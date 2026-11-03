import { z } from "zod";
import { providerPlaceIdPattern } from "@taiwanhub/shared";
import type { ResolverDeps } from "@/features/google-links/resolver";
/*
 * Matching imported My Maps markers to Google places. A KML export carries
 * only a name, coordinates and a note, never a place ID. Each marker gets one
 * IDs-only Places Text Search for its name, restricted to a small box around
 * its own coordinates, so a hit is the named place at that spot or nothing.
 * Only the place ID is kept; the member's coordinates and note stay as
 * imported, and an unmatched marker remains a plain custom place.
 */
/** Half-width of the search box around a marker, in meters. */
export const matchRadiusMeters = 200;
const metersPerDegree = 111_320;
/** The box around a point, or null where it would cross a pole or the antimeridian. */
export function matchBox(latitude: number, longitude: number) {
  const dLat = matchRadiusMeters / metersPerDegree;
  const dLng =
    matchRadiusMeters /
    (metersPerDegree * Math.cos((latitude * Math.PI) / 180));
  const low = { latitude: latitude - dLat, longitude: longitude - dLng };
  const high = { latitude: latitude + dLat, longitude: longitude + dLng };
  if (
    !Number.isFinite(dLng) ||
    Math.abs(low.latitude) > 85 ||
    Math.abs(high.latitude) > 85 ||
    low.longitude < -180 ||
    high.longitude > 180
  )
    return null;
  return { low, high };
}
const searchResponse = z.object({
  places: z
    .array(z.object({ id: z.string().regex(providerPlaceIdPattern) }))
    .optional(),
});
/** One IDs-only Text Search; null on no hit, a box we can't draw, or any provider failure. */
export async function matchPoint(
  point: { name: string; latitude: number; longitude: number },
  deps: ResolverDeps,
) {
  const box = matchBox(point.latitude, point.longitude);
  if (!box || !point.name.trim()) return null;
  try {
    const response = await deps.fetch(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(deps.timeoutMs ?? 5000),
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": deps.apiKey,
          "X-Goog-FieldMask": "places.id",
        },
        body: JSON.stringify({
          textQuery: point.name.slice(0, 200),
          pageSize: 1,
          locationRestriction: { rectangle: box },
        }),
      },
    );
    if (!response.ok) return null;
    const parsed = searchResponse.safeParse(
      await response.json().catch(() => null),
    );
    return parsed.success ? (parsed.data.places?.[0]?.id ?? null) : null;
  } catch {
    return null;
  }
}
/** Matches with bounded concurrency; one failed lookup never fails the rest. */
export async function matchPoints(
  points: { id: string; name: string; latitude: number; longitude: number }[],
  deps: ResolverDeps,
  concurrency = 6,
) {
  const matches = new Map<string, string>();
  let next = 0;
  const worker = async () => {
    while (next < points.length) {
      const point = points[next++];
      const id = await matchPoint(point, deps);
      if (id) matches.set(point.id, id);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, points.length) }, worker),
  );
  return matches;
}
