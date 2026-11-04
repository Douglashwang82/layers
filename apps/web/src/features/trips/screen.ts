import { AppError, addDays, launchCities, localDate } from "@taiwanhub/shared";
import type { Actor } from "@taiwanhub/shared";
import type { Locale } from "@/lib/dictionary";
import { layerTitle } from "@/lib/layer-labels";
import type { TripPanelState } from "@/lib/trip-panel";
import { getLayer, getMemberships } from "@/features/layers/repository";
import { getCollection } from "@/features/layers/collections";
import { getTripView, listTrips } from "./service";
import type { TripView } from "./repository";

export type TripSummary = Awaited<
  ReturnType<typeof listTrips>
>["trips"][number];

/** Where a new trip's places come from, resolved for this viewer. */
export type TripSource = {
  kind: "layer" | "folder";
  id: string;
  slug: string;
  name: string;
};

/** Server-resolved content of the trip screen the URL names (docs/plans/trip-scheduler-design.md). */
export type TripScreenData =
  | { kind: "signin" }
  | { kind: "list"; trips: TripSummary[] }
  | {
      kind: "new";
      source: TripSource | null;
      group: { id: string; name: string } | null;
      defaultStart: string;
      defaultEnd: string;
    }
  | { kind: "detail"; id: string; view: TripView | null };

/**
 * Loads what a trip screen shows. Guests get a sign-in prompt and no trip
 * query; a trip the viewer cannot see is the same neutral `null` as a missing one.
 */
export async function loadTripScreen(
  panel: TripPanelState,
  actor: Actor | null,
  locale: Locale,
): Promise<TripScreenData> {
  if (!actor) return { kind: "signin" };
  if (panel.panel === "list")
    return { kind: "list", ...(await listTrips(actor)) };
  if (panel.panel === "detail") {
    const view = await getTripView(panel.id, actor).catch((e: unknown) => {
      if (e instanceof AppError && e.status === 404) return null;
      throw e;
    });
    return { kind: "detail", id: panel.id, view };
  }
  let source: TripSource | null = null;
  let group: { id: string; name: string } | null = null;
  let timezone = "UTC";
  const memberships = await getMemberships(actor.id);
  if (panel.layer) {
    const found = await getLayer(panel.layer, actor);
    if (found) {
      source = {
        kind: "layer",
        id: found.layer.id,
        slug: found.layer.slug,
        name: layerTitle(found.layer, locale),
      };
      timezone = found.layer.timezone;
      const role = found.layer.ownerGroupId
        ? memberships.get(found.layer.ownerGroupId)
        : null;
      if (found.layer.ownerGroupId && (role === "owner" || role === "editor"))
        group = { id: found.layer.ownerGroupId, name: found.layer.ownerName };
    }
  } else if (panel.folder) {
    const folder = await getCollection(panel.folder, actor);
    if (folder) {
      source = {
        kind: "folder",
        id: folder.id,
        slug: folder.slug,
        name:
          locale === "zh-TW" && folder.titleChinese
            ? folder.titleChinese
            : folder.title,
      };
      timezone =
        launchCities.find((c) => c.slug === folder.citySlug)?.timezone ?? "UTC";
      const role = folder.ownerGroupId
        ? memberships.get(folder.ownerGroupId)
        : null;
      if (folder.ownerGroupId && (role === "owner" || role === "editor"))
        group = { id: folder.ownerGroupId, name: folder.ownerName };
    }
  }
  const today = localDate(new Date(), timezone);
  return {
    kind: "new",
    source,
    group,
    defaultStart: addDays(today, 1),
    defaultEnd: addDays(today, 2),
  };
}
