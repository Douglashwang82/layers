import { z } from "zod";
import { calendarDate } from "../../shared/src/daily-pick";
/**
 * `[CITY_SLUG] [--date YYYY-MM-DD]`, validated before any database access so
 * an impossible date is a usage error rather than a database error.
 */
export function parseDailyPickArgs(args: string[]) {
  const dateIndex = args.indexOf("--date");
  const date =
    dateIndex >= 0 ? calendarDate.parse(args[dateIndex + 1] ?? "") : undefined;
  const rest = args.filter(
    (arg, i) => dateIndex < 0 || (i !== dateIndex && i !== dateIndex + 1),
  );
  const unknown = rest.find((arg) => arg.startsWith("--"));
  if (unknown) throw new Error(`Unknown option: ${unknown}`);
  if (rest.length > 1) throw new Error("Provide at most one city slug.");
  const citySlug = rest[0]
    ? z
        .string()
        .regex(/^[a-z0-9-]{1,80}$/, "Use a city slug such as houston.")
        .parse(rest[0])
    : undefined;
  return { citySlug, date };
}
