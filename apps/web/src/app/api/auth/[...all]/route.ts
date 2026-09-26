import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toNextJsHandler } from "better-auth/next-js";
import { AppError, normalizeEmail } from "@taiwanhub/shared";
import { resolveMailer } from "@taiwanhub/shared/mail";
import { auth } from "@/lib/auth";
import { appUrl } from "@/lib/config";
import { isAdmittedEmail } from "@/features/membership/repository";
import {
  RateLimitedError,
  enforceCodeSendLimits,
  enforceCodeVerifyLimits,
  trustedClientIp,
} from "@/features/membership/rate-limit";
const { GET, POST: nativePost } = toNextJsHandler(auth);
export { GET };
const SEND_CODE = "/api/auth/email-otp/send-verification-otp";
const VERIFY_CODE = "/api/auth/sign-in/email-otp";
/**
 * Native email-OTP purposes this app never delivers (the mail callback sends
 * sign-in codes only) or never uses. Blocked so they can't create verification
 * rows, probe accounts, or set passwords.
 */
const BLOCKED = new Set([
  "/api/auth/email-otp/check-verification-otp",
  "/api/auth/email-otp/verify-email",
  "/api/auth/email-otp/request-password-reset",
  "/api/auth/forget-password/email-otp",
  "/api/auth/email-otp/reset-password",
  "/api/auth/email-otp/request-email-change",
  "/api/auth/email-otp/change-email",
]);
const MAX_BODY_BYTES = 4096;
const NO_STORE = { "Cache-Control": "no-store" };
const sendInput = z.object({
  email: z.string().max(254),
  type: z.literal("sign-in"),
});
const verifyInput = z.object({
  email: z.string().max(254),
  otp: z.string().max(32),
});
function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return NextResponse.json(body, {
    status,
    headers: { ...NO_STORE, ...headers },
  });
}
/**
 * The one public answer for every credential failure - wrong, expired,
 * exhausted, replayed or missing code, Better Auth's own per-IP throttle, and
 * every ineligible account - so none of them can be used to probe membership.
 */
function invalidCode() {
  return json({ code: "INVALID_OTP", message: "Invalid OTP" }, 400);
}
/**
 * Better Auth's router (better-call 1.4, rou3) matches the raw, case-sensitive
 * `new URL(request.url).pathname`, rejects `//`, and - with
 * advanced.skipTrailingSlashes unset - rejects a trailing slash; percent
 * escapes are not decoded. This app classifies on the same raw pathname and
 * additionally on a canonical form (decoded, collapsed slashes, no trailing
 * slash, lower case): any non-canonical spelling of a guarded or blocked
 * route is refused here, so it can never reach Better Auth even if its
 * routing were loosened later.
 */
function canonicalPath(pathname: string) {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // Malformed escapes: classify the raw value.
  }
  return decoded
    .replace(/\/{2,}/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}
async function readBody(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(appUrl).origin)
    throw new AppError(403, "BAD_ORIGIN", "Request origin is not allowed.");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES)
    throw new AppError(413, "TOO_LARGE", "Request is too large.");
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES)
    throw new AppError(413, "TOO_LARGE", "Request is too large.");
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new AppError(400, "INVALID_JSON", "Invalid JSON request.");
  }
}
/** Rebuilds the request with only the validated fields; extra user fields never reach Better Auth. */
function delegate(request: NextRequest, body: Record<string, string>) {
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  return nativePost(
    new NextRequest(request.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}
/**
 * Request a returning-member code. Every syntactically valid address gets the
 * same generic success once limits pass; only an admitted member is actually
 * sent a code. Provider failures are recorded (redacted) by the mail callback
 * and are never reflected here.
 */
async function sendCode(request: NextRequest) {
  const input = sendInput.safeParse(await readBody(request));
  if (!input.success)
    return json({ code: "VALIDATION_ERROR", message: "Invalid request." }, 400);
  const email = normalizeEmail(input.data.email);
  if (!z.email().safeParse(email).success)
    return json({ code: "INVALID_EMAIL", message: "Invalid email" }, 400);
  try {
    resolveMailer();
  } catch {
    // A global configuration problem: the same answer for every address,
    // decided before any membership lookup.
    return json(
      {
        code: "MAIL_UNAVAILABLE",
        message: "Email sign-in is unavailable right now.",
      },
      503,
    );
  }
  await enforceCodeSendLimits(email, trustedClientIp(request.headers));
  if (await isAdmittedEmail(email)) {
    const native = await delegate(request, { email, type: "sign-in" });
    if (!native.ok)
      console.warn(
        JSON.stringify({
          event: "sign_in_code_native_status",
          status: native.status,
        }),
      );
  }
  return json({ success: true });
}
/**
 * Verify a returning-member code. Shared verify limits apply to every
 * well-formed address before the admission check; admission is rechecked
 * before Better Auth sees the request, and every native credential failure is
 * collapsed into the same public answer ineligible accounts get.
 */
async function verifyCode(request: NextRequest) {
  const input = verifyInput.safeParse(await readBody(request));
  if (!input.success) return invalidCode();
  const email = normalizeEmail(input.data.email);
  if (!z.email().safeParse(email).success) return invalidCode();
  await enforceCodeVerifyLimits(email, trustedClientIp(request.headers));
  if (!/^\d{6}$/.test(input.data.otp)) return invalidCode();
  if (!(await isAdmittedEmail(email))) return invalidCode();
  const native = await delegate(request, { email, otp: input.data.otp });
  if (native.status >= 500)
    return json(
      {
        code: "SIGN_IN_UNAVAILABLE",
        message: "Sign-in is unavailable right now.",
      },
      503,
    );
  // OTP_EXPIRED, TOO_MANY_ATTEMPTS, INVALID_OTP, Better Auth's own 429 (which
  // only admitted addresses can reach) - all look like a wrong code.
  if (!native.ok) return invalidCode();
  const response = new NextResponse(native.body, native);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
export async function POST(request: NextRequest) {
  // Exactly the string Better Auth's router matches on (see canonicalPath).
  const path = new URL(request.url).pathname;
  const canonical = canonicalPath(path);
  const guarded =
    canonical === SEND_CODE ||
    canonical === VERIFY_CODE ||
    BLOCKED.has(canonical);
  if (guarded && (BLOCKED.has(canonical) || path !== canonical))
    return json({ code: "NOT_FOUND", message: "Not found." }, 404);
  if (!guarded) return nativePost(request);
  try {
    return canonical === SEND_CODE
      ? await sendCode(request)
      : await verifyCode(request);
  } catch (error) {
    if (error instanceof RateLimitedError)
      return json(
        {
          code: error.code,
          message: error.message,
          retryAfter: error.retryAfterSeconds,
        },
        429,
        { "Retry-After": String(error.retryAfterSeconds) },
      );
    if (error instanceof AppError)
      return json({ code: error.code, message: error.message }, error.status);
    console.error(error);
    return json(
      { code: "INTERNAL_ERROR", message: "Something went wrong." },
      500,
    );
  }
}
