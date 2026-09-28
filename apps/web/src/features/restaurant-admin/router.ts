import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AppError, requireModerator, type Actor } from "@taiwanhub/shared";
import { appUrl } from "@/lib/config";
import {
  addEvidence,
  approveCopy,
  curateCandidate,
  getRunDetail,
  listAreas,
  listJobs,
  queuePreparation,
  cancelRun,
  confirmCandidateArea,
  listCandidates,
  listRuns,
  publishRun,
  rejectCopy,
  setEvidenceApproval,
  withdrawPublishedPick,
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
 * Handles every /api/v1/admin/restaurant-picks/* route. `rest` excludes the
 * leading "admin"/"restaurant-picks" segments. Moderator-only throughout
 * (each service function calls requireModerator itself). No provider or
 * model call ever happens inside a request here — running the pipeline
 * itself (discovery/qualification/copy) is the separate, CLI-only
 * `prepareRestaurantPickRun`, invoked out of band; this router only reads
 * results, curates candidates/evidence, and drives the already-atomic
 * approve/publish/withdraw actions.
 */
export async function handleRestaurantAdminRoute(
  request: NextRequest,
  rest: string[],
  actor: Actor | null,
): Promise<NextResponse> {
  const method = request.method;
  const [first, second, third, fourth, fifth] = rest;
  try {
    requireModerator(actor);
    if (method === "GET") {
      if (!first) return ok(await listAreas(actor));
      if (first === "runs" && second && !third)
        return ok(await getRunDetail(actor, z.uuid().parse(second)));
      const areaId = z.uuid().parse(first);
      if (second === "jobs") return ok(await listJobs(actor, areaId));
      if (!second) return ok(await listRuns(actor, areaId));
      if (second === "candidates" && !third)
        return ok(await listCandidates(actor, areaId));
      throw new AppError(404, "NOT_FOUND", "Endpoint not found.");
    }
    checkOrigin(request);
    const body = await readJsonBody(request);
    if (first === "runs" && second && third === "cancel" && method === "POST")
      return ok(await cancelRun(actor, z.uuid().parse(second)));
    if (first === "runs" && second && third === "publish" && method === "POST")
      return ok(await publishRun(actor, z.uuid().parse(second), body));
    if (
      first === "runs" &&
      second &&
      third === "copy" &&
      fourth &&
      fifth === "approve" &&
      method === "POST"
    )
      return ok(await approveCopy(actor, z.uuid().parse(fourth)));
    if (
      first === "runs" &&
      second &&
      third === "copy" &&
      fourth &&
      fifth === "reject" &&
      method === "POST"
    )
      return ok(await rejectCopy(actor, z.uuid().parse(fourth), body));
    if (
      first === "picks" &&
      second &&
      third === "withdraw" &&
      method === "POST"
    )
      return ok(
        await withdrawPublishedPick(actor, z.uuid().parse(second), body),
      );
    if (first) {
      const areaId = z.uuid().parse(first);
      if (second === "prepare" && method === "POST")
        return ok(await queuePreparation(actor, areaId, body), 202);
      if (
        second === "candidates" &&
        third &&
        fourth === "confirm-area" &&
        method === "POST"
      )
        return ok(
          await confirmCandidateArea(
            actor,
            areaId,
            z.uuid().parse(third),
            body,
          ),
        );
      if (second === "candidates" && third && !fourth && method === "PATCH")
        return ok(
          await curateCandidate(actor, areaId, z.uuid().parse(third), body),
        );
      if (
        second === "candidates" &&
        third &&
        fourth === "evidence" &&
        !fifth &&
        method === "POST"
      )
        return ok(await addEvidence(actor, z.uuid().parse(third), body));
      if (
        second === "candidates" &&
        third &&
        fourth === "evidence" &&
        fifth &&
        method === "PATCH"
      ) {
        const approved = z
          .object({ approved: z.boolean() })
          .parse(body).approved;
        return ok(
          await setEvidenceApproval(actor, z.uuid().parse(fifth), approved),
        );
      }
    }
    throw new AppError(404, "NOT_FOUND", "Endpoint not found.");
  } catch (error) {
    return errorResponse(error);
  }
}
