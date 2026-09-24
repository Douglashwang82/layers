import { pool } from "@taiwanhub/database";
import type { PoolClient } from "pg";
import {
  AppError,
  requireActor,
  normalizeEmail,
  safeReturnTo,
  canTransitionNomination,
  batchHasCapacity,
  nominationEmailInput,
  nominationPatchInput,
  revisionedInput,
  nominationDecisionInput,
  reviewerToggleInput,
  batchCreateInput,
  batchUpdateInput,
  adminDirectInviteInput,
  joinContextInput,
  joinAcceptInput,
  joinEmailCompleteInput,
  type Actor,
  type NominationStatus,
} from "@taiwanhub/shared";
import { auth } from "@/lib/auth";
import { membershipMode, membershipIssuancePaused, appUrl } from "@/lib/config";
import {
  encryptOutboxPayload,
  type MailKind,
} from "@/lib/mail";
import { requireReviewer, requireAdmin } from "./access";
import { generateOpaqueToken, hashToken } from "./crypto";
import {
  getNominationById,
  listMyNominations,
  listReviewQueue,
  listReviewers as repoListReviewers,
  getOpenBatch,
  listBatches as repoListBatches,
  getBatchSeats,
  getInvitationById,
  getInvitationByTokenHash,
  getAdmission,
  getUserByEmail,
  isEffectiveReviewer,
  type NominationRow,
} from "./repository";
const TERMS_VERSION = "2026-09-24";
async function transaction<T>(fn: (tx: PoolClient) => Promise<T>) {
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    const result = await fn(tx);
    await tx.query("COMMIT");
    return result;
  } catch (e) {
    await tx.query("ROLLBACK");
    throw e;
  } finally {
    tx.release();
  }
}
function requireInviteOnly() {
  if (membershipMode !== "invite_only")
    throw new AppError(
      503,
      "MEMBERSHIP_PAUSED",
      "Membership is not accepting new accounts right now.",
    );
}
/** Issuance pause stops new approvals/invites but never blocks redeeming an already-issued one. */
function requireIssuanceOpen() {
  requireInviteOnly();
  if (membershipIssuancePaused)
    throw new AppError(
      503,
      "MEMBERSHIP_PAUSED",
      "New invitations are paused right now.",
    );
}
function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  const visible = local.slice(0, 1) || "*";
  return `${visible}${"*".repeat(Math.max(local.length - 1, 3))}@${domain}`;
}
function nominationView(row: NominationRow) {
  return {
    id: row.id,
    status: row.status,
    source: row.source,
    note: row.note,
    revision: row.revision,
    nominatorName: row.nominator_name,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
async function audit(
  tx: PoolClient,
  entry: {
    actorId?: string | null;
    action: string;
    nominationId?: string | null;
    invitationId?: string | null;
    targetUserId?: string | null;
    reason?: string | null;
    before?: unknown;
    after?: unknown;
  },
) {
  await tx.query(
    `INSERT INTO membership_audit(actor_id, action, nomination_id, invitation_id, target_user_id, reason, before_state, after_state)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      entry.actorId ?? null,
      entry.action,
      entry.nominationId ?? null,
      entry.invitationId ?? null,
      entry.targetUserId ?? null,
      entry.reason ?? null,
      entry.before ? JSON.stringify(entry.before) : null,
      entry.after ? JSON.stringify(entry.after) : null,
    ],
  );
}
async function enqueueMail(
  tx: PoolClient,
  kind: MailKind,
  recipient: string,
  dedupeKey: string,
  subject: string,
  text: string,
) {
  const { ciphertext, keyVersion } = encryptOutboxPayload({
    kind,
    to: recipient,
    subject,
    text,
  });
  await tx.query(
    `INSERT INTO mail_outbox(kind, dedupe_key, recipient, payload_ciphertext, payload_key_version)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [kind, dedupeKey, recipient, ciphertext, keyVersion],
  );
}
export async function getMembershipMe(actor: Actor | null) {
  const a = requireActor(actor);
  const [reviewer, nominations, openBatch] = await Promise.all([
    a.role === "ADMIN" ? Promise.resolve(true) : isEffectiveReviewer(a.id),
    listMyNominations(a.id),
    getOpenBatch(),
  ]);
  const batchSummary = openBatch
    ? { ...openBatch, ...(await getBatchSeats(openBatch.id)) }
    : null;
  return {
    reviewer,
    admin: a.role === "ADMIN",
    nominations: nominations.map(nominationView),
    openBatch: batchSummary,
  };
}
/** Duplicate targets (existing member or someone else's active nomination) get the same generic message; only the same nominator sees the existing case. */
export async function createNomination(actor: Actor | null, body: unknown) {
  const a = requireActor(actor);
  const input = nominationEmailInput.parse(body);
  const email = normalizeEmail(input.email);
  const userRow = await pool.query<{ email_verified: boolean }>(
    'SELECT email_verified FROM "user" WHERE id = $1',
    [a.id],
  );
  if (!userRow.rows[0]?.email_verified)
    throw new AppError(
      403,
      "EMAIL_VERIFICATION_REQUIRED",
      "Verify your email before nominating someone.",
    );
  if (await getUserByEmail(email))
    throw new AppError(
      409,
      "NOMINATION_UNAVAILABLE",
      "This nomination cannot be created.",
    );
  const existing = await pool.query<NominationRow>(
    `SELECT n.*, u.name AS nominator_name FROM membership_nomination n
     LEFT JOIN "user" u ON u.id = n.nominator_id
     WHERE n.email_normalized = $1 AND n.status IN ('pending_review','needs_info','approved')`,
    [email],
  );
  if (existing.rows[0]) {
    if (existing.rows[0].nominator_id === a.id)
      return { nomination: nominationView(existing.rows[0]), created: false };
    throw new AppError(
      409,
      "NOMINATION_UNAVAILABLE",
      "This nomination cannot be created.",
    );
  }
  try {
    const result = await pool.query<NominationRow>(
      `INSERT INTO membership_nomination(email_normalized, nominator_id, source, note)
       VALUES ($1,$2,'member',$3)
       RETURNING *, (SELECT name FROM "user" WHERE id = $2) AS nominator_name`,
      [email, a.id, input.note ?? null],
    );
    await pool.query(
      `INSERT INTO membership_audit(actor_id, action, nomination_id, after_state)
       VALUES ($1,'membership_nominated',$2,$3)`,
      [a.id, result.rows[0].id, JSON.stringify({ status: "pending_review" })],
    );
    return { nomination: nominationView(result.rows[0]), created: true };
  } catch (e) {
    if (e instanceof Error && /membership_nomination_open_email/.test(e.message))
      throw new AppError(
        409,
        "NOMINATION_UNAVAILABLE",
        "This nomination cannot be created.",
      );
    throw e;
  }
}
export async function listNominations(
  actor: Actor | null,
  scope: "mine" | "review",
) {
  const a = requireActor(actor);
  if (scope === "mine") return (await listMyNominations(a.id)).map(nominationView);
  await requireReviewer(a);
  return (await listReviewQueue()).map(nominationView);
}
async function loadOwnedNomination(id: string, tx: PoolClient) {
  const result = await tx.query<NominationRow>(
    `SELECT n.*, u.name AS nominator_name FROM membership_nomination n
     LEFT JOIN "user" u ON u.id = n.nominator_id
     WHERE n.id = $1 FOR UPDATE OF n`,
    [id],
  );
  if (!result.rows[0])
    throw new AppError(404, "NOT_FOUND", "This nomination is unavailable.");
  return result.rows[0];
}
export async function patchNomination(
  actor: Actor | null,
  id: string,
  body: unknown,
) {
  const a = requireActor(actor);
  const input = nominationPatchInput.parse(body);
  return transaction(async (tx) => {
    const row = await loadOwnedNomination(id, tx);
    if (row.nominator_id !== a.id)
      throw new AppError(403, "FORBIDDEN", "Only the nominator can do this.");
    if (row.status !== "pending_review" && row.status !== "needs_info")
      throw new AppError(
        409,
        "NOMINATION_UNAVAILABLE",
        "This nomination can no longer be edited.",
      );
    if (row.revision !== input.revision)
      throw new AppError(
        409,
        "REVISION_CONFLICT",
        "This nomination changed since you loaded it.",
      );
    const nextStatus: NominationStatus =
      row.status === "needs_info" ? "pending_review" : row.status;
    const result = await tx.query<NominationRow>(
      `UPDATE membership_nomination SET note = $1, status = $2, revision = revision + 1, updated_at = now()
       WHERE id = $3
       RETURNING *, (SELECT name FROM "user" WHERE id = nominator_id) AS nominator_name`,
      [input.note ?? null, nextStatus, id],
    );
    return nominationView(result.rows[0]);
  });
}
export async function withdrawNomination(
  actor: Actor | null,
  id: string,
  body: unknown,
) {
  const a = requireActor(actor);
  const input = revisionedInput.parse(body);
  return transaction(async (tx) => {
    const row = await loadOwnedNomination(id, tx);
    if (row.nominator_id !== a.id && a.role !== "ADMIN")
      throw new AppError(403, "FORBIDDEN", "Only the nominator can do this.");
    if (row.status !== "pending_review" && row.status !== "needs_info")
      throw new AppError(
        409,
        "NOMINATION_UNAVAILABLE",
        "This nomination can no longer be withdrawn.",
      );
    if (row.revision !== input.revision)
      throw new AppError(409, "REVISION_CONFLICT", "This nomination changed.");
    await tx.query(
      `UPDATE membership_nomination SET status = 'withdrawn', revision = revision + 1, updated_at = now() WHERE id = $1`,
      [id],
    );
    await audit(tx, {
      actorId: a.id,
      action: "membership_nomination_withdrawn",
      nominationId: id,
    });
    return { withdrawn: true };
  });
}
export async function decideNomination(
  actor: Actor | null,
  id: string,
  body: unknown,
) {
  const input = nominationDecisionInput.parse(body);
  const a =
    input.decision === "reject" ? requireAdmin(actor) : await requireReviewer(actor);
  const target: NominationStatus =
    input.decision === "approve"
      ? "approved"
      : input.decision === "needs_info"
        ? "needs_info"
        : "rejected";
  return transaction(async (tx) => {
    const batch = target === "approved" ? await getOpenBatch(tx) : null;
    const row = await loadOwnedNomination(id, tx);
    if (row.source === "member" && row.nominator_id === a.id)
      throw new AppError(
        403,
        "SELF_APPROVAL_FORBIDDEN",
        "You cannot decide on your own nomination.",
      );
    if (row.revision !== input.revision)
      throw new AppError(409, "REVISION_CONFLICT", "This nomination changed.");
    if (!canTransitionNomination(row.status as NominationStatus, target))
      throw new AppError(
        409,
        "NOMINATION_UNAVAILABLE",
        "This nomination can no longer be decided.",
      );
    if (target !== "approved") {
      await tx.query(
        `UPDATE membership_nomination SET status = $1, revision = revision + 1, updated_at = now() WHERE id = $2`,
        [target, id],
      );
      await audit(tx, {
        actorId: a.id,
        action: `membership_nomination_${target}`,
        nominationId: id,
        reason: input.reason ?? null,
      });
      return { status: target };
    }
    requireIssuanceOpen();
    if (!batch)
      throw new AppError(
        503,
        "BATCH_FULL",
        "No membership batch is open to accept invitations.",
      );
    const seats = await getBatchSeats(batch.id, tx);
    if (!batchHasCapacity(batch.capacity, seats.redeemed, seats.active_issued))
      throw new AppError(503, "BATCH_FULL", "This batch is full.");
    const token = generateOpaqueToken();
    const invitation = await tx.query<{ id: string }>(
      `INSERT INTO membership_invitation(nomination_id, batch_id, delivery, token_hash, expires_at)
       VALUES ($1,$2,'email',$3, now() + interval '14 days')
       RETURNING id`,
      [id, batch.id, hashToken(token)],
    );
    await tx.query(
      `UPDATE membership_nomination SET status = 'approved', approved_by = $1, approved_at = now(), revision = revision + 1, updated_at = now() WHERE id = $2`,
      [a.id, id],
    );
    await enqueueMail(
      tx,
      "membership_invitation",
      row.email_normalized,
      `invitation:${invitation.rows[0].id}:v1`,
      "You're invited to TaiwanHub",
      `${appUrl}/join#invite=${token}`,
    );
    await audit(tx, {
      actorId: a.id,
      action: "membership_invite_issued",
      nominationId: id,
      invitationId: invitation.rows[0].id,
    });
    return { status: "approved", invitationId: invitation.rows[0].id };
  });
}
async function requireInvitationActor(tx: PoolClient, invitationId: string, a: Actor) {
  const invitation = await tx.query<{
    id: string;
    nomination_id: string;
    status: string;
    delivery: string;
  }>(`SELECT * FROM membership_invitation WHERE id = $1 FOR UPDATE`, [
    invitationId,
  ]);
  if (!invitation.rows[0])
    throw new AppError(404, "NOT_FOUND", "This invitation is unavailable.");
  const nomination = await tx.query<{ nominator_id: string | null }>(
    `SELECT nominator_id FROM membership_nomination WHERE id = $1 FOR UPDATE`,
    [invitation.rows[0].nomination_id],
  );
  if (a.role !== "ADMIN" && nomination.rows[0]?.nominator_id !== a.id)
    throw new AppError(403, "FORBIDDEN", "Only the nominator can do this.");
  return invitation.rows[0];
}
export async function revokeInvitation(
  actor: Actor | null,
  invitationId: string,
  body: unknown,
) {
  const a = requireActor(actor);
  const reason = (body as { reason?: string } | null)?.reason ?? null;
  return transaction(async (tx) => {
    const invitation = await requireInvitationActor(tx, invitationId, a);
    if (invitation.status === "redeemed")
      throw new AppError(
        409,
        "INVITE_ALREADY_REDEEMED",
        "This invitation was already redeemed.",
      );
    if (invitation.status !== "issued") return { revoked: true };
    await tx.query(
      `UPDATE membership_invitation SET status = 'revoked', revoked_by = $1, revoked_at = now() WHERE id = $2`,
      [a.id, invitationId],
    );
    await tx.query(
      `UPDATE membership_nomination SET status = 'closed', updated_at = now() WHERE id = $1 AND status = 'approved'`,
      [invitation.nomination_id],
    );
    await audit(tx, {
      actorId: a.id,
      action: "membership_invitation_revoked",
      invitationId,
      nominationId: invitation.nomination_id,
      reason,
    });
    return { revoked: true };
  });
}
export async function reissueInvitation(actor: Actor | null, invitationId: string) {
  const a = requireActor(actor);
  return transaction(async (tx) => {
    const invitation = await requireInvitationActor(tx, invitationId, a);
    if (invitation.status !== "issued")
      throw new AppError(
        409,
        "NOMINATION_UNAVAILABLE",
        "Only a still-valid invitation can be reissued.",
      );
    const token = generateOpaqueToken();
    const updated = await tx.query<{ token_version: number; delivery: string }>(
      `UPDATE membership_invitation
       SET token_hash = $1, token_version = token_version + 1, expires_at = now() + interval '14 days', updated_at = now()
       WHERE id = $2
       RETURNING token_version, delivery`,
      [hashToken(token), invitationId],
    );
    await tx.query(`DELETE FROM membership_join_context WHERE invitation_id = $1`, [
      invitationId,
    ]);
    await audit(tx, {
      actorId: a.id,
      action: "membership_invitation_reissued",
      invitationId,
    });
    if (updated.rows[0].delivery === "manual")
      return { delivery: "manual" as const, token };
    const nomination = await tx.query<{ email_normalized: string }>(
      `SELECT email_normalized FROM membership_nomination WHERE id = $1`,
      [invitation.nomination_id],
    );
    await tx.query(
      `UPDATE mail_outbox SET status = 'superseded' WHERE dedupe_key LIKE $1 AND status = 'queued'`,
      [`invitation:${invitationId}:v%`],
    );
    await enqueueMail(
      tx,
      "membership_invitation",
      nomination.rows[0].email_normalized,
      `invitation:${invitationId}:v${updated.rows[0].token_version}`,
      "You're invited to TaiwanHub",
      `${appUrl}/join#invite=${token}`,
    );
    return { delivery: "email" as const };
  });
}
export async function adminDirectInvite(actor: Actor | null, body: unknown) {
  const a = requireAdmin(actor);
  requireIssuanceOpen();
  const input = adminDirectInviteInput.parse(body);
  const email = normalizeEmail(input.email);
  if (await getUserByEmail(email))
    throw new AppError(
      409,
      "NOMINATION_UNAVAILABLE",
      "This person is already a member.",
    );
  const existing = await pool.query(
    `SELECT 1 FROM membership_nomination WHERE email_normalized = $1 AND status IN ('pending_review','needs_info','approved')`,
    [email],
  );
  if (existing.rows[0])
    throw new AppError(
      409,
      "NOMINATION_UNAVAILABLE",
      "This email already has an active nomination.",
    );
  return transaction(async (tx) => {
    const batch = await tx.query<{ id: string; capacity: number; status: string }>(
      `SELECT id, capacity, status FROM membership_batch WHERE id = $1 FOR UPDATE`,
      [input.batchId],
    );
    if (!batch.rows[0] || batch.rows[0].status !== "open")
      throw new AppError(
        409,
        "BATCH_FULL",
        "That batch is not open to accept invitations.",
      );
    const seats = await getBatchSeats(batch.rows[0].id, tx);
    if (
      !batchHasCapacity(batch.rows[0].capacity, seats.redeemed, seats.active_issued)
    )
      throw new AppError(503, "BATCH_FULL", "This batch is full.");
    const nomination = await tx.query<{ id: string }>(
      `INSERT INTO membership_nomination(email_normalized, nominator_id, source, status, approved_by, approved_at)
       VALUES ($1,$2,'admin_direct','approved',$2, now())
       RETURNING id`,
      [email, a.id],
    );
    const token = generateOpaqueToken();
    const invitation = await tx.query<{ id: string }>(
      `INSERT INTO membership_invitation(nomination_id, batch_id, delivery, token_hash, expires_at)
       VALUES ($1,$2,$3,$4, now() + interval '14 days')
       RETURNING id`,
      [nomination.rows[0].id, batch.rows[0].id, input.delivery, hashToken(token)],
    );
    await audit(tx, {
      actorId: a.id,
      action: "membership_admin_direct_invite",
      nominationId: nomination.rows[0].id,
      invitationId: invitation.rows[0].id,
    });
    if (input.delivery === "manual")
      return {
        invitationId: invitation.rows[0].id,
        delivery: "manual" as const,
        link: `${appUrl}/join#invite=${token}`,
      };
    await enqueueMail(
      tx,
      "membership_invitation",
      email,
      `invitation:${invitation.rows[0].id}:v1`,
      "You're invited to TaiwanHub",
      `${appUrl}/join#invite=${token}`,
    );
    return { invitationId: invitation.rows[0].id, delivery: "email" as const };
  });
}
export async function listReviewers(actor: Actor | null) {
  requireAdmin(actor);
  return repoListReviewers();
}
export async function setReviewer(
  actor: Actor | null,
  userId: string,
  body: unknown,
) {
  const a = requireAdmin(actor);
  const input = reviewerToggleInput.parse(body);
  return transaction(async (tx) => {
    if (input.enabled) {
      await tx.query(
        `INSERT INTO membership_reviewer(user_id, granted_by)
         VALUES ($1,$2)
         ON CONFLICT (user_id) DO UPDATE SET granted_by = $2, granted_at = now(), revoked_by = NULL, revoked_at = NULL`,
        [userId, a.id],
      );
      await audit(tx, {
        actorId: a.id,
        action: "membership_reviewer_granted",
        targetUserId: userId,
        reason: input.reason ?? null,
      });
    } else {
      await tx.query(
        `UPDATE membership_reviewer SET revoked_by = $1, revoked_at = now() WHERE user_id = $2 AND revoked_at IS NULL`,
        [a.id, userId],
      );
      await audit(tx, {
        actorId: a.id,
        action: "membership_reviewer_revoked",
        targetUserId: userId,
        reason: input.reason ?? null,
      });
    }
    return { userId, enabled: input.enabled };
  });
}
export async function listBatches(actor: Actor | null) {
  requireAdmin(actor);
  return repoListBatches();
}
export async function createBatch(actor: Actor | null, body: unknown) {
  const a = requireAdmin(actor);
  const input = batchCreateInput.parse(body);
  try {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO membership_batch(name, capacity, created_by) VALUES ($1,$2,$3) RETURNING id`,
      [input.name, input.capacity, a.id],
    );
    return { id: result.rows[0].id };
  } catch (e) {
    if (e instanceof Error && /membership_batch_single_open/.test(e.message))
      throw new AppError(
        409,
        "NOMINATION_UNAVAILABLE",
        "Close the current open batch before opening another.",
      );
    throw e;
  }
}
export async function updateBatch(
  actor: Actor | null,
  batchId: string,
  body: unknown,
) {
  requireAdmin(actor);
  const input = batchUpdateInput.parse(body);
  return transaction(async (tx) => {
    if (input.capacity !== undefined) {
      const seats = await getBatchSeats(batchId, tx);
      if (input.capacity < seats.redeemed + seats.active_issued)
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          "Capacity cannot go below the number of seats already used.",
        );
    }
    try {
      const result = await tx.query(
        `UPDATE membership_batch SET
           name = COALESCE($1, name),
           capacity = COALESCE($2, capacity),
           status = COALESCE($3, status),
           updated_at = now()
         WHERE id = $4`,
        [input.name ?? null, input.capacity ?? null, input.status ?? null, batchId],
      );
      if (!result.rowCount)
        throw new AppError(404, "NOT_FOUND", "This batch is unavailable.");
    } catch (e) {
      if (e instanceof AppError) throw e;
      if (e instanceof Error && /membership_batch_single_open/.test(e.message))
        throw new AppError(
          409,
          "NOMINATION_UNAVAILABLE",
          "Another batch is already open.",
        );
      throw e;
    }
    return { updated: true };
  });
}
export async function createJoinContext(body: unknown) {
  requireInviteOnly();
  const { token, returnTo } = joinContextInput.parse(body);
  const invitation = await getInvitationByTokenHash(hashToken(token));
  if (
    !invitation ||
    invitation.status !== "issued" ||
    invitation.expires_at.getTime() <= Date.now()
  )
    throw new AppError(
      404,
      "INVITE_INVALID",
      "This invitation is no longer valid.",
    );
  const secret = generateOpaqueToken();
  await pool.query(
    `INSERT INTO membership_join_context(secret_hash, invitation_id, token_version, expires_at)
     VALUES ($1,$2,$3, now() + interval '15 minutes')`,
    [hashToken(secret), invitation.id, invitation.token_version],
  );
  return {
    secret,
    maskedEmail: maskEmail(invitation.email_normalized),
    nominatorName: invitation.nominator_name,
    invitationExpiresAt: invitation.expires_at.toISOString(),
    returnTo: safeReturnTo(returnTo),
  };
}
/**
 * `allowRedeemed` is for the post-OTP finalize step only: a client retrying
 * after a dropped response (AC09) must be able to re-run this with the same
 * cookie even though the context's own consumed_at is already set - the
 * invitation's redeemed_by is the real idempotency check at that point, not
 * consumed_at. Every other caller (joinEmailStart, the pre-OTP email lookup)
 * uses the default and only ever sees a still-issued invitation.
 */
async function loadJoinContext(
  secret: string,
  tx: PoolClient | typeof pool = pool,
  allowRedeemed = false,
) {
  const result = await tx.query<{
    id: string;
    invitation_id: string;
    token_version: number;
    consumed_at: Date | null;
    terms_version: string | null;
    terms_accepted_at: Date | null;
  }>(
    `SELECT * FROM membership_join_context WHERE secret_hash = $1 AND expires_at > now()`,
    [hashToken(secret)],
  );
  const context = result.rows[0];
  if (!context)
    throw new AppError(404, "INVITE_INVALID", "This invitation session has expired.");
  const invitation = await getInvitationById(context.invitation_id, tx);
  if (
    !invitation ||
    (invitation.status !== "issued" && !(allowRedeemed && invitation.status === "redeemed")) ||
    invitation.token_version !== context.token_version ||
    invitation.expires_at.getTime() <= Date.now()
  )
    throw new AppError(404, "INVITE_INVALID", "This invitation is no longer valid.");
  const nomination = await tx.query<{ email_normalized: string }>(
    `SELECT email_normalized FROM membership_nomination WHERE id = $1`,
    [invitation.nomination_id],
  );
  return { context, invitation, email: nomination.rows[0].email_normalized };
}
export async function joinEmailStart(secret: string, body: unknown) {
  requireInviteOnly();
  joinAcceptInput.parse(body);
  const { context, email } = await loadJoinContext(secret);
  await pool.query(
    `UPDATE membership_join_context SET terms_version = $1, terms_accepted_at = now() WHERE id = $2`,
    [TERMS_VERSION, context.id],
  );
  await auth.api.sendVerificationOTP({ body: { email, type: "sign-in" } });
  return { sent: true };
}
export async function joinEmailComplete(
  secret: string,
  body: unknown,
  forwardHeaders: (headers: Headers) => void,
) {
  requireInviteOnly();
  const input = joinEmailCompleteInput.parse(body);
  const { email } = await loadJoinContext(secret, pool, true);
  let otpResult: { headers: Headers; response: { token: string; user: { id: string } } };
  try {
    otpResult = (await auth.api.signInEmailOTP({
      body: { email, otp: input.otp },
      returnHeaders: true,
    })) as typeof otpResult;
  } catch {
    throw new AppError(400, "OTP_INVALID", "That code was incorrect or expired.");
  }
  const userId = otpResult.response.user.id;
  try {
    const outcome = await transaction(async (tx) => {
      const { context, invitation } = await loadJoinContext(secret, tx, true);
      if (invitation.status === "redeemed") {
        if (invitation.redeemed_by === userId) return { alreadyJoined: true };
        throw new AppError(
          409,
          "INVITE_ALREADY_REDEEMED",
          "This invitation was already redeemed.",
        );
      }
      const existingAdmission = await getAdmission(userId, tx);
      if (existingAdmission) {
        await tx.query(
          `UPDATE membership_invitation SET status = 'revoked', revoked_at = now() WHERE id = $1`,
          [invitation.id],
        );
        await tx.query(
          `UPDATE membership_nomination SET status = 'closed', updated_at = now() WHERE id = $1`,
          [invitation.nomination_id],
        );
        await tx.query(
          `UPDATE membership_join_context SET consumed_at = now() WHERE id = $1`,
          [context.id],
        );
        await audit(tx, {
          action: "membership_invitation_revoked",
          invitationId: invitation.id,
          nominationId: invitation.nomination_id,
          targetUserId: userId,
          reason: "already_member",
        });
        return { alreadyMember: true };
      }
      await tx.query(
        `INSERT INTO membership_admission(user_id, source, invitation_id, terms_version, terms_accepted_at)
         VALUES ($1,'invitation',$2,$3,$4)`,
        [userId, invitation.id, context.terms_version, context.terms_accepted_at],
      );
      await tx.query(
        `UPDATE membership_invitation SET status = 'redeemed', redeemed_by = $1, redeemed_at = now() WHERE id = $2`,
        [userId, invitation.id],
      );
      await tx.query(
        `UPDATE membership_nomination SET status = 'joined', updated_at = now() WHERE id = $1`,
        [invitation.nomination_id],
      );
      await tx.query(
        `UPDATE membership_join_context SET consumed_at = now() WHERE id = $1`,
        [context.id],
      );
      await audit(tx, {
        action: "membership_joined",
        invitationId: invitation.id,
        nominationId: invitation.nomination_id,
        targetUserId: userId,
      });
      await tx.query(
        `INSERT INTO analytics_event(user_id, name, properties) VALUES ($1,'membership_joined','{}')`,
        [userId],
      );
      return { joined: true };
    });
    forwardHeaders(otpResult.headers);
    return outcome;
  } catch (e) {
    await pool
      .query('DELETE FROM "session" WHERE token = $1', [otpResult.response.token])
      .catch(() => {});
    throw e;
  }
}
export async function retryMail(actor: Actor | null, mailId: string) {
  requireAdmin(actor);
  const result = await pool.query(
    `UPDATE mail_outbox SET status = 'queued', next_attempt_at = now(), lease_until = NULL
     WHERE id = $1 AND status IN ('failed','queued')`,
    [mailId],
  );
  if (!result.rowCount)
    throw new AppError(404, "NOT_FOUND", "This mail job is unavailable.");
  return { retried: true };
}
export async function getNomination(actor: Actor | null, id: string) {
  const a = requireActor(actor);
  const row = await getNominationById(id);
  if (!row)
    throw new AppError(404, "NOT_FOUND", "This nomination is unavailable.");
  const canSee =
    a.role === "ADMIN" ||
    row.nominator_id === a.id ||
    (await isEffectiveReviewer(a.id));
  if (!canSee)
    throw new AppError(404, "NOT_FOUND", "This nomination is unavailable.");
  return nominationView(row);
}
