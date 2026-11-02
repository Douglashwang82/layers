import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { pool } from "../../packages/database/src";
import { createGroup } from "../../apps/web/src/features/groups/service";
import {
  createLayer,
  setLayerItemMarker,
} from "../../apps/web/src/features/layers/service";
import { listLayerItemRefs } from "../../apps/web/src/features/layers/repository";
import { runMapQuery } from "../../apps/web/src/features/map/query";
import { collectExternalReferences } from "../../apps/web/src/features/map/external";
import { resolvePlaceSubject } from "../../apps/web/src/features/place-subjects/service";
import { flags } from "../../apps/web/src/lib/config";
import { parseMapQuery, type Actor } from "../../packages/shared/src";

const alice: Actor = { id: crypto.randomUUID(), role: "USER" },
  bob: Actor = { id: crypto.randomUUID(), role: "USER" },
  carol: Actor = { id: crypto.randomUUID(), role: "USER" };
const users = [alice, bob, carol];
const city = {
  id: "00000000-0000-4000-8000-000000001001",
  slug: "houston",
  name: "Houston",
  timezone: "America/Chicago",
  latitude: 29.7604,
  longitude: -95.3698,
};
const placeId = crypto.randomUUID();
const googleId = `test-${crypto.randomUUID()}`;
let groupId: string;
let privateLayer: { id: string; slug: string };
let groupLayer: { id: string; slug: string };
let publicLayer: { id: string; slug: string };
let privateItem: string;
let groupItem: string;
let publicItem: string;
let subjectItem: string;
let subjectId: string;
let aliceImage: string;
let aliceJpeg: string;
let carolImage: string;

async function image(owner: Actor, mime = "image/png") {
  const key = `${crypto.randomUUID()}.png`;
  const r = await pool.query<{ id: string }>(
    "INSERT INTO image(user_id,key,url,mime_type) VALUES($1,$2,$3,$4) RETURNING id",
    [owner.id, key, `/uploads/${key}`, mime],
  );
  return r.rows[0].id;
}
async function item(layerId: string, column: string, id: string) {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO layer_item(layer_id,${column},position) VALUES($1,$2,0) RETURNING id`,
    [layerId, id],
  );
  return r.rows[0].id;
}
const mapState = (layers: string[]) => ({
  ...parseMapQuery({ city: "houston" }),
  layers,
});

beforeAll(async () => {
  for (const u of users)
    await pool.query(
      'INSERT INTO "user"(id,name,email,role) VALUES($1,$2,$3,$4)',
      [u.id, `Marker ${u.id.slice(0, 4)}`, `${u.id}@example.test`, u.role],
    );
  await pool.query(
    `INSERT INTO place(id,slug,name,image,category,city_id,neighborhood,address,latitude,longitude,status)
     VALUES($1,$2,'Marker place','https://example.test/x.png','Taiwanese',$3,'Test','1 Test St',29.7,-95.4,'approved')`,
    [placeId, `marker-${placeId.slice(0, 8)}`, city.id],
  );
  flags.googlePlacesDiscovery = true;
  flags.externalPlaceCollections = true;
  groupId = (
    await createGroup(alice, { name: "Marker Circle", city: "houston" })
  ).group.id;
  await pool.query(
    "INSERT INTO group_member(group_id,user_id,role) VALUES($1,$2,'viewer')",
    [groupId, bob.id],
  );
  privateLayer = (
    await createLayer(alice, { title: "Marker private", city: "houston" })
  ).layer;
  groupLayer = (
    await createLayer(alice, {
      title: "Marker group",
      city: "houston",
      audience: "group",
      groupId,
    })
  ).layer;
  publicLayer = (
    await createLayer(alice, { title: "Marker public", city: "houston" })
  ).layer;
  await pool.query(
    "UPDATE layer SET audience='public',review_status='approved',lifecycle='active' WHERE id=$1",
    [publicLayer.id],
  );
  privateItem = await item(privateLayer.id, "place_id", placeId);
  groupItem = await item(groupLayer.id, "place_id", placeId);
  publicItem = await item(publicLayer.id, "place_id", placeId);
  subjectId = (
    await resolvePlaceSubject(alice, {
      provider: "google",
      providerPlaceId: googleId,
    })
  ).subjectId;
  subjectItem = await item(privateLayer.id, "subject_id", subjectId);
  aliceImage = await image(alice);
  aliceJpeg = await image(alice, "image/jpeg");
  carolImage = await image(carol);
});

afterAll(async () => {
  const layers = [privateLayer.id, groupLayer.id, publicLayer.id];
  await pool.query("DELETE FROM submission WHERE user_id=ANY($1::uuid[])", [
    users.map((u) => u.id),
  ]);
  await pool.query("DELETE FROM layer WHERE id=ANY($1::uuid[])", [layers]);
  await pool.query('DELETE FROM "group" WHERE id=$1', [groupId]);
  await pool.query("DELETE FROM place_provider_reference WHERE subject_id=$1", [
    subjectId,
  ]);
  await pool.query("DELETE FROM place_subject WHERE id=$1", [subjectId]);
  await pool.query("DELETE FROM place WHERE id=$1", [placeId]);
  await pool.query("DELETE FROM image WHERE user_id=ANY($1::uuid[])", [
    users.map((u) => u.id),
  ]);
  await pool.query(
    "DELETE FROM analytics_event WHERE user_id=ANY($1::uuid[])",
    [users.map((u) => u.id)],
  );
  await pool.query('DELETE FROM "user" WHERE id=ANY($1::uuid[])', [
    users.map((u) => u.id),
  ]);
  await pool.end();
});

describe("layer item custom markers", () => {
  it("stores the editor's sticker and serves it with the item on the map", async () => {
    const saved = await setLayerItemMarker(
      alice,
      privateLayer.id,
      privateItem,
      { imageId: aliceImage },
    );
    expect(saved.markerImageUrl).toMatch(/^\/uploads\//);
    const refs = await listLayerItemRefs(privateLayer.id);
    expect(refs.find((r) => r.id === privateItem)?.markerImageUrl).toBe(
      saved.markerImageUrl,
    );
    const result = await runMapQuery(
      mapState([privateLayer.slug]),
      city,
      alice,
    );
    const pin = result.items.find((i) => i.key === `place:${placeId}`);
    expect(pin?.markerImageUrl).toBe(saved.markerImageUrl);
  });

  it("is scoped to the layer: the same place elsewhere keeps its dot", async () => {
    const result = await runMapQuery(mapState([groupLayer.slug]), city, alice);
    const pin = result.items.find((i) => i.key === `place:${placeId}`);
    expect(pin).toBeDefined();
    expect(pin?.markerImageUrl).toBeUndefined();
  });

  it("works for Google places through the external references", async () => {
    await setLayerItemMarker(alice, privateLayer.id, subjectItem, {
      imageId: aliceImage,
    });
    const refs = await collectExternalReferences(
      mapState([privateLayer.slug]),
      city,
      alice,
    );
    expect(refs.find((r) => r.subjectId === subjectId)?.markerImageUrl).toMatch(
      /^\/uploads\//,
    );
  });

  it("only lets layer editors change markers", async () => {
    // bob is a group viewer; carol cannot see the private layer at all.
    await expect(
      setLayerItemMarker(bob, groupLayer.id, groupItem, { imageId: null }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      setLayerItemMarker(carol, privateLayer.id, privateItem, {
        imageId: carolImage,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      setLayerItemMarker(null, privateLayer.id, privateItem, { imageId: null }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("refuses another user's upload, non-PNG images and foreign items", async () => {
    await expect(
      setLayerItemMarker(alice, privateLayer.id, privateItem, {
        imageId: carolImage,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      setLayerItemMarker(alice, privateLayer.id, privateItem, {
        imageId: aliceJpeg,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      setLayerItemMarker(alice, privateLayer.id, groupItem, {
        imageId: aliceImage,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      setLayerItemMarker(alice, privateLayer.id, privateItem, {
        imageId: "not-a-uuid",
      }),
    ).rejects.toThrow();
  });

  it("sends an approved public layer back to review when a marker is set", async () => {
    await setLayerItemMarker(alice, publicLayer.id, publicItem, {
      imageId: aliceImage,
    });
    const layer = await pool.query<{ review_status: string }>(
      "SELECT review_status FROM layer WHERE id=$1",
      [publicLayer.id],
    );
    expect(layer.rows[0].review_status).toBe("pending");
  });

  it("clears a marker, and a deleted image leaves the ordinary pin", async () => {
    await setLayerItemMarker(alice, privateLayer.id, privateItem, {
      imageId: null,
    });
    expect(
      (await listLayerItemRefs(privateLayer.id)).find(
        (r) => r.id === privateItem,
      )?.markerImageUrl,
    ).toBeNull();
    const temp = await image(alice);
    await setLayerItemMarker(alice, groupLayer.id, groupItem, {
      imageId: temp,
    });
    await pool.query("DELETE FROM image WHERE id=$1", [temp]);
    const row = await pool.query<{ marker_image_id: string | null }>(
      "SELECT marker_image_id FROM layer_item WHERE id=$1",
      [groupItem],
    );
    expect(row.rows[0].marker_image_id).toBeNull();
  });
});
