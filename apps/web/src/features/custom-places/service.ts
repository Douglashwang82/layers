import {
  distanceKm,
  geocodeAddress,
  GeocoderError,
  pool,
} from "@taiwanhub/database";
import type { PoolClient } from "pg";
import { z } from "zod";
import {
  AppError,
  customPlaceInput,
  customPlacePatchInput,
  customPlaceSuggestionInput,
  placeInput,
  requireActor,
  type Actor,
} from "@taiwanhub/shared";
import { flags } from "@/lib/config";
import { requireEditableLayer } from "@/features/layers/repository";
import {
  contributionLimit,
  insertSubmission,
} from "@/features/community/service";
import {
  attachLayerItem,
  notProjected,
  requirePublicationReview,
} from "@/features/layers/service";
import {
  findCustomPlace,
  scopeAccess,
  toCustomPlace,
  type CustomPlaceRow,
} from "./repository";
/** Per owner scope; generous for personal and group use, bounded against abuse. */
export const maxCustomPlacesPerScope = 1000;
async function transaction<T>(fn: (tx: PoolClient) => Promise<T>) {
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    const result = await fn(tx);
    await tx.query("COMMIT");
    return result;
  } catch (e) {
    await tx.query("ROLLBACK");
    throw e;
  } finally {
    tx.release();
  }
}
/** Ids only: names, addresses and coordinates never go to analytics. */
async function record(
  tx: PoolClient,
  userId: string,
  name: string,
  properties: Record<string, string>,
) {
  await tx.query(
    "INSERT INTO analytics_event(user_id,name,properties) VALUES($1,$2,$3)",
    [userId, name, JSON.stringify(properties)],
  );
}
function enabled() {
  if (!flags.layerWrites || !flags.layerCustomPlaces)
    throw new AppError(404, "DISABLED", "Custom places are unavailable.");
}
function unavailable() {
  return new AppError(404, "NOT_FOUND", "This place is unavailable.");
}
/** Replaceable in tests so no live geocoder call is made. */
export const geocoding = { geocode: geocodeAddress };
/** A geocoded match farther than this from the city centre is treated as no match. */
export const maxCityDistanceKm = 150;
export type GeocodeOutcome =
  "matched" | "no_match" | "outside_city" | "unavailable" | "skipped";
type Location = {
  status: "exact" | "approximate" | "unspecified";
  latitude: number | null;
  longitude: number | null;
};
const unmapped: Location = {
  status: "unspecified",
  latitude: null,
  longitude: null,
};
/** A dropped pin is approximate; no pin means list-only unless the address geocodes. */
function pinLocation(
  pin: { latitude: number; longitude: number } | null,
): Location {
  return pin ? { status: "approximate", ...pin } : unmapped;
}
/** Per-member geocoder budget; the provider is shared and free. */
async function geocodeLimit(actor: Actor) {
  const result = await pool.query<{ count: number }>(
    `INSERT INTO rate_limit(key,count,expires_at) VALUES($1,1,now()+interval '1 minute') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limit.expires_at<now() THEN 1 ELSE rate_limit.count+1 END, expires_at=CASE WHEN rate_limit.expires_at<now() THEN now()+interval '1 minute' ELSE rate_limit.expires_at END RETURNING count`,
    [`geocode:${actor.id}`],
  );
  if (result.rows[0].count > 20)
    throw new AppError(
      429,
      "RATE_LIMITED",
      "Please wait a minute before looking up more addresses.",
    );
}
/**
 * Geocodes an address for a city. The geocoder is untrusted and optional: a
 * failure never blocks saving, the place just stays list-only.
 */
async function geocodeForCity(
  actor: Actor,
  address: string,
  cityId: string,
): Promise<{ outcome: GeocodeOutcome; location: Location; matched: string }> {
  if (!address.trim())
    return { outcome: "skipped", location: unmapped, matched: "" };
  await geocodeLimit(actor);
  const city = await pool.query<{ latitude: number; longitude: number }>(
    "SELECT latitude,longitude FROM city WHERE id=$1",
    [cityId],
  );
  let match;
  try {
    match = await geocoding.geocode(address);
  } catch (error) {
    if (error instanceof GeocoderError)
      return { outcome: "unavailable", location: unmapped, matched: "" };
    throw error;
  }
  if (!match) return { outcome: "no_match", location: unmapped, matched: "" };
  if (city.rows[0] && distanceKm(match, city.rows[0]) > maxCityDistanceKm)
    return { outcome: "outside_city", location: unmapped, matched: "" };
  return {
    outcome: "matched",
    location: {
      status: "exact",
      latitude: match.latitude,
      longitude: match.longitude,
    },
    matched: match.matchedAddress,
  };
}
/** Editor preview for "Find on map": nothing is stored. */
export async function previewGeocode(
  actor: Actor | null,
  layerId: string,
  address: unknown,
) {
  enabled();
  const a = requireActor(actor);
  const value = z.string().trim().min(1).max(300).parse(address);
  const found = await requireEditableLayer(layerId, a);
  const result = await geocodeForCity(a, value, found.layer.cityId);
  return {
    outcome: result.outcome,
    latitude: result.location.latitude,
    longitude: result.location.longitude,
    matchedAddress: result.matched,
  };
}
/**
 * Creates a place owned by the layer's owner (the user, or the group) and adds
 * it to that layer in one transaction. Only layer editors can do this, which
 * for group layers means group owners and editors.
 */
export async function createCustomPlaceInLayer(
  actor: Actor | null,
  layerId: string,
  body: unknown,
) {
  enabled();
  const a = requireActor(actor);
  const input = customPlaceInput.parse(body);
  const found = await requireEditableLayer(layerId, a);
  notProjected(found);
  const { layer } = found;
  const owner =
    layer.ownerKind === "group"
      ? { user: null, group: layer.ownerGroupId }
      : { user: layer.ownerUserId, group: null };
  // A member's pin wins; otherwise geocode the address before the transaction.
  let location = pinLocation(input.pin ?? null);
  let geocode: GeocodeOutcome = "skipped";
  if (!input.pin && input.address) {
    const result = await geocodeForCity(a, input.address, layer.cityId);
    location = result.location;
    geocode = result.outcome;
  }
  return transaction(async (tx) => {
    // Serialize creations per scope so the cap cannot be raced past.
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `custom_place:${owner.user ?? owner.group}`,
    ]);
    const count = await tx.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM custom_place WHERE (owner_user_id=$1 OR owner_group_id=$2) AND status<>'deleted'",
      [owner.user, owner.group],
    );
    if (count.rows[0].count >= maxCustomPlacesPerScope)
      throw new AppError(
        429,
        "LIMIT_REACHED",
        "You have reached the limit for custom places.",
      );
    const inserted = await tx.query<CustomPlaceRow>(
      `INSERT INTO custom_place(owner_user_id,owner_group_id,city_id,name,name_chinese,address,location_status,latitude,longitude,location,category_id,website,note,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::float8,$9::float8,CASE WHEN $8::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($9::float8,$8::float8),4326) END,$10,$11,$12,$13)
       RETURNING *`,
      [
        owner.user,
        owner.group,
        layer.cityId,
        input.name,
        input.nameChinese,
        input.address,
        location.status,
        location.latitude,
        location.longitude,
        input.categoryId ?? null,
        input.website,
        input.note,
        a.id,
      ],
    );
    const place = inserted.rows[0];
    await attachLayerItem(
      tx,
      a.id,
      found,
      { column: "custom_place_id", id: place.id, external: true },
      "",
    );
    await record(tx, a.id, "custom_place_created", {
      placeId: place.id,
      layerId: layer.id,
    });
    return {
      place: toCustomPlace(place),
      key: `custom:${place.id}`,
      geocode,
    };
  });
}
/** Locks the row and requires edit rights in its owner scope. */
async function requireEditablePlace(tx: PoolClient, actor: Actor, id: string) {
  const row = await findCustomPlace(id, tx, true);
  if (!row || row.status === "deleted") throw unavailable();
  const access = await scopeAccess(row, actor);
  if (!access) throw unavailable();
  if (access !== "edit")
    throw new AppError(403, "FORBIDDEN", "You cannot edit this place.");
  if (row.status !== "active") throw unavailable();
  return row;
}
/** Approved public layers showing this place go back to review after a change. */
async function requeuePublicLayers(
  tx: PoolClient,
  placeId: string,
  actorId: string,
) {
  const layers = await tx.query<{ layer_id: string }>(
    "SELECT layer_id FROM layer_item WHERE custom_place_id=$1",
    [placeId],
  );
  for (const { layer_id } of layers.rows)
    await requirePublicationReview(tx, layer_id, actorId);
}
export async function updateCustomPlace(
  actor: Actor | null,
  id: string,
  body: unknown,
) {
  enabled();
  const a = requireActor(actor);
  const input = customPlacePatchInput.parse(body);
  // Re-geocode a changed address unless the member pinned the place themselves.
  const current = await findCustomPlace(id);
  let geocoded: { outcome: GeocodeOutcome; location: Location } | null = null;
  if (
    current &&
    (await scopeAccess(current, a)) === "edit" &&
    input.pin === undefined &&
    input.address !== undefined &&
    input.address !== current.address &&
    current.location_status !== "approximate"
  )
    geocoded = await geocodeForCity(a, input.address, current.city_id);
  return transaction(async (tx) => {
    const row = await requireEditablePlace(tx, a, id);
    const location: Location =
      input.pin !== undefined
        ? pinLocation(input.pin)
        : geocoded
          ? geocoded.location
          : {
              status: row.location_status,
              latitude: row.latitude,
              longitude: row.longitude,
            };
    const updated = await tx.query<CustomPlaceRow>(
      `UPDATE custom_place SET name=$2,name_chinese=$3,address=$4,location_status=$5,latitude=$6::float8,longitude=$7::float8,
         location=CASE WHEN $6::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($7::float8,$6::float8),4326) END,
         category_id=$8,website=$9,note=$10,updated_at=now()
       WHERE id=$1 RETURNING *`,
      [
        id,
        input.name ?? row.name,
        input.nameChinese ?? row.name_chinese,
        input.address ?? row.address,
        location.status,
        location.latitude,
        location.longitude,
        input.categoryId === undefined ? row.category_id : input.categoryId,
        input.website ?? row.website,
        input.note ?? row.note,
      ],
    );
    await requeuePublicLayers(tx, id, a.id);
    await record(tx, a.id, "custom_place_updated", { placeId: id });
    // Re-read so derived fields (the suggestion state) are current.
    const fresh = (await findCustomPlace(id, tx)) ?? updated.rows[0];
    return {
      place: toCustomPlace(fresh),
      geocode: geocoded?.outcome ?? ("skipped" as GeocodeOutcome),
    };
  });
}
/**
 * Opt-in "Suggest to TaiwanHub": files an ordinary pending catalog proposal
 * from the private place plus the catalog facts it lacks, and links the two.
 * The private place is unchanged; once a moderator approves the proposal the
 * map shows the catalog place instead. A pending or approved suggestion
 * cannot be filed twice; a rejected one can be retried.
 */
export async function suggestCustomPlace(
  actor: Actor | null,
  id: string,
  body: unknown,
) {
  enabled();
  if (!flags.submissions)
    throw new AppError(404, "DISABLED", "Suggestions are unavailable.");
  const a = requireActor(actor);
  const input = customPlaceSuggestionInput.parse(body);
  await contributionLimit(a);
  return transaction(async (tx) => {
    const row = await requireEditablePlace(tx, a, id);
    if (row.latitude === null || row.longitude === null || !row.address.trim())
      throw new AppError(
        400,
        "LOCATION_REQUIRED",
        "Add an address and a map location before suggesting this place.",
      );
    if (row.catalog_place_id) {
      const linked = await tx.query<{ status: string }>(
        "SELECT status FROM place WHERE id=$1",
        [row.catalog_place_id],
      );
      const status = linked.rows[0]?.status;
      if (status === "pending" || status === "approved")
        throw new AppError(
          409,
          "ALREADY_SUGGESTED",
          "This place has already been suggested.",
        );
    }
    const proposal = placeInput.parse({
      name: row.name,
      nameChinese: row.name_chinese,
      description: input.description,
      cityId: row.city_id,
      neighborhood: input.neighborhood,
      address: row.address,
      latitude: row.latitude,
      longitude: row.longitude,
      category: input.category,
    });
    const submitted = await insertSubmission(tx, a, "places", proposal);
    await tx.query(
      "UPDATE custom_place SET catalog_place_id=$2,updated_at=now() WHERE id=$1",
      [id, submitted.id],
    );
    await record(tx, a.id, "custom_place_suggested", { placeId: id });
    const fresh = await findCustomPlace(id, tx);
    return { place: toCustomPlace(fresh!) };
  });
}
/** Soft delete; the place leaves every layer of its scope. */
export async function deleteCustomPlace(actor: Actor | null, id: string) {
  enabled();
  const a = requireActor(actor);
  return transaction(async (tx) => {
    await requireEditablePlace(tx, a, id);
    await tx.query(
      "UPDATE custom_place SET status='deleted',updated_at=now() WHERE id=$1",
      [id],
    );
    const removed = await tx.query<{ layer_id: string }>(
      "DELETE FROM layer_item WHERE custom_place_id=$1 RETURNING layer_id",
      [id],
    );
    const layerIds = [...new Set(removed.rows.map((r) => r.layer_id))];
    if (layerIds.length)
      await tx.query(
        "UPDATE layer SET updated_by=$2,updated_at=now() WHERE id=ANY($1::uuid[])",
        [layerIds, a.id],
      );
    await record(tx, a.id, "custom_place_deleted", { placeId: id });
    return { deleted: true };
  });
}
