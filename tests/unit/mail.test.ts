import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MailDeliveryError,
  RESEND_ENDPOINT,
  ResendMailer,
  invitationEmail,
  localTestMailer,
  mailErrorCode,
  readCapturedMail,
  resolveMailer,
  signInCodeEmail,
  type MailMessage,
} from "../../packages/shared/src/mail";
// Fake credentials only; no real provider or recipient is ever contacted.
const API_KEY = "re_test_not_a_real_key_123456";
const FROM = "TaiwanHub <hello@example.test>";
const message: MailMessage = {
  to: "member@example.test",
  kind: "membership_otp",
  subject: "Subject",
  text: "Body",
};
function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
function mailerWith(fetchImpl: typeof fetch, timeoutMs?: number) {
  return new ResendMailer({
    apiKey: API_KEY,
    from: FROM,
    fetch: fetchImpl,
    timeoutMs,
  });
}
async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as MailDeliveryError;
  }
  throw new Error("expected the send to fail");
}
describe("Resend adapter", () => {
  it("posts to the fixed endpoint with Bearer auth, the idempotency key and a validated id", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { id: "msg_123" }));
    const result = await mailerWith(fetchMock as unknown as typeof fetch).send(
      message,
      {
        idempotencyKey: "invitation:abc:v1",
      },
    );
    expect(result).toEqual({ providerMessageId: "msg_123" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(RESEND_ENDPOINT);
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(headers["Idempotency-Key"]).toBe("invitation:abc:v1");
    expect(init.redirect).toBe("error");
    expect(JSON.parse(String(init.body))).toEqual({
      from: FROM,
      to: [message.to],
      subject: message.subject,
      text: message.text,
    });
  });
  it("uses a frozen sender when one is given", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { id: "msg_1" }));
    await mailerWith(fetchMock as unknown as typeof fetch).send(message, {
      from: "Old <old@example.test>",
    });
    const init = (
      fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    )[1];
    expect(JSON.parse(String(init.body)).from).toBe("Old <old@example.test>");
  });
  it.each([
    [429, { name: "rate_limit_exceeded" }, "PROVIDER_RATE_LIMITED"],
    [500, { name: "internal_server_error" }, "PROVIDER_UNAVAILABLE"],
    [503, {}, "PROVIDER_UNAVAILABLE"],
    [401, { name: "missing_api_key" }, "PROVIDER_AUTH"],
    [403, { name: "invalid_api_key" }, "PROVIDER_AUTH"],
    [
      422,
      { name: "validation_error", message: "Invalid `to` field." },
      "INVALID_RECIPIENT",
    ],
    [
      422,
      { name: "validation_error", message: "Invalid subject." },
      "PROVIDER_REJECTED",
    ],
    [422, { name: "invalid_from_address" }, "MAIL_CONFIG"],
  ])("maps HTTP %i to %s", async (status, body, code) => {
    const fetchMock = vi.fn(async () => jsonResponse(status, body));
    const error = await failure(
      mailerWith(fetchMock as unknown as typeof fetch).send(message),
    );
    expect(error).toBeInstanceOf(MailDeliveryError);
    expect(error.code).toBe(code);
  });
  it("carries the provider's Retry-After on throttling", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        429,
        { name: "rate_limit_exceeded" },
        { "retry-after": "42" },
      ),
    );
    const error = await failure(
      mailerWith(fetchMock as unknown as typeof fetch).send(message),
    );
    expect(error.retryAfterSeconds).toBe(42);
    expect(error.permanent).toBe(false);
  });
  it("classifies permanent and configuration-wide failures", () => {
    expect(new MailDeliveryError("INVALID_RECIPIENT").permanent).toBe(true);
    expect(new MailDeliveryError("PROVIDER_REJECTED").permanent).toBe(true);
    expect(new MailDeliveryError("PROVIDER_TIMEOUT").permanent).toBe(false);
    expect(new MailDeliveryError("PROVIDER_AUTH").global).toBe(true);
    expect(new MailDeliveryError("MAIL_CONFIG").global).toBe(true);
  });
  it("rejects a malformed success response", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { unexpected: true }),
    );
    const error = await failure(
      mailerWith(fetchMock as unknown as typeof fetch).send(message),
    );
    expect(error.code).toBe("PROVIDER_MALFORMED_RESPONSE");
  });
  it("rejects a non-JSON success response", async () => {
    const fetchMock = vi.fn(
      async () => new Response("<html>", { status: 200 }),
    );
    const error = await failure(
      mailerWith(fetchMock as unknown as typeof fetch).send(message),
    );
    expect(error.code).toBe("PROVIDER_MALFORMED_RESPONSE");
  });
  it("times out instead of waiting indefinitely", async () => {
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const error = await failure(
      mailerWith(fetchMock as unknown as typeof fetch, 20).send(message),
    );
    expect(error.code).toBe("PROVIDER_TIMEOUT");
  });
  it("reports a network failure as a transient provider error", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const error = await failure(
      mailerWith(fetchMock as unknown as typeof fetch).send(message),
    );
    expect(error.code).toBe("PROVIDER_ERROR");
  });
  it("never puts the credential, recipient or provider text into the error", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(422, {
        name: "validation_error",
        message: `Invalid \`to\` ${message.to} for key ${API_KEY}`,
      }),
    );
    const error = await failure(
      mailerWith(fetchMock as unknown as typeof fetch).send(message),
    );
    const serialized = `${error.message} ${String(error)} ${JSON.stringify(error)}`;
    expect(serialized).not.toContain(API_KEY);
    expect(serialized).not.toContain(message.to);
    expect(serialized).not.toContain("validation_error");
    expect(mailErrorCode(error)).toBe("INVALID_RECIPIENT");
  });
});
describe("mail configuration", () => {
  it("builds a Resend mailer only with a key and a valid sender", () => {
    expect(
      resolveMailer({
        MAIL_PROVIDER: "resend",
        RESEND_API_KEY: API_KEY,
        MAIL_FROM: FROM,
      }),
    ).toBeInstanceOf(ResendMailer);
    for (const env of [
      { MAIL_PROVIDER: "resend", MAIL_FROM: FROM },
      { MAIL_PROVIDER: "resend", RESEND_API_KEY: API_KEY },
      {
        MAIL_PROVIDER: "resend",
        RESEND_API_KEY: API_KEY,
        MAIL_FROM: "not an address",
      },
    ])
      expect(() => resolveMailer(env)).toThrowError(MailDeliveryError);
  });
  it("fails closed for unknown providers and for test/capture transports in production", () => {
    expect(() => resolveMailer({ MAIL_PROVIDER: "smtp" })).toThrowError(
      MailDeliveryError,
    );
    expect(() => resolveMailer({ NODE_ENV: "production" })).toThrowError(
      MailDeliveryError,
    );
    expect(() =>
      resolveMailer({ NODE_ENV: "production", MAIL_PROVIDER: "test" }),
    ).toThrowError(MailDeliveryError);
    expect(() =>
      resolveMailer({
        NODE_ENV: "production",
        MAIL_PROVIDER: "capture",
        MAIL_CAPTURE_DIR: path.join(tmpdir(), "capture"),
      }),
    ).toThrowError(MailDeliveryError);
  });
  it("keeps the in-memory transport for local development", () => {
    expect(resolveMailer({ NODE_ENV: "development" })).toBe(localTestMailer);
  });
  it("only captures inside the OS temp directory", () => {
    expect(() =>
      resolveMailer({
        MAIL_PROVIDER: "capture",
        MAIL_CAPTURE_DIR: process.cwd(),
      }),
    ).toThrowError(MailDeliveryError);
    expect(() =>
      resolveMailer({
        MAIL_PROVIDER: "capture",
        MAIL_CAPTURE_DIR: "relative/dir",
      }),
    ).toThrowError(MailDeliveryError);
  });
});
describe("capture transport", () => {
  let dir: string;
  const previousKey = process.env.MAIL_OUTBOX_ENCRYPTION_KEY;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "taiwanhub-mail-unit-"));
    // Test-only key, never used outside this run.
    process.env.MAIL_OUTBOX_ENCRYPTION_KEY =
      "3HWCF7wU3kwiYI6i1Is5LdG9F6g/G40g4iBTgBVYS30=";
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (previousKey === undefined)
      delete process.env.MAIL_OUTBOX_ENCRYPTION_KEY;
    else process.env.MAIL_OUTBOX_ENCRYPTION_KEY = previousKey;
  });
  it("writes encrypted messages that only the Node-side reader can decrypt", async () => {
    const mailer = resolveMailer({
      MAIL_PROVIDER: "capture",
      MAIL_CAPTURE_DIR: dir,
    });
    await mailer.send(
      { ...message, text: "Your code is 012345" },
      { idempotencyKey: "k1" },
    );
    const captured = readCapturedMail(dir);
    expect(captured).toHaveLength(1);
    expect(captured[0].text).toBe("Your code is 012345");
    expect(captured[0].idempotencyKey).toBe("k1");
  });
});
describe("templates", () => {
  it("renders a bilingual invitation with the link and its actual expiry, not a fixed duration", () => {
    const mail = invitationEmail(
      "https://example.test/join#invite=abc",
      new Date("2026-10-03T08:15:00Z"),
    );
    expect(mail.text).toContain("https://example.test/join#invite=abc");
    expect(mail.text).toContain("expires 2026-10-03 08:15 UTC");
    expect(mail.text).toContain("將於 2026-10-03 08:15 UTC 到期");
    expect(mail.text).not.toMatch(/14 days|14 天/);
  });
  it("keeps a code's leading zeroes and never puts it in the subject", () => {
    const mail = signInCodeEmail("001234");
    expect(mail.text).toContain("001234");
    expect(mail.subject).not.toContain("001234");
    expect(mail.text).toContain("5 分鐘");
  });
});
