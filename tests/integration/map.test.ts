import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { pool } from "../../packages/database/src";
import { runMapQuery } from "../../apps/web/src/features/map/query";
import {
  resolveLayers,
  listLibrary,
  getLayer,
} from "../../apps/web/src/features/layers/repository";
import { parseMapQuery, type Actor } from "../../packages/shared/src";
const member: Actor = { id: crypto.randomUUID(), role: "USER" };
const city = {
  id: "00000000-0000-4000-8000-000000001001",
  slug: "houston",
  name: "Houston",
  timezone: "America/Chicago",
  latitude: 29.7604,
  longitude: -95.3698,
};
const placeId = "00000000-0000-4000-8000-000000005000";
beforeAll(async () => {
  await pool.query(
    'INSERT INTO "user"(id,name,email,role) VALUES($1,$2,$3,$4)',
    [member.id, "Map Tester", member.id + "@example.test", "USER"],
  );
  await pool.query(
    "INSERT INTO saved_place(user_id,place_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
    [member.id, placeId],
  );
});
afterAll(async () => {
  await pool.query('DELETE FROM "user" WHERE id=$1', [member.id]);
  await pool.end();
});
const state = (params: Record<string, string>) => {
  const parsed = parseMapQuery({ city: "houston", ...params });
  return { ...parsed, layers: parsed.layers ?? ["discover-houston"] };
};
describe("map query", () => {
  it("system layers exist per city and resolve for guests", async () => {
    const { resolved, unavailable } = await resolveLayers(
      ["discover-houston", "today-houston", "nope-layer", "my-saves"],
      null,
      city,
    );
    expect(resolved.map((r) => r.layer.slug)).toEqual([
      "discover-houston",
      "today-houston",
    ]);
    expect(unavailable).toEqual(["nope-layer", "my-saves"]);
  });
  it("unions layers, deduplicates by identity and keeps pins/rows/counts consistent", async () => {
    const discover = await runMapQuery(state({}), city, null);
    expect(discover.total).toBeGreaterThan(0);
    expect(discover.items.some((i) => i.type === "place")).toBe(true);
    expect(discover.items.some((i) => i.type === "event")).toBe(true);
    expect(discover.mapped + discover.unmapped).toBe(discover.total);
    const both = await runMapQuery(
      state({ layers: "discover-houston,food-houston" }),
      city,
      null,
    );
    const keys = both.items.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    const shared = both.items.find((i) => i.layers.length === 2);
    expect(shared?.layers.sort()).toEqual(["discover-houston", "food-houston"]);
    const food = both.layers.find((l) => l.slug === "food-houston")!;
    expect(food.count).toBe(
      both.items.filter((i) => i.layers.includes("food-houston")).length,
    );
    expect(both.layers.every((l) => l.status === "ok")).toBe(true);
  });
  it("intersects date, type and area filters and reports unavailable layers", async () => {
    const placesOnly = await runMapQuery(state({ types: "place" }), city, null);
    expect(placesOnly.items.every((i) => i.type === "place")).toBe(true);
    const eventsToday = await runMapQuery(
      state({ types: "event", date: "today" }),
      city,
      null,
    );
    expect(eventsToday.window.end).not.toBeNull();
    for (const e of eventsToday.items) {
      expect(new Date(e.startTime!).getTime()).toBeLessThan(
        new Date(eventsToday.window.end!).getTime(),
      );
    }
    const area = await runMapQuery(
      state({ area: "-95.40,29.70,-95.30,29.80", types: "place" }),
      city,
      null,
    );
    for (const p of area.items)
      if (p.latitude != null) {
        expect(p.longitude).toBeGreaterThanOrEqual(-95.4);
        expect(p.longitude).toBeLessThanOrEqual(-95.3);
      }
    const missing = await runMapQuery(
      state({ layers: "discover-houston,secret-layer" }),
      city,
      null,
    );
    const secret = missing.layers.find((l) => l.slug === "secret-layer")!;
    expect(secret.status).toBe("unavailable");
    expect(secret.title).toBe("");
    const none = await runMapQuery(state({ layers: "none" }), city, null);
    expect(none.total).toBe(0);
    expect(none.state.layers).toBe("none");
  });
  it("searches within layers by default and across the city on request", async () => {
    const inLayers = await runMapQuery(
      state({ layers: "weekend-houston", q: "noodle", types: "place" }),
      city,
      null,
    );
    expect(inLayers.total).toBe(0);
    const cityWide = await runMapQuery(
      state({ layers: "weekend-houston", q: "noodle", scope: "city" }),
      city,
      null,
    );
    expect(cityWide.searchScope).toBe("city");
    expect(cityWide.items.some((i) => /noodle/i.test(i.name))).toBe(true);
    expect(cityWide.items.every((i) => i.layers.length === 0)).toBe(true);
  });
  it("projects My saves for the signed-in user only", async () => {
    const mine = await runMapQuery(state({ layers: "my-saves" }), city, member);
    expect(mine.layers[0].status).toBe("ok");
    expect(mine.items.map((i) => i.id)).toContain(placeId);
    const guest = await runMapQuery(state({ layers: "my-saves" }), city, null);
    expect(guest.layers[0].status).toBe("unavailable");
    expect(guest.total).toBe(0);
    const library = await listLibrary("mine", member, city);
    expect(library[0].layer.slug).toBe("my-saves");
    expect(await getLayer("my-saves", null, city)).toBeNull();
  });
});
