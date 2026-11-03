import { pool } from "@taiwanhub/database";
import type { PoolClient } from "pg";
import {
  AppError,
  addDays,
  maxActiveTrips,
  maxTripDays,
  maxTripStops,
  orderDay,
  planTrip,
  requireActor,
  tripCreateInput,
  tripDayPatchInput,
  tripOptimizeInput,
  tripOptimizerVersion,
  tripRevisionInput,
  tripSourceInput,
  tripStopPatchInput,
  type Actor,
  type PlanInputStop,
} from "@taiwanhub/shared";
import { flags } from "@/lib/config";
import { getCollection } from "../layers/collections";
import type { CollectionNode } from "../layers/collections-types";
import {
  getLayer,
  getLayersById,
  getMemberships,
  type LayerWithAccess,
} from "../layers/repository";
import { transaction } from "../layers/service";
import {
  audienceFits,
  buildTripView,
  findTrip,
  listLayerPlaceItemIds,
  listTripRecords,
  loadDaysAndStops,
  resolveTripPlaces,
  type DayRow,
  type ItemRefusal,
  type StopRow,
  type TripPlace,
  type TripRecord,
  type TripView,
} from "./repository";

export function requireTrips() {
  if (!flags.trips) throw new AppError(404, "DISABLED", "Feature unavailable.");
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

function dayCount(startsOn: string, endsOn: string) {
  const ms =
    Date.parse(`${endsOn}T00:00:00Z`) - Date.parse(`${startsOn}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

function flattenLayers(node: CollectionNode, out: string[] = []) {
  for (const child of node.children)
    if (child.kind === "layer") out.push(child.layer.id);
    else flattenLayers(child.folder, out);
  return out;
}

/* ---------------------------------------------------------------------------
   Reads
   --------------------------------------------------------------------------- */
export async function listTrips(actor: Actor | null) {
  requireTrips();
  const a = requireActor(actor);
  const trips = await listTripRecords(a);
  return {
    trips: trips.map((t) => ({
      id: t.id,
      title: t.title,
      citySlug: t.citySlug,
      cityName: t.cityName,
      startsOn: t.startsOn,
      endsOn: t.endsOn,
      audience: t.audience,
      ownerName: t.ownerName,
      stopCount: t.stopCount,
      updatedAt: t.updatedAt,
    })),
  };
}

async function viewFor(
  trip: TripRecord,
  access: { view: boolean; edit: boolean; delete: boolean },
  actor: Actor | null,
  db: typeof pool | PoolClient = pool,
): Promise<TripView> {
  const { days, stops } = await loadDaysAndStops(db, trip.id);
  const ids = [
    ...new Set(stops.flatMap((s) => (s.layerItemId ? [s.layerItemId] : []))),
  ];
  const { places } = await resolveTripPlaces(ids, actor);
  return buildTripView(trip, access, days, stops, places);
}

export async function getTripView(id: string, actor: Actor | null) {
  requireTrips();
  const found = await findTrip(pool, id, actor);
  if (!found) throw new AppError(404, "NOT_FOUND", "This trip is unavailable.");
  return viewFor(found.trip, found.access, actor);
}

/* ---------------------------------------------------------------------------
   Source resolution (shared by preview and create)
   --------------------------------------------------------------------------- */
type SourceResult = {
  cityId: string | null;
  included: TripPlace[];
  refused: Array<{ itemId: string; reason: ItemRefusal }>;
};

async function resolveSource(
  actor: Actor,
  source: { layerId?: string; collectionId?: string; layerItemIds?: string[] },
  ownerGroupId: string | null,
): Promise<SourceResult> {
  let itemIds: string[];
  let layers: Map<string, LayerWithAccess> | undefined;
  let cityId: string | null = null;
  if (source.layerId) {
    const found = await getLayer(source.layerId, actor);
    if (!found)
      throw new AppError(404, "NOT_FOUND", "This layer is unavailable.");
    layers = new Map([[found.layer.id, found]]);
    cityId = found.layer.cityId;
    itemIds = await listLayerPlaceItemIds([found.layer.id]);
  } else if (source.collectionId) {
    const folder = await getCollection(source.collectionId, actor);
    if (!folder)
      throw new AppError(404, "NOT_FOUND", "This folder is unavailable.");
    const layerIds = [...new Set(flattenLayers(folder))];
    layers = await getLayersById(layerIds, actor);
    cityId = layers.get(layerIds[0] ?? "")?.layer.cityId ?? null;
    itemIds = await listLayerPlaceItemIds(layerIds);
  } else {
    itemIds = [...new Set(source.layerItemIds ?? [])];
  }
  const resolved = await resolveTripPlaces(itemIds, actor, layers);
  const refused: SourceResult["refused"] = [];
  const included: TripPlace[] = [];
  const keys = new Set<string>();
  for (const itemId of itemIds) {
    const reason = resolved.refused.get(itemId);
    if (reason) {
      refused.push({ itemId, reason });
      continue;
    }
    const place = resolved.places.get(itemId)!;
    const layer = resolved.layers.get(place.layerId)!;
    if (!audienceFits(layer, ownerGroupId))
      refused.push({ itemId, reason: "audience_mismatch" });
    else if (keys.has(place.key)) refused.push({ itemId, reason: "duplicate" });
    else if (included.length >= maxTripStops)
      refused.push({ itemId, reason: "limit" });
    else {
      keys.add(place.key);
      included.push(place);
      cityId ??= layer.layer.cityId;
    }
  }
  return { cityId, included, refused };
}

async function requireGroupEditor(
  actor: Actor,
  groupId: string | null | undefined,
) {
  if (!groupId) return null;
  const role = (await getMemberships(actor.id)).get(groupId);
  if (role !== "owner" && role !== "editor")
    throw new AppError(
      403,
      "FORBIDDEN",
      "Only group owners and editors can plan group trips.",
    );
  return groupId;
}

export async function previewTrip(actor: Actor | null, body: unknown) {
  requireTrips();
  const a = requireActor(actor);
  const input = tripSourceInput.parse(body);
  const groupId = await requireGroupEditor(
    a,
    (body as { groupId?: string } | null)?.groupId,
  );
  const result = await resolveSource(a, input, groupId);
  return {
    included: result.included.map((p) => ({
      itemId: p.itemId,
      label: p.label,
      labelChinese: p.labelChinese,
      located: p.point !== null,
    })),
    refused: result.refused,
  };
}

/* ---------------------------------------------------------------------------
   Writing plans
   --------------------------------------------------------------------------- */
async function writeDay(tx: PoolClient, dayId: string, stopIds: string[]) {
  if (!stopIds.length) return;
  await tx.query(
    `UPDATE trip_stop s SET day_id=$1, position=o.n-1, unscheduled_reason=NULL, updated_at=now()
     FROM unnest($2::uuid[]) WITH ORDINALITY AS o(id,n) WHERE s.id=o.id`,
    [dayId, stopIds],
  );
}

async function writeUnscheduled(
  tx: PoolClient,
  entries: Array<{ id: string; reason: string }>,
) {
  if (!entries.length) return;
  await tx.query(
    `UPDATE trip_stop s SET day_id=NULL, pinned=false, position=o.n-1, unscheduled_reason=o.reason, updated_at=now()
     FROM unnest($1::uuid[],$2::text[]) WITH ORDINALITY AS o(id,reason,n) WHERE s.id=o.id`,
    [entries.map((e) => e.id), entries.map((e) => e.reason)],
  );
}

type PlanContext = {
  tx: PoolClient;
  actor: Actor;
  trip: TripRecord;
  days: DayRow[];
  stops: StopRow[];
  /** Places the acting editor can see; stops without one are left untouched. */
  places: Map<string, TripPlace>;
};

function planStops(ctx: PlanContext, stops: StopRow[]): PlanInputStop[] {
  return stops.flatMap((s) => {
    const place = s.layerItemId ? ctx.places.get(s.layerItemId) : undefined;
    if (!place || s.status !== "active") return [];
    const day = ctx.days.findIndex((d) => d.id === s.dayId);
    return [
      {
        id: s.id,
        point: place.point,
        day: day >= 0 ? day : null,
        pinned: s.pinned,
        position: s.position,
      },
    ];
  });
}

/** Re-order one day (auto: by the heuristic; manual: just close gaps). */
async function reorderDay(ctx: PlanContext, dayId: string) {
  const day = ctx.days.find((d) => d.id === dayId);
  if (!day) return;
  const onDay = ctx.stops.filter(
    (s) => s.status === "active" && s.dayId === dayId,
  );
  const visible = planStops(ctx, onDay);
  const hidden = onDay
    .filter((s) => !visible.some((v) => v.id === s.id))
    .sort((a, b) => a.position - b.position);
  const ordered =
    day.orderMode === "manual"
      ? [...visible].sort((a, b) => a.position - b.position).map((s) => s.id)
      : orderDay(visible);
  await writeDay(ctx.tx, dayId, [...ordered, ...hidden.map((s) => s.id)]);
}

async function planAll(ctx: PlanContext) {
  const result = planTrip({
    dayCount: ctx.days.length,
    stopsPerDay: ctx.trip.stopsPerDay,
    stops: planStops(ctx, ctx.stops),
    manualDays: ctx.days.flatMap((d, i) =>
      d.orderMode === "manual" ? [i] : [],
    ),
  });
  for (let i = 0; i < ctx.days.length; i++)
    await writeDay(ctx.tx, ctx.days[i].id, result.days[i]);
  await writeUnscheduled(ctx.tx, result.unscheduled);
  return result;
}

/** Lock the trip, check access and revision, run `fn`, bump the revision. */
async function mutate(
  actor: Actor | null,
  tripId: string,
  expectedRevision: number | null,
  fn: (ctx: PlanContext) => Promise<void>,
): Promise<TripView> {
  requireTrips();
  const a = requireActor(actor);
  return transaction(async (tx) => {
    const found = await findTrip(tx, tripId, a, true);
    if (!found)
      throw new AppError(404, "NOT_FOUND", "This trip is unavailable.");
    if (!found.access.edit)
      throw new AppError(403, "FORBIDDEN", "You cannot edit this trip.");
    if (expectedRevision !== null && found.trip.revision !== expectedRevision)
      throw new AppError(
        409,
        "REVISION_CONFLICT",
        "This trip changed. Reload to see the latest version.",
      );
    const { days, stops } = await loadDaysAndStops(tx, tripId);
    const ids = [
      ...new Set(stops.flatMap((s) => (s.layerItemId ? [s.layerItemId] : []))),
    ];
    const { places } = await resolveTripPlaces(ids, a);
    await fn({ tx, actor: a, trip: found.trip, days, stops, places });
    const bumped = await tx.query<{ revision: number }>(
      `UPDATE trip SET revision=revision+1, updated_by=$2, updated_at=now() WHERE id=$1 RETURNING revision`,
      [tripId, a.id],
    );
    const trip = { ...found.trip, revision: bumped.rows[0].revision };
    return viewFor(trip, found.access, a, tx);
  });
}

/* ---------------------------------------------------------------------------
   Mutations
   --------------------------------------------------------------------------- */
export async function createTrip(actor: Actor | null, body: unknown) {
  requireTrips();
  const a = requireActor(actor);
  const input = tripCreateInput.parse(body);
  const days = dayCount(input.startsOn, input.endsOn);
  if (days > maxTripDays)
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      `A trip can be at most ${maxTripDays} days.`,
    );
  const groupId = await requireGroupEditor(a, input.groupId);
  const source = await resolveSource(a, input, groupId);
  if (!source.included.length || !source.cityId)
    throw new AppError(
      400,
      "NO_PLACES",
      "There are no places you can add to a trip here.",
    );
  const tripId = await transaction(async (tx) => {
    const count = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM trip WHERE status='active' AND ${groupId ? "owner_group_id" : "owner_user_id"}=$1`,
      [groupId ?? a.id],
    );
    if (count.rows[0].n >= maxActiveTrips)
      throw new AppError(
        409,
        "LIMIT_REACHED",
        `You can keep up to ${maxActiveTrips} trips.`,
      );
    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO trip(title,city_id,owner_user_id,owner_group_id,audience,starts_on,ends_on,stops_per_day,optimizer_version,created_by,updated_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING id`,
      [
        input.title,
        source.cityId,
        groupId ? null : a.id,
        groupId,
        groupId ? "group" : "private",
        input.startsOn,
        input.endsOn,
        input.stopsPerDay,
        tripOptimizerVersion,
        a.id,
      ],
    );
    const id = inserted.rows[0].id;
    const dates = Array.from({ length: days }, (_, i) =>
      addDays(input.startsOn, i),
    );
    const dayRows = await tx.query<{ id: string; on_date: string }>(
      `INSERT INTO trip_day(trip_id,on_date) SELECT $1, d::date FROM unnest($2::text[]) AS d
       RETURNING id,on_date::text AS on_date`,
      [id, dates],
    );
    const stopRows = await tx.query<{ id: string; layer_item_id: string }>(
      `INSERT INTO trip_stop(trip_id,layer_item_id,position,added_by)
       SELECT $1, o.item, o.n-1, $3 FROM unnest($2::uuid[]) WITH ORDINALITY AS o(item,n)
       RETURNING id,layer_item_id`,
      [id, source.included.map((p) => p.itemId), a.id],
    );
    const dayList: DayRow[] = dayRows.rows
      .map((d) => ({ id: d.id, onDate: d.on_date, orderMode: "auto" as const }))
      .sort((x, y) => (x.onDate < y.onDate ? -1 : 1));
    const stops: StopRow[] = stopRows.rows.map((s, i) => ({
      id: s.id,
      layerItemId: s.layer_item_id,
      dayId: null,
      position: i,
      pinned: false,
      unscheduledReason: null,
      status: "active",
      updatedAt: new Date().toISOString(),
    }));
    const places = new Map(source.included.map((p) => [p.itemId, p]));
    const trip = { stopsPerDay: input.stopsPerDay } as TripRecord;
    const result = await planAll({
      tx,
      actor: a,
      trip,
      days: dayList,
      stops,
      places,
    });
    await record(tx, a.id, "trip_created", {
      owner: groupId ? "group" : "user",
      days,
      stops: source.included.length,
      noLocation: result.unscheduled.filter((u) => u.reason === "no_location")
        .length,
      refused: source.refused.length,
    });
    return id;
  });
  return { ...(await getTripView(tripId, a)), refused: source.refused };
}

export async function deleteTrip(actor: Actor | null, tripId: string) {
  requireTrips();
  const a = requireActor(actor);
  return transaction(async (tx) => {
    const found = await findTrip(tx, tripId, a, true);
    if (!found)
      throw new AppError(404, "NOT_FOUND", "This trip is unavailable.");
    if (!found.access.delete)
      throw new AppError(403, "FORBIDDEN", "You cannot delete this trip.");
    await tx.query(
      `UPDATE trip SET status='deleted', deleted_at=now(), updated_by=$2, updated_at=now(), revision=revision+1 WHERE id=$1`,
      [tripId, a.id],
    );
    return { deleted: true };
  });
}

export async function patchTripStop(
  actor: Actor | null,
  tripId: string,
  stopId: string,
  body: unknown,
) {
  const input = tripStopPatchInput.parse(body);
  return mutate(actor, tripId, input.expectedRevision, async (ctx) => {
    const stop = ctx.stops.find((s) => s.id === stopId);
    // A stop the editor cannot see is indistinguishable from a missing one.
    if (!stop || !stop.layerItemId || !ctx.places.has(stop.layerItemId))
      throw new AppError(404, "NOT_FOUND", "This stop is unavailable.");
    if (input.status === "removed" && stop.status === "active") {
      await ctx.tx.query(
        `UPDATE trip_stop SET status='removed', updated_at=now() WHERE id=$1`,
        [stopId],
      );
      stop.status = "removed";
      if (stop.dayId) await reorderDay(ctx, stop.dayId);
      await record(ctx.tx, ctx.actor.id, "trip_stop_removed", {
        owner: ctx.trip.ownerGroupId ? "group" : "user",
      });
      return;
    }
    if (input.status === "active" && stop.status === "removed") {
      const taken = ctx.stops.some(
        (s) => s.status === "active" && s.layerItemId === stop.layerItemId,
      );
      if (taken)
        throw new AppError(
          409,
          "DUPLICATE",
          "This place is already in the trip.",
        );
      const dayStillThere = ctx.days.some((d) => d.id === stop.dayId);
      await ctx.tx.query(
        `UPDATE trip_stop SET status='active', day_id=$2, unscheduled_reason=$3, position=2147483647, updated_at=now() WHERE id=$1`,
        [
          stopId,
          dayStillThere ? stop.dayId : null,
          dayStillThere ? null : "user",
        ],
      );
      stop.status = "active";
      stop.position = Number.MAX_SAFE_INTEGER;
      if (dayStillThere && stop.dayId) await reorderDay(ctx, stop.dayId);
      return;
    }
    if (input.dayId !== undefined && stop.status === "active") {
      if (input.dayId !== null && !ctx.days.some((d) => d.id === input.dayId))
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          "That day is not part of this trip.",
        );
      const from = stop.dayId;
      await ctx.tx.query(
        `UPDATE trip_stop SET day_id=$2, pinned=$3, unscheduled_reason=$4, position=2147483647, updated_at=now() WHERE id=$1`,
        [
          stopId,
          input.dayId,
          input.dayId !== null,
          input.dayId === null ? "user" : null,
        ],
      );
      stop.dayId = input.dayId;
      stop.pinned = input.dayId !== null;
      stop.position = Number.MAX_SAFE_INTEGER;
      if (from && from !== input.dayId) await reorderDay(ctx, from);
      if (input.dayId) await reorderDay(ctx, input.dayId);
      await record(ctx.tx, ctx.actor.id, "trip_stop_moved", {
        owner: ctx.trip.ownerGroupId ? "group" : "user",
      });
    }
  });
}

export async function patchTripDay(
  actor: Actor | null,
  tripId: string,
  dayId: string,
  body: unknown,
) {
  const input = tripDayPatchInput.parse(body);
  return mutate(actor, tripId, input.expectedRevision, async (ctx) => {
    const day = ctx.days.find((d) => d.id === dayId);
    if (!day) throw new AppError(404, "NOT_FOUND", "This day is unavailable.");
    if (input.order) {
      const visible = planStops(
        ctx,
        ctx.stops.filter((s) => s.status === "active" && s.dayId === dayId),
      ).map((s) => s.id);
      const same =
        input.order.length === visible.length &&
        new Set(input.order).size === visible.length &&
        input.order.every((id) => visible.includes(id));
      if (!same)
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          "The order must list every stop on this day once.",
        );
      await ctx.tx.query(
        `UPDATE trip_day SET order_mode='manual', updated_at=now() WHERE id=$1`,
        [dayId],
      );
      day.orderMode = "manual";
      for (const s of ctx.stops) {
        const i = input.order.indexOf(s.id);
        if (i >= 0) s.position = i;
      }
      await reorderDay(ctx, dayId);
      return;
    }
    if (input.orderMode) {
      await ctx.tx.query(
        `UPDATE trip_day SET order_mode=$2, updated_at=now() WHERE id=$1`,
        [dayId, input.orderMode],
      );
      day.orderMode = input.orderMode;
      await reorderDay(ctx, dayId);
    }
  });
}

export async function optimizeTrip(
  actor: Actor | null,
  tripId: string,
  body: unknown,
) {
  const input = tripOptimizeInput.parse(body);
  return mutate(actor, tripId, input.expectedRevision, async (ctx) => {
    if (input.scope === "day") {
      if (!input.dayId || !ctx.days.some((d) => d.id === input.dayId))
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          "Choose a day of this trip.",
        );
      const day = ctx.days.find((d) => d.id === input.dayId)!;
      if (day.orderMode === "manual") {
        await ctx.tx.query(
          `UPDATE trip_day SET order_mode='auto', updated_at=now() WHERE id=$1`,
          [day.id],
        );
        day.orderMode = "auto";
      }
      await reorderDay(ctx, day.id);
    } else await planAll(ctx);
    await record(ctx.tx, ctx.actor.id, "trip_optimized", {
      scope: input.scope,
      stops: ctx.stops.filter((s) => s.status === "active").length,
      days: ctx.days.length,
    });
  });
}

/** Drop stops that are no longer available to this editor. */
export async function removeUnavailableStops(
  actor: Actor | null,
  tripId: string,
  body: unknown,
) {
  const input = tripRevisionInput.parse(body);
  return mutate(actor, tripId, input.expectedRevision, async (ctx) => {
    const gone = ctx.stops.filter(
      (s) =>
        s.status === "active" &&
        (!s.layerItemId || !ctx.places.has(s.layerItemId)),
    );
    if (!gone.length) return;
    await ctx.tx.query(
      `UPDATE trip_stop SET status='removed', updated_at=now() WHERE id=ANY($1::uuid[])`,
      [gone.map((s) => s.id)],
    );
  });
}
