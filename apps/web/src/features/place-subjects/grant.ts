import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "@taiwanhub/shared";
/**
 * Selection grants bridge a member's first local resolution of a business to
 * their first own save/review of it. A grant proves only that this actor
 * resolved this subject recently — never Google authenticity, city approval,
 * layer access or access to anyone else's content. Keep grants in memory and
 * request bodies; never in URLs or logs.
 */
const purpose = "taiwanhub:place-subject-selection-grant:v1";
export const selectionGrantTtlMs = 10 * 60 * 1000;
type Claims = { actorId: string; subjectId: string };
function signingKey(secret: string) {
  // A distinct purpose-derived key, so this signature cannot be confused with any other use of the secret.
  return createHmac("sha256", secret).update(purpose).digest();
}
function signature(payload: string, secret: string) {
  return createHmac("sha256", signingKey(secret)).update(payload).digest();
}
export function signSelectionGrant(
  claims: Claims,
  secret: string,
  now = Date.now(),
) {
  const payload = Buffer.from(
    JSON.stringify({
      p: purpose,
      a: claims.actorId,
      s: claims.subjectId,
      e: now + selectionGrantTtlMs,
    }),
  ).toString("base64url");
  return `${payload}.${signature(payload, secret).toString("base64url")}`;
}
/** True only for an unexpired grant signed by this server for exactly this actor and subject. */
export function verifySelectionGrant(
  token: string,
  expected: Claims,
  secret: string,
  now = Date.now(),
) {
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  const given = Buffer.from(sig, "base64url");
  const wanted = signature(payload, secret);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted))
    return false;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return false;
  }
  const c = claims as Record<string, unknown>;
  return (
    c.p === purpose &&
    c.a === expected.actorId &&
    c.s === expected.subjectId &&
    typeof c.e === "number" &&
    now < c.e
  );
}
/** Server-only secret; fail closed rather than sign with a weak or missing key. */
export function grantSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32)
    throw new AppError(
      503,
      "UNAVAILABLE",
      "This feature is not configured on this server.",
    );
  return secret;
}
