import { pool } from "@taiwanhub/database";
import type { PoolClient } from "pg";
import {
  AppError,
  layerInput,
  layerItemInput,
  layerPatchInput,
  parseLayerItemKey,
  requireActor,
  type Actor,
} from "@taiwanhub/shared";
import {
  getLayer,
  getMemberships,
  mySavesSlug,
  requireEditableLayer,
  type LayerWithAccess,
} from "./repository";
import { flags } from "@/lib/config";
import { requeueLayerReviews } from "@/features/reviews/service";
import { requireActionableSubject } from "@/features/place-subjects/service";
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
async function record(
  tx: PoolClient,
  userId: string,
  name: string,
  properties: Record<string, string | number | boolean>,
) {
  await tx.query(
    "INSERT INTO analytics_event(user_id,name,properties) VALUES($1,$2,$3)",
    [userId, name, JSON.stringify(properties)],
  );
}
function writable() {
  if (!flags.layerWrites)
    throw new AppError(404, "DISABLED", "Layer editing is unavailable.");
}
export function slugify(title: string, id: string) {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `${base || "layer"}-${id.slice(0, 8)}`;
}
export function notProjected(found: LayerWithAccess) {
  if (found.layer.ownerKind === "system" || found.layer.slug === mySavesSlug)
    throw new AppError(
      403,
      "FORBIDDEN",
      "System collections cannot be changed here.",
    );
}
/** New layers start private (or restricted to their group) as an editable draft. */
export async function createLayer(actor: Actor | null, body: unknown) {
  writable();
  const a = requireActor(actor);
  const input = layerInput.parse(body);
  return transaction(async (tx) => {
    const city = await tx.query<{ id: string }>(
      "SELECT id FROM city WHERE slug=$1",
      [input.city],
    );
    if (!city.rows[0])
      throw new AppError(400, "INVALID_CITY", "Choose a supported city.");
    let groupId: string | null = null;
    if (input.audience === "group") {
      const role = (await getMemberships(a.id)).get(input.groupId!);
      if (!role || role === "viewer")
        throw new AppError(
          403,
          "FORBIDDEN",
          "You need an editor role in this group.",
        );
      const group = await tx.query<{ city_id: string }>(
        'SELECT city_id FROM "group" WHERE id=$1',
        [input.groupId],
      );
      if (group.rows[0]?.city_id !== city.rows[0].id)
        throw new AppError(
          400,
          "CITY_MISMATCH",
          "The group belongs to a different city.",
        );
      groupId = input.groupId!;
    }
    const id = crypto.randomUUID();
    await tx.query(
      `INSERT INTO layer(id,slug,title,title_chinese,description,description_chinese,city_id,owner_kind,owner_user_id,owner_group_id,audience,schedule,starts_on,ends_on,lifecycle,created_by,updated_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'draft',$15,$15)`,
      [
        id,
        slugify(input.title, id),
        input.title,
        input.titleChinese,
        input.description,
        input.descriptionChinese,
        city.rows[0].id,
        groupId ? "group" : "user",
        groupId ? null : a.id,
        groupId,
        groupId ? "group" : "private",
        input.schedule,
        input.startsOn ?? null,
        input.schedule === "range"
          ? (input.endsOn ?? null)
          : input.schedule === "day"
            ? (input.startsOn ?? null)
            : null,
        a.id,
      ],
    );
    await record(tx, a.id, "layer_created", {
      layerId: id,
      owner: groupId ? "group" : "user",
    });
    return id;
  }).then((id) => getLayer(id, a).then((found) => found!));
}
/** Metadata and lifecycle changes are version-checked so a second editor never silently overwrites. */
export async function updateLayer(
  actor: Actor | null,
  id: string,
  body: unknown,
) {
  writable();
  const a = requireActor(actor);
  const input = layerPatchInput.parse(body);
  const found = await requireEditableLayer(id, a);
  notProjected(found);
  if (input.lifecycle === "archived" && !found.access.manage)
    throw new AppError(403, "FORBIDDEN", "Only the owner can archive.");
  return transaction(async (tx) => {
    const current = await tx.query<{ revision: number }>(
      "SELECT revision FROM layer WHERE id=$1 FOR UPDATE",
      [found.layer.id],
    );
    if (current.rows[0].revision !== input.revision)
      throw new AppError(
        409,
        "VERSION_CONFLICT",
        "Someone else changed this layer. Reload to review the latest version.",
      );
    const schedule = input.schedule ?? found.layer.schedule;
    const startsOn =
      input.startsOn !== undefined ? input.startsOn : found.layer.startsOn;
    const endsOn =
      schedule === "evergreen"
        ? null
        : schedule === "day"
          ? startsOn
          : input.endsOn !== undefined
            ? input.endsOn
            : found.layer.endsOn;
    if (schedule === "day" && !startsOn)
      throw new AppError(400, "INVALID_DATES", "Choose a day.");
    if (schedule === "range" && (!startsOn || !endsOn || startsOn > endsOn))
      throw new AppError(400, "INVALID_DATES", "Choose a valid date range.");
    await tx.query(
      `UPDATE layer SET title=COALESCE($2,title),title_chinese=COALESCE($3,title_chinese),description=COALESCE($4,description),description_chinese=COALESCE($5,description_chinese),schedule=$6,starts_on=$7,ends_on=$8,lifecycle=COALESCE($9,lifecycle),revision=revision+1,updated_by=$10,updated_at=now() WHERE id=$1`,
      [
        found.layer.id,
        input.title ?? null,
        input.titleChinese ?? null,
        input.description ?? null,
        input.descriptionChinese ?? null,
        schedule === "evergreen" ? "evergreen" : schedule,
        schedule === "evergreen" ? null : startsOn,
        endsOn,
        input.lifecycle ?? null,
        a.id,
      ],
    );
    if (input.order?.length)
      for (const [position, itemId] of input.order.entries())
        await tx.query(
          "UPDATE layer_item SET position=$3 WHERE id=$2 AND layer_id=$1",
          [found.layer.id, itemId, position],
        );
    if (input.lifecycle === "archived")
      await record(tx, a.id, "layer_archived", { layerId: found.layer.id });
  }).then(() => getLayer(found.layer.id, a).then((updated) => updated!));
}
/** Deletion requires the owner; personal controls never delete projected/system layers. */
export async function deleteLayer(actor: Actor | null, id: string) {
  writable();
  const a = requireActor(actor);
  const found = await requireEditableLayer(id, a);
  notProjected(found);
  if (!found.access.manage)
    throw new AppError(403, "FORBIDDEN", "Only the owner can delete.");
  await pool.query("DELETE FROM layer WHERE id=$1", [found.layer.id]);
  return { deleted: true };
}
/**
 * Adding an item creates a reference to the canonical entity, never a copy.
 * v1 layers are city-scoped; adding is idempotent and returns whether it was new.
 */
export async function addLayerItem(
  actor: Actor | null,
  id: string,
  body: unknown,
) {
  writable();
  const a = requireActor(actor);
  const input = layerItemInput.parse(body);
  const ref = parseLayerItemKey(input.key)!;
  const found = await requireEditableLayer(id, a);
  notProjected(found);
  return transaction(async (tx) => {
    let target: LayerItemTarget;
    if (ref.type === "subject")
      target = await subjectTarget(tx, a, found, ref.id, input.selectionGrant);
    else if (ref.type === "custom")
      target = await customPlaceTarget(tx, found, ref.id);
    else {
      const table =
        ref.type === "place"
          ? "place"
          : ref.type === "event"
            ? "event"
            : "content_post";
      if (ref.type === "content" && !flags.content)
        throw new AppError(404, "NOT_FOUND", "This item is unavailable.");
      const entity = await tx.query<{ city_id: string }>(
        `SELECT city_id FROM ${table} WHERE id=$1 AND status='approved'`,
        [ref.id],
      );
      if (!entity.rows[0])
        throw new AppError(404, "NOT_FOUND", "This item is unavailable.");
      if (entity.rows[0].city_id !== found.layer.cityId)
        throw new AppError(
          400,
          "CITY_MISMATCH",
          "This layer belongs to a different city.",
        );
      target = { column: itemColumns[ref.type], id: ref.id, external: false };
    }
    const added = await attachLayerItem(tx, a.id, found, target, input.note);
    if (added)
      await record(tx, a.id, "layer_item_added", {
        layerId: found.layer.id,
        type: ref.type,
      });
    const key = target.column === "place_id" ? `place:${target.id}` : input.key;
    return { added, key };
  });
}
/** Allowlisted key-kind to column mapping; never interpolate a client value. */
const itemColumns = {
  place: "place_id",
  event: "event_id",
  content: "content_id",
  subject: "subject_id",
  custom: "custom_place_id",
} as const;
export type LayerItemTarget = {
  column: (typeof itemColumns)[keyof typeof itemColumns];
  id: string;
  /** Not moderated on its own: adding it to a reviewed public layer re-queues review. */
  external: boolean;
};
/**
 * Appends an already-authorized target to the layer inside the caller's
 * transaction. Idempotent; returns whether a row was added.
 */
export async function attachLayerItem(
  tx: PoolClient,
  actorId: string,
  found: LayerWithAccess,
  target: LayerItemTarget,
  note: string,
) {
  const result = await tx.query(
    `INSERT INTO layer_item(layer_id,${target.column},note,position,added_by) VALUES($1,$2,$3,(SELECT COALESCE(max(position),-1)+1 FROM layer_item WHERE layer_id=$1),$4) ON CONFLICT DO NOTHING`,
    [found.layer.id, target.id, note, actorId],
  );
  const added = (result.rowCount ?? 0) > 0;
  if (added) {
    await tx.query(
      "UPDATE layer SET updated_by=$2,updated_at=now() WHERE id=$1",
      [found.layer.id, actorId],
    );
    // A reviewed public layer never publishes an unchecked external place.
    if (target.external)
      await requirePublicationReview(tx, found.layer.id, actorId);
  }
  return added;
}
/**
 * Custom places join only layers owned by the same user or group, in the same
 * city, while active. This keeps a private place out of every other scope.
 */
async function customPlaceTarget(
  tx: PoolClient,
  found: LayerWithAccess,
  placeId: string,
): Promise<LayerItemTarget> {
  if (!flags.layerCustomPlaces)
    throw new AppError(404, "DISABLED", "Adding this place is unavailable.");
  const row = await tx.query<{
    owner_user_id: string | null;
    owner_group_id: string | null;
    city_id: string;
  }>(
    "SELECT owner_user_id,owner_group_id,city_id FROM custom_place WHERE id=$1 AND status='active' FOR SHARE",
    [placeId],
  );
  const place = row.rows[0];
  const sameScope =
    !!place &&
    (found.layer.ownerKind === "user"
      ? place.owner_user_id === found.layer.ownerUserId
      : found.layer.ownerKind === "group" &&
        place.owner_group_id === found.layer.ownerGroupId);
  if (!sameScope)
    throw new AppError(404, "NOT_FOUND", "This item is unavailable.");
  if (place.city_id !== found.layer.cityId)
    throw new AppError(
      400,
      "CITY_MISMATCH",
      "This layer belongs to a different city.",
    );
  return { column: "custom_place_id", id: placeId, external: true };
}
/**
 * External places join a layer only when active, visible to the actor (or just
 * resolved under a selection grant) and curated into the layer's city. A
 * subject linked to a catalog place is stored as that place, deduplicating it.
 */
async function subjectTarget(
  tx: PoolClient,
  actor: Actor,
  found: LayerWithAccess,
  subjectId: string,
  selectionGrant: string | undefined,
): Promise<LayerItemTarget> {
  const subject = await requireActionableSubject(
    tx,
    actor,
    subjectId,
    selectionGrant,
  );
  if (subject.catalog_place_id) {
    const place = await tx.query<{ city_id: string }>(
      "SELECT city_id FROM place WHERE id=$1 AND status='approved'",
      [subject.catalog_place_id],
    );
    if (place.rows[0]?.city_id !== found.layer.cityId)
      throw new AppError(
        400,
        "CITY_MISMATCH",
        "This layer belongs to a different city.",
      );
    return {
      column: "place_id",
      id: subject.catalog_place_id,
      external: false,
    };
  }
  if (!flags.externalPlaceCollections)
    throw new AppError(404, "DISABLED", "Adding this place is unavailable.");
  const city = await tx.query<{
    city_id: string | null;
    city_review_status: string;
  }>("SELECT city_id,city_review_status FROM place_subject WHERE id=$1", [
    subject.id,
  ]);
  const reviewed = city.rows[0]?.city_review_status === "approved";
  // Moderation guards what is public: private and group layers take an
  // unreviewed place as-is (public viewers never see unreviewed subjects);
  // a public layer still needs a moderator's city review first.
  if (!reviewed) {
    if (found.layer.audience === "public")
      throw new AppError(
        409,
        "CITY_REVIEW_REQUIRED",
        "Saved — city review needed before adding to a layer.",
      );
    return { column: "subject_id", id: subject.id, external: true };
  }
  if (city.rows[0].city_id !== found.layer.cityId)
    throw new AppError(
      400,
      "CITY_MISMATCH",
      "This layer belongs to a different city.",
    );
  return { column: "subject_id", id: subject.id, external: true };
}
/** Sends an approved public layer back to moderation after unreviewed content changes. */
export async function requirePublicationReview(
  tx: PoolClient,
  layerId: string,
  actorId: string,
) {
  const layer = await tx.query<{ review_status: string; audience: string }>(
    "SELECT review_status,audience FROM layer WHERE id=$1 FOR UPDATE",
    [layerId],
  );
  if (
    layer.rows[0]?.audience !== "public" ||
    layer.rows[0].review_status !== "approved"
  )
    return;
  await tx.query("UPDATE layer SET review_status='pending' WHERE id=$1", [
    layerId,
  ]);
  await tx.query(
    "INSERT INTO submission(user_id,entity_type,entity_id) VALUES($1,'layers',$2)",
    [actorId, layerId],
  );
}
export async function removeLayerItem(
  actor: Actor | null,
  id: string,
  key: string,
) {
  writable();
  const a = requireActor(actor);
  const ref = parseLayerItemKey(key);
  if (!ref) throw new AppError(400, "INVALID_ITEM", "Unknown item.");
  const found = await requireEditableLayer(id, a);
  notProjected(found);
  const result = await pool.query(
    `DELETE FROM layer_item WHERE layer_id=$1 AND ${itemColumns[ref.type]}=$2`,
    [found.layer.id, ref.id],
  );
  if (result.rowCount)
    await pool.query(
      "UPDATE layer SET updated_by=$2,updated_at=now() WHERE id=$1",
      [found.layer.id, a.id],
    );
  return { removed: (result.rowCount ?? 0) > 0, key };
}
/** Following retains a layer in the library; it never applies it to the map. */
export async function followLayer(
  actor: Actor | null,
  id: string,
  active: boolean,
) {
  writable();
  const a = requireActor(actor);
  const found = await getLayer(id, a);
  if (!found || found.layer.slug === mySavesSlug)
    throw new AppError(404, "NOT_FOUND", "This layer is unavailable.");
  return transaction(async (tx) => {
    if (active) {
      const result = await tx.query(
        "INSERT INTO layer_follow(user_id,layer_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [a.id, found.layer.id],
      );
      if (result.rowCount)
        await record(tx, a.id, "layer_followed", { layerId: found.layer.id });
    } else
      await tx.query(
        "DELETE FROM layer_follow WHERE user_id=$1 AND layer_id=$2",
        [a.id, found.layer.id],
      );
    return { following: active };
  });
}
/** Publication is a reviewed action: the layer becomes public only after moderation approves it. */
export async function publishLayer(
  actor: Actor | null,
  id: string,
  publish: boolean,
) {
  writable();
  const a = requireActor(actor);
  const found = await requireEditableLayer(id, a);
  notProjected(found);
  if (!found.access.manage)
    throw new AppError(
      403,
      "FORBIDDEN",
      "Only the owner can change the audience.",
    );
  if (found.layer.ownerKind === "group" && publish)
    throw new AppError(
      400,
      "GROUP_LAYER",
      "Group layers stay with their members in this release.",
    );
  return transaction(async (tx) => {
    if (publish) {
      await tx.query(
        `UPDATE layer SET audience='public',review_status='pending',lifecycle=CASE WHEN lifecycle='draft' THEN 'active' ELSE lifecycle END,updated_by=$2,updated_at=now() WHERE id=$1`,
        [found.layer.id, a.id],
      );
      await tx.query(
        "INSERT INTO submission(user_id,entity_type,entity_id) VALUES($1,'layers',$2)",
        [a.id, found.layer.id],
      );
      // Scope-approved reviews in this layer must pass moderation before the public sees them.
      await requeueLayerReviews(tx, found.layer.id, a.id);
      await record(tx, a.id, "layer_publish_requested", {
        layerId: found.layer.id,
      });
    } else
      await tx.query(
        `UPDATE layer SET audience='private',review_status='unsubmitted',updated_by=$2,updated_at=now() WHERE id=$1`,
        [found.layer.id, a.id],
      );
  }).then(() => getLayer(found.layer.id, a).then((updated) => updated!));
}
