import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AppError, type Actor } from "@taiwanhub/shared";
import { appUrl } from "@/lib/config";
import {
  getMembershipMe,
  createNomination,
  listNominations,
  getNomination,
  patchNomination,
  withdrawNomination,
  decideNomination,
  revokeInvitation,
  reissueInvitation,
  adminDirectInvite,
  listReviewers,
  lookupUserByEmail,
  setReviewer,
  listBatches,
  createBatch,
  updateBatch,
  createJoinContext,
  joinEmailStart,
  joinEmailComplete,
  retryMail,
  listMailJobs,
} from "./service";
import { RateLimitedError, trustedClientIp } from "./rate-limit";
const JOIN_COOKIE = "membership_join";
function ok(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status });
}
function errorResponse(error: unknown) {
  if (error instanceof RateLimitedError)
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          retryAfter: error.retryAfterSeconds,
        },
      },
      {
        status: 429,
        headers: { "Retry-After": String(error.retryAfterSeconds) },
      },
    );
  if (error instanceof z.ZodError)
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: error.issues.map((v) => v.message).join(" "),
        },
      },
      { status: 400 },
    );
  if (error instanceof AppError)
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  throw error;
}
function joinCookieValue(request: NextRequest) {
  return request.cookies.get(JOIN_COOKIE)?.value;
}
function setJoinCookie(response: NextResponse, secret: string) {
  response.cookies.set(JOIN_COOKIE, secret, {
    httpOnly: true,
    secure: new URL(appUrl).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 15 * 60,
  });
}
function requireJoinCookie(request: NextRequest) {
  const secret = joinCookieValue(request);
  if (!secret)
    throw new AppError(
      404,
      "INVITE_INVALID",
      "This invitation session has expired.",
    );
  return secret;
}
async function readJsonBody(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 16384)
    throw new AppError(413, "TOO_LARGE", "Request is too large.");
  const raw = await request.text();
  if (raw.length > 16384)
    throw new AppError(413, "TOO_LARGE", "Request is too large.");
  return raw ? JSON.parse(raw) : {};
}
function checkOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(appUrl).origin)
    throw new AppError(403, "BAD_ORIGIN", "Request origin is not allowed.");
}
/** Handles every /api/v1/membership/* route. `rest` is the path with the leading "membership" segment removed. */
export async function handleMembershipRoute(
  request: NextRequest,
  rest: string[],
  actor: Actor | null,
  query: Record<string, string>,
): Promise<NextResponse> {
  const method = request.method;
  const [section, id, action] = rest;
  try {
    if (method === "GET") {
      if (!section) return ok(await getMembershipMe(actor));
      if (section === "nominations") {
        if (id) return ok(await getNomination(actor, id));
        const scope = query.scope === "review" ? "review" : "mine";
        return ok(await listNominations(actor, scope));
      }
      if (section === "admin" && id === "reviewers")
        return ok(await listReviewers(actor));
      if (section === "admin" && id === "batches")
        return ok(await listBatches(actor));
      if (section === "admin" && id === "lookup")
        return ok(await lookupUserByEmail(actor, query.email ?? ""));
      if (section === "admin" && id === "mail" && !action)
        return ok(await listMailJobs(actor, query));
      throw new AppError(404, "NOT_FOUND", "Endpoint not found.");
    }
    if (section === "join") {
      const response = await handleJoinRoute(request, id, action, method);
      response.headers.set("Cache-Control", "no-store");
      return response;
    }
    checkOrigin(request);
    const body = await readJsonBody(request);
    if (section === "nominations") {
      if (!id && method === "POST") {
        const { nomination, created } = await createNomination(actor, body);
        return ok(nomination, created ? 201 : 200);
      }
      if (id && !action && method === "PATCH")
        return ok(await patchNomination(actor, id, body));
      if (id && action === "withdraw" && method === "POST")
        return ok(await withdrawNomination(actor, id, body));
      if (id && action === "decision" && method === "POST")
        return ok(await decideNomination(actor, id, body));
    }
    if (section === "invitations") {
      if (id && action === "revoke" && method === "POST")
        return ok(await revokeInvitation(actor, id, body));
      if (id && action === "reissue" && method === "POST")
        return ok(await reissueInvitation(actor, id));
    }
    if (section === "admin") {
      if (id === "invitations" && method === "POST")
        return ok(await adminDirectInvite(actor, body), 201);
      if (id === "reviewers" && action && method === "PUT")
        return ok(await setReviewer(actor, action, body));
      if (id === "batches" && !action && method === "POST")
        return ok(await createBatch(actor, body), 201);
      if (id === "batches" && action && method === "PATCH")
        return ok(await updateBatch(actor, action, body));
      if (id === "mail" && action && rest[3] === "retry" && method === "POST")
        return ok(await retryMail(actor, action));
    }
    throw new AppError(404, "NOT_FOUND", "Endpoint not found.");
  } catch (error) {
    return errorResponse(error);
  }
}
/** Invitation join steps: no-store, same-origin, bounded bodies, shared IP/email limits. */
async function handleJoinRoute(
  request: NextRequest,
  id: string | undefined,
  action: string | undefined,
  method: string,
): Promise<NextResponse> {
  try {
    checkOrigin(request);
    const body = await readJsonBody(request);
    const clientIp = trustedClientIp(request.headers);
    if (id === "context" && method === "POST") {
      const result = await createJoinContext(body, clientIp);
      const response = ok({
        maskedEmail: result.maskedEmail,
        nominatorName: result.nominatorName,
        invitationExpiresAt: result.invitationExpiresAt,
        returnTo: result.returnTo,
      });
      setJoinCookie(response, result.secret);
      return response;
    }
    if (id === "email" && action === "start" && method === "POST")
      return ok(
        await joinEmailStart(requireJoinCookie(request), body, clientIp),
      );
    if (id === "email" && action === "complete" && method === "POST") {
      const setCookies: string[] = [];
      const outcome = await joinEmailComplete(
        requireJoinCookie(request),
        body,
        // Called only after the admission transaction commits. Every session
        // cookie is forwarded individually (a joined header would corrupt
        // multiple Set-Cookie values).
        (headers) => setCookies.push(...headers.getSetCookie()),
      );
      const response = ok(outcome);
      for (const cookie of setCookies)
        response.headers.append("set-cookie", cookie);
      return response;
    }
    throw new AppError(404, "NOT_FOUND", "Endpoint not found.");
  } catch (error) {
    return errorResponse(error);
  }
}
