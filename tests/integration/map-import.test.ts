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
});
