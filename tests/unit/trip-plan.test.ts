import { describe, expect, it } from "vitest";
import {
  haversineMeters,
  orderStops,
  pathMeters,
  planTrip,
  tripCreateInput,
  type PlanInputStop,
} from "@taiwanhub/shared";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const stop = (
  n: number,
  lat: number | null,
  lng = 0,
  extra: Partial<PlanInputStop> = {},
): PlanInputStop => ({
  id: id(n),
  point: lat === null ? null : { lat, lng },
  day: null,
  pinned: false,
  position: n,
  ...extra,
});
/** A deterministic shuffle so the "shuffled input" check needs no randomness. */
const shuffled = <T>(xs: T[]) =>
  xs
    .map((x, i) => ({ x, k: (i * 7919) % 101 }))
    .sort((a, b) => a.k - b.k)
    .map((v) => v.x);

describe("haversineMeters", () => {
  it("measures about 111 km per degree of latitude", () => {
    const m = haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(m).toBeGreaterThan(111_000);
    expect(m).toBeLessThan(111_400);
  });
});

describe("orderStops", () => {
  it("visits points on a line end to end", () => {
    const line = [3, 0, 4, 1, 2].map((x) => ({
      id: id(x),
      point: { lat: 29.7, lng: -95.4 + x * 0.01 },
    }));
    const ordered = orderStops(line).map((s) => s.id);
    const forward = [0, 1, 2, 3, 4].map(id);
    expect([forward, [...forward].reverse()]).toContainEqual(ordered);
  });
  it("is no longer than input order and stable under shuffling", () => {
    const pts = Array.from({ length: 12 }, (_, i) => ({
      id: id(i),
      point: {
        lat: 29.7 + Math.sin(i * 1.7) * 0.05,
        lng: -95.4 + Math.cos(i * 2.3) * 0.05,
      },
    }));
    const a = orderStops(pts);
    expect(pathMeters(a)).toBeLessThanOrEqual(pathMeters(pts));
    expect(orderStops(shuffled(pts)).map((s) => s.id)).toEqual(
      a.map((s) => s.id),
    );
  });
});

describe("planTrip", () => {
  // Two clear neighborhoods ~20 km apart.
  const west = [1, 2, 3].map((n) => stop(n, 29.76 + n * 0.002, -95.6));
  const east = [4, 5, 6].map((n) => stop(n, 29.76 + n * 0.002, -95.4));

  it("splits clusters into separate days", () => {
    const result = planTrip({
      dayCount: 2,
      stopsPerDay: 6,
      stops: [...west, ...east],
    });
    expect(result.unscheduled).toEqual([]);
    const sets = result.days.map((d) => new Set(d));
    const westIds = west.map((s) => s.id);
    expect(sets.some((s) => westIds.every((w) => s.has(w)))).toBe(true);
    expect(result.days.flat()).toHaveLength(6);
  });

  it("is deterministic under shuffled input", () => {
    const stops = [...west, ...east];
    const a = planTrip({ dayCount: 2, stopsPerDay: 6, stops });
    const b = planTrip({ dayCount: 2, stopsPerDay: 6, stops: shuffled(stops) });
    expect(b).toEqual(a);
  });

  it("reports overflow instead of dropping stops", () => {
    const result = planTrip({
      dayCount: 1,
      stopsPerDay: 4,
      stops: [...west, ...east],
    });
    expect(result.days[0]).toHaveLength(4);
    expect(result.unscheduled).toHaveLength(2);
    expect(result.unscheduled.every((u) => u.reason === "overflow")).toBe(true);
  });

  it("leaves extra days free when there are fewer stops than days", () => {
    const result = planTrip({
      dayCount: 3,
      stopsPerDay: 6,
      stops: west.slice(0, 2),
    });
    expect(result.days.filter((d) => d.length > 0)).toHaveLength(1);
  });

  it("sends unlocated stops to Not scheduled unless pinned", () => {
    const result = planTrip({
      dayCount: 2,
      stopsPerDay: 6,
      stops: [
        ...west,
        stop(9, null),
        stop(10, null, 0, { day: 1, pinned: true }),
      ],
    });
    expect(result.unscheduled).toEqual([{ id: id(9), reason: "no_location" }]);
    expect(result.days[1]).toContain(id(10));
  });

  it("keeps pinned stops on their day and leaves manual days untouched", () => {
    const pinnedEast = { ...east[0], day: 0, pinned: true };
    const manualStops = [
      { ...west[2], day: 1, position: 0 },
      { ...west[0], day: 1, position: 1 },
    ];
    const result = planTrip({
      dayCount: 3,
      stopsPerDay: 6,
      stops: [pinnedEast, ...manualStops, west[1], east[1], east[2]],
      manualDays: [1],
    });
    expect(result.days[0]).toContain(pinnedEast.id);
    expect(result.days[1]).toEqual([west[2].id, west[0].id]);
  });
});

describe("start and end points", () => {
  // Four places on a west-east line, 1 km apart, ids 1..4 from west to east.
  const lng = (x: number) => -95.4 + x * 0.01;
  const line = [1, 2, 3, 4].map((x) => ({
    id: id(x),
    point: { lat: 29.7, lng: lng(x) },
  }));
  const west = { lat: 29.7, lng: lng(0) };
  const east = { lat: 29.7, lng: lng(5) };
  const ids = (xs: Array<{ id: string }>) => xs.map((s) => s.id);
  const forward = [1, 2, 3, 4].map(id);

  it("leaves the open path exactly as before when there is no base", () => {
    const open = ids(orderStops(line));
    expect(ids(orderStops(line, {}))).toEqual(open);
    expect(ids(orderStops(line, { start: null, end: null }))).toEqual(open);
  });

  it("starts at the start point (start only)", () => {
    expect(ids(orderStops(line, { start: west }))).toEqual(forward);
    expect(ids(orderStops(line, { start: east }))).toEqual(
      [...forward].reverse(),
    );
  });

  it("finishes toward the end point (end only)", () => {
    expect(ids(orderStops(line, { end: east }))).toEqual(forward);
    expect(ids(orderStops(line, { end: west }))).toEqual(
      [...forward].reverse(),
    );
  });

  it("accounts for both ends, including a round trip", () => {
    expect(ids(orderStops(line, { start: west, end: east }))).toEqual(forward);
    expect(ids(orderStops(line, { start: east, end: west }))).toEqual(
      [...forward].reverse(),
    );
    expect(ids(orderStops(line, { start: west, end: west }))).toEqual(forward);
  });

  it("orders two stops by the base when one is given", () => {
    const two = line.slice(0, 2);
    expect(ids(orderStops(two, { start: east }))).toEqual([id(2), id(1)]);
    expect(ids(orderStops(two, { end: west }))).toEqual([id(2), id(1)]);
  });

  it("is deterministic under shuffled input", () => {
    const bounds = { start: west, end: east };
    expect(ids(orderStops(shuffled(line), bounds))).toEqual(
      ids(orderStops(line, bounds)),
    );
  });

  it("lets planTrip order each day around its own bounds", () => {
    const stops = line.map((s) => ({
      ...s,
      day: 0,
      pinned: true,
      position: 0,
    }));
    const a = planTrip({
      dayCount: 1,
      stopsPerDay: 6,
      stops,
      bounds: [{ start: east, end: west }],
    });
    expect(a.days[0]).toEqual([...forward].reverse());
    const b = planTrip({
      dayCount: 1,
      stopsPerDay: 6,
      stops,
      bounds: [{ start: west, end: east }],
    });
    expect(b.days[0]).toEqual(forward);
  });

  it("never reorders a manual day, and keeps unlocated stops last", () => {
    const manual = planTrip({
      dayCount: 1,
      stopsPerDay: 6,
      stops: [
        { ...stop(3, 29.7, lng(3)), day: 0, position: 0 },
        { ...stop(1, 29.7, lng(1)), day: 0, position: 1 },
      ],
      manualDays: [0],
      bounds: [{ start: west }],
    });
    expect(manual.days[0]).toEqual([id(3), id(1)]);
    const mixed = planTrip({
      dayCount: 1,
      stopsPerDay: 6,
      stops: [
        { ...stop(9, null), day: 0, pinned: true, position: 0 },
        ...line.map((s) => ({ ...s, day: 0, pinned: true, position: 1 })),
      ],
      bounds: [{ start: east }],
    });
    expect(mixed.days[0]).toEqual([id(4), id(3), id(2), id(1), id(9)]);
  });
});

describe("tripCreateInput", () => {
  const base = {
    title: "Weekend",
    startsOn: "2026-11-07",
    endsOn: "2026-11-08",
  };
  it("requires exactly one source", () => {
    expect(tripCreateInput.safeParse(base).success).toBe(false);
    expect(
      tripCreateInput.safeParse({
        ...base,
        layerId: id(1),
        collectionId: id(2),
      }).success,
    ).toBe(false);
    expect(tripCreateInput.parse({ ...base, layerId: id(1) }).stopsPerDay).toBe(
      6,
    );
  });
  it("rejects an end before the start", () => {
    expect(
      tripCreateInput.safeParse({
        ...base,
        endsOn: "2026-11-01",
        layerId: id(1),
      }).success,
    ).toBe(false);
  });
});
