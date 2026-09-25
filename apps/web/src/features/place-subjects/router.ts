import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pool } from "@taiwanhub/database";
import {
  AppError,
  placeSubjectLookupInput,
  requireActor,
  reviewScope,
  type Actor,
} from "@taiwanhub/shared";
import { appUrl } from "@/lib/config";
import { contributionLimit } from "@/features/community/service";
import { getSubjectDetail, lookupSubject } from "./repository";
import { listCityReviewQueue, patchSubject } from "./admin";
import {
  listReviewScopes,
  listScopeReviews,
} from "@/features/reviews/repository";
import { deleteReview, writeReview } from "@/features/reviews/service";
import {
  resolvePlaceSubject,
  savePlaceSubject,
  unsavePlaceSubject,
} from "./service";
/** Responses depend on the session; never let a shared cache keep them. */
function ok(data: unknown, status = 200) {
  return NextResponse.json(
    { data },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}
function errorResponse(error: unknown) {
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
  if (error instanceof SyntaxError)
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "Invalid JSON request." } },
      { status: 400 },
    );
  if (error instanceof AppError)
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  throw error;
}
async function readJsonBody(request: NextRequest) {
  if (Number(request.headers.get("content-length") ?? 0) > 4096)
    throw new AppError(413, "TOO_LARGE", "Request is too large.");
  const raw = await request.text();
  if (raw.length > 4096)
    throw new AppError(413, "TOO_LARGE", "Request is too large.");
  return raw ? JSON.parse(raw) : {};
}
function checkOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(appUrl).origin)
    throw new AppError(403, "BAD_ORIGIN", "Request origin is not allowed.");
}
/**
 * Bounded lookup rate, separate from the contribution limit. Keyed by actor, or
 * a hash of the forwarded client address for guests; the raw address is never stored.
 */
async function lookupLimit(request: NextRequest, actor: Actor | null) {
  const client =
    actor?.id ??
    createHash("sha256")
      .update(
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          "unknown",
      )
      .digest("hex")
      .slice(0, 32);
  const result = await pool.query<{ count: number }>(
    `INSERT INTO rate_limit(key,count,expires_at) VALUES($1,1,now()+interval '1 minute') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limit.expires_at<now() THEN 1 ELSE rate_limit.count+1 END, expires_at=CASE WHEN rate_limit.expires_at<now() THEN now()+interval '1 minute' ELSE rate_limit.expires_at END RETURNING count`,
    [`subject-lookup:${client}`],
  );
  if (result.rows[0].count > 60)
    throw new AppError(
      429,
      "RATE_LIMITED",
      "Please wait a minute before trying again.",
    );
}
/** Handles every /api/v1/place-subjects/* route. `rest` excludes the leading "place-subjects" segment. */
export async function handlePlaceSubjectRoute(
  request: NextRequest,
  rest: string[],
  actor: Actor | null,
  query: Record<string, string>,
): Promise<NextResponse> {
  const method = request.method;
  const [id, action] = rest;
  try {
    if (method === "GET") {
      if (id === "lookup" && !action) {
        const input = placeSubjectLookupInput.parse(query);
        await lookupLimit(request, actor);
        return ok(
          await lookupSubject(input.provider, input.providerPlaceId, actor),
        );
      }
      if (id && action === "reviews") {
        const scope = reviewScope.parse(query.scope ?? "");
        const page = z.coerce
          .number()
          .int()
          .min(1)
          .max(500)
          .catch(1)
          .parse(query.page ?? 1);
        const result = await listScopeReviews(
          z.uuid().parse(id),
          scope,
          actor,
          page,
        );
        if (!result)
          throw new AppError(
            404,
            "NOT_FOUND",
            "These reviews are unavailable.",
          );
        return ok(result);
      }
      if (id && action === "review-scopes") {
        const result = await listReviewScopes(z.uuid().parse(id), actor);
        if (!result)
          throw new AppError(404, "NOT_FOUND", "This place is unavailable.");
        return ok(result);
      }
      if (id && !action) {
        const detail = await getSubjectDetail(z.uuid().parse(id), actor);
        if (!detail)
          throw new AppError(404, "NOT_FOUND", "This place is unavailable.");
        return ok(detail);
      }
      throw new AppError(404, "NOT_FOUND", "Endpoint not found.");
    }
    checkOrigin(request);
    const a = requireActor(actor);
    await contributionLimit(a);
    const body = await readJsonBody(request);
    if (id === "resolve" && !action && method === "POST")
      return ok(await resolvePlaceSubject(a, body));
    if (id && action === "review") {
      const subjectId = z.uuid().parse(id);
      if (method === "PUT") return ok(await writeReview(a, subjectId, body));
      if (method === "DELETE")
        return ok(await deleteReview(a, subjectId, body));
    }
    if (id && action === "save") {
      const subjectId = z.uuid().parse(id);
      if (method === "POST")
        return ok(await savePlaceSubject(a, subjectId, body));
      if (method === "DELETE")
        return ok(await unsavePlaceSubject(a, subjectId));
    }
    throw new AppError(404, "NOT_FOUND", "Endpoint not found.");
  } catch (error) {
    return errorResponse(error);
  }
}
/** /api/v1/admin/place-subjects[/{id}]: moderator city curation, status, linking and provider replacement. */
export async function handleAdminPlaceSubjectRoute(
  request: NextRequest,
  id: string | undefined,
  actor: Actor | null,
  query: Record<string, string>,
): Promise<NextResponse> {
  try {
    if (request.method === "GET" && !id)
      return ok(await listCityReviewQueue(actor, query));
    if (request.method === "PATCH" && id) {
      checkOrigin(request);
      const subjectId = z.uuid().parse(id);
      return ok(
        await patchSubject(actor, subjectId, await readJsonBody(request)),
      );
    }
    throw new AppError(404, "NOT_FOUND", "Endpoint not found.");
  } catch (error) {
    return errorResponse(error);
  }
}
