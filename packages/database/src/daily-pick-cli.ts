import "dotenv/config";
import { pool } from "./index";
import { runDailyPickGeneration } from "./daily-pick";
import { parseDailyPickArgs } from "./daily-pick-args";
/**
 * pnpm daily-pick:generate [CITY_SLUG] [--date YYYY-MM-DD]
 * Idempotent: safe to run repeatedly or concurrently for the same day. Prints a
 * JSON summary and exits non-zero when any city failed.
 */
async function main() {
  const summary = await runDailyPickGeneration(
    parseDailyPickArgs(process.argv.slice(2)),
  );
  console.log(JSON.stringify({ event: "daily_pick_run", ...summary }));
  if (summary.errors.length) process.exitCode = 1;
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
