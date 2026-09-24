import { pool } from "@taiwanhub/database";
import type { PoolClient } from "pg";
type Queryable = Pick<typeof pool, "query"> | PoolClient;
export type NominationRow = {
  id: string;
  email_normalized: string;
  nominator_id: string | null;
  nominator_name: string | null;
  source: string;
  note: string | null;
  status: string;
  revision: number;
  approved_by: string | null;
  approved_at: Date | null;
  created_at: Date;
  updated_at: Date;
};
export async function getNominationById(id: string, db: Queryable = pool) {
  const result = await db.query<NominationRow>(
    `SELECT n.*, u.name AS nominator_name
     FROM membership_nomination n
     LEFT JOIN "user" u ON u.id = n.nominator_id
     WHERE n.id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}
export async function listMyNominations(nominatorId: string) {
  const result = await pool.query<NominationRow>(
    `SELECT n.*, u.name AS nominator_name
     FROM membership_nomination n
     LEFT JOIN "user" u ON u.id = n.nominator_id
     WHERE n.nominator_id = $1
     ORDER BY n.created_at DESC
     LIMIT 50`,
    [nominatorId],
  );
  return result.rows;
}
export async function listReviewQueue() {
  const result = await pool.query<NominationRow>(
    `SELECT n.*, u.name AS nominator_name
     FROM membership_nomination n
     LEFT JOIN "user" u ON u.id = n.nominator_id
     WHERE n.status IN ('pending_review', 'needs_info')
     ORDER BY n.created_at ASC
     LIMIT 50`,
  );
  return result.rows;
}
export async function isEffectiveReviewer(userId: string) {
  const result = await pool.query(
    `SELECT 1 FROM membership_reviewer WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
  return (result.rowCount ?? 0) > 0;
}
export async function listReviewers() {
  const result = await pool.query<{
    user_id: string;
    name: string;
    email: string;
    granted_by: string;
    granted_at: Date;
    revoked_by: string | null;
    revoked_at: Date | null;
  }>(
    `SELECT r.user_id, u.name, u.email, r.granted_by, r.granted_at, r.revoked_by, r.revoked_at
     FROM membership_reviewer r
     JOIN "user" u ON u.id = r.user_id
     ORDER BY r.granted_at DESC`,
  );
  return result.rows;
}
export async function getOpenBatch(db: Queryable = pool) {
  const result = await db.query<{
    id: string;
    name: string;
    capacity: number;
    status: string;
  }>(`SELECT id, name, capacity, status FROM membership_batch WHERE status = 'open' LIMIT 1`);
  return result.rows[0] ?? null;
}
export async function listBatches() {
  const result = await pool.query<{
    id: string;
    name: string;
    capacity: number;
    status: string;
    redeemed: number;
    active_issued: number;
  }>(
    `SELECT b.id, b.name, b.capacity, b.status,
       (SELECT count(*)::int FROM membership_invitation i WHERE i.batch_id = b.id AND i.status = 'redeemed') AS redeemed,
       (SELECT count(*)::int FROM membership_invitation i WHERE i.batch_id = b.id AND i.status = 'issued' AND i.expires_at > now()) AS active_issued
     FROM membership_batch b
     ORDER BY b.created_at DESC`,
  );
  return result.rows;
}
export async function getBatchSeats(batchId: string, db: Queryable = pool) {
  const result = await db.query<{ redeemed: number; active_issued: number }>(
    `SELECT
       (SELECT count(*)::int FROM membership_invitation WHERE batch_id = $1 AND status = 'redeemed') AS redeemed,
       (SELECT count(*)::int FROM membership_invitation WHERE batch_id = $1 AND status = 'issued' AND expires_at > now()) AS active_issued`,
    [batchId],
  );
  return result.rows[0];
}
export type InvitationRow = {
  id: string;
  nomination_id: string;
  batch_id: string;
  delivery: string;
  token_hash: string;
  token_version: number;
  expires_at: Date;
  status: string;
  redeemed_by: string | null;
  redeemed_at: Date | null;
};
export async function getInvitationById(id: string, db: Queryable = pool) {
  const result = await db.query<InvitationRow>(
    `SELECT * FROM membership_invitation WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}
export async function getInvitationByTokenHash(tokenHash: string) {
  const result = await pool.query<
    InvitationRow & { email_normalized: string; nominator_name: string | null }
  >(
    `SELECT i.*, n.email_normalized, u.name AS nominator_name
     FROM membership_invitation i
     JOIN membership_nomination n ON n.id = i.nomination_id
     LEFT JOIN "user" u ON u.id = n.nominator_id
     WHERE i.token_hash = $1`,
    [tokenHash],
  );
  return result.rows[0] ?? null;
}
/**
 * Read-only admission gate check used from databaseHooks.user.create.before.
 * A live, unexpired, un-revoked invitation for this email is sufficient; no
 * write happens here, so this check is reliable regardless of whichever
 * account-creation call site (OTP, OAuth, or otherwise) is running it - see
 * docs/adr/0001-membership-invitation-auth-transaction-boundary.md section 2.2.
 */
export async function hasLiveInvitationForEmail(emailNormalized: string) {
  const result = await pool.query(
    `SELECT 1 FROM membership_invitation i
     JOIN membership_nomination n ON n.id = i.nomination_id
     WHERE n.email_normalized = $1 AND i.status = 'issued' AND i.expires_at > now()
     LIMIT 1`,
    [emailNormalized],
  );
  return (result.rowCount ?? 0) > 0;
}
export async function getAdmission(userId: string, db: Queryable = pool) {
  const result = await db.query<{
    user_id: string;
    source: string;
    invitation_id: string | null;
    admitted_at: Date;
  }>(`SELECT * FROM membership_admission WHERE user_id = $1`, [userId]);
  return result.rows[0] ?? null;
}
export async function getUserByEmail(emailNormalized: string) {
  const result = await pool.query<{
    id: string;
    email: string;
    email_verified: boolean;
  }>('SELECT id, email, email_verified FROM "user" WHERE email = $1', [
    emailNormalized,
  ]);
  return result.rows[0] ?? null;
}
