import { describe, expect, it } from "vitest";
import { routeLinks, type RouteStop } from "@/lib/route-link";
const stop = (n: number, placeId?: string): RouteStop => ({
  lat: 35 + n / 100,
  lng: 139 + n / 100,
  placeId,
});
const params = (url: string) => new URL(url).searchParams;
describe("routeLinks", () => {
  it("opens one link from the user's location with stops in order", () => {
    const [link, ...rest] = routeLinks(
      [stop(1, "A"), stop(2, "B"), stop(3, "C")],
      "walking",
    );
    expect(rest).toEqual([]);
    expect(link).toMatchObject({ from: null, to: 3 });
    expect(link.url.startsWith("https://www.google.com/maps/dir/?api=1&")).toBe(
      true,
    );
    const p = params(link.url);
    expect(p.has("origin")).toBe(false);
    expect(p.get("destination")).toBe("35.030000,139.030000");
    expect(p.get("destination_place_id")).toBe("C");
    expect(p.get("waypoints")).toBe(
      "35.010000,139.010000|35.020000,139.020000",
    );
    expect(p.get("waypoint_place_ids")).toBe("A|B");
    expect(p.get("travelmode")).toBe("walking");
    // Google requires pipes and commas to be encoded.
    expect(link.url).toContain("%7C");
    expect(link.url).toContain("%2C");
  });
  it("sends waypoint place IDs only when every waypoint has one", () => {
    const [link] = routeLinks([stop(1, "A"), stop(2), stop(3)], "driving");
    const p = params(link.url);
    expect(p.has("waypoint_place_ids")).toBe(false);
    expect(p.has("destination_place_id")).toBe(false);
    expect(p.get("waypoints")?.split("|")).toHaveLength(2);
  });
  it("splits into parts of at most 4 stops, each starting at the last stop", () => {
    const stops = Array.from({ length: 9 }, (_, i) => stop(i + 1, `P${i + 1}`));
    const links = routeLinks(stops, "driving");
    expect(links.map(({ from, to }) => [from, to])).toEqual([
      [null, 4],
      [4, 8],
      [8, 9],
    ]);
    const second = params(links[1].url);
    expect(second.get("origin_place_id")).toBe("P4");
    expect(second.get("waypoint_place_ids")).toBe("P5|P6|P7");
    expect(second.get("destination_place_id")).toBe("P8");
    const last = params(links[2].url);
    expect(last.get("origin_place_id")).toBe("P8");
    expect(last.has("waypoints")).toBe(false);
  });
  it("makes one transit link per leg", () => {
    const links = routeLinks([stop(1, "A"), stop(2, "B"), stop(3)], "transit");
    expect(links.map(({ from, to }) => [from, to])).toEqual([
      [null, 1],
      [1, 2],
      [2, 3],
    ]);
    for (const link of links) {
      expect(params(link.url).has("waypoints")).toBe(false);
      expect(params(link.url).get("travelmode")).toBe("transit");
    }
    expect(params(links[2].url).get("origin_place_id")).toBe("B");
  });
  it("returns no links without stops", () => {
    expect(routeLinks([], "walking")).toEqual([]);
  });
});
