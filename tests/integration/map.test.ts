import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { pool } from "../../packages/database/src";
import { runMapQuery } from "../../apps/web/src/features/map/query";
import {
  resolveLayers,
  listLibrary,
  getLayer,
} from "../../apps/web/src/features/layers/repository";
import {
  addLayerItem,
  createLayer,
} from "../../apps/web/src/features/layers/service";
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
  await pool.query("DELETE FROM layer WHERE owner_user_id=$1", [member.id]);
  await pool.query('DELETE FROM "user" WHERE id=$1', [member.id]);
  await pool.end();
});
const state = (params: Record<string, string>) => {
  const parsed = parseMapQuery({ city: "houston", ...params });
  return { ...parsed, layers: parsed.layers ?? "none" };
};
async function memberLayer(title: string, placeIds: string[]) {
  const { layer } = await createLayer(member, { title, city: "houston" });
  for (const id of placeIds)
    await addLayerItem(member, layer.id, { key: `place:${id}` });
  return layer.slug;
}
describe("map query", () => {
  it("drops system layers except the Daily Pick and reports unknown ones", async () => {
    const { resolved, unavailable, disabled } = await resolveLayers(
      ["discover-houston", "today-houston", "nope-layer", "my-saves"],
      null,
      city,
    );
    expect(resolved).toEqual([]);
    expect(disabled).toEqual(["discover-houston", "today-houston"]);
    expect(unavailable).toEqual(["nope-layer", "my-saves"]);
  });
  it("unions layers, deduplicates by identity and keeps pins/rows/counts consistent", async () => {
    const { rows } = await pool.query<{ id: string }>(
      "SELECT id FROM place WHERE status='approved' AND id<>$1 ORDER BY id LIMIT 1",
      [placeId],
    );
    const other = rows[0].id;
    const first = await memberLayer("Union A", [placeId, other]);
    const second = await memberLayer("Union B", [placeId]);
    const both = await runMapQuery(
      state({ layers: `${first},${second}` }),
      city,
      member,
    );
    expect(both.total).toBe(2);
    expect(both.mapped + both.unmapped).toBe(both.total);
    const keys = both.items.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    const shared = both.items.find((i) => i.layers.length === 2);
    expect(shared?.key).toBe(`place:${placeId}`);
    expect(shared?.layers.sort()).toEqual([first, second].sort());
    for (const slug of [first, second])
      expect(both.layers.find((l) => l.slug === slug)?.count).toBe(
        both.items.filter((i) => i.layers.includes(slug)).length,
      );
    expect(both.layers.every((l) => l.status === "ok")).toBe(true);
  });
  it("reports unavailable layers without details and keeps an empty map empty", async () => {
    const mine = await memberLayer("Private", [placeId]);
    const missing = await runMapQuery(
      state({ layers: `${mine},secret-layer` }),
      city,
      null,
    );
    for (const slug of [mine, "secret-layer"]) {
      const layer = missing.layers.find((l) => l.slug === slug)!;
      expect(layer.status).toBe("unavailable");
      expect(layer.title).toBe("");
    }
    expect(missing.total).toBe(0);
    const none = await runMapQuery(state({ layers: "none" }), city, null);
    expect(none.total).toBe(0);
    expect(none.state.layers).toBe("none");
  });
  it("no longer offers a My saves layer", async () => {
    for (const actor of [member, null]) {
      const result = await runMapQuery(
        state({ layers: "my-saves" }),
        city,
        actor,
      );
      expect(result.layers[0].status).toBe("unavailable");
      expect(result.total).toBe(0);
    }
    const library = await listLibrary("mine", member, city);
    expect(library.some((l) => l.layer.slug === "my-saves")).toBe(false);
    expect(await getLayer("my-saves", member)).toBeNull();
  });
});
