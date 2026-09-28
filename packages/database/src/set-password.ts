import { hashPassword } from "better-auth/crypto";
import { pool } from "./index";
/**
 * Only-local, only-CLI tool for setting or resetting an existing account's
 * password directly, without going through the email-delivered reset flow
 * (docs/guides/engineering-onboarding.md). Uses the same scrypt hashing
 * Better Auth's default emailAndPassword config applies, so the account can
 * sign in with the new password afterward. It never runs over HTTP and never
 * accepts a client-supplied field.
 */
async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const newPassword = process.argv[3];
  if (!email || !email.includes("@") || !newPassword)
    throw new Error(
      "Usage: pnpm auth:set-password email@example.com newPassword",
    );
  if (newPassword.length < 10)
    throw new Error("Password must be at least 10 characters.");
  const client = await pool.connect();
  try {
    const user = await client.query<{ id: string }>(
      'SELECT id FROM "user" WHERE email = $1',
      [email],
    );
    if (!user.rowCount) throw new Error(`No account exists for ${email}.`);
    const userId = user.rows[0].id;
    const hash = await hashPassword(newPassword);
    await client.query("BEGIN");
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM account WHERE provider_id = 'credential' AND user_id = $1`,
      [userId],
    );
    if (existing.rowCount) {
      await client.query(
        `UPDATE account SET password = $1, updated_at = now() WHERE id = $2`,
        [hash, existing.rows[0].id],
      );
    } else {
      await client.query(
        `INSERT INTO account(account_id, provider_id, user_id, password)
         VALUES ($1, 'credential', $1, $2)`,
        [userId, hash],
      );
    }
    await client.query("COMMIT");
    console.log(`Password set for ${email}.`);
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
