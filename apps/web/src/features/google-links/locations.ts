import { pool } from "@taiwanhub/database";
import { resolveProviderPlace } from "../place-subjects/service";
import { fetchPlaceLocation, type ResolverDeps } from "./resolver";
/** Browsing reads existing coordinates only; it never triggers paid lookups. */
export const locationTtlDays = 30;
export type CachedLocation = { lat: number; lng: number; types: string[] };
/** Nothing outlives the permitted cache period, referenced or not. */
async function expireLocations() {
  await pool.query(
    `UPDATE place_provider_reference SET latitude=NULL, longitude=NULL, types=NULL, location_fetched_at=NULL, updated_at=now()
     WHERE location_fetched_at < now() - make_interval(days=>$1::int)`,
    [locationTtlDays],
  );
}
/** Missing or expired coordinates remain list-only until explicitly located. */
export async function placeLocations(subjectIds: string[]) {
  const locations = new Map<string, CachedLocation>();
  if (!subjectIds.length) return locations;
  await expireLocations();
  const rows = await pool.query<{
    subject_id: string;
    provider_place_id: string;
    latitude: number | null;
    longitude: number | null;
    types: string[] | null;
  }>(
    `SELECT subject_id, provider_place_id, latitude, longitude, types FROM place_provider_reference
     WHERE subject_id=ANY($1::uuid[]) AND provider='google' AND state='current'
       AND location_fetched_at >= now() - make_interval(days=>$2::int)`,
    [subjectIds, locationTtlDays],
  );
  for (const row of rows.rows) {
    if (row.latitude != null && row.longitude != null)
      locations.set(row.subject_id, {
        lat: row.latitude,
        lng: row.longitude,
        types: row.types ?? [],
      });
  }
  return locations;
}
/** Cached Google place types by place ID, for places held by ID alone (imported markers). */
export async function placeTypes(placeIds: string[]) {
  const types = new Map<string, string[]>();
  if (!placeIds.length) return types;
  await expireLocations();
  const rows = await pool.query<{
    provider_place_id: string;
    types: string[];
  }>(
    `SELECT provider_place_id, types FROM place_provider_reference
     WHERE provider='google' AND provider_place_id=ANY($1::text[]) AND types IS NOT NULL
       AND location_fetched_at >= now() - make_interval(days=>$2::int)`,
    [[...new Set(placeIds)], locationTtlDays],
  );
  for (const row of rows.rows) types.set(row.provider_place_id, row.types);
  return types;
}
/**
 * Caches Place Details (`location,types`) for places a member just imported.
 * An explicit provider operation, never run while browsing. Places with fresh
 * types are skipped; one failed lookup leaves that place untyped, nothing more.
 * Returns the types known for each place, fresh or just fetched.
 */
export async function cachePlaceDetails(
  placeIds: string[],
  deps: ResolverDeps,
  concurrency = 4,
) {
  const unique = [...new Set(placeIds)];
  const known = await placeTypes(unique);
  const types = new Map(known);
  const queue = unique.filter((id) => !known.has(id));
  const worker = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      try {
        const place = await fetchPlaceLocation(id, deps);
        if (!place) continue;
        await resolveProviderPlace(id);
        await pool.query(
          `UPDATE place_provider_reference SET latitude=$2, longitude=$3, types=$4, location_fetched_at=now(), updated_at=now()
           WHERE provider='google' AND provider_place_id=$1`,
          [id, place.lat, place.lng, place.types],
        );
        types.set(id, place.types);
      } catch {
        // Best effort: the marker keeps the neutral pin.
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, worker),
  );
  return types;
}
