import { createHash, randomBytes } from "node:crypto";
import { pool } from "./index";
/**
 * Only-local, only-CLI tool for a brand-new environment that has no ADMIN
 * yet. It never runs over HTTP and never accepts a client-supplied field; the
 * only input is the operator's own command line (docs/invitation-membership-implementation-plan.md
 * section 9). Once the resulting invitation is redeemed, grant that account
 * ADMIN with the existing `pnpm admin:grant <email>`.
 */
async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email || !email.includes("@"))
    throw new Error("Usage: pnpm membership:bootstrap operator@example.com");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serializes concurrent invocations against each other for the whole
    // transaction; an advisory lock key scoped to this tool only.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('membership_bootstrap'))");
    const admin = await client.query('SELECT 1 FROM "user" WHERE role = $1 LIMIT 1', [
      "ADMIN",
    ]);
    if ((admin.rowCount ?? 0) > 0)
      throw new Error(
        "An ADMIN already exists. Use the normal ADMIN direct-invite flow instead.",
      );
    const activeBootstrap = await client.query(
      `SELECT 1 FROM membership_nomination WHERE source = 'operator_bootstrap' AND status IN ('pending_review','needs_info','approved') LIMIT 1`,
    );
    if ((activeBootstrap.rowCount ?? 0) > 0)
      throw new Error(
        "A bootstrap invitation is already active. Reissue it instead of creating a new one.",
      );
    const existingUser = await client.query('SELECT 1 FROM "user" WHERE email = $1', [
      email,
    ]);
    if ((existingUser.rowCount ?? 0) > 0)
      throw new Error(`An account already exists for ${email}.`);
    const batch = await client.query<{ id: string }>(
      `INSERT INTO membership_batch(name, capacity, status) VALUES ($1, 1, 'open') RETURNING id`,
      [`Bootstrap for ${email}`],
    );
    const nomination = await client.query<{ id: string }>(
      `INSERT INTO membership_nomination(email_normalized, nominator_id, source, status, approved_at)
       VALUES ($1, NULL, 'operator_bootstrap', 'approved', now())
       RETURNING id`,
      [email],
    );
    const token = randomBytes(20).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await client.query(
      `INSERT INTO membership_invitation(nomination_id, batch_id, delivery, token_hash, expires_at)
       VALUES ($1, $2, 'manual', $3, now() + interval '14 days')`,
      [nomination.rows[0].id, batch.rows[0].id, tokenHash],
    );
    await client.query(
      `INSERT INTO membership_audit(action, nomination_id, reason)
       VALUES ('membership_bootstrap_invite_issued', $1, $2)`,
      [nomination.rows[0].id, `operator=${process.env.USER ?? process.env.USERNAME ?? "unknown"}`],
    );
    await client.query("COMMIT");
    const baseUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
    console.log(`Bootstrap invitation created for ${email}.`);
    console.log(`One-time link (share it out of band, it cannot be read back):`);
    console.log(`${baseUrl}/join#invite=${token}`);
    console.log(
      `After they complete it, run: pnpm admin:grant ${email}`,
    );
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
