import { pool } from "@taiwanhub/database";
import type { PoolClient } from "pg";
import {
  AppError,
  customPlaceInput,
  customPlacePatchInput,
  requireActor,
  type Actor,
} from "@taiwanhub/shared";
import { flags } from "@/lib/config";
import { requireEditableLayer } from "@/features/layers/repository";
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
/** A dropped pin is approximate; no pin means list-only. Geocoded (exact) points are set server-side in C2. */
function locationOf(pin: { latitude: number; longitude: number } | null) {
  return pin
    ? { status: "approximate" as const, ...pin }
    : { status: "unspecified" as const, latitude: null, longitude: null };
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
  const location = locationOf(input.pin ?? null);
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
    return { place: toCustomPlace(place), key: `custom:${place.id}` };
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
  return transaction(async (tx) => {
    const row = await requireEditablePlace(tx, a, id);
    const location =
      input.pin === undefined
        ? {
            status: row.location_status,
            latitude: row.latitude,
            longitude: row.longitude,
          }
        : locationOf(input.pin);
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
    return { place: toCustomPlace(updated.rows[0]) };
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
