import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../packages/database/src";
import {
  createNomination,
  patchNomination,
  withdrawNomination,
  decideNomination,
  adminDirectInvite,
  setReviewer,
  createBatch,
  updateBatch,
  createJoinContext,
  joinEmailStart,
  joinEmailComplete,
  revokeInvitation,
} from "../../apps/web/src/features/membership/service";
import { localTestMailer } from "../../apps/web/src/lib/mail";
import type { Actor } from "../../packages/shared/src";
const admin: Actor = { id: crypto.randomUUID(), role: "ADMIN" };
const nominatorA: Actor = { id: crypto.randomUUID(), role: "USER" };
const nominatorB: Actor = { id: crypto.randomUUID(), role: "USER" };
const reviewer: Actor = { id: crypto.randomUUID(), role: "USER" };
const plainUser: Actor = { id: crypto.randomUUID(), role: "USER" };
const cleanupUserIds = [
  admin.id,
  nominatorA.id,
  nominatorB.id,
  reviewer.id,
  plainUser.id,
];
const cleanupBatchIds: string[] = [];
const cleanupEmails: string[] = [];
function testEmail(prefix: string) {
  const email = `${prefix}-${crypto.randomUUID()}@membership-test.example`;
  cleanupEmails.push(email);
  return email;
}
async function makeUser(actor: Actor, emailVerified = true) {
  cleanupUserIds.push(actor.id);
  await pool.query(
    'INSERT INTO "user"(id,name,email,role,email_verified) VALUES($1,$2,$3,$4,$5)',
    [actor.id, "Membership Test", `${actor.id}@example.test`, actor.role, emailVerified],
  );
}
async function extractOtp(email: string) {
  const message = [...localTestMailer.sent]
    .reverse()
    .find((m) => m.to === email && m.kind === "membership_otp");
  const match = message?.text.match(/\d{6}/);
  if (!match) throw new Error("No OTP was sent to " + email);
  return match[0];
}
beforeAll(async () => {
  for (const actor of [admin, nominatorA, nominatorB, reviewer, plainUser])
    await makeUser(actor);
});
afterAll(async () => {
  // Exact ids/emails created by this file only - never a broad LIKE sweep,
  // so a stray row left by an unrelated earlier run can't collide with a live FK.
  const joinedUserIds = (
    await pool.query<{ id: string }>(
      'SELECT id FROM "user" WHERE email = ANY($1::text[])',
      [cleanupEmails],
    )
  ).rows.map((r) => r.id);
  const allUserIds = [...cleanupUserIds, ...joinedUserIds];
  await pool.query(`DELETE FROM membership_admission WHERE user_id = ANY($1::uuid[])`, [
    allUserIds,
  ]);
  await pool.query(
    `DELETE FROM membership_audit WHERE actor_id = ANY($1::uuid[]) OR target_user_id = ANY($1::uuid[])`,
    [allUserIds],
  );
  await pool.query(
    `DELETE FROM membership_join_context WHERE invitation_id IN (
       SELECT id FROM membership_invitation WHERE nomination_id IN (
         SELECT id FROM membership_nomination WHERE nominator_id = ANY($1::uuid[]) OR email_normalized = ANY($2::text[])
       )
     )`,
    [cleanupUserIds, cleanupEmails],
  );
  await pool.query(
    `DELETE FROM membership_invitation WHERE nomination_id IN (SELECT id FROM membership_nomination WHERE nominator_id = ANY($1::uuid[]) OR email_normalized = ANY($2::text[]))`,
    [cleanupUserIds, cleanupEmails],
  );
  await pool.query(
    `DELETE FROM membership_nomination WHERE nominator_id = ANY($1::uuid[]) OR email_normalized = ANY($2::text[])`,
    [cleanupUserIds, cleanupEmails],
  );
  await pool.query(`DELETE FROM membership_reviewer WHERE user_id = ANY($1::uuid[])`, [
    cleanupUserIds,
  ]);
  if (cleanupBatchIds.length)
    await pool.query(`DELETE FROM membership_batch WHERE id = ANY($1::uuid[])`, [
      cleanupBatchIds,
    ]);
  await pool.query(`DELETE FROM "user" WHERE id = ANY($1::uuid[])`, [allUserIds]);
  await pool.end();
});
describe("nomination lifecycle", () => {
  it("lets a verified member nominate, and treats a retry from the same nominator as idempotent", async () => {
    const email = testEmail("friend");
    const first = await createNomination(nominatorA, { email });
    expect(first.created).toBe(true);
    expect(first.nomination.status).toBe("pending_review");
    const second = await createNomination(nominatorA, { email });
    expect(second.created).toBe(false);
    expect(second.nomination.id).toBe(first.nomination.id);
  });
  it("gives a different nominator and an existing-member target the same generic error", async () => {
    const email = testEmail("friend");
    await createNomination(nominatorA, { email });
    await expect(createNomination(nominatorB, { email })).rejects.toMatchObject({
      code: "NOMINATION_UNAVAILABLE",
    });
    await expect(
      createNomination(nominatorB, { email: `${plainUser.id}@example.test` }),
    ).rejects.toMatchObject({ code: "NOMINATION_UNAVAILABLE" });
  });
  it("requires a verified email to nominate", async () => {
    const unverified: Actor = { id: crypto.randomUUID(), role: "USER" };
    await makeUser(unverified, false);
    await expect(
      createNomination(unverified, { email: testEmail("x") }),
    ).rejects.toMatchObject({ code: "EMAIL_VERIFICATION_REQUIRED" });
  });
  it("moves needs_info back to pending_review on patch, and rejects a stale revision", async () => {
    const email = testEmail("friend");
    const { nomination } = await createNomination(nominatorA, { email });
    const decided = await decideNomination(admin, nomination.id, {
      decision: "needs_info",
      revision: nomination.revision,
      reason: "Tell me more.",
    });
    expect(decided.status).toBe("needs_info");
    await expect(
      patchNomination(nominatorA, nomination.id, {
        note: "more context",
        revision: nomination.revision,
      }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    const patched = await patchNomination(nominatorA, nomination.id, {
      note: "more context",
      revision: nomination.revision + 1,
    });
    expect(patched.status).toBe("pending_review");
  });
  it("lets the nominator withdraw a pending nomination", async () => {
    const email = testEmail("friend");
    const { nomination } = await createNomination(nominatorA, { email });
    const result = await withdrawNomination(nominatorA, nomination.id, {
      revision: nomination.revision,
    });
    expect(result.withdrawn).toBe(true);
    const reopened = await createNomination(nominatorB, { email });
    expect(reopened.created).toBe(true);
  });
  it("forbids a reviewer from approving their own nomination, and requires ADMIN to reject", async () => {
    await setReviewer(admin, nominatorA.id, { enabled: true });
    const email = testEmail("friend");
    const { nomination } = await createNomination(nominatorA, { email });
    await expect(
      decideNomination(nominatorA, nomination.id, {
        decision: "approve",
        revision: nomination.revision,
      }),
    ).rejects.toMatchObject({ code: "SELF_APPROVAL_FORBIDDEN" });
    await expect(
      decideNomination(reviewer, nomination.id, {
        decision: "reject",
        revision: nomination.revision,
        reason: "not applicable",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await setReviewer(admin, nominatorA.id, { enabled: false });
  });
});
describe("batch capacity", () => {
  it("reserves a seat on approval, refuses once full, blocks a second open batch, and floors capacity at current usage", async () => {
    const { id: batchId } = await createBatch(admin, {
      name: `Batch ${crypto.randomUUID()}`,
      capacity: 1,
    });
    cleanupBatchIds.push(batchId);
    const first = await adminDirectInvite(admin, {
      email: testEmail("seat"),
      batchId,
      delivery: "manual",
    });
    expect(first.delivery).toBe("manual");
    await expect(
      adminDirectInvite(admin, { email: testEmail("seat"), batchId, delivery: "manual" }),
    ).rejects.toMatchObject({ code: "BATCH_FULL" });
    await expect(
      createBatch(admin, { name: `Extra ${crypto.randomUUID()}`, capacity: 5 }),
    ).rejects.toMatchObject({ code: "NOMINATION_UNAVAILABLE" });
    await updateBatch(admin, batchId, { capacity: 2 });
    await adminDirectInvite(admin, { email: testEmail("seat"), batchId, delivery: "manual" });
    await expect(
      updateBatch(admin, batchId, { capacity: 1 }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await updateBatch(admin, batchId, { status: "closed" });
  });
});
describe("full join flow", () => {
  let batchId: string;
  beforeAll(async () => {
    const created = await createBatch(admin, {
      name: `Join ${crypto.randomUUID()}`,
      capacity: 5,
    });
    batchId = created.id;
    cleanupBatchIds.push(batchId);
  });
  afterAll(async () => {
    await updateBatch(admin, batchId, { status: "closed" });
  });
  it("completes admission end-to-end via a manually delivered invitation", async () => {
    const email = testEmail("newmember");
    const invite = await adminDirectInvite(admin, { email, batchId, delivery: "manual" });
    if (invite.delivery !== "manual") throw new Error("expected manual delivery");
    const url = new URL(invite.link);
    const token = url.hash.replace("#invite=", "");
    const context = await createJoinContext({ token });
    expect(context.maskedEmail).toMatch(/\*/);
    await joinEmailStart(context.secret, { acceptTerms: true });
    const otp = await extractOtp(email);
    const outcome = await joinEmailComplete(context.secret, { otp }, () => {});
    expect(outcome).toEqual({ joined: true });
    const admission = await pool.query(
      `SELECT source FROM membership_admission a JOIN "user" u ON u.id = a.user_id WHERE u.email = $1`,
      [email],
    );
    expect(admission.rows[0]?.source).toBe("invitation");
    const invitationRow = await pool.query<{ status: string }>(
      `SELECT status FROM membership_invitation WHERE id = $1`,
      [invite.invitationId],
    );
    expect(invitationRow.rows[0].status).toBe("redeemed");
  });
  it("finalizes admission for an account Better Auth already created on an interrupted first attempt", async () => {
    // Simulates the AC09 recovery case: the OTP verify call succeeded and
    // created the user (and, in production, a session Better Auth would have
    // set a cookie for), but our own admission transaction never ran - e.g.
    // the process died right after auth.api.signInEmailOTP returned. The
    // invitation is therefore still 'issued' and no admission row exists yet.
    const { auth } = await import("../../apps/web/src/lib/auth");
    const email = testEmail("interrupted");
    const invite = await adminDirectInvite(admin, { email, batchId, delivery: "manual" });
    if (invite.delivery !== "manual") throw new Error("expected manual delivery");
    const url = new URL(invite.link);
    const token = url.hash.replace("#invite=", "");
    const context = await createJoinContext({ token });
    await joinEmailStart(context.secret, { acceptTerms: true });
    const firstOtp = await extractOtp(email);
    await auth.api.signInEmailOTP({ body: { email, otp: firstOtp } });
    const stillIssued = await pool.query<{ status: string }>(
      `SELECT status FROM membership_invitation WHERE id = $1`,
      [invite.invitationId],
    );
    expect(stillIssued.rows[0].status).toBe("issued");
    await joinEmailStart(context.secret, { acceptTerms: true });
    const secondOtp = await extractOtp(email);
    const outcome = await joinEmailComplete(context.secret, { otp: secondOtp }, () => {});
    expect(outcome).toEqual({ joined: true });
    const admission = await pool.query(
      `SELECT source FROM membership_admission a JOIN "user" u ON u.id = a.user_id WHERE u.email = $1`,
      [email],
    );
    expect(admission.rows[0]?.source).toBe("invitation");
  });
  it("rejects redemption of a revoked invitation", async () => {
    const email = testEmail("revoked");
    const invite = await adminDirectInvite(admin, { email, batchId, delivery: "manual" });
    if (invite.delivery !== "manual") throw new Error("expected manual delivery");
    const url = new URL(invite.link);
    const token = url.hash.replace("#invite=", "");
    await revokeInvitation(admin, invite.invitationId, {});
    await expect(createJoinContext({ token })).rejects.toMatchObject({
      code: "INVITE_INVALID",
    });
  });
});
