import { pool } from "@taiwanhub/database";
import type { Pool, PoolClient } from "pg";
import { haversineMeters, type Actor, type LatLng } from "@taiwanhub/shared";
import {
  getLayersById,
  getMemberships,
  isPubliclyVisible,
  type LayerWithAccess,
  type Memberships,
} from "../layers/repository";
import { placeLocations } from "../google-links/locations";

/* ---------------------------------------------------------------------------
   Trip records and access
   --------------------------------------------------------------------------- */
export type TripRecord = {
  id: string;
  title: string;
  cityId: string;
  citySlug: string;
  cityName: string;
  timezone: string;
  ownerUserId: string | null;
  ownerGroupId: string | null;
  ownerName: string;
  audience: "private" | "group";
  startsOn: string;
  endsOn: string;
  stopsPerDay: number;
  /** Layer item used as "where you stay"; null when none. */
  baseItemId: string | null;
  revision: number;
  createdBy: string | null;
  updatedAt: string;
};
export type TripAccess = { view: boolean; edit: boolean; delete: boolean };

const tripColumns = `t.id,t.title,t.city_id,c.slug AS city_slug,c.name AS city_name,c.timezone,
  t.owner_user_id,t.owner_group_id,COALESCE(g.name,'') AS owner_name,t.audience,
  t.starts_on::text AS starts_on,t.ends_on::text AS ends_on,t.stops_per_day,t.base_item_id,t.revision,t.created_by,t.updated_at`;
const tripFrom = `FROM trip t JOIN city c ON c.id=t.city_id LEFT JOIN "group" g ON g.id=t.owner_group_id`;

function toTrip(r: Record<string, unknown>): TripRecord {
  return {
    id: String(r.id),
    title: String(r.title),
    cityId: String(r.city_id),
    citySlug: String(r.city_slug),
    cityName: String(r.city_name),
    timezone: String(r.timezone),
    ownerUserId: (r.owner_user_id as string) ?? null,
    ownerGroupId: (r.owner_group_id as string) ?? null,
    ownerName: String(r.owner_name ?? ""),
    audience: r.audience as TripRecord["audience"],
    startsOn: String(r.starts_on),
    endsOn: String(r.ends_on),
    stopsPerDay: Number(r.stops_per_day),
    baseItemId: (r.base_item_id as string) ?? null,
    revision: Number(r.revision),
    createdBy: (r.created_by as string) ?? null,
    updatedAt: new Date(String(r.updated_at)).toISOString(),
  };
}

/** Mirrors layer access: private trips are the owner's; group trips follow group roles. */
export function tripAccessFor(
  trip: Pick<TripRecord, "ownerUserId" | "ownerGroupId" | "createdBy">,
  actor: Actor | null,
  memberships: Memberships,
): TripAccess {
  if (!actor) return { view: false, edit: false, delete: false };
  if (trip.ownerUserId) {
    const own = trip.ownerUserId === actor.id;
    return { view: own, edit: own, delete: own };
  }
  const role = trip.ownerGroupId ? memberships.get(trip.ownerGroupId) : null;
  if (!role) return { view: false, edit: false, delete: false };
  return {
    view: true,
    edit: role !== "viewer",
    delete: role === "owner" || trip.createdBy === actor.id,
  };
}

/** An active trip the actor may view (optionally locked for update), or null. */
export async function findTrip(
  db: Pool | PoolClient,
  id: string,
  actor: Actor | null,
  lock = false,
): Promise<{ trip: TripRecord; access: TripAccess } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const result = await db.query<Record<string, unknown>>(
    `SELECT ${tripColumns} ${tripFrom} WHERE t.id=$1 AND t.status='active'${lock ? " FOR UPDATE OF t" : ""}`,
    [id],
  );
  if (!result.rows[0]) return null;
  const trip = toTrip(result.rows[0]);
  const access = tripAccessFor(trip, actor, await getMemberships(actor?.id));
  return access.view ? { trip, access } : null;
}

export async function listTripRecords(actor: Actor) {
  const memberships = await getMemberships(actor.id);
  const groups = [...memberships.keys()];
  const result = await pool.query<Record<string, unknown>>(
    `SELECT ${tripColumns},
       (SELECT count(*) FROM trip_stop s WHERE s.trip_id=t.id AND s.status='active' AND s.layer_item_id IS NOT NULL)::int AS stop_count
     ${tripFrom}
     WHERE t.status='active' AND (t.owner_user_id=$1 OR t.owner_group_id=ANY($2::uuid[]))
     ORDER BY t.starts_on DESC, t.updated_at DESC LIMIT 200`,
    [actor.id, groups],
  );
  return result.rows.map((r) => ({
    ...toTrip(r),
    stopCount: Number(r.stop_count),
  }));
}

/* ---------------------------------------------------------------------------
   Layer items as trip places
   --------------------------------------------------------------------------- */
export type TripPlace = {
  itemId: string;
  layerId: string;
  layerSlug: string;
  /** Canonical map key; duplicates of one place collapse on it. */
  key: string;
  label: string;
  labelChinese: string;
  point: LatLng | null;
  /** Google place id for directions links, when the place is external. */
  providerPlaceId: string | null;
};

type ItemRow = {
  id: string;
  layer_id: string;
  place_id: string | null;
  subject_id: string | null;
  custom_place_id: string | null;
  event_id: string | null;
  content_id: string | null;
  link_name: string | null;
  p_name: string | null;
  p_name_zh: string | null;
  p_lat: number | null;
  p_lng: number | null;
  p_status: string | null;
  cp_name: string | null;
  cp_name_zh: string | null;
  cp_lat: number | null;
  cp_lng: number | null;
  cp_status: string | null;
  cp_catalog_id: string | null;
  s_status: string | null;
  s_review: string | null;
  s_name: string | null;
  s_name_zh: string | null;
  provider_place_id: string | null;
};

const itemSelect = `SELECT i.id,i.layer_id,i.place_id,i.subject_id,i.custom_place_id,i.event_id,i.content_id,i.link_name,
    p.name AS p_name,p.name_chinese AS p_name_zh,p.latitude AS p_lat,p.longitude AS p_lng,p.status AS p_status,
    cp.name AS cp_name,cp.name_chinese AS cp_name_zh,
    CASE WHEN cp.location_status<>'unspecified' THEN cp.latitude END AS cp_lat,
    CASE WHEN cp.location_status<>'unspecified' THEN cp.longitude END AS cp_lng,
    cp.status AS cp_status,cpp.id AS cp_catalog_id,
    s.status AS s_status,s.city_review_status AS s_review,sp.name AS s_name,sp.name_chinese AS s_name_zh,
    ppr.provider_place_id
  FROM layer_item i
  LEFT JOIN place p ON p.id=i.place_id
  LEFT JOIN custom_place cp ON cp.id=i.custom_place_id
  LEFT JOIN place cpp ON cpp.id=cp.catalog_place_id AND cpp.status='approved'
  LEFT JOIN place_subject s ON s.id=i.subject_id
  LEFT JOIN place sp ON sp.id=s.catalog_place_id AND sp.status='approved'
  LEFT JOIN place_provider_reference ppr ON ppr.subject_id=i.subject_id AND ppr.provider='google' AND ppr.state='current'`;

export type ItemRefusal =
  "not_a_place" | "unavailable" | "audience_mismatch" | "duplicate" | "limit";

/**
 * Resolve layer items to places the actor can see right now, with
 * coordinates derived for this request only (never stored). Items the actor
 * cannot see are reported as `unavailable`, with no detail.
 */
export async function resolveTripPlaces(
  itemIds: string[],
  actor: Actor | null,
  layers?: Map<string, LayerWithAccess>,
): Promise<{
  places: Map<string, TripPlace>;
  refused: Map<string, ItemRefusal>;
  layers: Map<string, LayerWithAccess>;
}> {
  const places = new Map<string, TripPlace>();
  const refused = new Map<string, ItemRefusal>();
  if (!itemIds.length) return { places, refused, layers: layers ?? new Map() };
  const rows = (
    await pool.query<ItemRow>(`${itemSelect} WHERE i.id=ANY($1::uuid[])`, [
      itemIds,
    ])
  ).rows;
  const byLayer =
    layers ??
    (await getLayersById([...new Set(rows.map((r) => r.layer_id))], actor));
  const located = await placeLocations(
    rows.flatMap((r) => (r.subject_id ? [r.subject_id] : [])),
  );
  const found = new Set(rows.map((r) => r.id));
  for (const id of itemIds) if (!found.has(id)) refused.set(id, "unavailable");
  for (const r of rows) {
    const layer = byLayer.get(r.layer_id);
    if (!layer || !layer.access.view || layer.layer.lifecycle === "archived") {
      refused.set(r.id, "unavailable");
      continue;
    }
    if (r.event_id || r.content_id) {
      refused.set(r.id, "not_a_place");
      continue;
    }
    const member = layer.access.role !== "public";
    let place: Omit<TripPlace, "itemId" | "layerId" | "layerSlug"> | null =
      null;
    if (r.place_id && r.p_status === "approved")
      place = {
        key: `place:${r.place_id}`,
        label: r.p_name ?? "",
        labelChinese: r.p_name_zh ?? "",
        point:
          r.p_lat != null && r.p_lng != null
            ? { lat: Number(r.p_lat), lng: Number(r.p_lng) }
            : null,
        providerPlaceId: null,
      };
    else if (r.custom_place_id && r.cp_status === "active")
      place = {
        key: r.cp_catalog_id
          ? `place:${r.cp_catalog_id}`
          : `custom:${r.custom_place_id}`,
        label: r.cp_name ?? "",
        labelChinese: r.cp_name_zh ?? "",
        point:
          r.cp_lat != null && r.cp_lng != null
            ? { lat: Number(r.cp_lat), lng: Number(r.cp_lng) }
            : null,
        providerPlaceId: null,
      };
    else if (
      r.subject_id &&
      r.s_status === "active" &&
      (member || r.s_review === "approved")
    ) {
      const cached = located.get(r.subject_id);
      place = {
        key: `subject:${r.subject_id}`,
        label: r.link_name || r.s_name || "",
        labelChinese: r.s_name_zh ?? "",
        point: cached ? { lat: cached.lat, lng: cached.lng } : null,
        providerPlaceId: r.provider_place_id,
      };
    }
    if (!place) {
      refused.set(r.id, "unavailable");
      continue;
    }
    places.set(r.id, {
      ...place,
      itemId: r.id,
      layerId: r.layer_id,
      layerSlug: layer.layer.slug,
    });
  }
  return { places, refused, layers: byLayer };
}

/** Place items of the given layers, in layer order then item order. */
export async function listLayerPlaceItemIds(layerIds: string[]) {
  if (!layerIds.length) return [];
  const result = await pool.query<{ id: string }>(
    `SELECT i.id FROM layer_item i
     JOIN unnest($1::uuid[]) WITH ORDINALITY AS o(layer_id, n) ON o.layer_id=i.layer_id
     WHERE i.event_id IS NULL AND i.content_id IS NULL
     ORDER BY o.n, i.position, i.created_at, i.id`,
    [layerIds],
  );
  return result.rows.map((r) => r.id);
}

/** Whether a layer may supply places to a trip with this owner (write-time rule). */
export function audienceFits(
  layer: LayerWithAccess,
  ownerGroupId: string | null,
) {
  if (!ownerGroupId) return true;
  return (
    (layer.layer.ownerKind === "group" &&
      layer.layer.ownerGroupId === ownerGroupId) ||
    isPubliclyVisible(layer.layer)
  );
}

/**
 * Places an editor may choose as the base or a day's start/end: located places
 * in the layers of the trip's visible places that are not active stops and
 * that fit the trip's audience. Resolved for this actor only.
 */
export async function listBaseCandidates(
  trip: Pick<TripRecord, "ownerGroupId">,
  activeItemIds: Set<string>,
  visible: Map<string, TripPlace>,
  actor: Actor,
) {
  const layerIds = [...new Set([...visible.values()].map((p) => p.layerId))];
  const ids = (await listLayerPlaceItemIds(layerIds))
    .filter((id) => !activeItemIds.has(id))
    .slice(0, 300);
  const { places, layers } = await resolveTripPlaces(ids, actor);
  const out: Array<{ itemId: string; label: string; labelChinese: string }> =
    [];
  for (const id of ids) {
    const place = places.get(id);
    const layer = place && layers.get(place.layerId);
    if (!place?.point || !layer || !audienceFits(layer, trip.ownerGroupId))
      continue;
    out.push({
      itemId: id,
      label: place.label,
      labelChinese: place.labelChinese,
    });
  }
  return out;
}

/* ---------------------------------------------------------------------------
   Days and stops
   --------------------------------------------------------------------------- */
export type DayRow = {
  id: string;
  onDate: string;
  orderMode: "auto" | "manual";
  startKind: "base" | "first_stop" | "item";
  startItemId: string | null;
  endKind: "base" | "last_stop" | "item";
  endItemId: string | null;
};
export type StopRow = {
  id: string;
  layerItemId: string | null;
  dayId: string | null;
  position: number;
  pinned: boolean;
  unscheduledReason: string | null;
  status: "active" | "removed";
  updatedAt: string;
};

export async function loadDaysAndStops(db: Pool | PoolClient, tripId: string) {
  const [days, stops] = await Promise.all([
    db.query<{
      id: string;
      on_date: string;
      order_mode: DayRow["orderMode"];
      start_kind: DayRow["startKind"];
      start_item_id: string | null;
      end_kind: DayRow["endKind"];
      end_item_id: string | null;
    }>(
      `SELECT id,on_date::text AS on_date,order_mode,start_kind,start_item_id,end_kind,end_item_id
       FROM trip_day WHERE trip_id=$1 ORDER BY on_date`,
      [tripId],
    ),
    db.query<{
      id: string;
      layer_item_id: string | null;
      day_id: string | null;
      position: number;
      pinned: boolean;
      unscheduled_reason: string | null;
      status: StopRow["status"];
      updated_at: Date;
    }>(
      `SELECT id,layer_item_id,day_id,position,pinned,unscheduled_reason,status,updated_at
       FROM trip_stop WHERE trip_id=$1 ORDER BY position,id`,
      [tripId],
    ),
  ]);
  return {
    days: days.rows.map((d): DayRow => ({
      id: d.id,
      onDate: d.on_date,
      orderMode: d.order_mode,
      startKind: d.start_kind,
      startItemId: d.start_item_id,
      endKind: d.end_kind,
      endItemId: d.end_item_id,
    })),
    stops: stops.rows.map((s): StopRow => ({
      id: s.id,
      layerItemId: s.layer_item_id,
      dayId: s.day_id,
      position: s.position,
      pinned: s.pinned,
      unscheduledReason: s.unscheduled_reason,
      status: s.status,
      updatedAt: s.updated_at.toISOString(),
    })),
  };
}

/* ---------------------------------------------------------------------------
   Per-viewer view
   --------------------------------------------------------------------------- */
export type TripStopView = {
  id: string;
  itemId: string;
  layerSlug: string;
  key: string;
  label: string;
  labelChinese: string;
  location: LatLng | null;
  providerPlaceId: string | null;
  /** Straight-line meters from the previous located stop that day. */
  legMeters: number | null;
  pinned: boolean;
};
/** A day's start or end place (the trip base or a per-day override), located. */
export type TripEndpointView = {
  itemId: string;
  kind: "base" | "item";
  label: string;
  labelChinese: string;
  location: LatLng;
  providerPlaceId: string | null;
};
export type TripDayView = {
  id: string;
  date: string;
  orderMode: "auto" | "manual";
  /** The setting; `start` is what applies for this viewer (null = open path). */
  startKind: DayRow["startKind"];
  endKind: DayRow["endKind"];
  start: TripEndpointView | null;
  end: TripEndpointView | null;
  stops: TripStopView[];
  /** Straight-line meters from the last located stop to `end`. */
  endLegMeters: number | null;
  /** Straight-line meters through start, the day's located stops and end, in order. */
  totalMeters: number;
};
export type TripView = {
  trip: Omit<TripRecord, "createdBy" | "ownerUserId" | "cityId" | "baseItemId">;
  revision: number;
  canEdit: boolean;
  canDelete: boolean;
  /** The trip base as this viewer can see it; null when none or not visible. */
  base: TripEndpointView | null;
  /** Editors only: a base is set but this editor cannot see or locate it. */
  baseUnavailable: boolean;
  /** Editors only: located places that can be a base or day start/end. */
  baseCandidates: Array<{
    itemId: string;
    label: string;
    labelChinese: string;
  }>;
  days: TripDayView[];
  notScheduled: Array<TripStopView & { reason: string }>;
  removed: TripStopView[];
  /** Active stops this viewer cannot see (no names, no places). */
  unavailableCount: number;
};

/**
 * The start and end that apply to a day for whoever resolved `places`: the
 * trip base or a per-day item, but only when it is visible and located.
 * Otherwise the day falls back to an open path (first / last stop).
 */
export function dayEndpoints(
  baseItemId: string | null,
  day: DayRow,
  places: Map<string, TripPlace>,
) {
  const pick = (
    id: string | null,
    kind: TripEndpointView["kind"],
  ): TripEndpointView | null => {
    const place = id ? places.get(id) : undefined;
    if (!place?.point) return null;
    return {
      itemId: place.itemId,
      kind,
      label: place.label,
      labelChinese: place.labelChinese,
      location: place.point,
      providerPlaceId: place.providerPlaceId,
    };
  };
  return {
    start:
      day.startKind === "item"
        ? pick(day.startItemId, "item")
        : day.startKind === "base"
          ? pick(baseItemId, "base")
          : null,
    end:
      day.endKind === "item"
        ? pick(day.endItemId, "item")
        : day.endKind === "base"
          ? pick(baseItemId, "base")
          : null,
  };
}

export function buildTripView(
  trip: TripRecord,
  access: TripAccess,
  days: DayRow[],
  stops: StopRow[],
  places: Map<string, TripPlace>,
  baseCandidates: TripView["baseCandidates"] = [],
): TripView {
  const view = (s: StopRow): TripStopView | null => {
    const place = s.layerItemId ? places.get(s.layerItemId) : undefined;
    if (!place) return null;
    return {
      id: s.id,
      itemId: place.itemId,
      layerSlug: place.layerSlug,
      key: place.key,
      label: place.label,
      labelChinese: place.labelChinese,
      location: place.point,
      providerPlaceId: place.providerPlaceId,
      legMeters: null,
      pinned: s.pinned,
    };
  };
  const active = stops.filter((s) => s.status === "active");
  let unavailableCount = 0;
  const baseView = dayEndpoints(
    trip.baseItemId,
    { startKind: "base", endKind: "base" } as DayRow,
    places,
  ).start;
  const dayViews = days.map((d): TripDayView => {
    const list: TripStopView[] = [];
    for (const s of active.filter((x) => x.dayId === d.id)) {
      const v = view(s);
      if (v) list.push(v);
      else unavailableCount++;
    }
    const { start, end } = dayEndpoints(trip.baseItemId, d, places);
    let total = 0;
    let previous: LatLng | null = start?.location ?? null;
    for (const v of list) {
      if (!v.location) continue;
      if (previous) {
        v.legMeters = Math.round(haversineMeters(previous, v.location));
        total += v.legMeters;
      }
      previous = v.location;
    }
    let endLegMeters: number | null = null;
    // A day with no located stop has no route, so no base-to-base leg either.
    if (end && previous && list.some((v) => v.location)) {
      endLegMeters = Math.round(haversineMeters(previous, end.location));
      total += endLegMeters;
    }
    return {
      id: d.id,
      date: d.onDate,
      orderMode: d.orderMode,
      startKind: d.startKind,
      endKind: d.endKind,
      start,
      end,
      stops: list,
      endLegMeters,
      totalMeters: total,
    };
  });
  const notScheduled: TripView["notScheduled"] = [];
  for (const s of active.filter(
    (x) => !x.dayId || !days.some((d) => d.id === x.dayId),
  )) {
    const v = view(s);
    if (v) notScheduled.push({ ...v, reason: s.unscheduledReason ?? "user" });
    else unavailableCount++;
  }
  const removed = stops
    .filter((s) => s.status === "removed")
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .flatMap((s) => view(s) ?? []);
  return {
    trip: {
      id: trip.id,
      title: trip.title,
      citySlug: trip.citySlug,
      cityName: trip.cityName,
      timezone: trip.timezone,
      ownerGroupId: trip.ownerGroupId,
      ownerName: trip.ownerName,
      audience: trip.audience,
      startsOn: trip.startsOn,
      endsOn: trip.endsOn,
      stopsPerDay: trip.stopsPerDay,
      revision: trip.revision,
      updatedAt: trip.updatedAt,
    },
    revision: trip.revision,
    canEdit: access.edit,
    canDelete: access.delete,
    base: baseView,
    baseUnavailable: access.edit && trip.baseItemId !== null && !baseView,
    baseCandidates: access.edit ? baseCandidates : [],
    days: dayViews,
    notScheduled,
    removed,
    unavailableCount: access.edit ? unavailableCount : 0,
  };
}
