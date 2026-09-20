import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pool, decideCandidate, revertRevision } from "@taiwanhub/database";
import {
  AppError,
  kinds,
  listInput,
  requireActor,
  requireModerator,
  plainText,
  type Kind,
} from "@taiwanhub/shared";
import { currentActor } from "@/lib/session";
import {
  getCities,
  getContent,
  listContent,
  getHomeFeed,
  getSaved,
  getSightings,
} from "@/features/catalog/repository";
import {
  recommend,
  rsvp,
  save,
  follow,
  createSighting,
  submitContent,
  moderate,
  editContent,
  contributionLimit,
} from "@/features/community/service";
import { flags, appUrl } from "@/lib/config";
import { trackEvent } from "@/lib/analytics";
export const dynamic = "force-dynamic";
async function handler(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path } = await params;
    const [resource, id, action] = path;
    const method = request.method;
    if (
      ((resource === "products" || resource === "product-sightings") &&
        !flags.products) ||
      (resource === "organizations" && !flags.organizations)
    )
      throw new AppError(404, "DISABLED", "Feature unavailable.");
    const actor = await currentActor();
    if (method === "GET") {
      const input = listInput.parse(
        Object.fromEntries(request.nextUrl.searchParams),
      );
      if (resource === "cities") return ok(await getCities());
      if (resource === "home")
        return ok(await getHomeFeed(input.city, actor?.id));
      if (resource === "saved")
        return ok(await getSaved(requireActor(actor).id));
      if (resource === "search") {
        await trackEvent(
          "search_performed",
          { query: input.q, city: input.city },
          actor?.id,
        );
        const results = await Promise.all(
          kinds
            .filter(
              (k) =>
                (k !== "products" || flags.products) &&
                (k !== "organizations" || flags.organizations),
            )
            .map(async (k) => ({ kind: k, ...(await listContent(k, input)) })),
        );
        return ok(results);
      }
      if (resource === "product-sightings") {
        if (id) z.uuid().parse(id);
        return ok(await getSightings(id, input.city));
      }
      if (kinds.includes(resource as Kind))
        return ok(
          id
            ? await getContent(resource as Kind, id)
            : await listContent(resource as Kind, input),
        );
      if (resource === "admin") {
        requireModerator(actor);
        return ok(
          (
            await pool.query(
              "SELECT * FROM submission WHERE status=$1 ORDER BY created_at DESC LIMIT 100",
              ["pending"],
            )
          ).rows,
        );
      }
    } else {
      const origin = request.headers.get("origin");
      if (origin && origin !== new URL(appUrl).origin)
        throw new AppError(403, "BAD_ORIGIN", "Request origin is not allowed.");
      const a = requireActor(actor);
      await contributionLimit(a);
      if (Number(request.headers.get("content-length") ?? 0) > 16384)
        throw new AppError(413, "TOO_LARGE", "Request is too large.");
      const raw = method === "DELETE" ? "{}" : await request.text();
      if (raw.length > 16384)
        throw new AppError(413, "TOO_LARGE", "Request is too large.");
      const body: unknown = JSON.parse(raw);
      if (
        resource === "admin" &&
        id === "ingestion" &&
        action &&
        method === "POST"
      ) {
        requireModerator(a);
        z.uuid().parse(action);
        const decision = z
          .object({ decision: z.enum(["approve", "reject"]) })
          .parse(body).decision;
        try {
          return ok(await decideCandidate(action, a.id, decision));
        } catch (error) {
          throw new AppError(409, "INGESTION_CONFLICT", String(error));
        }
      }
      if (
        resource === "admin" &&
        id === "revisions" &&
        action &&
        method === "POST"
      ) {
        if (a.role !== "ADMIN")
          throw new AppError(403, "FORBIDDEN", "Administrator required.");
        z.uuid().parse(action);
        try {
          return ok(await revertRevision(action, a.id));
        } catch (error) {
          throw new AppError(409, "REVISION_CONFLICT", String(error));
        }
      }
      if (resource === "admin" && method === "POST")
        return ok(await moderate(a, body));
      if (
        resource === "admin" &&
        method === "PATCH" &&
        kinds.includes(id as Kind) &&
        action
      ) {
        z.uuid().parse(action);
        return ok(await editContent(a, id as Kind, action, body));
      }
      if (resource === "profile" && method === "PATCH") {
        const v = z
          .object({
            name: plainText(80),
            bio: z
              .string()
              .trim()
              .max(300)
              .refine((v) => !/[<>]/.test(v)),
            preferredLanguage: z.enum(["en", "zh-TW"]),
            homeCityId: z.uuid(),
          })
          .parse(body);
        await pool.query(
          'UPDATE "user" SET name=$1,bio=$2,preferred_language=$3,home_city_id=$4,updated_at=now() WHERE id=$5',
          [v.name, v.bio, v.preferredLanguage, v.homeCityId, a.id],
        );
        return ok({ updated: true });
      }
      if (resource === "reports" && method === "POST") {
        const v = z
          .object({
            entityType: z.enum([
              "places",
              "events",
              "products",
              "organizations",
              "notes",
              "sightings",
              "recommendations",
            ]),
            entityId: z.uuid(),
            reason: plainText(500),
          })
          .parse(body);
        await pool.query(
          "INSERT INTO submission(user_id,entity_type,entity_id,reason) VALUES($1,$2,$3,$4)",
          [a.id, v.entityType, v.entityId, v.reason],
        );
        return ok({ status: "pending" }, 201);
      }
      if (resource === "product-sightings" && method === "POST") {
        if (!flags.submissions)
          throw new AppError(404, "DISABLED", "Submissions unavailable.");
        return ok(await createSighting(a, body), 201);
      }
      if (
        (resource === "places" || resource === "events") &&
        !id &&
        method === "POST"
      ) {
        if (!flags.submissions)
          throw new AppError(404, "DISABLED", "Submissions unavailable.");
        return ok(await submitContent(a, resource, body), 201);
      }
      if (id) z.uuid().parse(id);
      if (
        resource === "places" &&
        action === "recommendation" &&
        method === "POST"
      )
        return ok(await recommend(a, id, body));
      if (
        resource === "events" &&
        action === "rsvp" &&
        (method === "POST" || method === "DELETE")
      )
        return ok(await rsvp(a, id, method === "POST"));
      if (
        resource === "organizations" &&
        action === "follow" &&
        (method === "POST" || method === "DELETE")
      )
        return ok(await follow(a, id, method === "POST"));
      if (
        ["places", "events", "products"].includes(resource) &&
        action === "save" &&
        (method === "POST" || method === "DELETE")
      )
        return ok(
          await save(
            a,
            resource as Exclude<Kind, "organizations">,
            id,
            method === "POST",
          ),
        );
    }
    throw new AppError(404, "NOT_FOUND", "Endpoint not found.");
  } catch (error) {
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
    console.error(error);
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Something went wrong. Please try again.",
        },
      },
      { status: 500 },
    );
  }
}
function ok(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status });
}
export { handler as GET, handler as POST, handler as DELETE, handler as PATCH };
