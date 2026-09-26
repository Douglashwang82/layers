import { randomUUID } from "node:crypto";
import { pool } from "./index";
import {
  resolveMailer,
  decryptOutboxPayload,
  mailErrorCode,
  assertOutboxEncryptionKey,
  MailDeliveryError,
  ATTEMPT_OUTCOME_UNKNOWN,
  PROVIDER_IDEMPOTENCY_WINDOW_MS,
  type Mailer,
  type MailMessage,
} from "../../shared/src/mail";
const RETRY_DELAYS_MINUTES = [1, 5, 30, 120];
const MAX_ATTEMPTS = 5;
const LEASE_SECONDS = 120;
/** Delay before a row released by a provider-wide failure is tried again. */
const GLOBAL_FAILURE_DELAY_SECONDS = 300;
/** One CLI invocation handles at most this much; the rest waits for the next run. */
export const MAIL_WORKER_RUN_LIMITS = {
  maxMessages: 100,
  maxDurationMs: 180_000,
};
type ClaimedRow = {
  id: string;
  dedupe_key: string;
  payload_ciphertext: string;
  payload_key_version: number;
  attempts: number;
  first_attempt_at: Date | null;
  sender: string | null;
};
type Outcome = "sent" | "retrying" | "failed" | "superseded" | "lost";
/** `invitation:{id}:v{tokenVersion}` for kind=membership_invitation; other kinds have no re-validation target. */
function parseInvitationDedupeKey(dedupeKey: string) {
  const match = /^invitation:([0-9a-f-]+):v(\d+)$/.exec(dedupeKey);
  if (!match) return null;
  return { invitationId: match[1], tokenVersion: Number(match[2]) };
}
/**
 * Claims exactly one due row under a two-minute lease owned by `owner`.
 * Rows are claimed one at a time so a lease never expires while the row
 * waits behind others in the same run.
 */
async function claimNext(owner: string): Promise<ClaimedRow | null> {
  const result = await pool.query<ClaimedRow>(
    `UPDATE mail_outbox SET lease_owner = $1, lease_until = now() + $2::int * interval '1 second', updated_at = now()
     WHERE id = (
       SELECT id FROM mail_outbox
       WHERE status = 'queued' AND next_attempt_at <= now() AND (lease_until IS NULL OR lease_until <= now())
       ORDER BY next_attempt_at, id
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, dedupe_key, payload_ciphertext, payload_key_version, attempts, first_attempt_at, sender`,
    [owner, LEASE_SECONDS],
  );
  return result.rows[0] ?? null;
}
async function isInvitationStillValid(dedupeKey: string) {
  const parsed = parseInvitationDedupeKey(dedupeKey);
  if (!parsed) return true;
  const result = await pool.query<{
    status: string;
    token_version: number;
    expires_at: Date;
  }>(
    `SELECT status, token_version, expires_at FROM membership_invitation WHERE id = $1`,
    [parsed.invitationId],
  );
  const invitation = result.rows[0];
  return (
    !!invitation &&
    invitation.status === "issued" &&
    invitation.token_version === parsed.tokenVersion &&
    invitation.expires_at.getTime() > Date.now()
  );
}
/**
 * Every final update matches this claim's owner and a still-queued status, so
 * a late worker can't overwrite a reissue/revocation (superseded), a newer
 * claim, or an operator action.
 */
async function finish(
  row: ClaimedRow,
  owner: string,
  status: "queued" | "failed" | "superseded" | "provider_accepted",
  fields: {
    errorCode?: string | null;
    delaySeconds?: number;
    providerMessageId?: string | null;
  },
) {
  const result = await pool.query(
    `UPDATE mail_outbox SET
       status = $3,
       last_error_code = $4,
       provider_message_id = COALESCE($5, provider_message_id),
       next_attempt_at = CASE WHEN $6::int IS NULL THEN next_attempt_at ELSE now() + $6::int * interval '1 second' END,
       lease_owner = NULL,
       lease_until = NULL,
       updated_at = now()
     WHERE id = $1 AND lease_owner = $2 AND status = 'queued'`,
    [
      row.id,
      owner,
      status,
      fields.errorCode ?? null,
      fields.providerMessageId ?? null,
      fields.delaySeconds ?? null,
    ],
  );
  return (result.rowCount ?? 0) > 0;
}
async function processRow(
  row: ClaimedRow,
  owner: string,
  mailer: Mailer,
): Promise<{ outcome: Outcome; code?: string; global?: boolean }> {
  // Recheck the invitation immediately before sending. A message already in
  // flight may still arrive after a revocation; redemption rejects it.
  if (!(await isInvitationStillValid(row.dedupe_key)))
    return {
      outcome: (await finish(row, owner, "superseded", {}))
        ? "superseded"
        : "lost",
    };
  // The provider only deduplicates within its idempotency window; beyond it a
  // replay could deliver twice, so stop and require reconciliation/reissue.
  if (
    row.first_attempt_at &&
    Date.now() - row.first_attempt_at.getTime() >=
      PROVIDER_IDEMPOTENCY_WINDOW_MS
  ) {
    const code = "IDEMPOTENCY_WINDOW_EXPIRED";
    return {
      outcome: (await finish(row, owner, "failed", { errorCode: code }))
        ? "failed"
        : "lost",
      code,
    };
  }
  let message: MailMessage;
  try {
    message = decryptOutboxPayload(
      row.payload_ciphertext,
      row.payload_key_version,
    );
  } catch {
    const code = "PAYLOAD_UNREADABLE";
    return {
      outcome: (await finish(row, owner, "failed", { errorCode: code }))
        ? "failed"
        : "lost",
      code,
    };
  }
  // A queued row that has already used its whole budget can only be one whose
  // last attempt never recorded an outcome (a crash during or right after the
  // provider call). Never spend a sixth attempt: fail it terminally, marked
  // ambiguous so an operator reconciles with the provider log or reissues.
  if (row.attempts >= MAX_ATTEMPTS) {
    const code = ATTEMPT_OUTCOME_UNKNOWN;
    return {
      outcome: (await finish(row, owner, "failed", { errorCode: code }))
        ? "failed"
        : "lost",
      code,
    };
  }
  // Persist the attempt (and freeze the sender) before the provider call. A
  // crash after this point leaves attempts counted and no error code, which
  // is treated as an ambiguous outcome and replayed with the same key.
  const sender = row.sender ?? mailer.sender;
  const started = await pool.query<{ attempts: number }>(
    `UPDATE mail_outbox SET attempts = attempts + 1, first_attempt_at = COALESCE(first_attempt_at, now()),
       sender = COALESCE(sender, $3), last_error_code = NULL, updated_at = now()
     WHERE id = $1 AND lease_owner = $2 AND status = 'queued'
     RETURNING attempts`,
    [row.id, owner, sender],
  );
  if (!started.rowCount) return { outcome: "lost" };
  const attempts = started.rows[0].attempts;
  let providerMessageId: string | null;
  try {
    const result = await mailer.send(message, {
      idempotencyKey: row.dedupe_key,
      from: sender,
    });
    providerMessageId = result.providerMessageId ?? null;
  } catch (error) {
    return recordFailure(row, owner, attempts, error);
  }
  // Outside the provider try: a database failure here is not a provider
  // failure. The row stays queued with its lease; a later claim replays it
  // with the same idempotency key, which the provider deduplicates.
  const recorded = await finish(row, owner, "provider_accepted", {
    providerMessageId,
  });
  // No longer our queued claim (e.g. reissued/revoked mid-send, or the lease
  // was taken over): the provider accepted it, but this run didn't record it.
  return { outcome: recorded ? "sent" : "lost" };
}
async function recordFailure(
  row: ClaimedRow,
  owner: string,
  attempts: number,
  error: unknown,
): Promise<{ outcome: Outcome; code?: string; global?: boolean }> {
  const code = mailErrorCode(error);
  if (error instanceof MailDeliveryError && error.global) {
    // Configuration/authentication refused every message: this attempt was
    // definitively not accepted, so undo it and stop the run.
    await pool.query(
      `UPDATE mail_outbox SET attempts = attempts - 1, first_attempt_at = $3, sender = $4,
         last_error_code = $5, next_attempt_at = now() + $6::int * interval '1 second',
         lease_owner = NULL, lease_until = NULL, updated_at = now()
       WHERE id = $1 AND lease_owner = $2 AND status = 'queued'`,
      [
        row.id,
        owner,
        row.first_attempt_at,
        row.sender,
        code,
        GLOBAL_FAILURE_DELAY_SECONDS,
      ],
    );
    return { outcome: "retrying", code, global: true };
  }
  const permanent = error instanceof MailDeliveryError && error.permanent;
  const exhausted = permanent || attempts >= MAX_ATTEMPTS;
  const backoffSeconds =
    RETRY_DELAYS_MINUTES[
      Math.min(attempts - 1, RETRY_DELAYS_MINUTES.length - 1)
    ] * 60;
  const providerDelay =
    error instanceof MailDeliveryError ? (error.retryAfterSeconds ?? 0) : 0;
  const updated = await finish(row, owner, exhausted ? "failed" : "queued", {
    errorCode: code,
    delaySeconds: exhausted
      ? undefined
      : Math.max(backoffSeconds, Math.ceil(providerDelay)),
  });
  if (!updated) return { outcome: "lost", code };
  return { outcome: exhausted ? "failed" : "retrying", code };
}
/**
 * One bounded worker pass: validates configuration before claiming anything,
 * then processes due rows one claim at a time until the queue is empty or the
 * message/time bound is reached. Integration tests call this directly.
 */
export async function runMailOutboxOnce(
  options: {
    maxMessages?: number;
    maxDurationMs?: number;
    mailer?: Mailer;
  } = {},
) {
  assertOutboxEncryptionKey();
  const mailer = options.mailer ?? resolveMailer();
  const maxMessages = options.maxMessages ?? MAIL_WORKER_RUN_LIMITS.maxMessages;
  const maxDurationMs =
    options.maxDurationMs ?? MAIL_WORKER_RUN_LIMITS.maxDurationMs;
  const startedAt = Date.now();
  const summary = {
    claimed: 0,
    sent: 0,
    retrying: 0,
    failed: 0,
    superseded: 0,
    lost: 0,
    configurationError: null as string | null,
    failures: [] as { id: string; code: string }[],
    dueRemaining: 0,
    oldestDueSeconds: null as number | null,
  };
  while (
    summary.claimed < maxMessages &&
    Date.now() - startedAt < maxDurationMs
  ) {
    // A unique owner per claim: a stale completion from an earlier claim of
    // the same row can never match a newer one.
    const owner = randomUUID();
    const row = await claimNext(owner);
    if (!row) break;
    summary.claimed++;
    const result = await processRow(row, owner, mailer);
    summary[result.outcome]++;
    if (result.code && result.outcome !== "retrying")
      summary.failures.push({ id: row.id, code: result.code });
    if (result.global) {
      summary.configurationError = result.code ?? "MAIL_CONFIG";
      break;
    }
  }
  const backlog = await pool.query<{
    due: number;
    oldest_due_seconds: number | null;
  }>(
    `SELECT count(*)::int AS due,
       floor(extract(epoch FROM now() - min(next_attempt_at)))::int AS oldest_due_seconds
     FROM mail_outbox WHERE status = 'queued' AND next_attempt_at <= now()`,
  );
  summary.dueRemaining = backlog.rows[0]?.due ?? 0;
  summary.oldestDueSeconds = backlog.rows[0]?.oldest_due_seconds ?? null;
  return summary;
}
async function main() {
  let summary: Awaited<ReturnType<typeof runMailOutboxOnce>>;
  try {
    summary = await runMailOutboxOnce();
  } catch (error) {
    if (!(error instanceof MailDeliveryError)) throw error;
    // Redacted: only the error code, never configuration values.
    console.error(
      JSON.stringify({
        event: "mail_worker_configuration_error",
        code: error.code,
      }),
    );
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({ event: "mail_worker_run", ...summary }));
  if (summary.configurationError || summary.failed > 0) process.exitCode = 1;
}
if (require.main === module)
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
