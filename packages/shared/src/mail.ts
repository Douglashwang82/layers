import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
/*
 * Server-only mail module. Imported through the `@taiwanhub/shared/mail`
 * subpath (never the package root) so Node crypto/fs and provider
 * configuration stay out of browser bundles.
 */
export type MailKind =
  | "membership_invitation"
  | "membership_otp"
  | "membership_password_reset";
export type MailMessage = {
  to: string;
  kind: MailKind;
  subject: string;
  text: string;
};
export type MailSendOptions = {
  /** Provider-side deduplication key; invitation attempts reuse their outbox dedupe_key. */
  idempotencyKey?: string;
  /** Frozen sender for a retried outbox row; defaults to the configured MAIL_FROM. */
  from?: string;
};
export type MailSendResult = { providerMessageId?: string };
export interface Mailer {
  /** Configured sender, frozen onto an outbox row at its first attempt. */
  readonly sender: string;
  send(
    message: MailMessage,
    options?: MailSendOptions,
  ): Promise<MailSendResult>;
}
export type MailErrorCode =
  | "MAIL_CONFIG"
  | "PROVIDER_AUTH"
  | "INVALID_RECIPIENT"
  | "PROVIDER_REJECTED"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_MALFORMED_RESPONSE"
  | "PROVIDER_ERROR";
/** The provider definitively refused this message; retrying the same request cannot succeed. */
const PERMANENT: ReadonlySet<MailErrorCode> = new Set([
  "INVALID_RECIPIENT",
  "PROVIDER_REJECTED",
]);
/** Configuration problems affect every message, not one row. */
const GLOBAL: ReadonlySet<MailErrorCode> = new Set([
  "MAIL_CONFIG",
  "PROVIDER_AUTH",
]);
/** The provider may have accepted the message even though we saw a failure. */
const AMBIGUOUS: ReadonlySet<string> = new Set([
  "PROVIDER_TIMEOUT",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_MALFORMED_RESPONSE",
  "PROVIDER_ERROR",
]);
/**
 * A de-identified delivery failure. The message is only the code: provider
 * requests/responses, recipients and credentials are never attached.
 */
export class MailDeliveryError extends Error {
  constructor(
    public readonly code: MailErrorCode,
    public readonly retryAfterSeconds?: number,
  ) {
    super(`Mail delivery failed: ${code}`);
    this.name = "MailDeliveryError";
  }
  get permanent() {
    return PERMANENT.has(this.code);
  }
  get global() {
    return GLOBAL.has(this.code);
  }
}
/**
 * A row whose attempt may have been accepted, or whose attempt never recorded
 * an outcome (a crash after the provider call), can only be replayed safely
 * with the same idempotency key while the provider still remembers it.
 */
export function isAmbiguousMailError(code: string | null | undefined) {
  return (
    !code ||
    AMBIGUOUS.has(code) ||
    code === "IDEMPOTENCY_WINDOW_EXPIRED" ||
    code === ATTEMPT_OUTCOME_UNKNOWN
  );
}
/**
 * Terminal code for a job whose final budgeted attempt never recorded an
 * outcome (e.g. the worker crashed during the provider call). The provider may
 * or may not have accepted it; the worker never spends another attempt.
 */
export const ATTEMPT_OUTCOME_UNKNOWN = "ATTEMPT_OUTCOME_UNKNOWN";
/**
 * Resend keeps idempotency keys for 24 hours; stop automatic replay an hour
 * earlier. Past this window an ambiguous row needs operator reconciliation
 * or an invitation reissue, never a blind resend.
 */
export const PROVIDER_IDEMPOTENCY_WINDOW_MS = 23 * 60 * 60 * 1000;
export type CapturedMail = MailMessage & MailSendOptions;
/**
 * Captures sent mail in memory for unit/integration tests running in the same
 * process. Never usable in production, and never exposed over HTTP.
 */
class LocalTestMailer implements Mailer {
  readonly sender = "TaiwanHub Test <test@taiwanhub.invalid>";
  sent: CapturedMail[] = [];
  async send(
    message: MailMessage,
    options: MailSendOptions = {},
  ): Promise<MailSendResult> {
    if (process.env.NODE_ENV === "production")
      throw new MailDeliveryError("MAIL_CONFIG");
    this.sent.push({ ...message, ...options });
    return { providerMessageId: `test-${randomUUID()}` };
  }
}
export const localTestMailer = new LocalTestMailer();
/**
 * Cross-process capture for browser tests: the web server and worker write
 * encrypted messages into a per-run directory under the OS temp directory,
 * and Node-side Playwright fixtures decrypt them with readCapturedMail. It is
 * never readable over the application's HTTP API and refuses production.
 */
class CaptureMailer implements Mailer {
  readonly sender = "TaiwanHub Capture <capture@taiwanhub.invalid>";
  constructor(private readonly dir: string) {}
  async send(
    message: MailMessage,
    options: MailSendOptions = {},
  ): Promise<MailSendResult> {
    if (process.env.NODE_ENV === "production")
      throw new MailDeliveryError("MAIL_CONFIG");
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const id = randomUUID();
    const { ciphertext, keyVersion } = encryptOutboxPayload(message);
    writeFileSync(
      path.join(this.dir, `${Date.now()}-${id}.mail`),
      JSON.stringify({
        ciphertext,
        keyVersion,
        idempotencyKey: options.idempotencyKey ?? null,
      }),
      { mode: 0o600 },
    );
    return { providerMessageId: `capture-${id}` };
  }
}
function captureDirectory(raw: string | undefined) {
  if (!raw || !path.isAbsolute(raw)) return null;
  const relative = path.relative(tmpdir(), path.resolve(raw));
  // Only a directory under the OS temp directory: never public/ or the workspace.
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    return null;
  return path.resolve(raw);
}
/** Node-side test helper; decrypts everything captured in `dir`, oldest first. */
export function readCapturedMail(dir: string): CapturedMail[] {
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".mail"));
  } catch {
    return [];
  }
  return names.sort().map((name) => {
    const stored = JSON.parse(readFileSync(path.join(dir, name), "utf8")) as {
      ciphertext: string;
      keyVersion: number;
      idempotencyKey: string | null;
    };
    return {
      ...decryptOutboxPayload(stored.ciphertext, stored.keyVersion),
      idempotencyKey: stored.idempotencyKey ?? undefined,
    };
  });
}
export const RESEND_ENDPOINT = "https://api.resend.com/emails";
const RESEND_TIMEOUT_MS = 10_000;
const resendAccepted = z.object({ id: z.string().min(1).max(200) });
const resendError = z.object({
  name: z.string().max(100).optional(),
  message: z.string().max(2000).optional(),
});
/** Accepts `addr@example.com` or `Name <addr@example.com>`. */
const senderPattern =
  /^(?:[^<>\r\n]{1,100} <[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+>|[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+)$/;
function retryAfterSeconds(response: Response) {
  const value = Number(response.headers.get("retry-after"));
  return Number.isFinite(value) && value > 0
    ? Math.min(value, 86_400)
    : undefined;
}
/** Maps a Resend error response to a code without keeping any of its text. */
async function classifyResendFailure(
  response: Response,
): Promise<MailDeliveryError> {
  const parsed = resendError.safeParse(await response.json().catch(() => null));
  const name = parsed.success ? (parsed.data.name ?? "") : "";
  const message = parsed.success ? (parsed.data.message ?? "") : "";
  if (response.status === 429)
    return new MailDeliveryError(
      "PROVIDER_RATE_LIMITED",
      retryAfterSeconds(response),
    );
  if (response.status === 401 || response.status === 403)
    return new MailDeliveryError(
      /from|domain/i.test(name) ? "MAIL_CONFIG" : "PROVIDER_AUTH",
    );
  if (response.status >= 500)
    return new MailDeliveryError("PROVIDER_UNAVAILABLE");
  if (response.status === 409) return new MailDeliveryError("PROVIDER_ERROR");
  if (/from/i.test(name)) return new MailDeliveryError("MAIL_CONFIG");
  if (response.status === 400 || response.status === 422)
    return new MailDeliveryError(
      /\bto\b|recipient/i.test(message)
        ? "INVALID_RECIPIENT"
        : "PROVIDER_REJECTED",
    );
  return new MailDeliveryError("PROVIDER_ERROR");
}
/**
 * Resend HTTPS email API (https://resend.com/docs/api-reference/emails/send-email).
 * Fixed host, Bearer auth, ten-second timeout, validated response. No inner
 * retry: OTP users request a new code and invitation retries belong to the
 * outbox worker. "Accepted" means accepted by Resend, not delivered.
 */
export class ResendMailer implements Mailer {
  constructor(
    private readonly config: {
      apiKey: string;
      from: string;
      fetch?: typeof fetch;
      timeoutMs?: number;
    },
  ) {}
  get sender() {
    return this.config.from;
  }
  async send(
    message: MailMessage,
    options: MailSendOptions = {},
  ): Promise<MailSendResult> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs ?? RESEND_TIMEOUT_MS,
    );
    try {
      let response: Response;
      try {
        response = await (this.config.fetch ?? fetch)(RESEND_ENDPOINT, {
          method: "POST",
          redirect: "error",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            "Content-Type": "application/json",
            ...(options.idempotencyKey
              ? { "Idempotency-Key": options.idempotencyKey.slice(0, 256) }
              : {}),
          },
          body: JSON.stringify({
            from: options.from ?? this.config.from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
          }),
        });
      } catch {
        throw new MailDeliveryError(
          controller.signal.aborted ? "PROVIDER_TIMEOUT" : "PROVIDER_ERROR",
        );
      }
      if (!response.ok) throw await classifyResendFailure(response);
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new MailDeliveryError(
          controller.signal.aborted
            ? "PROVIDER_TIMEOUT"
            : "PROVIDER_MALFORMED_RESPONSE",
        );
      }
      const accepted = resendAccepted.safeParse(body);
      if (!accepted.success)
        throw new MailDeliveryError("PROVIDER_MALFORMED_RESPONSE");
      return { providerMessageId: accepted.data.id };
    } finally {
      clearTimeout(timer);
    }
  }
}
type MailEnv = Record<string, string | undefined>;
/**
 * Fails closed. `resend` needs RESEND_API_KEY and MAIL_FROM. `capture` and the
 * default in-memory test transport are refused in production even if their
 * variables are set. Throws MailDeliveryError("MAIL_CONFIG"), whose message
 * never includes configuration values.
 */
export function resolveMailer(env: MailEnv = process.env): Mailer {
  const provider = env.MAIL_PROVIDER ?? "";
  const production = env.NODE_ENV === "production";
  if (provider === "resend") {
    const apiKey = env.RESEND_API_KEY ?? "";
    const from = (env.MAIL_FROM ?? "").trim();
    if (!apiKey || !senderPattern.test(from))
      throw new MailDeliveryError("MAIL_CONFIG");
    return new ResendMailer({ apiKey, from });
  }
  if (provider === "capture") {
    const dir = captureDirectory(env.MAIL_CAPTURE_DIR);
    if (production || !dir) throw new MailDeliveryError("MAIL_CONFIG");
    return new CaptureMailer(dir);
  }
  if ((provider === "" || provider === "test") && !production)
    return localTestMailer;
  throw new MailDeliveryError("MAIL_CONFIG");
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
/** Worker preflight: fails with MAIL_CONFIG (no key material in the message). */
export function assertOutboxEncryptionKey() {
  try {
    outboxKey();
  } catch {
    throw new MailDeliveryError("MAIL_CONFIG");
  }
}
export function encryptOutboxPayload(payload: MailMessage) {
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
/**
 * Key version 1 payloads are `{kind,to,subject,text}` JSON. Rows queued before
 * the bilingual templates carry only the join link as `text`; they remain
 * readable and are sent as stored.
 */
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
export function mailErrorCode(error: unknown): MailErrorCode {
  if (error instanceof MailDeliveryError) return error.code;
  if (error instanceof Error) {
    if (/timeout/i.test(error.message)) return "PROVIDER_TIMEOUT";
    if (/rate.?limit/i.test(error.message)) return "PROVIDER_RATE_LIMITED";
    if (/invalid.*address|bad.*recipient/i.test(error.message))
      return "INVALID_RECIPIENT";
  }
  return "PROVIDER_ERROR";
}
/* Bilingual plain-text templates (English, then Traditional Chinese). */
/**
 * `expiresAt` is the invitation's persisted expiry, not a fixed duration: a
 * delayed or reissued delivery must not promise more time than remains.
 */
export function invitationEmail(link: string, expiresAt: Date) {
  const expiry = `${expiresAt.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  return {
    subject: "You're invited to TaiwanHub · 你受邀加入 TaiwanHub",
    text: [
      "A TaiwanHub member invited you to join.",
      "",
      `Open this link to accept. It works once and expires ${expiry}:`,
      link,
      "",
      "If you weren't expecting this, you can ignore this email.",
      "",
      "——",
      "",
      "一位 TaiwanHub 會員邀請你加入。",
      "",
      `請開啟以下連結接受邀請。此連結只能使用一次，將於 ${expiry} 到期：`,
      link,
      "",
      "如果你並未預期收到這封信，可以直接忽略。",
    ].join("\n"),
  };
}
export function resetPasswordEmail(link: string) {
  return {
    subject: "Reset your TaiwanHub password · 重設 TaiwanHub 密碼",
    text: [
      "We received a request to reset your TaiwanHub password.",
      "",
      "Open this link to choose a new password. It works once and expires in 1 hour:",
      link,
      "",
      "If you didn't ask for this, you can ignore this email — your password won't change.",
      "",
      "——",
      "",
      "我們收到重設你的 TaiwanHub 密碼的請求。",
      "",
      "請開啟以下連結設定新密碼。此連結只能使用一次，將於 1 小時後失效：",
      link,
      "",
      "如果這不是你本人的操作，可以直接忽略這封信，你的密碼不會被變更。",
    ].join("\n"),
  };
}
export function signInCodeEmail(otp: string) {
  return {
    subject: "Your TaiwanHub code · TaiwanHub 驗證碼",
    text: [
      `Your TaiwanHub code is ${otp}. It expires in 5 minutes.`,
      "If you didn't ask for it, you can ignore this email.",
      "",
      "——",
      "",
      `你的 TaiwanHub 驗證碼是 ${otp}，5 分鐘內有效。`,
      "如果這不是你本人的操作，可以直接忽略這封信。",
    ].join("\n"),
  };
}
