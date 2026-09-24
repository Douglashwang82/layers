import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { pool } from "../../packages/database/src";
import { runMailOutboxOnce } from "../../packages/database/src/mail-worker";
import {
  adminDirectInvite,
  revokeInvitation,
} from "../../apps/web/src/features/membership/service";
import { createBatch, updateBatch } from "../../apps/web/src/features/membership/service";
import { localTestMailer } from "../../packages/shared/src";
import type { Actor } from "../../packages/shared/src";
const admin: Actor = { id: crypto.randomUUID(), role: "ADMIN" };
let batchId: string;
const cleanupEmails: string[] = [];
function testEmail(prefix: string) {
  const email = `${prefix}-${crypto.randomUUID()}@mail-worker-test.example`;
  cleanupEmails.push(email);
  return email;
}
beforeAll(async () => {
  await pool.query('INSERT INTO "user"(id,name,email,role) VALUES($1,$2,$3,$4)', [
    admin.id,
    "Mail Worker Test Admin",
    `${admin.id}@example.test`,
    "ADMIN",
  ]);
  const created = await createBatch(admin, {
    name: `Mail worker ${crypto.randomUUID()}`,
    capacity: 10,
  });
  batchId = created.id;
});
afterEach(() => {
  localTestMailer.sent = [];
  vi.restoreAllMocks();
});
afterAll(async () => {
  await updateBatch(admin, batchId, { status: "closed" });
  await pool.query(
    `DELETE FROM mail_outbox WHERE recipient = ANY($1::text[])`,
    [cleanupEmails],
  );
  await pool.query(
    `DELETE FROM membership_audit WHERE invitation_id IN (SELECT id FROM membership_invitation WHERE nomination_id IN (SELECT id FROM membership_nomination WHERE email_normalized = ANY($1::text[])))`,
    [cleanupEmails],
  );
  await pool.query(
    `DELETE FROM membership_invitation WHERE nomination_id IN (SELECT id FROM membership_nomination WHERE email_normalized = ANY($1::text[]))`,
    [cleanupEmails],
  );
  await pool.query(`DELETE FROM membership_nomination WHERE email_normalized = ANY($1::text[])`, [
    cleanupEmails,
  ]);
  await pool.query(`DELETE FROM membership_batch WHERE id = $1`, [batchId]);
  await pool.query(`DELETE FROM "user" WHERE id = $1`, [admin.id]);
  await pool.end();
});
describe("mail outbox worker", () => {
  it("sends a queued invitation email and marks it provider_accepted", async () => {
    const email = testEmail("send");
    await adminDirectInvite(admin, { email, batchId, delivery: "email" });
    const summary = await runMailOutboxOnce();
    expect(summary.sent).toBeGreaterThanOrEqual(1);
    expect(localTestMailer.sent.some((m) => m.to === email)).toBe(true);
    const row = await pool.query<{ status: string }>(
      `SELECT status FROM mail_outbox WHERE recipient = $1`,
      [email],
    );
    expect(row.rows[0].status).toBe("provider_accepted");
  });
  it("marks a superseded row instead of sending after the invitation is revoked", async () => {
    const email = testEmail("stale");
    const invite = await adminDirectInvite(admin, { email, batchId, delivery: "email" });
    if (invite.delivery !== "email") throw new Error("expected email delivery");
    await revokeInvitation(admin, invite.invitationId, {});
    const summary = await runMailOutboxOnce();
    expect(summary.superseded).toBeGreaterThanOrEqual(1);
    expect(localTestMailer.sent.some((m) => m.to === email)).toBe(false);
  });
  it("retries with backoff on a transient send failure and stops after too many attempts", async () => {
    const email = testEmail("fail");
    await adminDirectInvite(admin, { email, batchId, delivery: "email" });
    vi.spyOn(localTestMailer, "send").mockRejectedValue(new Error("provider timeout"));
    const first = await runMailOutboxOnce();
    expect(first.retrying).toBeGreaterThanOrEqual(1);
    const afterFirst = await pool.query<{ status: string; attempts: number; next_attempt_at: Date }>(
      `SELECT status, attempts, next_attempt_at FROM mail_outbox WHERE recipient = $1`,
      [email],
    );
    expect(afterFirst.rows[0].status).toBe("queued");
    expect(afterFirst.rows[0].attempts).toBe(1);
    expect(afterFirst.rows[0].next_attempt_at.getTime()).toBeGreaterThan(Date.now());
    await pool.query(`UPDATE mail_outbox SET attempts = 4, next_attempt_at = now() WHERE recipient = $1`, [
      email,
    ]);
    const final = await runMailOutboxOnce();
    expect(final.failed).toBeGreaterThanOrEqual(1);
    const afterFinal = await pool.query<{ status: string; last_error_code: string }>(
      `SELECT status, last_error_code FROM mail_outbox WHERE recipient = $1`,
      [email],
    );
    expect(afterFinal.rows[0].status).toBe("failed");
    expect(afterFinal.rows[0].last_error_code).toBe("PROVIDER_TIMEOUT");
  });
});
