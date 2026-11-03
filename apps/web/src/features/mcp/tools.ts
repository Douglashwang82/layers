import { z } from "zod";
import {
  AppError,
  maxGoogleLinks,
  parseMapQuery,
  type Actor,
  type GoogleLinkResult,
} from "@taiwanhub/shared";
import { appUrl } from "@/lib/config";
import { getCities } from "@/features/catalog/repository";
import { pickCity } from "@/lib/city";
import { getLayer, listLibrary } from "@/features/layers/repository";
import { removeLayerItem } from "@/features/layers/service";
import {
  createLayerFromGoogle,
  importGooglePlaces,
  resolveGoogleLinks,
} from "@/features/google-links/service";
import { contributionLimit } from "@/features/community/service";
import { runMapQuery } from "@/features/map/query";
import { mvpMapState } from "@/features/map/request";
import { MCP_READ_SCOPE, MCP_WRITE_SCOPE } from "./config";

/*
 * MCP tools (docs/guides/mcp-connector.md). Each tool is a thin adapter over
 * the same feature services the web API uses: inputs are validated here and
 * again by the service, and authorization stays in the service layer, so a
 * connector can never see or change more than the member can on the site.
 */

export type ToolScope = typeof MCP_READ_SCOPE | typeof MCP_WRITE_SCOPE;

const layerRef = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .describe("Layer id or slug, as returned by list_layers.");
const links = z
  .array(z.string().trim().min(1).max(2048))
  .min(1)
  .max(maxGoogleLinks)
  .describe(
    "Google Maps place links (maps.app.goo.gl or google.com/maps URLs).",
  );

export const toolInputs = {
  list_layers: z.object({
    scope: z
      .enum(["mine", "groups", "following", "discover"])
      .default("mine")
      .describe(
        "mine: layers you own; groups: your groups' layers; following: layers you follow; discover: public layers in a city.",
      ),
    city: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(80)
      .optional()
      .describe("City slug, e.g. houston, taipei or tokyo."),
    query: z.string().trim().max(100).default(""),
  }),
  get_layer_places: z.object({ layer: layerRef }),
  create_layer: z.object({
    title: z.string().trim().min(1).max(80),
    titleChinese: z.string().trim().max(80).default(""),
    description: z.string().trim().max(500).default(""),
    city: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(80)
      .describe("City slug, e.g. houston, taipei or tokyo."),
    audience: z.enum(["private", "group"]).default("private"),
    groupId: z.uuid().optional(),
    links,
  }),
  add_places_to_layer: z.object({ layer: layerRef, links }),
  remove_place_from_layer: z.object({
    layer: layerRef,
    key: z.string().max(80).describe("The place key from get_layer_places."),
  }),
};
export type ToolName = keyof typeof toolInputs;

export const toolMeta: Record<
  ToolName,
  {
    title: string;
    description: string;
    scope: ToolScope;
    annotations: {
      readOnlyHint: boolean;
      destructiveHint?: boolean;
      idempotentHint?: boolean;
      openWorldHint?: boolean;
    };
  }
> = {
  list_layers: {
    title: "List layers",
    description:
      "List the member's LocalLink map layers (curated collections of places), their groups' layers, followed layers, or public layers in a city.",
    scope: MCP_READ_SCOPE,
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  get_layer_places: {
    title: "Get a layer's places",
    description:
      "List the places on one LocalLink layer with names, addresses, coordinates and notes. Demo places are labeled isDemo.",
    scope: MCP_READ_SCOPE,
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  create_layer: {
    title: "Create a layer",
    description:
      "Create a new private (or group) LocalLink layer filled with the places from one or more Google Maps links.",
    scope: MCP_WRITE_SCOPE,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
  },
  add_places_to_layer: {
    title: "Add places to a layer",
    description:
      "Add places from Google Maps links to a LocalLink layer the member can edit. Places already on the layer are skipped.",
    scope: MCP_WRITE_SCOPE,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  remove_place_from_layer: {
    title: "Remove a place from a layer",
    description:
      "Remove one place from a LocalLink layer the member can edit. The place itself is not deleted.",
    scope: MCP_WRITE_SCOPE,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
};

/** Map item cap per response: keeps tool output within model context budgets. */
export const maxPlacesPerResponse = 100;

const layerUrl = (slug: string) =>
  `${appUrl}/?layerPanel=detail&layer=${encodeURIComponent(slug)}`;

type Found = NonNullable<Awaited<ReturnType<typeof getLayer>>>;
function layerSummary({ layer, access }: Found) {
  return {
    id: layer.id,
    slug: layer.slug,
    title: layer.title,
    titleChinese: layer.titleChinese,
    description: layer.description,
    city: layer.citySlug,
    owner: layer.ownerName,
    audience: layer.audience,
    placeCount: layer.itemCount,
    canEdit: access.edit,
    url: layerUrl(layer.slug),
  };
}

async function requireLayer(ref: string, actor: Actor) {
  const found = await getLayer(ref, actor);
  if (!found)
    throw new AppError(404, "NOT_FOUND", "This layer is unavailable.");
  return found;
}

/**
 * Resolve pasted links like the chat capture does: only Google Maps results
 * are added; Instagram captions are unverified and only reported back.
 */
async function resolveMapsLinks(
  actor: Actor,
  input: string[],
  layerId?: string,
) {
  const { results } = (await resolveGoogleLinks(actor, {
    links: input,
    layerId,
  })) as { results: GoogleLinkResult[] };
  const maps = results.filter(
    (r) => r.status === "resolved" && r.source !== "instagram",
  );
  const providerPlaceIds = [...new Set(maps.map((r) => r.providerPlaceId!))];
  const linkNames = Object.fromEntries(
    maps.filter((r) => r.name).map((r) => [r.providerPlaceId!, r.name!]),
  );
  const unresolved = results
    .filter((r) => !maps.includes(r))
    .map((r) => ({
      link: r.input,
      status: r.source === "instagram" ? "unsupported" : r.status,
      reason: r.source === "instagram" ? "instagram_not_added" : r.reason,
    }));
  return { providerPlaceIds, linkNames, unresolved };
}

export const toolHandlers: {
  [K in ToolName]: (
    actor: Actor,
    input: z.infer<(typeof toolInputs)[K]>,
  ) => Promise<unknown>;
} = {
  async list_layers(actor, input) {
    const city = pickCity(await getCities(), input.city);
    const layers = await listLibrary(input.scope, actor, city, input.query);
    return { city: city.slug, layers: layers.map(layerSummary) };
  },

  async get_layer_places(actor, input) {
    const found = await requireLayer(input.layer, actor);
    const cities = await getCities();
    const city = pickCity(cities, found.layer.citySlug);
    const state = mvpMapState({
      ...parseMapQuery({ city: city.slug }),
      city: city.slug,
      layers: [found.layer.slug],
    });
    const result = await runMapQuery(state, city, actor);
    const places = result.items.slice(0, maxPlacesPerResponse).map((item) => ({
      key: item.key,
      name: item.name,
      nameChinese: item.nameChinese,
      category: item.category,
      address: item.address,
      neighborhood: item.neighborhood,
      latitude: item.latitude,
      longitude: item.longitude,
      locationStatus: item.locationStatus,
      note: item.note,
      isDemo: item.isDemo,
    }));
    return {
      layer: layerSummary(found),
      places,
      total: result.total,
      truncated: result.truncated || result.items.length > places.length,
    };
  },

  async create_layer(actor, input) {
    await contributionLimit(actor);
    const { providerPlaceIds, linkNames, unresolved } = await resolveMapsLinks(
      actor,
      input.links,
    );
    if (!providerPlaceIds.length)
      throw new AppError(
        400,
        "NO_PLACES",
        "None of the links could be matched to a Google Maps place, so no layer was created.",
      );
    const created = await createLayerFromGoogle(actor, {
      title: input.title,
      titleChinese: input.titleChinese,
      description: input.description,
      city: input.city,
      audience: input.audience,
      groupId: input.groupId,
      providerPlaceIds,
      linkNames,
    });
    return {
      layer: layerSummary(created),
      added: created.added,
      skipped: created.skipped,
      unresolved,
    };
  },

  async add_places_to_layer(actor, input) {
    await contributionLimit(actor);
    const found = await requireLayer(input.layer, actor);
    if (!found.access.edit)
      throw new AppError(403, "FORBIDDEN", "You cannot edit this layer.");
    const { providerPlaceIds, linkNames, unresolved } = await resolveMapsLinks(
      actor,
      input.links,
      found.layer.id,
    );
    const outcome = providerPlaceIds.length
      ? await importGooglePlaces(actor, found.layer.id, {
          providerPlaceIds,
          linkNames,
        })
      : { added: 0, skipped: [] };
    return { layer: layerSummary(found), ...outcome, unresolved };
  },

  async remove_place_from_layer(actor, input) {
    await contributionLimit(actor);
    const found = await requireLayer(input.layer, actor);
    await removeLayerItem(actor, found.layer.id, input.key);
    return { layer: layerSummary(found), removed: input.key };
  },
};

/** Whether a token's space-separated scope claim grants a tool. */
export function hasScope(granted: string[], tool: ToolName) {
  const needed = toolMeta[tool].scope;
  // Write access implies read access for the same member.
  return (
    granted.includes(needed) ||
    (needed === MCP_READ_SCOPE && granted.includes(MCP_WRITE_SCOPE))
  );
}

/** A safe, model-readable error: service messages only, never internals. */
export function toolError(error: unknown) {
  if (error instanceof z.ZodError)
    return {
      code: "VALIDATION_ERROR",
      message: error.issues.map((i) => i.message).join(" "),
    };
  if (error instanceof AppError)
    return { code: error.code, message: error.message };
  return { code: "INTERNAL_ERROR", message: "Something went wrong." };
}
