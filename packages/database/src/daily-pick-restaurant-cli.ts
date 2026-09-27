import "dotenv/config";
import { readFile } from "node:fs/promises";
import { pool } from "./index";
import {
  loadRestaurantArea,
  prepareRestaurantPickRun,
} from "./daily-pick-restaurant-run";
import {
  createFakeCopyAdapter,
  createFakeQualificationAdapter,
} from "./restaurant-providers";
import {
  isCalendarDate,
  localDate,
  type DailyHoursSource,
} from "../../shared/src";

/**
 * pnpm daily-pick:restaurant:worker CITY_SLUG [--date YYYY-MM-DD] [--fixtures path.json]
 *
 * Offline-only entrypoint for the version 2 restaurant pipeline (see
 * docs/plans/daily-restaurant-recommendation-implementation-plan.md section
 * 9's "offline fixture/simulation mode"). It never constructs a real
 * provider or model adapter: only the deterministic fakes from
 * restaurant-providers.ts, seeded from an optional fixtures file. Wiring the
 * real Google Places / Anthropic adapters into a scheduled run is a separate,
 * environment-scoped step that requires the Phase 0 ADR, a server API key
 * and an explicitly enabled area; this file intentionally has no flag that
 * reaches them.
 *
 * This CLI can only ever reach `prepareRestaurantPickRun`, which never
 * publishes — it stops at `ready_for_review` (or `empty`/`failed`) and
 * leaves a pending, human-unreviewed `restaurant_copy` row. There is no
 * function this file calls, and no flag it accepts, that can turn that into
 * a live public recommendation: only `publishRestaurantPickRun`, called
 * separately by an authenticated moderator action after
 * `approveRestaurantCopy`, can do that. As defense in depth, this CLI also
 * refuses outright when NODE_ENV=production, since a fake-adapter run has no
 * legitimate reason to execute against a production database at all.
 *
 * Fixtures file shape (keyed by provider place ID, matching
 * place_provider_reference.provider_place_id):
 * {
 *   "<providerPlaceId>": {
 *     "rating": 4.6, "ratingCount": 120, "businessStatus": "OPERATIONAL",
 *     "hours": [{ "date": "2026-09-27", "periods": [{ "open": 600, "close": 1320 }] }]
 *   }
 * }
 */
type FixtureFile = Record<
  string,
  {
    rating: number | null;
    ratingCount: number | null;
    businessStatus:
      "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY" | null;
    hours: { date: string; periods: { open: number; close: number }[] }[];
  }
>;

function parseArgs(argv: string[]) {
  const citySlug = argv[0];
  if (!citySlug || citySlug.startsWith("--"))
    throw new Error(
      "Usage: daily-pick:restaurant:worker CITY_SLUG [--date YYYY-MM-DD] [--fixtures path.json]",
    );
  let date: string | undefined;
  let fixturesPath: string | undefined;
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--date") date = argv[++i];
    else if (argv[i] === "--fixtures") fixturesPath = argv[++i];
  }
  if (date && !isCalendarDate(date))
    throw new Error(`Invalid date: ${date}. Use YYYY-MM-DD.`);
  return { citySlug, date, fixturesPath };
}

async function loadFixtures(path: string | undefined) {
  const fixtures = new Map<
    string,
    {
      rating: number | null;
      ratingCount: number | null;
      businessStatus:
        "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY" | null;
      hoursByDate: Map<string, DailyHoursSource>;
    }
  >();
  if (!path) return fixtures;
  const parsed = JSON.parse(await readFile(path, "utf8")) as FixtureFile;
  for (const [providerPlaceId, entry] of Object.entries(parsed)) {
    const hoursByDate = new Map<string, DailyHoursSource>(
      entry.hours.map((h) => [h.date, h]),
    );
    fixtures.set(providerPlaceId, {
      rating: entry.rating,
      ratingCount: entry.ratingCount,
      businessStatus: entry.businessStatus,
      hoursByDate,
    });
  }
  return fixtures;
}

async function main() {
  if (process.env.NODE_ENV === "production")
    throw new Error(
      "Refusing to run the fake-adapter CLI with NODE_ENV=production. This command has no path to real adapters or to publication; it should not run against a production database at all.",
    );
  const { citySlug, date, fixturesPath } = parseArgs(process.argv.slice(2));
  const area = await loadRestaurantArea(pool, citySlug);
  if (!area) throw new Error(`Unknown restaurant discovery area: ${citySlug}`);
  if (!area.enabled)
    throw new Error(
      `Area "${citySlug}" is not enabled. This is expected until the Phase 0 ADR and area configuration are approved; enable it explicitly in restaurant_discovery_area only after that.`,
    );
  const fixtures = await loadFixtures(fixturesPath);
  const qualification = createFakeQualificationAdapter(fixtures);
  const copy = createFakeCopyAdapter();
  const targetDate = date ?? localDate(new Date(), area.timezone);
  const result = await prepareRestaurantPickRun(area, targetDate, {
    qualification,
    copy,
  });
  console.log(
    JSON.stringify({
      event: "restaurant_pick_prepare",
      citySlug,
      date: targetDate,
      fixturesPath: fixturesPath ?? null,
      result,
    }),
  );
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
