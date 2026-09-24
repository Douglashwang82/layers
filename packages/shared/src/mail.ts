import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
export type MailKind = "membership_invitation" | "membership_otp";
export type MailMessage = {
  to: string;
  kind: MailKind;
  subject: string;
  text: string;
};
export type MailSendResult = { providerMessageId?: string };
export interface Mailer {
  send(message: MailMessage): Promise<MailSendResult>;
}
/**
 * Captures sent mail in memory instead of delivering it. This is the only
 * transport wired up so far - no provider has been chosen yet (see plan
 * section 8 and 13). Never usable in production, and never exposed over HTTP.
 */
class LocalTestMailer implements Mailer {
  sent: MailMessage[] = [];
  async send(message: MailMessage): Promise<MailSendResult> {
    if (process.env.NODE_ENV === "production")
      throw new Error("The local test mail transport cannot run in production.");
    this.sent.push(message);
    return { providerMessageId: `test-${crypto.randomUUID()}` };
  }
}
export const localTestMailer = new LocalTestMailer();
/**
 * No MAIL_PROVIDER has been selected by the team yet (plan section 13). In
 * production this throws rather than silently using the test transport or
 * dropping mail; outside production it falls back to the local test
 * transport for dev/CI.
 */
export function resolveMailer(): Mailer {
  const provider = process.env.MAIL_PROVIDER;
  if (provider && provider !== "test")
    throw new Error(
      `Mail provider "${provider}" is not implemented. Configure a real Mailer before setting MAIL_PROVIDER.`,
    );
  if (process.env.NODE_ENV === "production")
    throw new Error(
      "No mail provider is configured for production. Set MAIL_PROVIDER to a real provider before enabling email delivery.",
    );
  return localTestMailer;
}
const CURRENT_KEY_VERSION = 1;
function outboxKey(): Buffer {
  const raw = process.env.MAIL_OUTBOX_ENCRYPTION_KEY;
  if (!raw)
    throw new Error(
      "MAIL_OUTBOX_ENCRYPTION_KEY is not set; cannot encrypt outbox payloads.",
    );
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32)
    throw new Error("MAIL_OUTBOX_ENCRYPTION_KEY must decode to 32 bytes.");
  return key;
}
export function encryptOutboxPayload(payload: Omit<MailMessage, "to"> & { to: string }) {
  const key = outboxKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([iv, tag, ciphertext]).toString("base64"),
    keyVersion: CURRENT_KEY_VERSION,
  };
}
export function decryptOutboxPayload(
  ciphertextBase64: string,
  keyVersion: number,
): MailMessage {
  if (keyVersion !== CURRENT_KEY_VERSION)
    throw new Error(`Unsupported mail outbox key version ${keyVersion}.`);
  const key = outboxKey();
  const raw = Buffer.from(ciphertextBase64, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8"));
}
/** De-identifies a thrown error before it is ever persisted in mail_outbox.last_error_code. */
export function mailErrorCode(error: unknown): string {
  if (error instanceof Error) {
    if (/timeout/i.test(error.message)) return "PROVIDER_TIMEOUT";
    if (/rate.?limit/i.test(error.message)) return "PROVIDER_RATE_LIMITED";
    if (/invalid.*address|bad.*recipient/i.test(error.message))
      return "INVALID_RECIPIENT";
  }
  return "PROVIDER_ERROR";
}
