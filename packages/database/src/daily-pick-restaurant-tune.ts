import "dotenv/config";
import { readFile } from "node:fs/promises";
import { pool } from "./index";
import {
  loadRestaurantArea,
  prepareRestaurantPickRun,
  approveRestaurantCopy,
  RunBusy,
  type RestaurantArea,
} from "./daily-pick-restaurant-run";
import { enqueueRestaurantJob, workRestaurantJob } from "./restaurant-jobs";
import {
  createFakeCopyAdapter,
  createFakeQualificationAdapter,
  type RestaurantQualitySnapshot,
} from "./restaurant-providers";
import { isCalendarDate, localDate, addDays } from "../../shared/src";

/**
 * Local-only iteration tool for the restaurant recommendation pipeline.
 * Not wired into CI or production: it writes straight to
 * restaurant_discovery_area.config and reuses the fake fixture adapters, so a
 * moderator can see how a rating/config change moves the top-10 report
 * without hand-editing fixture JSON or SQL each time. Refuses anything but a
 * local development database, exactly like daily-pick-restaurant-cli.ts.
 */

type Fixture = Omit<RestaurantQualitySnapshot, "retrievedAt">;

function parseArgs(argv: string[]) {
  const citySlug = argv[0];
  if (!citySlug || citySlug.startsWith("--"))
    throw new Error(
      "Usage: daily-pick:restaurant:tune CITY_SLUG [--date YYYY-MM-DD] [--reset] [--publish]\n" +
        "  [--rating N] [--rating-count N] [--business-status OPERATIONAL|CLOSED_TEMPORARILY|CLOSED_PERMANENTLY]\n" +
        "  [--closed] [--fixtures FILE.json]\n" +
        "  [--min-rating N] [--min-rating-count N] [--food-rotation-days N] [--restaurant-repeat-days N]\n" +
        "  [--rating-prior N] [--rating-prior-weight N] [--max-evidence-age-minutes N] [--max-copy-attempts N] [--report-size N]",
    );
  const opts: Record<string, string> = {};
  const flags = new Set<string>();
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    if (key === "reset" || key === "publish" || key === "closed") {
      flags.add(key);
      continue;
    }
    const value = argv[++i];
    if (value === undefined) throw new Error(`Missing value for --${key}`);
    opts[key] = value;
  }
  return { citySlug, opts, flags };
}

const ruleConfigFlagMap: Record<string, string> = {
  "min-rating": "minRating",
  "min-rating-count": "minRatingCount",
  "food-rotation-days": "foodRotationDays",
  "restaurant-repeat-days": "restaurantRepeatDays",
  "rating-prior": "ratingPrior",
  "rating-prior-weight": "ratingPriorWeight",
  "max-evidence-age-minutes": "maxEvidenceAgeMinutes",
  "max-copy-attempts": "maxCopyAttempts",
  "report-size": "reportSize",
};

function requireLocalDatabase() {
  const host = new URL(process.env.DATABASE_URL!).hostname;
  if (
    process.env.NODE_ENV === "production" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(host)
  )
    throw new Error(
      "daily-pick:restaurant:tune requires a local development database.",
    );
}

async function mergeAreaConfig(area: RestaurantArea, opts: Record<string, string>) {
  const patch: Record<string, number> = {};
  for (const [flag, key] of Object.entries(ruleConfigFlagMap)) {
    if (opts[flag] === undefined) continue;
    const value = Number(opts[flag]);
    if (!Number.isFinite(value)) throw new Error(`Invalid --${flag}: ${opts[flag]}`);
    patch[key] = value;
  }
  if (!Object.keys(patch).length) return area;
  const merged = { ...area.config, ...patch };
  await pool.query(
    "UPDATE restaurant_discovery_area SET config = $2::jsonb, updated_at = now() WHERE id = $1",
    [area.id, JSON.stringify(merged)],
  );
  console.log(`Area config updated: ${JSON.stringify(patch)}`);
  return { ...area, config: merged };
}

async function candidateProviderIds(areaId: string) {
  const result = await pool.query<{ provider_place_id: string | null }>(
    `SELECT (SELECT r.provider_place_id FROM place_provider_reference r WHERE r.subject_id=s.id AND r.state='current' LIMIT 1) AS provider_place_id
     FROM restaurant_candidate c JOIN place_subject s ON s.id = c.subject_id
     WHERE c.area_id = $1 AND c.state = 'approved'`,
    [areaId],
  );
  return result.rows.map((r) => r.provider_place_id).filter((id): id is string => !!id);
}

async function buildFixtures(
  area: RestaurantArea,
  date: string,
  opts: Record<string, string>,
  flags: Set<string>,
): Promise<Map<string, Fixture>> {
  if (opts.fixtures) {
    const raw = JSON.parse(await readFile(opts.fixtures, "utf8")) as Record<
      string,
      {
        rating: number | null;
        ratingCount: number | null;
        businessStatus: Fixture["businessStatus"];
        hours: { date: string; periods: { open: number; close: number }[] }[];
      }
    >;
    return new Map(
      Object.entries(raw).map(([id, v]) => [
        id,
        {
          rating: v.rating,
          ratingCount: v.ratingCount,
          businessStatus: v.businessStatus,
          hoursByDate: new Map(v.hours.map((h) => [h.date, h])),
        },
      ]),
    );
  }
  const rating = opts.rating !== undefined ? Number(opts.rating) : 4.6;
  const ratingCount = opts["rating-count"] !== undefined ? Number(opts["rating-count"]) : 200;
  const businessStatus = flags.has("closed")
    ? "CLOSED_TEMPORARILY"
    : ((opts["business-status"] as Fixture["businessStatus"]) ?? "OPERATIONAL");
  const hoursByDate = flags.has("closed")
    ? new Map()
    : new Map([[date, { date, periods: [{ open: 0, close: 1440 }] }]]);
  const ids = await candidateProviderIds(area.id);
  if (!ids.length)
    throw new Error(
      `No approved candidates with a provider place ID found for area ${area.citySlug}.`,
    );
  const fixture: Fixture = { rating, ratingCount, businessStatus, hoursByDate };
  return new Map(ids.map((id) => [id, fixture]));
}

async function resetRun(areaId: string, date: string) {
  // Only unreviewed drafts block a new attempt; terminal runs (published,
  // empty, failed) stay as history and a publish replaces the current pick.
  const drafts = await pool.query<{ id: string }>(
    `SELECT id FROM daily_pick_run WHERE area_id=$1 AND run_date=$2
     AND status IN ('ready_for_review','ready_to_publish')`,
    [areaId, date],
  );
  if (!drafts.rows.length) {
    console.log(`No unreviewed draft for ${date}; starting a new attempt.`);
    return;
  }
  for (const { id: runId } of drafts.rows) {
    await pool.query("DELETE FROM restaurant_job WHERE run_id=$1", [runId]);
    await pool.query("DELETE FROM restaurant_copy WHERE run_id=$1", [runId]);
    await pool.query("DELETE FROM daily_pick_run WHERE id=$1", [runId]);
    console.log(`Discarded unreviewed draft ${runId} for ${date}.`);
  }
}

async function pickFreeDate(areaId: string, timezone: string, start?: string) {
  let date = start ?? localDate(new Date(), timezone);
  for (let i = 0; i < 365; i++) {
    const existing = await pool.query(
      "SELECT 1 FROM daily_pick_run WHERE area_id=$1 AND run_date=$2",
      [areaId, date],
    );
    if (!existing.rowCount) return date;
    date = addDays(date, 1);
  }
  throw new Error("Could not find a free date within a year.");
}

async function printReport(runId: string) {
  const rows = await pool.query<{
    report_position: number;
    label: string;
    decision: string;
    score: number | null;
    primary_reason_code: string;
  }>(
    `SELECT rc.report_position,
       COALESCE(p.name, (SELECT r.provider_place_id FROM place_provider_reference r WHERE r.subject_id=s.id AND r.state='current' LIMIT 1), rc.subject_id::text)
         || ' [' || COALESCE((SELECT c.food_type FROM restaurant_candidate c WHERE c.subject_id=rc.subject_id LIMIT 1), 'no food type') || ']' AS label,
       rc.decision, rc.score, rc.primary_reason_code
     FROM daily_pick_run_candidate rc
     JOIN place_subject s ON s.id = rc.subject_id
     LEFT JOIN place p ON p.id = s.catalog_place_id
     WHERE rc.run_id=$1 ORDER BY rc.report_position`,
    [runId],
  );
  console.log("\nTop-10 report:");
  for (const r of rows.rows)
    console.log(
      `  ${r.report_position}. ${r.label} — ${r.decision} (score=${r.score?.toFixed(2) ?? "—"}, ${r.primary_reason_code})`,
    );
}

async function main() {
  requireLocalDatabase();
  const { citySlug, opts, flags } = parseArgs(process.argv.slice(2));
  if (opts.date && !isCalendarDate(opts.date))
    throw new Error(`Invalid --date: ${opts.date}. Use YYYY-MM-DD.`);

  let area = await loadRestaurantArea(pool, citySlug);
  if (!area) throw new Error(`Unknown restaurant discovery area: ${citySlug}`);
  if (!area.enabled)
    throw new Error(`Area "${citySlug}" is not enabled.`);

  area = await mergeAreaConfig(area, opts);

  const date = opts.date ?? (await pickFreeDate(area.id, area.timezone));
  if (flags.has("reset")) await resetRun(area.id, date);

  const fixtures = await buildFixtures(area, date, opts, flags);
  const adapters = {
    qualification: createFakeQualificationAdapter(fixtures),
    copy: createFakeCopyAdapter(),
  };

  const prepared = await prepareRestaurantPickRun(area, date, adapters);
  console.log(JSON.stringify({ event: "prepare", date, result: prepared }, null, 2));
  if ("runId" in prepared) await printReport(prepared.runId);

  if (flags.has("publish")) {
    if (prepared.status !== "ready_for_review" || !("copyId" in prepared) || !prepared.copyId) {
      console.log("Nothing to publish: run has no approved winner/copy.");
      return;
    }
    const anyUser = await pool.query<{ id: string }>('SELECT id FROM "user" LIMIT 1');
    if (!anyUser.rows[0])
      throw new Error("No local user found to record as copy approver; seed the dev DB first.");
    await approveRestaurantCopy(prepared.copyId, anyUser.rows[0].id);
    console.log("Copy approved.");
    // If this date already has a published pick (e.g. a new attempt after a
    // prior --reset-refused publish), publishRestaurantPickRun requires
    // expectedPickId to match it, exactly like the admin UI's "replace" flow.
    const current = await pool.query<{ id: string }>(
      `SELECT d.id FROM daily_pick d JOIN city c ON c.id = d.city_id
       WHERE c.slug = $1 AND d.pick_date = $2 AND d.status = 'published'`,
      [area.citySlug, date],
    );
    const expectedPickId = current.rows[0]?.id ?? null;
    if (expectedPickId) console.log(`Replacing published pick ${expectedPickId}.`);
    await enqueueRestaurantJob({
      areaId: area.id,
      date,
      kind: "publish",
      runId: prepared.runId,
      expectedPickId,
    });
    for (let i = 0; i < 5; i++) {
      const result = await workRestaurantJob(area, adapters);
      if (!result) break;
      console.log(JSON.stringify({ event: "publish", result }, null, 2));
    }
  }
}

main()
  .catch((e) => {
    if (e instanceof RunBusy)
      console.error(
        `Run ${e.runId} is an unreviewed draft for this date. Rerun with --reset to discard it.`,
      );
    else console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
