import { isFoodCategory, isRetailCategory } from "./categories";

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
