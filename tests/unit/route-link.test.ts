import { describe, expect, it } from "vitest";
import { routeLinks, shortOrder, type RouteStop } from "@/lib/route-link";
const stop = (n: number, placeId?: string): RouteStop => ({
  lat: 35 + n / 100,
  lng: 139 + n / 100,
  placeId,
});
const params = (url: string) => new URL(url).searchParams;
describe("routeLinks", () => {
  it("opens one link from stop 1 through the stops in order", () => {
    const [link, ...rest] = routeLinks(
      [stop(1, "A"), stop(2, "B"), stop(3, "C")],
      "walking",
    );
    expect(rest).toEqual([]);
    expect(link).toMatchObject({ from: 1, to: 3 });
    expect(link.url.startsWith("https://www.google.com/maps/dir/?api=1&")).toBe(
      true,
    );
    const p = params(link.url);
    // Never the user's location: Google uses it only when origin is missing.
    expect(p.get("origin")).toBe("35.010000,139.010000");
    expect(p.get("origin_place_id")).toBe("A");
    expect(p.get("waypoints")).toBe("35.020000,139.020000");
    expect(p.get("waypoint_place_ids")).toBe("B");
    expect(p.get("destination")).toBe("35.030000,139.030000");
    expect(p.get("destination_place_id")).toBe("C");
    expect(p.get("travelmode")).toBe("walking");
    // Google requires commas (and pipes) to be encoded.
    expect(link.url).toContain("%2C");
  });
  it("sends waypoint place IDs only when every waypoint has one", () => {
    const [link] = routeLinks(
      [stop(1), stop(2, "B"), stop(3), stop(4)],
      "driving",
    );
    const p = params(link.url);
    expect(p.has("origin_place_id")).toBe(false);
    expect(p.has("waypoint_place_ids")).toBe(false);
    expect(p.has("destination_place_id")).toBe(false);
    expect(p.get("waypoints")?.split("|")).toHaveLength(2);
    expect(link.url).toContain("%7C");
  });
  it("splits into parts of at most 5 stops, each starting at the last stop", () => {
    const stops = Array.from({ length: 10 }, (_, i) =>
      stop(i + 1, `P${i + 1}`),
    );
    const links = routeLinks(stops, "driving");
    expect(links.map(({ from, to }) => [from, to])).toEqual([
      [1, 5],
      [5, 9],
      [9, 10],
    ]);
    const first = params(links[0].url);
    expect(first.get("origin_place_id")).toBe("P1");
    expect(first.get("waypoint_place_ids")).toBe("P2|P3|P4");
    expect(first.get("destination_place_id")).toBe("P5");
    const last = params(links[2].url);
    expect(last.get("origin_place_id")).toBe("P9");
    expect(last.has("waypoints")).toBe(false);
    expect(last.get("destination_place_id")).toBe("P10");
  });
  it("makes one transit link per leg", () => {
    const links = routeLinks([stop(1, "A"), stop(2, "B"), stop(3)], "transit");
    expect(links.map(({ from, to }) => [from, to])).toEqual([
      [1, 2],
      [2, 3],
    ]);
    for (const link of links) {
      expect(params(link.url).has("waypoints")).toBe(false);
      expect(params(link.url).get("travelmode")).toBe("transit");
    }
    expect(params(links[1].url).get("origin_place_id")).toBe("B");
  });
  it("needs at least two stops", () => {
    expect(routeLinks([], "walking")).toEqual([]);
    expect(routeLinks([stop(1, "A")], "walking")).toEqual([]);
  });
});
describe("shortOrder", () => {
  const at = (placeId: string, lng: number): RouteStop => ({
    lat: 35,
    lng,
    placeId,
  });
  it("visits places along a line from one end, whatever the input order", () => {
    const order = shortOrder([
      at("C", 139.03),
      at("A", 139.01),
      at("E", 139.05),
      at("B", 139.02),
      at("D", 139.04),
    ]).map((s) => s.placeId);
    expect([order, [...order].reverse()]).toContainEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
    ]);
  });
  it("keeps every stop exactly once", () => {
    const stops = [at("A", 139.1), at("B", 139.0), at("C", 139.3)];
    const order = shortOrder(stops);
    expect(order).toHaveLength(3);
    expect(new Set(order)).toEqual(new Set(stops));
  });
  it("handles zero and one stop", () => {
    expect(shortOrder([])).toEqual([]);
    expect(shortOrder([at("A", 139)])).toEqual([at("A", 139)]);
  });
});
