import { pool } from "@taiwanhub/database";
/** Browsing reads existing coordinates only; it never triggers paid lookups. */
export const locationTtlDays = 30;
export type CachedLocation = { lat: number; lng: number; types: string[] };
/** Missing or expired coordinates remain list-only until explicitly located. */
export async function placeLocations(subjectIds: string[]) {
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
