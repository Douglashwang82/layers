import { describe, expect, it, vi } from "vitest";
import {
  matchBox,
  matchPoint,
  matchPoints,
  matchRadiusMeters,
} from "../../apps/web/src/features/map-import/match";

const shrine = {
  name: "北口本宮富士淺間神社",
  latitude: 35.470696,
  longitude: 138.7922637,
};
function deps(handler: (body: Record<string, unknown>) => Response) {
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) =>
    handler(JSON.parse(String(init?.body ?? "{}"))),
  );
  return {
    fetch: fetch as unknown as typeof globalThis.fetch,
    apiKey: "k",
    calls: fetch,
  };
}

describe("matching imported markers to Google places", () => {
  it("searches by name, restricted to a small box around the marker", async () => {
    const d = deps(() => Response.json({ places: [{ id: "ChIJabc_123-x" }] }));
    expect(await matchPoint(shrine, d)).toBe("ChIJabc_123-x");
    const [url, init] = d.calls.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://places.googleapis.com/v1/places:searchText");
    expect((init.headers as Record<string, string>)["X-Goog-FieldMask"]).toBe(
      "places.id",
    );
    const body = JSON.parse(String(init.body));
    expect(body.textQuery).toBe(shrine.name);
    expect(body.pageSize).toBe(1);
    expect(body.locationBias).toBeUndefined();
    const { low, high } = body.locationRestriction.rectangle;
    expect(low.latitude).toBeLessThan(shrine.latitude);
    expect(high.latitude).toBeGreaterThan(shrine.latitude);
    expect(low.longitude).toBeLessThan(shrine.longitude);
    expect(high.longitude).toBeGreaterThan(shrine.longitude);
    // About ±200 m: well under a kilometer either way.
    expect((high.latitude - low.latitude) * 111_320).toBeCloseTo(
      2 * matchRadiusMeters,
      0,
    );
  });

  it("leaves markers unmatched on no hit, provider errors, bad IDs or thrown fetches", async () => {
    expect(
      await matchPoint(
        shrine,
        deps(() => Response.json({})),
      ),
    ).toBeNull();
    expect(
      await matchPoint(
        shrine,
        deps(() => new Response("no", { status: 500 })),
      ),
    ).toBeNull();
    expect(
      await matchPoint(
        shrine,
        deps(() => Response.json({ places: [{ id: "bad id/../x" }] })),
      ),
    ).toBeNull();
    expect(
      await matchPoint(shrine, {
        fetch: (async () => {
          throw new Error("offline");
        }) as typeof fetch,
        apiKey: "k",
      }),
    ).toBeNull();
  });

  it("never draws a box across the antimeridian or near the poles", async () => {
    expect(matchBox(35, 179.9999)).toBeNull();
    expect(matchBox(89.9, 10)).toBeNull();
    const d = deps(() => Response.json({ places: [{ id: "x" }] }));
    expect(await matchPoint({ ...shrine, longitude: -180 }, d)).toBeNull();
    expect(d.calls).not.toHaveBeenCalled();
  });

  it("matches a batch with bounded concurrency, keyed by marker", async () => {
    let active = 0,
      peak = 0;
    const fetch = (async (_url: unknown, init?: RequestInit) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      const { textQuery } = JSON.parse(String(init?.body));
      return Response.json(
        textQuery === "nowhere" ? {} : { places: [{ id: `id-${textQuery}` }] },
      );
    }) as typeof globalThis.fetch;
    const points = Array.from({ length: 20 }, (_, i) => ({
      id: `point-${i}`,
      name: i === 3 ? "nowhere" : `p${i}`,
      latitude: 35,
      longitude: 139,
    }));
    const matches = await matchPoints(points, { fetch, apiKey: "k" }, 4);
    expect(peak).toBeLessThanOrEqual(4);
    expect(matches.size).toBe(19);
    expect(matches.get("point-0")).toBe("id-p0");
    expect(matches.has("point-3")).toBe(false);
  });
});
