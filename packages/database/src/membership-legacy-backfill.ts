import { pool } from "./index";
/**
 * Run once at cutover, before flipping MEMBERSHIP_MODE to invite_only (plan
 * section 9). Gives every real existing account a source=legacy admission
 * row so normal login isn't gated. "Real" here means "has at least one
 * account (login credential) row" - seed/demo users never get one (see
 * seed.ts), so this needs no hardcoded id list and can't be fooled by an
 * email domain. Safe to re-run: idempotent via the NOT EXISTS check and the
 * ON CONFLICT guard.
 */
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const candidates = await pool.query<{ id: string; email: string }>(`
    SELECT u.id, u.email FROM "user" u
    WHERE EXISTS (SELECT 1 FROM account a WHERE a.user_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM membership_admission m WHERE m.user_id = u.id)
    ORDER BY u.created_at
  `);
  console.log(
    `${candidates.rows.length} account(s) need a legacy admission row.`,
  );
  if (dryRun) {
    for (const row of candidates.rows) console.log(" -", row.email);
    return;
  }
  for (const row of candidates.rows) {
    await pool.query(
      `INSERT INTO membership_admission(user_id, source) VALUES ($1, 'legacy') ON CONFLICT (user_id) DO NOTHING`,
      [row.id],
    );
  }
  console.log("Backfill complete.");
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
