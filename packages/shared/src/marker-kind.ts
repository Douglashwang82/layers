import {
  isFoodCategory,
  isGoogleFoodPlace,
  isRetailCategory,
} from "./categories";

/**
 * Visual marker kinds. Classification is semantic and lives here so the map,
 * list and legend agree; colors and icons belong to the web presentation layer.
 * Unknown or missing categories stay "info": nothing is inferred from names.
 */
export const markerKinds = [
  "food",
  "retail",
  "park",
  "culture",
  "community",
  "event",
  "info",
] as const;
export type MarkerKind = (typeof markerKinds)[number];

export function markerKind(item: {
  type: "place" | "event" | "content";
  category?: string | null;
}): MarkerKind {
  if (item.type === "event") return "event";
  if (item.type === "content") return "info";
  const category = item.category ?? "";
  if (isFoodCategory(category)) return "food";
  if (isRetailCategory(category)) return "retail";
  if (category === "Park") return "park";
  if (category === "Museum") return "culture";
  if (category === "Community Center" || category === "Service")
    return "community";
  return "info";
}
/** The few kinds a Google place can take: food, shopping, outdoors, sights, other. */
export const googleMarkerKinds = [
  "food",
  "retail",
  "park",
  "culture",
  "info",
] as const satisfies readonly MarkerKind[];
export type GoogleMarkerKind = (typeof googleMarkerKinds)[number];
const googleOutdoorTypes = new Set([
  "park",
  "national_park",
  "state_park",
  "garden",
  "botanical_garden",
  "hiking_area",
  "beach",
  "campground",
  "zoo",
  "playground",
]);
const googleSightTypes = new Set([
  "museum",
  "art_gallery",
  "tourist_attraction",
  "historical_landmark",
  "historical_place",
  "cultural_landmark",
  "monument",
  "place_of_worship",
  "church",
  "hindu_temple",
  "mosque",
  "synagogue",
  "performing_arts_theater",
  "aquarium",
  "observation_deck",
]);
/**
 * A Google place's marker kind from its Places API types. The first match
 * wins in this order, so a museum café counts as food and a shrine park as
 * outdoors; no types (not fetched yet) is "info".
 */
export function googleMarkerKind(
  types: readonly string[] | null | undefined,
): GoogleMarkerKind {
  if (!types?.length) return "info";
  if (isGoogleFoodPlace(types)) return "food";
  if (types.some((t) => googleOutdoorTypes.has(t))) return "park";
  if (types.some((t) => googleSightTypes.has(t))) return "culture";
  if (
    types.some(
      (t) =>
        t === "store" ||
        t.endsWith("_store") ||
        t === "shopping_mall" ||
        t === "market",
    )
  )
    return "retail";
  return "info";
}
