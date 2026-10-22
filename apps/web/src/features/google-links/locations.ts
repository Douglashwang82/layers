import { pool } from "@taiwanhub/database";
import { AppError } from "@taiwanhub/shared";
import { fetchPlaceLocation, type ResolverDeps } from "./resolver";
import { resolverDeps } from "./deps";
/*
 * Coordinates for Google place pins (owner decision 2026-10-21, map MVP).
 * Google permits caching a place's latitude/longitude for at most 30 days, so
 * place_provider_reference holds them as a cache: expired values are cleared,
 * and a place without fresh coordinates is looked up again (Place Details,
 * `location,types` fields) when it is next listed. The place types (owner
 * request 2026-10-22, e.g. to tell restaurants apart) share the same fetch
 * and expiry. Names and other details still come only from the Places UI
 * Kit or the pasted link.
 */
export const locationTtlDays = 30;
/** Lookups per call; a map page holds at most this many external places. */
const maxLookups = 60;
const concurrency = 4;
/** Place IDs whose lookup just failed, so a broken ID is not retried on every view. */
const failedUntil = new Map<string, number>();
const retryAfterMs = 60 * 60 * 1000;
/** The server key's deps, or null when lookups are not configured here. */
function lookupDeps(): ResolverDeps | null {
  try {
    return resolverDeps();
  } catch (error) {
    if (error instanceof AppError) return null;
    throw error;
  }
}
export type CachedLocation = { lat: number; lng: number; types: string[] };
/**
 * Fresh coordinates and types for each subject's current Google place, by
 * subject ID. Missing or expired ones (and coordinates cached before types
 * were) are fetched (bounded) and stored; a place that cannot be located is
 * left out, and the client then locates it through the visible UI Kit
 * component as before.
 */
export async function placeLocations(
  subjectIds: string[],
  deps: ResolverDeps | null = lookupDeps(),
) {
  const locations = new Map<string, CachedLocation>();
  if (!subjectIds.length) return locations;
  // Nothing outlives the permitted cache period, referenced or not.
  await pool.query(
    `UPDATE place_provider_reference SET latitude=NULL, longitude=NULL, types=NULL, location_fetched_at=NULL, updated_at=now()
     WHERE location_fetched_at < now() - make_interval(days=>$1::int)`,
    [locationTtlDays],
  );
  const rows = await pool.query<{
    subject_id: string;
    provider_place_id: string;
    latitude: number | null;
    longitude: number | null;
    types: string[] | null;
  }>(
    `SELECT subject_id, provider_place_id, latitude, longitude, types FROM place_provider_reference
     WHERE subject_id=ANY($1::uuid[]) AND provider='google' AND state='current'`,
    [subjectIds],
  );
  const missing: { subjectId: string; placeId: string }[] = [];
  for (const row of rows.rows) {
    const cached =
      row.latitude != null && row.longitude != null
        ? { lat: row.latitude, lng: row.longitude, types: row.types ?? [] }
        : null;
    if (cached) locations.set(row.subject_id, cached);
    if (
      (!cached || !row.types) &&
      (failedUntil.get(row.provider_place_id) ?? 0) < Date.now()
    )
      missing.push({
        subjectId: row.subject_id,
        placeId: row.provider_place_id,
      });
  }
  if (!deps || !missing.length) return locations;
  const queue = missing.slice(0, maxLookups);
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      let location: CachedLocation | null = null;
      try {
        location = await fetchPlaceLocation(next.placeId, deps);
      } catch {
        location = null;
      }
      if (!location) {
        failedUntil.set(next.placeId, Date.now() + retryAfterMs);
        continue;
      }
      await pool.query(
        `UPDATE place_provider_reference SET latitude=$2, longitude=$3, types=$4, location_fetched_at=now(), updated_at=now()
         WHERE provider='google' AND provider_place_id=$1 AND state='current'`,
        [next.placeId, location.lat, location.lng, location.types],
      );
      locations.set(next.subjectId, location);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, worker),
  );
  return locations;
}
