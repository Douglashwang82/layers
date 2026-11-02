import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { pool } from "../../packages/database/src";
import type { Actor } from "../../packages/shared/src";
import { flags } from "../../apps/web/src/lib/config";
import {
  commitMapImport,
  listCollections,
  reviewMapImport,
} from "../../apps/web/src/features/map-import/service";
import { parseKml } from "../../apps/web/src/features/map-import/parser";
import { getLayer } from "../../apps/web/src/features/layers/repository";
import { createGroup } from "../../apps/web/src/features/groups/service";
import { getLayerContents } from "../../apps/web/src/features/layers/contents";
const owner: Actor = { id: crypto.randomUUID(), role: "USER" };
const stranger: Actor = { id: crypto.randomUUID(), role: "USER" };
const viewer: Actor = { id: crypto.randomUUID(), role: "USER" };
const document = parseKml(
  readFileSync("tests/fixtures/shared-map.kml", "utf8"),
);
const oldFlags = { ...flags };
// A local .env may hold a real key; these tests never make live Places calls.
const oldLinkKey = process.env.GOOGLE_MAPS_LINK_API_KEY;
function request(extra: Record<string, unknown> = {}) {
  return {
    requestId: crypto.randomUUID(),
    permission: true,
    document,
    selected: document.layers.flatMap((l) => l.points.map((p) => p.id)),
    mode: "new",
    title: "Imported test map",
    city: "houston",
    ...extra,
  };
}
beforeAll(async () => {
  delete process.env.GOOGLE_MAPS_LINK_API_KEY;
  flags.layerWrites = true;
  flags.layerCustomPlaces = true;
  for (const actor of [owner, stranger, viewer])
    await pool.query(
      'INSERT INTO "user"(id,name,email,email_verified,role) VALUES($1,$2,$3,true,$4)',
      [
        actor.id,
        "Map Import Test",
        `${actor.id}@map-import.invalid`,
        actor.role,
      ],
    );
});
afterAll(async () => {
  await pool.query('DELETE FROM "group" WHERE created_by=$1', [owner.id]);
  await pool.query('DELETE FROM "user" WHERE id=ANY($1::uuid[])', [
    [owner.id, stranger.id, viewer.id],
  ]);
  Object.assign(flags, oldFlags);
  if (oldLinkKey === undefined) delete process.env.GOOGLE_MAPS_LINK_API_KEY;
  else process.env.GOOGLE_MAPS_LINK_API_KEY = oldLinkKey;
  await pool.end();
});
describe("transactional map imports", () => {
  it("creates one layer, preserves outside-city pins and retries without duplication", async () => {
    const input = request();
    const result = await commitMapImport(owner, input);
    expect(result.added).toBe(2);
    expect(result.skipped).toBe(2);
    expect(await commitMapImport(owner, input)).toEqual(result);
    const found = (await getLayer(result.layers[0].id, owner))!;
    expect(found.layer.audience).toBe("private");
    const contents = await getLayerContents(
      found.layer,
      {
        id: found.layer.cityId,
        slug: "houston",
        name: "Houston",
        timezone: "America/Chicago",
        latitude: 29.7,
        longitude: -95.3,
      },
      owner,
    );
    expect(
      contents.items.some((p) => p.latitude === 35.7 && p.longitude === 139.7),
    ).toBe(true);
    await expect(
      commitMapImport(owner, { ...input, title: "Changed" }),
    ).rejects.toMatchObject({ code: "REQUEST_CONFLICT" });
  });
  it("preserves folders in an access-controlled collection and reuses matching places", async () => {
    const result = await commitMapImport(
      owner,
      request({ mode: "collection" }),
    );
    expect(result.layers.map((l) => l.title)).toEqual(["Food", "Parks"]);
    expect(result.reused).toBe(2);
    expect(await reviewMapImport(owner, request())).toMatchObject({
      newPlaces: 0,
      reused: 2,
    });
    expect(
      (await listCollections(owner)).some(
        (c) => c.id === result.collectionId && c.layers.length === 2,
      ),
    ).toBe(true);
    expect(await listCollections(stranger)).toEqual([]);
  });
  it("checks existing-layer access, revisions and duplicate memberships", async () => {
    const created = await commitMapImport(owner, request());
    const layer = (await getLayer(created.layers[0].id, owner))!.layer;
    const input = request({
      mode: "existing",
      layerId: layer.id,
      revision: layer.revision,
    });
    await expect(commitMapImport(stranger, input)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const result = await commitMapImport(owner, input);
    expect(result.added).toBe(0);
    expect(result.skipped).toBe(4);
    await expect(
      commitMapImport(owner, { ...input, requestId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });
  it("allows group owners, denies viewers, and hides the collection after membership ends", async () => {
    const created = await createGroup(owner, {
      name: "Map Import Group",
      city: "houston",
    });
    const groupId = created.group.id;
    await pool.query(
      "INSERT INTO group_member(group_id,user_id,role) VALUES($1,$2,'viewer')",
      [groupId, viewer.id],
    );
    await expect(
      commitMapImport(viewer, request({ groupId })),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const result = await commitMapImport(
      owner,
      request({ mode: "collection", groupId }),
    );
    expect(
      (await listCollections(viewer)).some((c) => c.id === result.collectionId),
    ).toBe(true);
    await pool.query(
      "DELETE FROM group_member WHERE group_id=$1 AND user_id=$2",
      [groupId, viewer.id],
    );
    expect(await listCollections(viewer)).toEqual([]);
  });
  it("rolls back all layers and receipts if the destination city is invalid", async () => {
    const before = await pool.query(
      "SELECT count(*) FROM layer WHERE owner_user_id=$1",
      [owner.id],
    );
    const input = request({ city: "not-a-supported-city", mode: "collection" });
    await expect(commitMapImport(owner, input)).rejects.toMatchObject({
      code: "INVALID_CITY",
    });
    expect(
      (
        await pool.query("SELECT count(*) FROM layer WHERE owner_user_id=$1", [
          owner.id,
        ])
      ).rows,
    ).toEqual(before.rows);
    expect(
      (
        await pool.query(
          "SELECT * FROM map_import_receipt WHERE request_id=$1",
          [input.requestId],
        )
      ).rowCount,
    ).toBe(0);
  });
  it("rolls back earlier folders when the owner capacity is reached midway", async () => {
    await pool.query(
      `INSERT INTO custom_place(owner_user_id,city_id,name,created_by) SELECT $1,c.id,'Capacity fixture '||n,$1 FROM city c CROSS JOIN generate_series(1,999) n WHERE c.slug='houston'`,
      [stranger.id],
    );
    const input = request({ mode: "collection" });
    await expect(commitMapImport(stranger, input)).rejects.toMatchObject({
      code: "LIMIT_REACHED",
    });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM custom_place WHERE owner_user_id=$1",
          [stranger.id],
        )
      ).rows[0].n,
    ).toBe(999);
    expect(
      (
        await pool.query("SELECT id FROM layer WHERE owner_user_id=$1", [
          stranger.id,
        ])
      ).rowCount,
    ).toBe(0);
    expect(await listCollections(stranger)).toEqual([]);
    expect(
      (
        await pool.query(
          "SELECT * FROM map_import_receipt WHERE request_id=$1",
          [input.requestId],
        )
      ).rowCount,
    ).toBe(0);
  });
  it("serializes simultaneous retries and rejects public destinations", async () => {
    const input = request();
    const [one, two] = await Promise.all([
      commitMapImport(owner, input),
      commitMapImport(owner, input),
    ]);
    expect(one).toEqual(two);
    const layer = (await getLayer(one.layers[0].id, owner))!.layer;
    await pool.query("UPDATE layer SET audience='public' WHERE id=$1", [
      layer.id,
    ]);
    await expect(
      commitMapImport(
        owner,
        request({
          mode: "existing",
          layerId: layer.id,
          revision: layer.revision,
        }),
      ),
    ).rejects.toMatchObject({ code: "PRIVATE_REQUIRED" });
  });
  it("links markers to Google places by ID only, keeping their own pins", async () => {
    const places = (layerId: string) =>
      pool.query<{
        name: string;
        google_place_id: string | null;
        latitude: number;
        longitude: number;
      }>(
        "SELECT c.name,c.google_place_id,c.latitude,c.longitude FROM layer_item i JOIN custom_place c ON c.id=i.custom_place_id WHERE i.layer_id=$1 ORDER BY c.name",
        [layerId],
      );
    // Without a configured key, markers import unmatched, as before.
    const plain = await commitMapImport(owner, request());
    expect(plain.matched).toBe(0);
    const before = await places(plain.layers[0].id);
    expect(before.rows.every((r) => r.google_place_id === null)).toBe(true);
    process.env.GOOGLE_MAPS_LINK_API_KEY = "fake";
    try {
      // Importing the same markers again links the earlier, unmatched copies.
      const again = await commitMapImport(owner, request());
      expect(again.matched).toBe(before.rowCount);
      expect(again.reused).toBe(before.rowCount);
      const after = await places(plain.layers[0].id);
      for (const [i, row] of after.rows.entries()) {
        expect(row.google_place_id).toMatch(/^fake-link-/);
        expect([row.latitude, row.longitude]).toEqual([
          before.rows[i].latitude,
          before.rows[i].longitude,
        ]);
      }
      // A replayed request returns its receipt without new lookups.
      const spent = () =>
        pool.query<{ count: number }>(
          "SELECT count FROM rate_limit WHERE key=$1",
          [`map-import-match:${owner.id}`],
        );
      const count = (await spent()).rows[0].count;
      const input = request();
      await commitMapImport(owner, input);
      const replay = await commitMapImport(owner, input);
      expect(replay.matched).toBe(before.rowCount);
      expect((await spent()).rows[0].count).toBe(count + before.rowCount!);
    } finally {
      delete process.env.GOOGLE_MAPS_LINK_API_KEY;
    }
  });
});
