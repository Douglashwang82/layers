import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../packages/database/src";
import {
  createGroup,
  inviteMember,
  revokeInvite,
} from "../../apps/web/src/features/groups/service";
import {
  createBatch,
  updateBatch,
  createJoinContext,
  joinEmailStart,
  joinEmailComplete,
  reissueInvitation,
} from "../../apps/web/src/features/membership/service";
import { localTestMailer } from "../../packages/shared/src/mail";
import type { Actor } from "../../packages/shared/src";
const admin: Actor = { id: crypto.randomUUID(), role: "ADMIN" };
const owner: Actor = { id: crypto.randomUUID(), role: "USER" };
const memberActor: Actor = { id: crypto.randomUUID(), role: "USER" };
const userIds = [admin.id, owner.id, memberActor.id];
const emails: string[] = [];
const batchIds: string[] = [];
let groupId: string;
let groupSlug: string;
function testEmail(prefix: string) {
  const email = `${prefix}-${crypto.randomUUID()}@group-owner-test.example`;
  emails.push(email);
  return email;
}
async function extractOtp(email: string) {
  const message = [...localTestMailer.sent]
    .reverse()
    .find((m) => m.to === email && m.kind === "membership_otp");
  const match = message?.text.match(/\d{6}/);
  if (!match) throw new Error("No OTP was sent to " + email);
  return match[0];
}
async function openBatch(capacity: number) {
  const batch = await createBatch(admin, {
    name: `Group owner ${crypto.randomUUID()}`,
    capacity,
  });
  batchIds.push(batch.id);
  return batch.id;
}
async function invitationFor(groupInviteId: string) {
  const row = await pool.query<{
    id: string;
    status: string;
    nomination_id: string;
  }>(
    `SELECT i.id, i.status, i.nomination_id FROM group_invite g
     JOIN membership_invitation i ON i.id = g.membership_invitation_id
     WHERE g.id = $1`,
    [groupInviteId],
  );
  return row.rows[0];
}
beforeAll(async () => {
  for (const [actor, name] of [
    [admin, "Admin"],
    [owner, "Group Owner"],
    [memberActor, "Existing Member"],
  ] as const)
    await pool.query(
      'INSERT INTO "user"(id,name,email,role,email_verified) VALUES($1,$2,$3,$4,true)',
      [actor.id, name, `${actor.id}@example.test`, actor.role],
    );
  await pool.query(
    `INSERT INTO membership_admission(user_id, source) VALUES ($1,'legacy')`,
    [memberActor.id],
  );
  const created = await createGroup(owner, {
    name: `Owner invite ${crypto.randomUUID()}`,
    nameChinese: "邀請測試",
    description: "Group owner invite test",
    city: "houston",
  });
  groupId = created.group.id;
  groupSlug = created.group.slug;
});
afterAll(async () => {
  const joined = (
    await pool.query<{ id: string }>(
      'SELECT id FROM "user" WHERE email = ANY($1::text[])',
      [emails],
    )
  ).rows.map((r) => r.id);
  const all = [...userIds, ...joined];
  await pool.query(`DELETE FROM "group" WHERE id = $1`, [groupId]);
  await pool.query(
    `DELETE FROM membership_admission WHERE user_id = ANY($1::uuid[])`,
    [all],
  );
  await pool.query(
    `DELETE FROM membership_audit WHERE actor_id = ANY($1::uuid[]) OR target_user_id = ANY($1::uuid[])`,
    [all],
  );
  await pool.query(
    `DELETE FROM membership_join_context WHERE invitation_id IN (
       SELECT id FROM membership_invitation WHERE nomination_id IN (
         SELECT id FROM membership_nomination WHERE nominator_id = ANY($1::uuid[]) OR email_normalized = ANY($2::text[])))`,
    [[owner.id, admin.id], emails],
  );
  await pool.query(
    `DELETE FROM membership_invitation WHERE nomination_id IN (SELECT id FROM membership_nomination WHERE nominator_id = ANY($1::uuid[]) OR email_normalized = ANY($2::text[]))`,
    [[owner.id, admin.id], emails],
  );
  await pool.query(
    `DELETE FROM membership_nomination WHERE nominator_id = ANY($1::uuid[]) OR email_normalized = ANY($2::text[])`,
    [[owner.id, admin.id], emails],
  );
  await pool.query(
    `DELETE FROM mail_outbox WHERE recipient = ANY($1::text[])`,
    [emails],
  );
  if (batchIds.length)
    await pool.query(
      `DELETE FROM membership_batch WHERE id = ANY($1::uuid[])`,
      [batchIds],
    );
  await pool.query(`DELETE FROM "user" WHERE id = ANY($1::uuid[])`, [all]);
  await pool.end();
});
describe("one-step group invite", () => {
  it("invites a non-member with a nomination, invitation and queued mail", async () => {
    const batchId = await openBatch(5);
    const email = testEmail("newbie");
    const result = await inviteMember(owner, groupId, {
      email: email.toUpperCase(),
      role: "editor",
    });
    expect(result.membership).toBe("invited");
    expect(result.delivery).toBe("email");
    expect(result.email).toBe(email);
    const invitation = await invitationFor(result.id);
    expect(invitation.status).toBe("issued");
    const nomination = await pool.query<{ source: string; status: string }>(
      `SELECT source, status FROM membership_nomination WHERE id = $1`,
      [invitation.nomination_id],
    );
    expect(nomination.rows[0]).toEqual({
      source: "group_owner",
      status: "approved",
    });
    const mail = await pool.query(
      `SELECT 1 FROM mail_outbox WHERE dedupe_key = $1`,
      [`invitation:${invitation.id}:v1`],
    );
    expect(mail.rowCount).toBe(1);
    await updateBatch(admin, batchId, { status: "closed" });
  });
  it("admits the person through the join flow and adds them to the group", async () => {
    const batchId = await openBatch(5);
    const email = testEmail("redeem");
    const result = await inviteMember(owner, groupId, {
      email,
      role: "editor",
    });
    const invitation = await invitationFor(result.id);
    // Switch to manual delivery so the raw token is retrievable via reissue.
    await pool.query(
      `UPDATE membership_invitation SET delivery = 'manual' WHERE id = $1`,
      [invitation.id],
    );
    const reissued = await reissueInvitation(owner, invitation.id);
    if (reissued.delivery !== "manual") throw new Error("expected manual");
    const context = await createJoinContext({ token: reissued.token });
    await joinEmailStart(context.secret, { acceptTerms: true });
    const otp = await extractOtp(email);
    const outcome = await joinEmailComplete(context.secret, { otp }, () => {});
    expect(outcome).toMatchObject({ joined: true, groupSlug });
    const member = await pool.query<{ role: string }>(
      `SELECT m.role FROM group_member m JOIN "user" u ON u.id = m.user_id
       WHERE m.group_id = $1 AND u.email = $2`,
      [groupId, email],
    );
    expect(member.rows[0]?.role).toBe("editor");
    const accepted = await pool.query(
      `SELECT accepted_at FROM group_invite WHERE id = $1`,
      [result.id],
    );
    expect(accepted.rows[0].accepted_at).not.toBeNull();
    await updateBatch(admin, batchId, { status: "closed" });
  });
  it("reports member for an already admitted account", async () => {
    const result = await inviteMember(owner, groupId, {
      email: `${memberActor.id}@example.test`,
      role: "viewer",
    });
    expect(result.membership).toBe("member");
    expect(await invitationFor(result.id)).toBeUndefined();
  });
  it("reports pending when the email has an open nomination", async () => {
    const batchId = await openBatch(5);
    const email = testEmail("pending");
    await pool.query(
      `INSERT INTO membership_nomination(email_normalized, nominator_id, source, status)
       VALUES ($1,$2,'member','pending_review')`,
      [email, admin.id],
    );
    const result = await inviteMember(owner, groupId, {
      email,
      role: "viewer",
    });
    expect(result.membership).toBe("pending");
    await updateBatch(admin, batchId, { status: "closed" });
  });
  it("keeps the group invite when the batch is closed or full", async () => {
    const closed = await inviteMember(owner, groupId, {
      email: testEmail("nobatch"),
      role: "viewer",
    });
    expect(closed.membership).toBe("unavailable");
    const batchId = await openBatch(1);
    await inviteMember(owner, groupId, {
      email: testEmail("seat"),
      role: "viewer",
    });
    const full = await inviteMember(owner, groupId, {
      email: testEmail("full"),
      role: "viewer",
    });
    expect(full.membership).toBe("unavailable");
    const kept = await pool.query(`SELECT 1 FROM group_invite WHERE id = $1`, [
      full.id,
    ]);
    expect(kept.rowCount).toBe(1);
    await updateBatch(admin, batchId, { status: "closed" });
  });
  it("revokes the linked membership invitation with the group invite", async () => {
    const batchId = await openBatch(5);
    const result = await inviteMember(owner, groupId, {
      email: testEmail("revoke"),
      role: "viewer",
    });
    const before = await invitationFor(result.id);
    expect(before.status).toBe("issued");
    await expect(revokeInvite(owner, groupId, result.id)).resolves.toEqual({
      revoked: true,
    });
    const after = await invitationFor(result.id);
    expect(after.status).toBe("revoked");
    const nomination = await pool.query<{ status: string }>(
      `SELECT status FROM membership_nomination WHERE id = $1`,
      [after.nomination_id],
    );
    expect(nomination.rows[0].status).toBe("closed");
    await updateBatch(admin, batchId, { status: "closed" });
  });
  it("never fails with a server error for concurrent invites to one email", async () => {
    const batchId = await openBatch(5);
    const email = testEmail("race");
    const results = await Promise.all([
      inviteMember(owner, groupId, { email, role: "viewer" }),
      inviteMember(owner, groupId, { email, role: "viewer" }),
    ]);
    expect(results.map((r) => r.membership).sort()).toEqual([
      "invited",
      "pending",
    ]);
    await updateBatch(admin, batchId, { status: "closed" });
  });
});
