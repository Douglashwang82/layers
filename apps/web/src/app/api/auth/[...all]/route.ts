import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { pool } from "@taiwanhub/database";
import { hasLiveInvitationForEmail } from "@/features/membership/repository";
const { GET, POST: nativePost } = toNextJsHandler(auth);
export { GET };
async function userExists(email: string) {
  const result = await pool.query('SELECT 1 FROM "user" WHERE email = $1', [
    email,
  ]);
  return (result.rowCount ?? 0) > 0;
}
function invalidCredential() {
  return NextResponse.json(
    {
      error: {
        code: "INVITE_REQUIRED",
        message: "Use your invitation to join TaiwanHub.",
      },
    },
    { status: 403 },
  );
}
/**
 * Every account-creation path is already gated by databaseHooks.user.create.before
 * in lib/auth.ts, which is the real, reliable veto (see ADR 0001). This wrapper
 * exists only to stop the *public* native endpoints from being used to reach
 * that path for an uninvited email at all - both to avoid wasting an OTP send
 * on someone who was never going to be allowed to join, and because our own
 * gated flow (features/membership/service.ts) drives account creation
 * in-process via auth.api.*, which never touches this HTTP route, so blocking
 * here never affects it. Existing users keep using these endpoints normally.
 */
export async function POST(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (
    path !== "/api/auth/sign-in/email-otp" &&
    path !== "/api/auth/email-otp/send-verification-otp"
  )
    return nativePost(request);
  const bodyText = await request.text();
  let email: unknown;
  let type: unknown;
  try {
    const parsed = JSON.parse(bodyText);
    email = parsed?.email;
    type = parsed?.type;
  } catch {
    return nativePost(
      new NextRequest(request.url, {
        method: "POST",
        headers: request.headers,
        body: bodyText,
      }),
    );
  }
  if (
    typeof email === "string" &&
    (path === "/api/auth/sign-in/email-otp" || type === "sign-in")
  ) {
    const normalized = email.toLowerCase();
    if (!(await userExists(normalized)) && !(await hasLiveInvitationForEmail(normalized)))
      return invalidCredential();
  }
  return nativePost(
    new NextRequest(request.url, {
      method: "POST",
      headers: request.headers,
      body: bodyText,
    }),
  );
}
