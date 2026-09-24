import { pool } from "./index";
import {
  resolveMailer,
  decryptOutboxPayload,
  mailErrorCode,
} from "../../shared/src/mail";
const RETRY_DELAYS_MINUTES = [1, 5, 30, 120];
const MAX_ATTEMPTS = 5;
const LEASE_MINUTES = 2;
type OutboxRow = {
  id: string;
  dedupe_key: string;
  recipient: string;
  payload_ciphertext: string;
  payload_key_version: number;
  attempts: number;
};
/** `invitation:{id}:v{tokenVersion}` for kind=membership_invitation; other kinds have no re-validation target. */
function parseInvitationDedupeKey(dedupeKey: string) {
  const match = /^invitation:([0-9a-f-]+):v(\d+)$/.exec(dedupeKey);
  if (!match) return null;
  return { invitationId: match[1], tokenVersion: Number(match[2]) };
}
async function claimBatch(limit: number): Promise<OutboxRow[]> {
  const result = await pool.query<OutboxRow>(
    `UPDATE mail_outbox SET lease_until = now() + interval '${LEASE_MINUTES} minutes'
     WHERE id IN (
       SELECT id FROM mail_outbox
       WHERE status = 'queued' AND next_attempt_at <= now() AND (lease_until IS NULL OR lease_until <= now())
       ORDER BY next_attempt_at
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, dedupe_key, recipient, payload_ciphertext, payload_key_version, attempts`,
    [limit],
  );
  return result.rows;
}
async function isInvitationStillValid(dedupeKey: string) {
  const parsed = parseInvitationDedupeKey(dedupeKey);
  if (!parsed) return true;
  const result = await pool.query<{ status: string; token_version: number }>(
    `SELECT status, token_version FROM membership_invitation WHERE id = $1`,
    [parsed.invitationId],
  );
  const invitation = result.rows[0];
  return (
    !!invitation &&
    invitation.status === "issued" &&
    invitation.token_version === parsed.tokenVersion
  );
}
async function processRow(row: OutboxRow) {
  if (!(await isInvitationStillValid(row.dedupe_key))) {
    await pool.query(`UPDATE mail_outbox SET status = 'superseded', lease_until = NULL WHERE id = $1`, [
      row.id,
    ]);
    return "superseded" as const;
  }
  try {
    const message = decryptOutboxPayload(row.payload_ciphertext, row.payload_key_version);
    const result = await resolveMailer().send(message);
    await pool.query(
      `UPDATE mail_outbox SET status = 'provider_accepted', provider_message_id = $2, lease_until = NULL WHERE id = $1`,
      [row.id, result.providerMessageId ?? null],
    );
    return "sent" as const;
  } catch (error) {
    const attempts = row.attempts + 1;
    const exhausted = attempts >= MAX_ATTEMPTS;
    const delayMinutes =
      RETRY_DELAYS_MINUTES[Math.min(attempts - 1, RETRY_DELAYS_MINUTES.length - 1)];
    await pool.query(
      `UPDATE mail_outbox SET
         status = $2,
         attempts = $3,
         last_error_code = $4,
         next_attempt_at = now() + ($5 || ' minutes')::interval,
         lease_until = NULL
       WHERE id = $1`,
      [
        row.id,
        exhausted ? "failed" : "queued",
        attempts,
        mailErrorCode(error),
        String(delayMinutes),
      ],
    );
    return exhausted ? ("failed" as const) : ("retrying" as const);
  }
}
/** Processes every currently-due row once and returns. Deployment (cron/queue) is not decided yet - see plan section 13. */
export async function runMailOutboxOnce(batchSize = 25) {
  const rows = await claimBatch(batchSize);
  const outcomes = { sent: 0, retrying: 0, failed: 0, superseded: 0 };
  for (const row of rows) outcomes[await processRow(row)]++;
  return { claimed: rows.length, ...outcomes };
}
async function main() {
  const summary = await runMailOutboxOnce();
  console.log(JSON.stringify(summary));
}
if (require.main === module)
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
