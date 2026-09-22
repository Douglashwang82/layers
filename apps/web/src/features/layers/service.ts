import { pool } from "@taiwanhub/database";
import type { PoolClient } from "pg";
import {
  AppError,
  layerInput,
  layerItemInput,
  layerPatchInput,
  parseItemKey,
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
function notProjected(found: LayerWithAccess) {
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
  const ref = parseItemKey(input.key)!;
  const found = await requireEditableLayer(id, a);
  notProjected(found);
  return transaction(async (tx) => {
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
    const column = `${ref.type}_id`;
    const result = await tx.query(
      `INSERT INTO layer_item(layer_id,${column},note,position,added_by) VALUES($1,$2,$3,(SELECT COALESCE(max(position),-1)+1 FROM layer_item WHERE layer_id=$1),$4) ON CONFLICT DO NOTHING`,
      [found.layer.id, ref.id, input.note, a.id],
    );
    const added = (result.rowCount ?? 0) > 0;
    if (added) {
      await tx.query(
        "UPDATE layer SET updated_by=$2,updated_at=now() WHERE id=$1",
        [found.layer.id, a.id],
      );
      await record(tx, a.id, "layer_item_added", {
        layerId: found.layer.id,
        type: ref.type,
      });
    }
    return { added, key: input.key };
  });
}
export async function removeLayerItem(
  actor: Actor | null,
  id: string,
  key: string,
) {
  writable();
  const a = requireActor(actor);
  const ref = parseItemKey(key);
  if (!ref) throw new AppError(400, "INVALID_ITEM", "Unknown item.");
  const found = await requireEditableLayer(id, a);
  notProjected(found);
  const result = await pool.query(
    `DELETE FROM layer_item WHERE layer_id=$1 AND ${ref.type}_id=$2`,
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
