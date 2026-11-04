import { z } from "zod";
/**
 * Trip planner: assigns stops to days and orders each day by straight-line
 * (haversine) distance. Pure and deterministic — no randomness, no clock.
 * Distances are estimates of visiting order, never travel times.
 * See docs/plans/trip-scheduler-design.md (section 5).
 */
export const tripOptimizerVersion = 2;
export const maxTripDays = 14;
export const maxTripStops = 80;
export const minStopsPerDay = 2;
export const maxStopsPerDay = 12;
export const defaultStopsPerDay = 6;
export const maxActiveTrips = 50;

export type LatLng = { lat: number; lng: number };
const earthRadiusMeters = 6371008.8;
/** Below this, an "improvement" is float noise. */
const epsilonMeters = 1;

export function haversineMeters(a: LatLng, b: LatLng) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type LocatedStop = { id: string; point: LatLng };
const byId = (a: { id: string }, b: { id: string }) =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export function pathMeters(stops: LocatedStop[]) {
  let total = 0;
  for (let i = 1; i < stops.length; i++)
    total += haversineMeters(stops[i - 1].point, stops[i].point);
  return total;
}

/** Fixed ends of a day's path: where it starts and where it must end. Either may be absent (open). */
export type DayBounds = { start?: LatLng | null; end?: LatLng | null };

/** Path length including the legs from the start point and to the end point, when present. */
export function boundedPathMeters(
  stops: LocatedStop[],
  bounds: DayBounds = {},
) {
  let total = pathMeters(stops);
  if (stops.length) {
    if (bounds.start) total += haversineMeters(bounds.start, stops[0].point);
    if (bounds.end)
      total += haversineMeters(stops[stops.length - 1].point, bounds.end);
  }
  return total;
}

/** Nearest-neighbor from a first stop (by index) or from a fixed start point. */
function nearestNeighbor(stops: LocatedStop[], start: number | LatLng) {
  const path: LocatedStop[] = [];
  let rest = [...stops];
  let here: LatLng | null = null;
  if (typeof start === "number") {
    path.push(stops[start]);
    rest = stops.filter((_, i) => i !== start);
    here = stops[start].point;
  } else here = start;
  while (rest.length) {
    let next = 0;
    for (let i = 1; i < rest.length; i++)
      if (
        haversineMeters(here, rest[i].point) + epsilonMeters <
        haversineMeters(here, rest[next].point)
      )
        next = i;
    path.push(...rest.splice(next, 1));
    here = path[path.length - 1].point;
  }
  return path;
}

/** 2-opt: reverse segments while that shortens the path (ends stay fixed). */
function twoOpt(path: LocatedStop[], bounds: DayBounds) {
  const p = [...path];
  const at = (i: number) =>
    i < 0
      ? (bounds.start ?? null)
      : i >= p.length
        ? (bounds.end ?? null)
        : p[i].point;
  const d = (a: number, b: number) => {
    const x = at(a);
    const y = at(b);
    return x && y ? haversineMeters(x, y) : 0;
  };
  for (let pass = 0; pass < 100; pass++) {
    let improved = false;
    for (let i = 0; i < p.length - 1; i++)
      for (let k = i + 1; k < p.length; k++) {
        const delta = d(i - 1, k) + d(i, k + 1) - d(i - 1, i) - d(k, k + 1);
        if (delta < -epsilonMeters) {
          p.splice(i, k - i + 1, ...p.slice(i, k + 1).reverse());
          improved = true;
        }
      }
    if (!improved) break;
  }
  return p;
}

/**
 * A short path through the stops. Without a start point: nearest-neighbor
 * from every possible first stop, the shortest kept. With one: nearest-neighbor
 * from it. Then 2-opt, counting the legs to the start and end points when
 * given. With neither, this is the open-path heuristic exactly as before.
 */
export function orderStops<T extends LocatedStop>(
  stops: T[],
  bounds: DayBounds = {},
): T[] {
  const sorted = [...stops].sort(byId);
  if (sorted.length <= 1) return sorted;
  if (sorted.length === 2 && !bounds.start && !bounds.end) return sorted;
  const starts: Array<number | LatLng> = bounds.start
    ? [bounds.start]
    : sorted.map((_, i) => i);
  let best = sorted as LocatedStop[];
  let bestLength = Infinity;
  for (const start of starts) {
    const path = twoOpt(nearestNeighbor(sorted, start), bounds);
    const length = boundedPathMeters(path, bounds);
    if (length + epsilonMeters < bestLength) {
      best = path;
      bestLength = length;
    }
  }
  return best as T[];
}

export type PlanInputStop = {
  id: string;
  /** Null when the place has no usable map location for this request. */
  point: LatLng | null;
  /** Current day index, or null when not scheduled. */
  day: number | null;
  /** Kept on its day by re-planning. */
  pinned: boolean;
  /** Current order within its day (used for manual days and unlocated stops). */
  position: number;
};
export type PlanResult = {
  /** Stop ids per day index, in visiting order. */
  days: string[][];
  unscheduled: Array<{ id: string; reason: "overflow" | "no_location" }>;
};

function centroid(points: LatLng[]): LatLng {
  const sum = points.reduce(
    (acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }),
    { lat: 0, lng: 0 },
  );
  return { lat: sum.lat / points.length, lng: sum.lng / points.length };
}

const byPosition = (a: PlanInputStop, b: PlanInputStop) =>
  a.position - b.position || byId(a, b);

/** Order one day's stops: located stops by the heuristic, unlocated ones after, in their order. */
export function orderDay(
  stops: PlanInputStop[],
  bounds: DayBounds = {},
): string[] {
  const located = stops.filter((s): s is PlanInputStop & LocatedStop =>
    Boolean(s.point),
  );
  const unlocated = stops.filter((s) => !s.point).sort(byPosition);
  return [...orderStops(located, bounds), ...unlocated].map((s) => s.id);
}

/**
 * Plan every day: pinned stops and stops on manual days stay on their day;
 * the rest are clustered into days with capacity (capacitated k-means with
 * farthest-point seeding and regret-ordered assignment), then each auto day
 * is ordered. Stops that do not fit are returned as overflow, never dropped.
 */
export function planTrip(input: {
  dayCount: number;
  stopsPerDay: number;
  stops: PlanInputStop[];
  /** Day indexes whose order the user set by hand. */
  manualDays?: number[];
  /** Start and end points per day index (trip base or per-day override). */
  bounds?: DayBounds[];
}): PlanResult {
  const { dayCount, stopsPerDay } = input;
  const manual = new Set(input.manualDays ?? []);
  const stops = [...input.stops].sort(byId);
  const fixed: PlanInputStop[][] = Array.from({ length: dayCount }, () => []);
  const free: Array<PlanInputStop & LocatedStop> = [];
  const unscheduled: PlanResult["unscheduled"] = [];
  for (const stop of stops) {
    const onDay = stop.day !== null && stop.day >= 0 && stop.day < dayCount;
    if (onDay && (stop.pinned || manual.has(stop.day!)))
      fixed[stop.day!].push(stop);
    else if (!stop.point)
      unscheduled.push({ id: stop.id, reason: "no_location" });
    else free.push(stop as PlanInputStop & LocatedStop);
  }
  const capacity = fixed.map((f, d) =>
    manual.has(d) ? 0 : Math.max(0, stopsPerDay - f.length),
  );
  const openDays = capacity
    .map((c, d) => (c > 0 ? d : -1))
    .filter((d) => d >= 0);
  // Use only as many days as give each at least two stops; the rest stay
  // free days instead of one stop smeared across many days.
  const k = Math.min(
    openDays.length,
    Math.max(
      Math.ceil(free.length / stopsPerDay),
      Math.floor(free.length / minStopsPerDay),
      free.length ? 1 : 0,
    ),
  );
  // Seeds: days already holding located fixed stops seed at their centroid;
  // the remaining seeds use farthest-point seeding over the free stops.
  const seeds: Array<{ day: number; center: LatLng }> = [];
  for (const d of openDays) {
    if (seeds.length >= k) break;
    const points = fixed[d].flatMap((s) => (s.point ? [s.point] : []));
    if (points.length) seeds.push({ day: d, center: centroid(points) });
  }
  if (free.length) {
    const all = centroid(free.map((s) => s.point));
    const used = new Set<string>();
    while (seeds.length < k) {
      let best: (typeof free)[number] | null = null;
      let bestDistance = -1;
      for (const s of free) {
        if (used.has(s.id)) continue;
        const distance = seeds.length
          ? Math.min(...seeds.map((x) => haversineMeters(x.center, s.point)))
          : haversineMeters(all, s.point);
        if (distance > bestDistance + epsilonMeters) {
          best = s;
          bestDistance = distance;
        }
      }
      if (!best) break;
      used.add(best.id);
      const day = openDays.find((d) => !seeds.some((x) => x.day === d))!;
      seeds.push({ day, center: best.point });
    }
  }
  let assignment = new Map<string, number>();
  for (let pass = 0; pass < 10 && seeds.length; pass++) {
    const remaining = new Map(seeds.map((s) => [s.day, capacity[s.day]]));
    const ranked = free
      .map((s) => {
        const distances = seeds
          .map((x) => haversineMeters(x.center, s.point))
          .sort((a, b) => a - b);
        return { s, regret: (distances[1] ?? distances[0]) - distances[0] };
      })
      .sort((a, b) => b.regret - a.regret || byId(a.s, b.s));
    const next = new Map<string, number>();
    for (const { s } of ranked) {
      const choices = seeds
        .filter((x) => remaining.get(x.day)! > 0)
        .sort(
          (a, b) =>
            haversineMeters(a.center, s.point) -
              haversineMeters(b.center, s.point) || a.day - b.day,
        );
      if (!choices.length) continue;
      next.set(s.id, choices[0].day);
      remaining.set(choices[0].day, remaining.get(choices[0].day)! - 1);
    }
    const changed =
      next.size !== assignment.size ||
      [...next].some(([id, d]) => assignment.get(id) !== d);
    assignment = next;
    if (!changed) break;
    for (const seed of seeds) {
      const points = [
        ...fixed[seed.day].flatMap((s) => (s.point ? [s.point] : [])),
        ...free.filter((s) => next.get(s.id) === seed.day).map((s) => s.point),
      ];
      if (points.length) seed.center = centroid(points);
    }
  }
  for (const s of free)
    if (!assignment.has(s.id))
      unscheduled.push({ id: s.id, reason: "overflow" });
  const days = fixed.map((dayStops, d) => {
    if (manual.has(d)) return [...dayStops].sort(byPosition).map((s) => s.id);
    return orderDay(
      [...dayStops, ...free.filter((s) => assignment.get(s.id) === d)],
      input.bounds?.[d] ?? {},
    );
  });
  return { days, unscheduled };
}

/* ---------------------------------------------------------------------------
   HTTP inputs
   --------------------------------------------------------------------------- */
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const tripSourceInput = z
  .object({
    layerId: z.uuid().optional(),
    collectionId: z.uuid().optional(),
    layerItemIds: z
      .array(z.uuid())
      .max(maxTripStops * 2)
      .optional(),
  })
  .refine(
    (v) =>
      [v.layerId, v.collectionId, v.layerItemIds].filter((x) => x !== undefined)
        .length === 1,
    { message: "Choose exactly one source: a layer, a folder or places." },
  );
export const tripCreateInput = z
  .object({
    title: z.string().trim().min(1).max(120),
    startsOn: isoDay,
    endsOn: isoDay,
    groupId: z.uuid().nullish(),
    /** Optional "where you stay": a layer item with a map location. */
    baseItemId: z.uuid().optional(),
    stopsPerDay: z
      .number()
      .int()
      .min(minStopsPerDay)
      .max(maxStopsPerDay)
      .default(defaultStopsPerDay),
    layerId: z.uuid().optional(),
    collectionId: z.uuid().optional(),
    layerItemIds: z
      .array(z.uuid())
      .max(maxTripStops * 2)
      .optional(),
  })
  .refine((v) => v.startsOn <= v.endsOn, {
    message: "The trip must end on or after its start date.",
    path: ["endsOn"],
  })
  .refine(
    (v) =>
      [v.layerId, v.collectionId, v.layerItemIds].filter((x) => x !== undefined)
        .length === 1,
    { message: "Choose exactly one source: a layer, a folder or places." },
  );
export const tripRevisionInput = z.object({
  expectedRevision: z.number().int().min(1),
});
export const tripBaseInput = tripRevisionInput.extend({
  /** A layer item with a map location, or null to clear the base. */
  baseItemId: z.uuid().nullable(),
});
export const tripStopPatchInput = tripRevisionInput.extend({
  status: z.enum(["active", "removed"]).optional(),
  /** Day id, or null to move the stop to Not scheduled. */
  dayId: z.uuid().nullable().optional(),
});
export const tripDayPatchInput = tripRevisionInput
  .extend({
    orderMode: z.enum(["auto", "manual"]).optional(),
    order: z.array(z.uuid()).max(maxTripStops).optional(),
    /** base = the trip base (open path when none); item needs startItemId. */
    startKind: z.enum(["base", "first_stop", "item"]).optional(),
    startItemId: z.uuid().optional(),
    endKind: z.enum(["base", "last_stop", "item"]).optional(),
    endItemId: z.uuid().optional(),
  })
  .refine((v) => (v.startKind === "item") === (v.startItemId !== undefined), {
    message: 'A start place is needed with startKind "item", and only then.',
    path: ["startItemId"],
  })
  .refine((v) => (v.endKind === "item") === (v.endItemId !== undefined), {
    message: 'An end place is needed with endKind "item", and only then.',
    path: ["endItemId"],
  });
export const tripOptimizeInput = tripRevisionInput.extend({
  scope: z.enum(["day", "all"]),
  dayId: z.uuid().optional(),
});
