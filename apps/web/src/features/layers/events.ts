import { pool } from "@taiwanhub/database";
import type { PoolClient } from "pg";
import {
  AppError,
  layerEventInput,
  layerEventPatchInput,
  localDateTimeOf,
  maxLayerEventDays,
  requireActor,
  zonedDateTime,
  type Actor,
  type LayerEvent,
} from "@taiwanhub/shared";
import { flags } from "@/lib/config";
import {
  getLayer,
  mySavesSlug,
  requireEditableLayer,
  type LayerRecord,
  type LayerWithAccess,
} from "./repository";
import { notProjected, requirePublicationReview } from "./service";
/*
 * Events attached to a place in a layer (docs/plans/layer-mvp-google-links-plan.md,
 * M3/M8). The event has no location of its own: it is shown at its layer
 * item's place, to exactly the people who can view the layer.
 */
/** The map key of the place a layer item holds, matching map/list identities. */
const itemKeySql = `CASE
    WHEN i.place_id IS NOT NULL THEN 'place:' || i.place_id
    WHEN i.subject_id IS NOT NULL THEN 'subject:' || i.subject_id
    WHEN cp.catalog_place_id IS NOT NULL AND cpp.id IS NOT NULL THEN 'place:' || cpp.id
    WHEN i.custom_place_id IS NOT NULL THEN 'custom:' || i.custom_place_id
  END`;
const eventFrom = `FROM layer_item_event e
  JOIN layer_item i ON i.id=e.layer_item_id
  JOIN layer l ON l.id=i.layer_id
  LEFT JOIN place p ON p.id=i.place_id
  LEFT JOIN place_subject s ON s.id=i.subject_id
  LEFT JOIN custom_place cp ON cp.id=i.custom_place_id
  LEFT JOIN place cpp ON cpp.id=cp.catalog_place_id AND cpp.status='approved'`;
/** Only events whose place is itself visible: approved catalog, active custom, active subject. */
const visiblePlace = `e.status='active'
  AND (i.event_id IS NULL AND i.content_id IS NULL)
  AND (i.place_id IS NULL OR p.status='approved')
  AND (i.custom_place_id IS NULL OR cp.status='active')
  AND (i.subject_id IS NULL OR s.status='active')`;
type Row = {
  id: string;
  key: string;
  layer: string;
  title: string;
  title_chinese: string;
  start_time: Date;
  end_time: Date;
  note: string;
};
const columns = `e.id,${itemKeySql} AS key,l.slug AS layer,e.title,e.title_chinese,e.start_time,e.end_time,e.note`;
function toEvent(row: Row): LayerEvent {
  return {
    id: row.id,
    key: row.key,
    layer: row.layer,
    title: row.title,
    titleChinese: row.title_chinese,
    startTime: row.start_time.toISOString(),
    endTime: row.end_time.toISOString(),
    note: row.note,
  };
}
/**
 * Upcoming and ongoing events in the resolved layers, grouped by place key.
 * Public viewers see only events on city-reviewed external places, the same
 * rule that decides whether they see the place at all.
 */
export async function listMapEvents(
  resolved: LayerWithAccess[],
  now = new Date(),
): Promise<Record<string, LayerEvent[]>> {
  const curated = resolved.filter(
    (r) => r.layer.ownerKind !== "system" && r.layer.rule?.kind !== "saves",
  );
  if (!curated.length) return {};
  const member = curated
    .filter((r) => r.access.role !== "public")
    .map((r) => r.layer.id);
  const result = await pool.query<Row>(
    `SELECT ${columns} ${eventFrom}
     WHERE i.layer_id=ANY($1::uuid[]) AND e.end_time > $2 AND ${visiblePlace}
       AND (i.subject_id IS NULL OR i.layer_id=ANY($3::uuid[]) OR s.city_review_status='approved')
     ORDER BY e.start_time, e.id LIMIT 500`,
    [curated.map((r) => r.layer.id), now, member],
  );
  const grouped: Record<string, LayerEvent[]> = {};
  for (const row of result.rows) {
    if (!row.key) continue;
    (grouped[row.key] ??= []).push(toEvent(row));
  }
  return grouped;
}
/** Every active event in one layer, for its editors and viewers. */
export async function listLayerEvents(
  actor: Actor | null,
  idOrSlug: string,
): Promise<LayerEvent[]> {
  // My saves is a projection over saved tables; it has no items to attach to.
  if (idOrSlug === mySavesSlug) return [];
  const found = await getLayer(idOrSlug, actor);
  if (!found)
    throw new AppError(404, "NOT_FOUND", "This layer is unavailable.");
  const member = found.access.role !== "public";
  const result = await pool.query<Row>(
    `SELECT ${columns} ${eventFrom}
     WHERE i.layer_id=$1 AND ${visiblePlace}
       AND ($2::boolean OR i.subject_id IS NULL OR s.city_review_status='approved')
     ORDER BY e.start_time, e.id LIMIT 500`,
    [found.layer.id, member],
  );
  return result.rows.filter((r) => r.key).map(toEvent);
}
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
function writable() {
  if (!flags.layerWrites || !flags.mapMvp)
    throw new AppError(404, "DISABLED", "Layer events are unavailable.");
}
async function editable(actor: Actor, layerId: string) {
  const found = await requireEditableLayer(layerId, actor);
  notProjected(found);
  return found;
}
/** Wall-clock times become instants in the layer city's time zone, within the allowed span. */
function instants(
  layer: LayerRecord,
  startsAt: string,
  endsAt: string,
): [Date, Date] {
  const start = zonedDateTime(startsAt, layer.timezone);
  const end = zonedDateTime(endsAt, layer.timezone);
  if (end < start)
    throw new AppError(
      400,
      "INVALID_DATES",
      "The event must end after it starts.",
    );
  if (end.getTime() - start.getTime() > maxLayerEventDays * 86400000)
    throw new AppError(
      400,
      "INVALID_DATES",
      `An event can last at most ${maxLayerEventDays} days.`,
    );
  return [start, end];
}
/** The layer item holding the keyed place, locked so a concurrent removal waits. */
async function itemFor(tx: PoolClient, layerId: string, key: string) {
  const [type, id] = key.split(":");
  const condition =
    type === "place"
      ? "(place_id=$2 OR custom_place_id IN (SELECT id FROM custom_place WHERE catalog_place_id=$2))"
      : type === "subject"
        ? "subject_id=$2"
        : "custom_place_id=$2";
  const result = await tx.query<{ id: string }>(
    `SELECT id FROM layer_item WHERE layer_id=$1 AND ${condition} ORDER BY position LIMIT 1 FOR UPDATE`,
    [layerId, id],
  );
  if (!result.rows[0])
    throw new AppError(404, "NOT_FOUND", "This place is not in the layer.");
  return result.rows[0].id;
}
async function eventRow(actor: Actor | null, layerId: string, eventId: string) {
  const events = await listLayerEvents(actor, layerId);
  const event = events.find((e) => e.id === eventId);
  if (!event)
    throw new AppError(404, "NOT_FOUND", "This event is unavailable.");
  return event;
}
export async function createLayerEvent(
  actor: Actor | null,
  layerId: string,
  body: unknown,
) {
  writable();
  const a = requireActor(actor);
  const input = layerEventInput.parse(body);
  const found = await editable(a, layerId);
  const [start, end] = instants(found.layer, input.startsAt, input.endsAt);
  const id = await transaction(async (tx) => {
    const itemId = await itemFor(tx, found.layer.id, input.key);
    const created = await tx.query<{ id: string }>(
      `INSERT INTO layer_item_event(layer_item_id,title,title_chinese,start_time,end_time,note,created_by,updated_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id`,
      [itemId, input.title, input.titleChinese, start, end, input.note, a.id],
    );
    await touch(tx, found.layer.id, a.id);
    await tx.query(
      "INSERT INTO analytics_event(user_id,name,properties) VALUES($1,'layer_event_added',$2)",
      [a.id, JSON.stringify({ layerId: found.layer.id })],
    );
    return created.rows[0].id;
  });
  return { event: await eventRow(a, found.layer.id, id) };
}
export async function updateLayerEvent(
  actor: Actor | null,
  layerId: string,
  eventId: string,
  body: unknown,
) {
  writable();
  const a = requireActor(actor);
  const input = layerEventPatchInput.parse(body);
  const found = await editable(a, layerId);
  await transaction(async (tx) => {
    const current = await tx.query<{ start_time: Date; end_time: Date }>(
      `SELECT e.start_time,e.end_time FROM layer_item_event e JOIN layer_item i ON i.id=e.layer_item_id
       WHERE e.id=$1 AND i.layer_id=$2 AND e.status='active' FOR UPDATE OF e`,
      [eventId, found.layer.id],
    );
    const row = current.rows[0];
    if (!row)
      throw new AppError(404, "NOT_FOUND", "This event is unavailable.");
    const [start, end] =
      input.startsAt || input.endsAt
        ? instants(
            found.layer,
            input.startsAt ??
              localDateTimeOf(row.start_time, found.layer.timezone),
            input.endsAt ?? localDateTimeOf(row.end_time, found.layer.timezone),
          )
        : [row.start_time, row.end_time];
    await tx.query(
      `UPDATE layer_item_event SET title=COALESCE($2,title),title_chinese=COALESCE($3,title_chinese),
         start_time=$4,end_time=$5,note=COALESCE($6,note),updated_by=$7,updated_at=now() WHERE id=$1`,
      [
        eventId,
        input.title ?? null,
        input.titleChinese ?? null,
        start,
        end,
        input.note ?? null,
        a.id,
      ],
    );
    await touch(tx, found.layer.id, a.id);
  });
  return { event: await eventRow(a, found.layer.id, eventId) };
}
/** Soft delete; the row stays for the layer's history. */
export async function deleteLayerEvent(
  actor: Actor | null,
  layerId: string,
  eventId: string,
) {
  writable();
  const a = requireActor(actor);
  const found = await editable(a, layerId);
  const result = await pool.query(
    `UPDATE layer_item_event e SET status='deleted',updated_by=$3,updated_at=now()
     FROM layer_item i WHERE i.id=e.layer_item_id AND e.id=$1 AND i.layer_id=$2 AND e.status='active'`,
    [eventId, found.layer.id, a.id],
  );
  if (!result.rowCount)
    throw new AppError(404, "NOT_FOUND", "This event is unavailable.");
  return { deleted: true, id: eventId };
}
/** Event text is unreviewed member content: a reviewed public layer goes back to review. */
async function touch(tx: PoolClient, layerId: string, actorId: string) {
  await tx.query(
    "UPDATE layer SET updated_by=$2,updated_at=now() WHERE id=$1",
    [layerId, actorId],
  );
  await requirePublicationReview(tx, layerId, actorId);
}
