import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  pool,
  decideCandidate,
  revertRevision,
  addExtractionPage,
  removeExtractionPage,
  setExtractionPageEnabled,
} from "@taiwanhub/database";
import {
  AppError,
  kinds,
  listInput,
  requireActor,
  requireModerator,
  plainText,
  mapPageSize,
  mapPreferenceInput,
  moderationEntityTypes,
  type Kind,
} from "@taiwanhub/shared";
import { currentActor } from "@/lib/session";
import { getActiveCity } from "@/lib/city";
import { runMapQuery } from "@/features/map/query";
import { resolveMapRequest } from "@/features/map/request";
import { getMapItemDetail } from "@/features/map/detail";
import {
  getLayer,
  listLibrary,
  listLayerItemRefs,
  setMapPreference,
} from "@/features/layers/repository";
import {
  createLayer,
  updateLayer,
  deleteLayer,
  addLayerItem,
  removeLayerItem,
  followLayer,
  publishLayer,
} from "@/features/layers/service";
import {
  getContentPost,
  listContentPosts,
} from "@/features/content/repository";
import { createContent, saveContent } from "@/features/content/service";
import {
  getGroup,
  listInvites,
  listMembers,
  listMyGroups,
} from "@/features/groups/repository";
import {
  acceptInvite,
  createGroup,
  inviteMember,
  removeMember,
  revokeInvite,
  setMemberRole,
} from "@/features/groups/service";
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
import { clientEventNames } from "@/lib/track";
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
    const query = Object.fromEntries(request.nextUrl.searchParams);
    if (method === "GET" && resource === "map") {
      if (id === "item")
        return ok(await getMapItemDetail(String(query.key ?? ""), actor));
      const { city, state } = await resolveMapRequest(query, actor);
      const result = await runMapQuery(state, city, actor);
      if (id === "results") {
        const start = (state.page - 1) * mapPageSize;
        return ok({
          generatedAt: result.generatedAt,
          items: result.items.slice(start, start + mapPageSize),
          total: result.total,
          mapped: result.mapped,
          unmapped: result.unmapped,
          page: state.page,
          pageSize: mapPageSize,
        });
      }
      if (id) throw new AppError(404, "NOT_FOUND", "Endpoint not found.");
      return ok(result);
    }
    if (method === "GET" && resource === "layers") {
      const { city } = await getActiveCity(query.city);
      if (id) {
        const found = await getLayer(id, actor, city);
        if (!found)
          throw new AppError(404, "NOT_FOUND", "This layer is unavailable.");
        if (action === "items")
          return ok({ items: await listLayerItemRefs(found.layer.id) });
        return ok(found);
      }
      const scope = z
        .enum(["discover", "following", "mine", "groups"])
        .catch("discover")
        .parse(query.scope);
      return ok(
        await listLibrary(
          scope,
          actor,
          city,
          String(query.q ?? "").slice(0, 100),
        ),
      );
    }
    if (method === "GET" && resource === "content") {
      if (!flags.content)
        throw new AppError(404, "DISABLED", "Feature unavailable.");
      if (id) return ok(await getContentPost(id, actor));
      const { city } = await getActiveCity(query.city);
      return ok(
        await listContentPosts({
          city: city.slug,
          q: String(query.q ?? "").slice(0, 100),
        }),
      );
    }
    if (method === "GET" && resource === "groups") {
      if (!id) return ok(await listMyGroups(requireActor(actor).id));
      const found = await getGroup(id, actor);
      if (!found)
        throw new AppError(404, "NOT_FOUND", "This group is unavailable.");
      // Member lists and invitations never leave the group.
      if (action === "members") {
        if (!found.role)
          throw new AppError(404, "NOT_FOUND", "This group is unavailable.");
        return ok(await listMembers(found.group.id));
      }
      if (action === "invites") {
        if (found.role !== "owner")
          throw new AppError(
            403,
            "FORBIDDEN",
            "Only a group owner can do this.",
          );
        return ok(await listInvites(found.group.id));
      }
      return ok(found);
    }
    if (method === "GET") {
      const input = listInput.parse(query);
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
      // Guest outcome events: allowlisted names, coarse string values, bounded size.
      if (resource === "analytics" && method === "POST") {
        const raw = await request.text();
        if (raw.length > 2048)
          throw new AppError(413, "TOO_LARGE", "Request is too large.");
        const v = z
          .object({
            name: z.enum(clientEventNames),
            properties: z
              .record(
                z.string().max(40),
                z.union([z.string().max(80), z.number(), z.boolean()]),
              )
              .refine((p) => Object.keys(p).length <= 5)
              .default({}),
          })
          .parse(JSON.parse(raw));
        await trackEvent(v.name, v.properties, actor?.id);
        return ok({ recorded: true }, 202);
      }
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
      // Extraction source pages. Administrators only: adding one asserts a
      // permission to read and republish that page.
      if (resource === "admin" && id === "extraction") {
        if (a.role !== "ADMIN")
          throw new AppError(403, "FORBIDDEN", "Administrator required.");
        try {
          if (method === "POST" && !action)
            return ok(await addExtractionPage(body, a.id), 201);
          if (method === "POST" && action) {
            z.uuid().parse(action);
            const enabled = z
              .object({ enabled: z.boolean() })
              .parse(body).enabled;
            return ok(await setExtractionPageEnabled(action, enabled));
          }
          if (method === "DELETE" && action) {
            z.uuid().parse(action);
            return ok(await removeExtractionPage(action));
          }
        } catch (error) {
          if (error instanceof AppError) throw error;
          throw new AppError(400, "EXTRACTION_INVALID", String(error));
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
      if (resource === "content") {
        if (!id && method === "POST")
          return ok(await createContent(a, body), 201);
        if (
          id &&
          action === "save" &&
          (method === "POST" || method === "DELETE")
        )
          return ok(await saveContent(a, id, method === "POST"));
      }
      if (resource === "groups") {
        if (!id && method === "POST")
          return ok(await createGroup(a, body), 201);
        if (id && action === "invites" && method === "POST")
          return ok(await inviteMember(a, id, body), 201);
        if (id && action === "invites" && method === "DELETE")
          return ok(await revokeInvite(a, id, String(query.invite ?? "")));
        if (id && action === "members" && method === "PATCH")
          return ok(
            await setMemberRole(a, id, z.uuid().parse(query.user), body),
          );
        if (id && action === "members" && method === "DELETE")
          return ok(await removeMember(a, id, z.uuid().parse(query.user)));
      }
      if (
        resource === "invites" &&
        id &&
        action === "accept" &&
        method === "POST"
      )
        return ok(await acceptInvite(a, id));
      if (resource === "map" && id === "preference" && method === "POST")
        return ok(await setMapPreference(a.id, mapPreferenceInput.parse(body)));
      if (resource === "layers") {
        if (!id && method === "POST")
          return ok(await createLayer(a, body), 201);
        if (id && !action && method === "PATCH")
          return ok(await updateLayer(a, id, body));
        if (id && !action && method === "DELETE")
          return ok(await deleteLayer(a, id));
        if (id && action === "items" && method === "POST")
          return ok(await addLayerItem(a, id, body), 201);
        if (id && action === "items" && method === "DELETE")
          return ok(await removeLayerItem(a, id, String(query.key ?? "")));
        if (
          id &&
          action === "follow" &&
          (method === "POST" || method === "DELETE")
        )
          return ok(await followLayer(a, id, method === "POST"));
        if (
          id &&
          action === "publish" &&
          (method === "POST" || method === "DELETE")
        )
          return ok(await publishLayer(a, id, method === "POST"));
      }
      if (resource === "reports" && method === "POST") {
        const v = z
          .object({
            entityType: z.enum(moderationEntityTypes),
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
