import { pool } from "./index";
type Queryable = Pick<typeof pool, "query">;
export type LegacyCandidate = {
  id: string;
  email: string;
  created_at: Date;
  providers: string[];
};
/**
 * Genuine pre-membership accounts that still lack an admission row. Run with
 * --dry-run and review every candidate before the admission gate is enforced
 * (docs/plans/membership-beta-readiness-plan.md section 7, step 3).
 *
 * A candidate must:
 * - have at least one account (login credential) row - seed/demo users never
 *   get one (see seed.ts), so no hardcoded id list or email-domain guess;
 * - not look like a partial invitation join: an account created at or after
 *   an invitation was issued to the same email only exists because the join
 *   flow started, and must finish through that invitation, never be promoted;
 * - optionally, predate --created-before (e.g. the membership launch time).
 *
 * Idempotent via the NOT EXISTS check and the ON CONFLICT guard.
 */
export async function findLegacyCandidates(
  db: Queryable = pool,
  createdBefore: Date | null = null,
) {
  const result = await db.query<LegacyCandidate>(
    `SELECT u.id, u.email, u.created_at, array_agg(DISTINCT a.provider_id ORDER BY a.provider_id) AS providers
     FROM "user" u
     JOIN account a ON a.user_id = u.id
     WHERE NOT EXISTS (SELECT 1 FROM membership_admission m WHERE m.user_id = u.id)
       AND NOT EXISTS (
         SELECT 1 FROM membership_invitation i
         JOIN membership_nomination n ON n.id = i.nomination_id
         WHERE n.email_normalized = lower(u.email) AND i.created_at <= u.created_at
       )
       AND ($1::timestamptz IS NULL OR u.created_at < $1::timestamptz)
     GROUP BY u.id
     ORDER BY u.created_at`,
    [createdBefore],
  );
  return result.rows;
}
export async function backfillLegacyAdmissions(
  candidates: LegacyCandidate[],
  db: Queryable = pool,
) {
  let inserted = 0;
  for (const row of candidates) {
    const result = await db.query(
      `INSERT INTO membership_admission(user_id, source) VALUES ($1, 'legacy') ON CONFLICT (user_id) DO NOTHING`,
      [row.id],
    );
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}
function parseCreatedBefore(argv: string[]) {
  const arg = argv.find((a) => a.startsWith("--created-before="));
  if (!arg) return null;
  const value = new Date(arg.slice("--created-before=".length));
  if (Number.isNaN(value.getTime()))
    throw new Error("--created-before must be an ISO date/time.");
  return value;
}
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const createdBefore = parseCreatedBefore(process.argv);
  const candidates = await findLegacyCandidates(pool, createdBefore);
  console.log(
    `${candidates.length} account(s) need a legacy admission row${createdBefore ? ` (created before ${createdBefore.toISOString()})` : ""}.`,
  );
  if (dryRun) {
    for (const row of candidates)
      console.log(
        ` - ${row.email} · created ${row.created_at.toISOString()} · ${row.providers.join(", ")}`,
      );
    return;
  }
  const inserted = await backfillLegacyAdmissions(candidates);
  console.log(`Backfill complete: ${inserted} admission row(s) added.`);
}
if (require.main === module)
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
