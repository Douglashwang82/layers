import { isFoodCategory, isGoogleFoodPlace } from "@taiwanhub/shared";
/*
 * Tabelog search links for food places in Japan. Tabelog has no public API
 * and its terms forbid scraping, so this only builds a search URL for the
 * visitor to open; nothing here fetches Tabelog.
 */
// Rough boxes around Japan's islands, cut to leave out Korea, Taiwan and
// Russia's Pacific coast.
const japanBoxes: [number, number, number, number][] = [
  // [south, north, west, east]
  [32.5, 41.6, 132.0, 142.2], // Honshu, Shikoku
  [41.3, 45.6, 139.3, 146.0], // Hokkaido
  [30.0, 34.4, 129.5, 132.0], // Kyushu
  [34.0, 35.7, 130.8, 132.0], // western Honshu
  [24.0, 30.0, 122.9, 131.5], // Ryukyu islands
  [24.0, 32.5, 138.5, 142.5], // Izu and Ogasawara islands
];
export function isInJapan(lat: number, lng: number) {
  return japanBoxes.some(
    ([s, n, w, e]) => lat >= s && lat <= n && lng >= w && lng <= e,
  );
}
export function tabelogSearchUrl(name: string) {
  return `https://tabelog.com/rstLst/?vs=1&sw=${encodeURIComponent(name)}`;
}
function searchFor(
  name: string | null | undefined,
  food: boolean,
  lat: number | null | undefined,
  lng: number | null | undefined,
) {
  const trimmed = name?.trim();
  if (!trimmed || !food || lat == null || lng == null) return null;
  return isInJapan(lat, lng) ? tabelogSearchUrl(trimmed) : null;
}
/** A Tabelog search link for a named catalog or custom food place in Japan, otherwise null. */
export function tabelogLink(item: {
  type: string;
  name: string;
  category: string;
  latitude: number | null;
  longitude: number | null;
}) {
  if (item.type !== "place") return null;
  return searchFor(
    item.name,
    isFoodCategory(item.category),
    item.latitude,
    item.longitude,
  );
}
/** The same for a Google place: its pasted-link name, cached types and location. */
export function googleTabelogLink(ref: {
  name: string | null;
  types?: string[] | null;
  location?: { lat: number; lng: number } | null;
}) {
  return searchFor(
    ref.name,
    isGoogleFoodPlace(ref.types ?? []),
    ref.location?.lat,
    ref.location?.lng,
  );
}
