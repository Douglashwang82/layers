import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { pool } from "@taiwanhub/database";
import { AppError, normalizeEmail } from "@taiwanhub/shared";
/**
 * Shared PostgreSQL limits for every membership email-code send (native
 * sign-in and the custom join routes) and for join-context exchanges. In-process
 * auth.api.* calls never pass through Better Auth's HTTP rate limiter, so these
 * are enforced explicitly, before any eligibility branching. Counter keys are
 * purpose-specific HMACs: raw emails and IP addresses are never stored.
 */
export const membershipLimits = {
  sendEmailCooldown: { windowSeconds: 60, max: 1 },
  sendEmailHourly: { windowSeconds: 3600, max: 5 },
  sendIpHourly: { windowSeconds: 3600, max: 20 },
  joinContextIp: { windowSeconds: 600, max: 30 },
  // Code verification, counted for every well-formed address (eligible or
  // not) before the admission check. Better Auth's stricter per-code attempt
  // budget (three) still applies on top.
  verifyEmail: { windowSeconds: 600, max: 10 },
  verifyIp: { windowSeconds: 600, max: 30 },
} as const;
type LimitName = keyof typeof membershipLimits;
export class RateLimitedError extends AppError {
  constructor(public retryAfterSeconds: number) {
    super(429, "RATE_LIMITED", "Please wait before trying again.");
  }
}
let limiterKey: Buffer | null = null;
function keyMaterial() {
  if (limiterKey) return limiterKey;
  const secret = process.env.AUTH_SECRET;
  if (!secret && process.env.NODE_ENV === "production")
    throw new Error("AUTH_SECRET is required for membership rate limiting.");
  limiterKey = createHmac("sha256", secret || "taiwanhub-local-development")
    .update("taiwanhub:membership-rate-limit:v1")
    .digest();
  return limiterKey;
}
function counterKey(name: LimitName, value: string) {
  const digest = createHmac("sha256", keyMaterial())
    .update(`${name}\u0000${value}`)
    .digest("base64url");
  return `membership:${name}:${digest}`;
}
async function hit(name: LimitName, value: string) {
  const { windowSeconds, max } = membershipLimits[name];
  const result = await pool.query<{ count: number; retry_after: number }>(
    `INSERT INTO rate_limit(key, count, expires_at) VALUES ($1, 1, now() + $2::int * interval '1 second')
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limit.expires_at < now() THEN 1 ELSE rate_limit.count + 1 END,
       expires_at = CASE WHEN rate_limit.expires_at < now() THEN now() + $2::int * interval '1 second' ELSE rate_limit.expires_at END
     RETURNING count, GREATEST(1, ceil(extract(epoch FROM expires_at - now())))::int AS retry_after`,
    [counterKey(name, value), windowSeconds],
  );
  const row = result.rows[0];
  return row.count > max ? row.retry_after : 0;
}
async function enforce(checks: [LimitName, string | null][]) {
  let retryAfter = 0;
  // Every applicable counter is incremented, so a blocked caller keeps spending its budget.
  for (const [name, value] of checks)
    if (value) retryAfter = Math.max(retryAfter, await hit(name, value));
  if (retryAfter) throw new RateLimitedError(retryAfter);
}
/** Applies to every code send, eligible or not. */
export function enforceCodeSendLimits(email: string, ip: string | null) {
  const normalized = normalizeEmail(email);
  return enforce([
    ["sendEmailCooldown", normalized],
    ["sendEmailHourly", normalized],
    ["sendIpHourly", ip],
  ]);
}
/** Applies to every well-formed verification attempt, eligible or not. */
export function enforceCodeVerifyLimits(email: string, ip: string | null) {
  return enforce([
    ["verifyEmail", normalizeEmail(email)],
    ["verifyIp", ip],
  ]);
}
/** Test support: clears one address's send/verify counters (the keys are HMACs, so no broad sweep is needed). */
export async function resetCodeSendLimits(email: string) {
  const normalized = normalizeEmail(email);
  await pool.query(`DELETE FROM rate_limit WHERE key = ANY($1::text[])`, [
    [
      counterKey("sendEmailCooldown", normalized),
      counterKey("sendEmailHourly", normalized),
      counterKey("verifyEmail", normalized),
    ],
  ]);
}
export function enforceJoinContextLimit(ip: string | null) {
  return enforce([["joinContextIp", ip]]);
}
/**
 * Only the header named by TRUSTED_CLIENT_IP_HEADER is trusted (on Vercel,
 * `x-vercel-forwarded-for`, which the platform sets and overwrites). Unset,
 * no IP is derived and IP counters are skipped; per-email limits still apply.
 * Arbitrary client-supplied forwarding headers are never read.
 */
export function trustedClientIp(headers: Headers): string | null {
  const name = process.env.TRUSTED_CLIENT_IP_HEADER?.trim().toLowerCase();
  if (!name) return null;
  const first = headers.get(name)?.split(",")[0]?.trim() ?? "";
  return isIP(first) ? first : null;
}
