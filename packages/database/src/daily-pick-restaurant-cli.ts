import "dotenv/config";
import { createRestaurantRuntime } from "./restaurant-runtime";
import { scheduleRestaurantDay, workRestaurantJob } from "./restaurant-jobs";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { pool } from "./index";
import { loadRestaurantArea } from "./daily-pick-restaurant-run";
import {
  createFakeCopyAdapter,
  createFakeQualificationAdapter,
} from "./restaurant-providers";
import {
  isCalendarDate,
  localDate,
  type DailyHoursSource,
} from "../../shared/src";

/** Real worker by default; --fixtures is restricted to a local development database. */
const fixturesSchema = z.record(
  z.string(),
  z.object({
    rating: z.number().min(0).max(5).nullable(),
    ratingCount: z.number().int().min(0).nullable(),
    businessStatus: z
      .enum(["OPERATIONAL", "CLOSED_TEMPORARILY", "CLOSED_PERMANENTLY"])
      .nullable(),
    hours: z.array(
      z.object({
        date: z.iso.date(),
        periods: z.array(
          z.object({
            open: z.number().int().min(0).max(1440),
            close: z.number().int().min(0).max(2880),
          }),
        ),
      }),
    ),
  }),
);
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
    else throw new Error(`Unknown argument: ${argv[i]}`);
    if (!argv[i]) throw new Error("Missing argument value.");
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
  const parsed = fixturesSchema.parse(JSON.parse(await readFile(path, "utf8")));
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
  const { citySlug, date, fixturesPath } = parseArgs(process.argv.slice(2));
  if (fixturesPath) {
    const host = new URL(process.env.DATABASE_URL!).hostname;
    if (
      process.env.NODE_ENV === "production" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(host)
    )
      throw new Error("Fixture mode requires a local development database.");
  }
  const area = await loadRestaurantArea(pool, citySlug);
  if (!area) throw new Error(`Unknown restaurant discovery area: ${citySlug}`);
  if (!area.enabled)
    throw new Error(
      `Area "${citySlug}" is not enabled. This is expected until the Phase 0 ADR and area configuration are approved; enable it explicitly in restaurant_discovery_area only after that.`,
    );
  const adapters = fixturesPath
    ? {
        qualification: createFakeQualificationAdapter(
          await loadFixtures(fixturesPath),
        ),
        copy: createFakeCopyAdapter(),
      }
    : createRestaurantRuntime(area);
  const targetDate = date ?? localDate(new Date(), area.timezone);
  await scheduleRestaurantDay(area, targetDate);
  for (let i = 0; i < 10; i++) {
    const result = await workRestaurantJob(area, adapters);
    if (!result) break;
    console.log(
      JSON.stringify({ event: "restaurant_worker", citySlug, result }),
    );
    if (result.status === "failed") process.exitCode = 1;
  }
}
/** Keeps the cause visible in CI logs without echoing connection strings or keys. */
function redact(message: string) {
  return message
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]")
    .replace(/\b(?:sk-ant-[\w-]+|AIza[\w-]{20,})\b/g, "[redacted]")
    .slice(0, 500);
}
main()
  .catch((e) => {
    console.error(
      e instanceof Error
        ? `${e.name}: restaurant worker failed: ${redact(e.message)}`
        : "Restaurant worker failed.",
    );
    process.exitCode = 1;
  })
  .finally(() => pool.end());
