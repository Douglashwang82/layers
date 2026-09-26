import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { pool } from "../../packages/database/src";
import { runMailOutboxOnce } from "../../packages/database/src/mail-worker";
import {
  adminDirectInvite,
  revokeInvitation,
  reissueInvitation,
  listMailJobs,
  retryMail,
} from "../../apps/web/src/features/membership/service";
import {
  createBatch,
  updateBatch,
} from "../../apps/web/src/features/membership/service";
import {
  localTestMailer,
  MailDeliveryError,
  type Mailer,
} from "../../packages/shared/src/mail";
import type { Actor } from "../../packages/shared/src";
const admin: Actor = { id: crypto.randomUUID(), role: "ADMIN" };
const member: Actor = { id: crypto.randomUUID(), role: "USER" };
let batchId: string;
const cleanupEmails: string[] = [];
function testEmail(prefix: string) {
  const email = `${prefix}-${crypto.randomUUID()}@mail-worker-test.example`;
  cleanupEmails.push(email);
  return email;
}
async function queueInvitation(prefix: string) {
  const email = testEmail(prefix);
  const invite = await adminDirectInvite(admin, {
    email,
    batchId,
    delivery: "email",
  });
  if (invite.delivery !== "email") throw new Error("expected email delivery");
  const row = await pool.query<{ id: string; dedupe_key: string }>(
    `SELECT id, dedupe_key FROM mail_outbox WHERE recipient = $1`,
    [email],
  );
  return {
    email,
    invitationId: invite.invitationId,
    mailId: row.rows[0].id,
    dedupeKey: row.rows[0].dedupe_key,
  };
}
async function outboxRow(mailId: string) {
  const result = await pool.query<{
    status: string;
    attempts: number;
    last_error_code: string | null;
    next_attempt_at: Date;
    first_attempt_at: Date | null;
    sender: string | null;
    lease_owner: string | null;
  }>(`SELECT * FROM mail_outbox WHERE id = $1`, [mailId]);
  return result.rows[0];
}
function failingMailer(error: Error): Mailer {
  return {
    sender: "TaiwanHub Test <test@taiwanhub.invalid>",
    send: vi.fn(async () => {
      throw error;
    }),
  };
}
function sentTo(email: string) {
  return localTestMailer.sent.filter((m) => m.to === email);
}
beforeAll(async () => {
  for (const actor of [admin, member])
    await pool.query(
      'INSERT INTO "user"(id,name,email,role) VALUES($1,$2,$3,$4)',
      [actor.id, "Mail Worker Test", `${actor.id}@example.test`, actor.role],
    );
  const created = await createBatch(admin, {
    name: `Mail worker ${crypto.randomUUID()}`,
    capacity: 60,
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
    `DELETE FROM membership_audit WHERE actor_id = $2 OR invitation_id IN (SELECT id FROM membership_invitation WHERE nomination_id IN (SELECT id FROM membership_nomination WHERE email_normalized = ANY($1::text[])))`,
    [cleanupEmails, admin.id],
  );
  await pool.query(
    `DELETE FROM membership_invitation WHERE nomination_id IN (SELECT id FROM membership_nomination WHERE email_normalized = ANY($1::text[]))`,
    [cleanupEmails],
  );
  await pool.query(
    `DELETE FROM membership_nomination WHERE email_normalized = ANY($1::text[])`,
    [cleanupEmails],
  );
  await pool.query(`DELETE FROM membership_batch WHERE id = $1`, [batchId]);
  await pool.query(`DELETE FROM "user" WHERE id = ANY($1::uuid[])`, [
    [admin.id, member.id],
  ]);
  await pool.end();
});
describe("mail outbox worker", () => {
  it("sends a queued invitation email and marks it provider_accepted", async () => {
    const { email, mailId } = await queueInvitation("send");
    const summary = await runMailOutboxOnce();
    expect(summary.sent).toBeGreaterThanOrEqual(1);
    expect(sentTo(email)).toHaveLength(1);
    expect((await outboxRow(mailId)).status).toBe("provider_accepted");
  });
  it("sends the bilingual template with the dedupe key as idempotency key, and freezes the sender", async () => {
    const { email, mailId, dedupeKey } = await queueInvitation("identity");
    await runMailOutboxOnce();
    const [sent] = sentTo(email);
    expect(sent.idempotencyKey).toBe(dedupeKey);
    expect(sent.from).toBe(localTestMailer.sender);
    expect(sent.text).toContain("/join#invite=");
    expect(sent.text).toContain("邀請");
    const row = await outboxRow(mailId);
    expect(row.attempts).toBe(1);
    expect(row.sender).toBe(localTestMailer.sender);
    expect(row.first_attempt_at).not.toBeNull();
    expect(row.lease_owner).toBeNull();
  });
  it("marks a superseded row instead of sending after the invitation is revoked", async () => {
    const { email, invitationId } = await queueInvitation("stale");
    await revokeInvitation(admin, invitationId, {});
    const summary = await runMailOutboxOnce();
    expect(summary.superseded).toBeGreaterThanOrEqual(1);
    expect(sentTo(email)).toHaveLength(0);
  });
  it("supersedes a job whose invitation has expired", async () => {
    const { email, invitationId, mailId } = await queueInvitation("expired");
    await pool.query(
      `UPDATE membership_invitation SET expires_at = now() - interval '1 second' WHERE id = $1`,
      [invitationId],
    );
    await runMailOutboxOnce();
    expect(sentTo(email)).toHaveLength(0);
    expect((await outboxRow(mailId)).status).toBe("superseded");
  });
  it("retries with backoff on a transient send failure and stops after too many attempts", async () => {
    const { mailId } = await queueInvitation("fail");
    vi.spyOn(localTestMailer, "send").mockRejectedValue(
      new Error("provider timeout"),
    );
    const first = await runMailOutboxOnce();
    expect(first.retrying).toBeGreaterThanOrEqual(1);
    const afterFirst = await outboxRow(mailId);
    expect(afterFirst.status).toBe("queued");
    expect(afterFirst.attempts).toBe(1);
    expect(afterFirst.next_attempt_at.getTime()).toBeGreaterThan(Date.now());
    await pool.query(
      `UPDATE mail_outbox SET attempts = 4, next_attempt_at = now() WHERE id = $1`,
      [mailId],
    );
    const final = await runMailOutboxOnce();
    expect(final.failed).toBeGreaterThanOrEqual(1);
    const afterFinal = await outboxRow(mailId);
    expect(afterFinal.status).toBe("failed");
    expect(afterFinal.last_error_code).toBe("PROVIDER_TIMEOUT");
  });
  it("lets competing workers dispatch a due row only once", async () => {
    const { email } = await queueInvitation("race");
    await Promise.all([
      runMailOutboxOnce(),
      runMailOutboxOnce(),
      runMailOutboxOnce(),
    ]);
    expect(sentTo(email)).toHaveLength(1);
  });
  it("does not let a late completion overwrite a reissue that happened mid-send", async () => {
    const { email, invitationId, mailId } = await queueInvitation("late");
    let reissued = false;
    const mailer: Mailer = {
      sender: localTestMailer.sender,
      send: async (message) => {
        if (message.to === email && !reissued) {
          reissued = true;
          await reissueInvitation(admin, invitationId);
        }
        return { providerMessageId: "late-accept" };
      },
    };
    const summary = await runMailOutboxOnce({ mailer });
    expect(reissued).toBe(true);
    // Accepted by the provider but no longer this claim's row: reported as lost, not sent.
    expect(summary.lost).toBeGreaterThanOrEqual(1);
    expect((await outboxRow(mailId)).status).toBe("superseded");
    const newer = await pool.query<{ dedupe_key: string }>(
      `SELECT dedupe_key FROM mail_outbox WHERE recipient = $1 AND id <> $2`,
      [email, mailId],
    );
    expect(newer.rows[0].dedupe_key).toMatch(/:v2$/);
  });
  it("replays an attempt with no recorded outcome using the same key and frozen sender", async () => {
    const { email, mailId, dedupeKey } = await queueInvitation("crash");
    // As if a worker crashed after the provider call: attempt counted, no outcome.
    await pool.query(
      `UPDATE mail_outbox SET attempts = 1, first_attempt_at = now() - interval '1 hour',
         sender = 'Frozen <frozen@example.test>', last_error_code = NULL,
         lease_owner = 'crashed-worker', lease_until = now() - interval '1 second'
       WHERE id = $1`,
      [mailId],
    );
    await runMailOutboxOnce();
    const [sent] = sentTo(email);
    expect(sent.idempotencyKey).toBe(dedupeKey);
    expect(sent.from).toBe("Frozen <frozen@example.test>");
    const row = await outboxRow(mailId);
    expect(row.status).toBe("provider_accepted");
    expect(row.attempts).toBe(2);
  });
  it("never spends a sixth attempt after a crash on the final budgeted send", async () => {
    const { email, mailId } = await queueInvitation("crash-at-budget");
    // As if the fifth attempt was recorded and the worker died during the provider call.
    await pool.query(
      `UPDATE mail_outbox SET attempts = 5, first_attempt_at = now() - interval '3 hours',
         sender = 'Frozen <frozen@example.test>', last_error_code = NULL,
         lease_owner = 'crashed-worker', lease_until = now() - interval '1 second'
       WHERE id = $1`,
      [mailId],
    );
    const summary = await runMailOutboxOnce();
    expect(sentTo(email)).toHaveLength(0);
    const row = await outboxRow(mailId);
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(5);
    expect(row.last_error_code).toBe("ATTEMPT_OUTCOME_UNKNOWN");
    expect(summary.failures).toContainEqual({
      id: mailId,
      code: "ATTEMPT_OUTCOME_UNKNOWN",
    });
    // Shown to operators as possibly accepted; a retry is still refused only past the window.
    const listing = await listMailJobs(admin, {
      status: "failed",
      pageSize: "50",
    });
    const view = listing.jobs.find((j) => j.id === mailId);
    if (view) expect(view.ambiguous).toBe(true);
  });
  it("does not claim a row under another worker's live lease", async () => {
    const { email, mailId } = await queueInvitation("leased");
    await pool.query(
      `UPDATE mail_outbox SET lease_owner = 'other-worker', lease_until = now() + interval '1 minute' WHERE id = $1`,
      [mailId],
    );
    await runMailOutboxOnce();
    expect(sentTo(email)).toHaveLength(0);
    expect((await outboxRow(mailId)).lease_owner).toBe("other-worker");
    await pool.query(
      `UPDATE mail_outbox SET lease_until = now() - interval '1 second' WHERE id = $1`,
      [mailId],
    );
  });
  it("stops automatic replay past the provider idempotency window", async () => {
    const { email, mailId } = await queueInvitation("window");
    await pool.query(
      `UPDATE mail_outbox SET attempts = 1, first_attempt_at = now() - interval '25 hours', last_error_code = 'PROVIDER_TIMEOUT' WHERE id = $1`,
      [mailId],
    );
    await runMailOutboxOnce();
    expect(sentTo(email)).toHaveLength(0);
    const row = await outboxRow(mailId);
    expect(row.status).toBe("failed");
    expect(row.last_error_code).toBe("IDEMPOTENCY_WINDOW_EXPIRED");
  });
  it("fails immediately on a permanent rejection", async () => {
    const { mailId } = await queueInvitation("permanent");
    await runMailOutboxOnce({
      mailer: failingMailer(new MailDeliveryError("INVALID_RECIPIENT")),
    });
    const row = await outboxRow(mailId);
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(1);
    expect(row.last_error_code).toBe("INVALID_RECIPIENT");
  });
  it("honors a longer provider rate-limit delay", async () => {
    const { mailId } = await queueInvitation("throttled");
    await runMailOutboxOnce({
      mailer: failingMailer(
        new MailDeliveryError("PROVIDER_RATE_LIMITED", 900),
      ),
    });
    const row = await outboxRow(mailId);
    expect(row.status).toBe("queued");
    expect(row.next_attempt_at.getTime()).toBeGreaterThan(Date.now() + 800_000);
  });
  it("undoes the attempt and stops the run on a configuration-wide failure", async () => {
    const { mailId } = await queueInvitation("auth");
    const summary = await runMailOutboxOnce({
      mailer: failingMailer(new MailDeliveryError("PROVIDER_AUTH")),
    });
    expect(summary.configurationError).toBe("PROVIDER_AUTH");
    expect(summary.claimed).toBe(1);
    const row = await pool.query<{
      status: string;
      attempts: number;
      first_attempt_at: Date | null;
    }>(
      `SELECT status, attempts, first_attempt_at FROM mail_outbox WHERE id = $1`,
      [mailId],
    );
    // The auth failure may have hit an older due row first; this row is either
    // untouched or restored - never charged an attempt.
    expect(row.rows[0].status).toBe("queued");
    expect(row.rows[0].attempts).toBe(0);
    expect(row.rows[0].first_attempt_at).toBeNull();
    await pool.query(
      `UPDATE mail_outbox SET status = 'superseded' WHERE id = $1`,
      [mailId],
    );
  });
  it("bounds a single run", async () => {
    await queueInvitation("bound-a");
    await queueInvitation("bound-b");
    const summary = await runMailOutboxOnce({ maxMessages: 1 });
    expect(summary.claimed).toBe(1);
    await runMailOutboxOnce();
  });
});
describe("operator mail controls", () => {
  it("is ADMIN-only and never discloses payloads or full recipients", async () => {
    await expect(listMailJobs(member, {})).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const { email, mailId } = await queueInvitation("list");
    const listing = await listMailJobs(admin, {
      status: "queued",
      pageSize: "50",
    });
    expect(listing.pageSize).toBe(50);
    const serialized = JSON.stringify(listing);
    expect(serialized).not.toContain(email);
    expect(serialized).not.toContain("payload");
    expect(serialized).not.toContain("invite=");
    expect(listing.jobs.find((j) => j.id === mailId)?.recipient).toMatch(/\*/);
    await runMailOutboxOnce();
  });
  it("refuses to retry queued, accepted and superseded jobs", async () => {
    const queued = await queueInvitation("retry-queued");
    await expect(retryMail(admin, queued.mailId)).rejects.toMatchObject({
      code: "MAIL_RETRY_UNAVAILABLE",
    });
    await runMailOutboxOnce();
    await expect(retryMail(admin, queued.mailId)).rejects.toMatchObject({
      code: "MAIL_RETRY_UNAVAILABLE",
    });
    const stale = await queueInvitation("retry-superseded");
    await revokeInvitation(admin, stale.invitationId, {});
    await runMailOutboxOnce();
    await expect(retryMail(admin, stale.mailId)).rejects.toMatchObject({
      code: "MAIL_RETRY_UNAVAILABLE",
    });
  });
  it("requeues an eligible failed job with a fresh budget and audits it", async () => {
    const { mailId, invitationId, dedupeKey } =
      await queueInvitation("retry-ok");
    await pool.query(
      `UPDATE mail_outbox SET status = 'failed', attempts = 5, last_error_code = 'PROVIDER_TIMEOUT',
         first_attempt_at = now() - interval '2 hours', sender = 'Frozen <frozen@example.test>'
       WHERE id = $1`,
      [mailId],
    );
    await expect(retryMail(member, mailId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await retryMail(admin, mailId);
    const row = await outboxRow(mailId);
    expect(row.status).toBe("queued");
    expect(row.attempts).toBe(0);
    expect(row.sender).toBe("Frozen <frozen@example.test>");
    const audit = await pool.query(
      `SELECT 1 FROM membership_audit WHERE action = 'membership_mail_retried' AND actor_id = $1 AND invitation_id = $2`,
      [admin.id, invitationId],
    );
    expect(audit.rowCount).toBe(1);
    await runMailOutboxOnce();
    const resent = localTestMailer.sent.find(
      (m) => m.idempotencyKey === dedupeKey,
    );
    expect(resent?.from).toBe("Frozen <frozen@example.test>");
  });
  it("requires reconciliation past the idempotency window and reissue for invalid invitations", async () => {
    const old = await queueInvitation("retry-window");
    await pool.query(
      `UPDATE mail_outbox SET status = 'failed', attempts = 5, last_error_code = 'PROVIDER_TIMEOUT',
         first_attempt_at = now() - interval '30 hours' WHERE id = $1`,
      [old.mailId],
    );
    await expect(retryMail(admin, old.mailId)).rejects.toMatchObject({
      code: "MAIL_RECONCILIATION_REQUIRED",
    });
    const listing = await listMailJobs(admin, {
      status: "failed",
      pageSize: "50",
    });
    const view = listing.jobs.find((j) => j.id === old.mailId);
    if (view) {
      expect(view.retryable).toBe(false);
      expect(view.reconciliationRequired).toBe(true);
    }
    const revoked = await queueInvitation("retry-revoked");
    await pool.query(
      `UPDATE mail_outbox SET status = 'failed', attempts = 5, last_error_code = 'PROVIDER_ERROR' WHERE id = $1`,
      [revoked.mailId],
    );
    await revokeInvitation(admin, revoked.invitationId, {});
    await expect(retryMail(admin, revoked.mailId)).rejects.toMatchObject({
      code: "INVITE_INVALID",
    });
  });
});
