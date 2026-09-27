import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GeocoderError, pool } from "../../packages/database/src";
import {
  createCustomPlaceInLayer,
  deleteCustomPlace,
  geocoding,
  previewGeocode,
  updateCustomPlace,
} from "../../apps/web/src/features/custom-places/service";
import {
  getVisibleCustomPlace,
  listScopePlaces,
} from "../../apps/web/src/features/custom-places/repository";
import {
  addLayerItem,
  createLayer,
  publishLayer,
} from "../../apps/web/src/features/layers/service";
import {
  getLayer,
  listLayerItemRefs,
} from "../../apps/web/src/features/layers/repository";
import { createGroup } from "../../apps/web/src/features/groups/service";
import { runMapQuery } from "../../apps/web/src/features/map/query";
import { getMapItemDetail } from "../../apps/web/src/features/map/detail";
import { parseMapQuery } from "../../packages/shared/src";
import { flags } from "../../apps/web/src/lib/config";
import type { Actor } from "../../packages/shared/src";
/*
 * Custom places (docs/plans/layer-scoped-places-design.md, C1): created freely
 * by editors of private and group layers, readable only by the owner scope and
 * by viewers of a layer that contains them, and never crossing scopes.
 */
const alice: Actor = { id: crypto.randomUUID(), role: "USER" },
  bob: Actor = { id: crypto.randomUUID(), role: "USER" },
  editor: Actor = { id: crypto.randomUUID(), role: "USER" },
  viewer: Actor = { id: crypto.randomUUID(), role: "USER" };
const users = [alice, bob, editor, viewer];
const pin = { latitude: 29.705, longitude: -95.55 };
let groupId: string;
let alicePrivate: string;
let aliceSecond: string;
let bobPrivate: string;
let groupLayer: string;
async function layerFor(actor: Actor, title: string, group?: string) {
  const created = await createLayer(actor, {
    title,
    city: "houston",
    ...(group ? { audience: "group", groupId: group } : {}),
  });
  return created.layer.id;
}
async function reviewStatus(layerId: string) {
  const result = await pool.query<{ review_status: string }>(
    "SELECT review_status FROM layer WHERE id=$1",
    [layerId],
  );
  return result.rows[0].review_status;
}
beforeAll(async () => {
  for (const actor of users)
    await pool.query(
      'INSERT INTO "user"(id,name,email,email_verified,role) VALUES($1,$2,$3,true,$4)',
      [
        actor.id,
        "Custom Place Test",
        `${actor.id}@custom-places-test.example`,
        actor.role,
      ],
    );
  flags.layerWrites = true;
  flags.layerCustomPlaces = true;
  const group = await createGroup(alice, {
    name: "Custom Place Circle",
    city: "houston",
  });
  groupId = group.group.id;
  await pool.query(
    "INSERT INTO group_member(group_id,user_id,role) VALUES($1,$2,'editor'),($1,$3,'viewer')",
    [groupId, editor.id, viewer.id],
  );
  alicePrivate = await layerFor(alice, "Alice private list");
  aliceSecond = await layerFor(alice, "Alice second list");
  bobPrivate = await layerFor(bob, "Bob private list");
  groupLayer = await layerFor(alice, "Circle list", groupId);
});
afterAll(async () => {
  const ids = users.map((u) => u.id);
  await pool.query("DELETE FROM submission WHERE user_id=ANY($1::uuid[])", [
    ids,
  ]);
  await pool.query(
    "DELETE FROM layer WHERE created_by=ANY($1::uuid[]) OR owner_user_id=ANY($1::uuid[]) OR owner_group_id=$2",
    [ids, groupId],
  );
  await pool.query(
    "DELETE FROM custom_place WHERE owner_user_id=ANY($1::uuid[]) OR owner_group_id=$2",
    [ids, groupId],
  );
  await pool.query('DELETE FROM "group" WHERE id=$1', [groupId]);
  await pool.query(
    "DELETE FROM analytics_event WHERE user_id=ANY($1::uuid[])",
    [ids],
  );
  await pool.query('DELETE FROM "user" WHERE id=ANY($1::uuid[])', [ids]);
  await pool.end();
});
describe("custom places in private layers", () => {
  let placeId: string;
  it("creates a place with a dropped pin and adds it to the layer", async () => {
    const created = await createCustomPlaceInLayer(alice, alicePrivate, {
      name: "Grandma's dumpling spot",
      address: "Bellaire Blvd",
      pin,
      website: "https://example.test/menu",
    });
    placeId = created.place.id;
    expect(created.key).toBe(`custom:${placeId}`);
    expect(created.place).toMatchObject({
      ownerKind: "user",
      locationStatus: "approximate",
      latitude: pin.latitude,
      longitude: pin.longitude,
    });
    const refs = await listLayerItemRefs(alicePrivate);
    expect(refs.map((r) => r.key)).toContain(`custom:${placeId}`);
    const geometry = await pool.query<{ lng: number; lat: number }>(
      "SELECT ST_X(location) AS lng, ST_Y(location) AS lat FROM custom_place WHERE id=$1",
      [placeId],
    );
    expect(geometry.rows[0]).toEqual({
      lng: pin.longitude,
      lat: pin.latitude,
    });
  });
  it("saves without a pin as list-only", async () => {
    const created = await createCustomPlaceInLayer(alice, alicePrivate, {
      name: "Night market pop-up",
    });
    expect(created.place).toMatchObject({
      locationStatus: "unspecified",
      latitude: null,
      longitude: null,
    });
  });
  it("is visible to its owner only", async () => {
    expect((await getVisibleCustomPlace(placeId, alice))?.id).toBe(placeId);
    expect(await getVisibleCustomPlace(placeId, bob)).toBeNull();
    expect(await getVisibleCustomPlace(placeId, null)).toBeNull();
  });
  it("can be reused in the owner's other layers and found by search", async () => {
    const added = await addLayerItem(alice, aliceSecond, {
      key: `custom:${placeId}`,
    });
    expect(added).toEqual({ added: true, key: `custom:${placeId}` });
    const layer = (await getLayer(aliceSecond, alice))!.layer;
    const found = await listScopePlaces(layer, "dumpling");
    expect(found.map((p) => p.id)).toEqual([placeId]);
    expect(await listScopePlaces(layer, "100%_match")).toEqual([]);
  });
  it("never enters another user's layer or a group layer", async () => {
    await expect(
      addLayerItem(bob, bobPrivate, { key: `custom:${placeId}` }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      addLayerItem(alice, groupLayer, { key: `custom:${placeId}` }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("cannot be edited or deleted by someone else", async () => {
    await expect(
      updateCustomPlace(bob, placeId, { name: "Mine now" }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(deleteCustomPlace(bob, placeId)).rejects.toMatchObject({
      status: 404,
    });
  });
  it("updates fields and clears the pin", async () => {
    const updated = await updateCustomPlace(alice, placeId, {
      nameChinese: "阿嬤水餃",
      pin: null,
    });
    expect(updated.place).toMatchObject({
      name: "Grandma's dumpling spot",
      nameChinese: "阿嬤水餃",
      locationStatus: "unspecified",
      latitude: null,
    });
  });
  it("rejects invalid input", async () => {
    await expect(
      createCustomPlaceInLayer(alice, alicePrivate, { name: "" }),
    ).rejects.toThrow();
    await expect(
      createCustomPlaceInLayer(alice, alicePrivate, {
        name: "Plain http",
        website: "http://example.test",
      }),
    ).rejects.toThrow();
    await expect(
      createCustomPlaceInLayer(alice, alicePrivate, {
        name: "Half pin",
        pin: { latitude: 29.7 },
      }),
    ).rejects.toThrow();
  });
  it("soft-deletes and leaves every layer", async () => {
    await deleteCustomPlace(alice, placeId);
    const keys = [
      ...(await listLayerItemRefs(alicePrivate)),
      ...(await listLayerItemRefs(aliceSecond)),
    ].map((r) => r.key);
    expect(keys).not.toContain(`custom:${placeId}`);
    expect(await getVisibleCustomPlace(placeId, alice)).toBeNull();
    await expect(
      addLayerItem(alice, alicePrivate, { key: `custom:${placeId}` }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
describe("custom places in group layers", () => {
  let placeId: string;
  it("lets a group editor create a group-owned place", async () => {
    const created = await createCustomPlaceInLayer(editor, groupLayer, {
      name: "Circle picnic corner",
      pin,
    });
    placeId = created.place.id;
    expect(created.place.ownerKind).toBe("group");
  });
  it("keeps viewers read-only and outsiders out", async () => {
    await expect(
      createCustomPlaceInLayer(viewer, groupLayer, { name: "Viewer spot" }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      updateCustomPlace(viewer, placeId, { name: "Renamed" }),
    ).rejects.toMatchObject({ status: 403 });
    expect((await getVisibleCustomPlace(placeId, viewer))?.id).toBe(placeId);
    expect(await getVisibleCustomPlace(placeId, bob)).toBeNull();
    expect(await getVisibleCustomPlace(placeId, null)).toBeNull();
  });
  it("never enters a member's personal layer", async () => {
    await expect(
      addLayerItem(alice, alicePrivate, { key: `custom:${placeId}` }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("lets the group owner edit it", async () => {
    const updated = await updateCustomPlace(alice, placeId, {
      note: "Bring a mat",
    });
    expect(updated.place.note).toBe("Bring a mat");
  });
});
describe("custom places and public layers", () => {
  it("stay hidden while a published layer awaits review", async () => {
    const layerId = await layerFor(alice, "Alice going public");
    const { place } = await createCustomPlaceInLayer(alice, layerId, {
      name: "Hidden gem bakery",
      pin,
    });
    await publishLayer(alice, layerId, true);
    expect(await reviewStatus(layerId)).toBe("pending");
    expect(await getVisibleCustomPlace(place.id, null)).toBeNull();
    // A moderator's approval makes the layer, and so the place, public.
    await pool.query(
      "UPDATE layer SET review_status='approved', lifecycle='active' WHERE id=$1",
      [layerId],
    );
    expect((await getVisibleCustomPlace(place.id, null))?.id).toBe(place.id);
    expect((await getVisibleCustomPlace(place.id, bob))?.id).toBe(place.id);
  });
  it("re-queue an approved public layer's review when added or edited", async () => {
    const layerId = await layerFor(alice, "Alice approved public");
    await pool.query(
      "UPDATE layer SET audience='public', review_status='approved', lifecycle='active' WHERE id=$1",
      [layerId],
    );
    const { place } = await createCustomPlaceInLayer(alice, layerId, {
      name: "New tea stand",
    });
    expect(await reviewStatus(layerId)).toBe("pending");
    await pool.query("UPDATE layer SET review_status='approved' WHERE id=$1", [
      layerId,
    ]);
    await updateCustomPlace(alice, place.id, { name: "Renamed tea stand" });
    expect(await reviewStatus(layerId)).toBe("pending");
  });
});
describe("feature flag", () => {
  it("refuses custom place writes when disabled", async () => {
    flags.layerCustomPlaces = false;
    try {
      await expect(
        createCustomPlaceInLayer(alice, alicePrivate, { name: "Off" }),
      ).rejects.toMatchObject({ status: 404, code: "DISABLED" });
    } finally {
      flags.layerCustomPlaces = true;
    }
  });
});
describe("address geocoding (stubbed; no live geocoder call)", () => {
  const real = geocoding.geocode;
  const bellaire = {
    latitude: 29.705,
    longitude: -95.55,
    matchedAddress: "9600 BELLAIRE BLVD, HOUSTON, TX, 77036",
  };
  afterAll(() => {
    geocoding.geocode = real;
  });
  it("stores a matched address as an exact location", async () => {
    geocoding.geocode = vi.fn(async () => bellaire);
    const created = await createCustomPlaceInLayer(alice, alicePrivate, {
      name: "Geocoded tea house",
      address: "9600 Bellaire Blvd",
    });
    expect(created.geocode).toBe("matched");
    expect(created.place).toMatchObject({
      locationStatus: "exact",
      latitude: bellaire.latitude,
      longitude: bellaire.longitude,
    });
  });
  it("keeps the place list-only on no match, a far-away match, or an outage", async () => {
    const cases: [string, () => Promise<unknown>][] = [
      ["no_match", async () => null],
      [
        "outside_city",
        async () => ({
          latitude: 40.7128,
          longitude: -74.006,
          matchedAddress: "",
        }),
      ],
      [
        "unavailable",
        async () => {
          throw new GeocoderError("Geocoder is unavailable (TimeoutError).");
        },
      ],
    ];
    for (const [outcome, stub] of cases) {
      geocoding.geocode = vi.fn(stub) as typeof geocoding.geocode;
      const created = await createCustomPlaceInLayer(alice, alicePrivate, {
        name: `Unmapped ${outcome}`,
        address: "1 Main St",
      });
      expect(created.geocode).toBe(outcome);
      expect(created.place.locationStatus).toBe("unspecified");
    }
  });
  it("prefers the member's pin and never geocodes it", async () => {
    const spy = vi.fn(async () => bellaire);
    geocoding.geocode = spy;
    const created = await createCustomPlaceInLayer(alice, alicePrivate, {
      name: "Pinned stall",
      address: "somewhere on Bellaire",
      pin,
    });
    expect(created.geocode).toBe("skipped");
    expect(created.place.locationStatus).toBe("approximate");
    expect(spy).not.toHaveBeenCalled();
  });
  it("re-geocodes a changed address unless the place was pinned", async () => {
    geocoding.geocode = vi.fn(async () => null);
    const { place } = await createCustomPlaceInLayer(alice, alicePrivate, {
      name: "Moves around",
      address: "old address",
    });
    geocoding.geocode = vi.fn(async () => bellaire);
    const updated = await updateCustomPlace(alice, place.id, {
      address: "9600 Bellaire Blvd",
    });
    expect(updated.geocode).toBe("matched");
    expect(updated.place.locationStatus).toBe("exact");
    const pinned = await createCustomPlaceInLayer(alice, alicePrivate, {
      name: "Pinned then moved",
      pin,
    });
    const spy = vi.fn(async () => bellaire);
    geocoding.geocode = spy;
    const kept = await updateCustomPlace(alice, pinned.place.id, {
      address: "new text",
    });
    expect(kept.place.locationStatus).toBe("approximate");
    expect(spy).not.toHaveBeenCalled();
  });
  it("previews for layer editors without storing anything", async () => {
    geocoding.geocode = vi.fn(async () => bellaire);
    const before = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM custom_place WHERE owner_user_id=$1",
      [alice.id],
    );
    await expect(
      previewGeocode(alice, alicePrivate, "9600 Bellaire Blvd"),
    ).resolves.toEqual({
      outcome: "matched",
      latitude: bellaire.latitude,
      longitude: bellaire.longitude,
      matchedAddress: bellaire.matchedAddress,
    });
    const after = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM custom_place WHERE owner_user_id=$1",
      [alice.id],
    );
    expect(after.rows[0].count).toBe(before.rows[0].count);
    await expect(
      previewGeocode(viewer, groupLayer, "9600 Bellaire Blvd"),
    ).rejects.toMatchObject({ status: 403 });
    await expect(previewGeocode(alice, alicePrivate, "")).rejects.toThrow();
  });
});
describe("custom places on the map and in details", () => {
  const houston = {
    id: "00000000-0000-4000-8000-000000001001",
    slug: "houston",
    name: "Houston",
    timezone: "America/Chicago",
    latitude: 29.7604,
    longitude: -95.3698,
  };
  const mapState = (params: Record<string, string>) => {
    const parsed = parseMapQuery({ city: "houston", ...params });
    return { ...parsed, layers: parsed.layers ?? "none" };
  };
  let layerSlug: string;
  let placeId: string;
  let groupPlaceId: string;
  beforeAll(async () => {
    const layerId = await layerFor(alice, "Alice map list");
    layerSlug = (await getLayer(layerId, alice))!.layer.slug;
    placeId = (
      await createCustomPlaceInLayer(alice, layerId, {
        name: "Qwertz Map Stall",
        pin,
      })
    ).place.id;
    groupPlaceId = (
      await createCustomPlaceInLayer(editor, groupLayer, {
        name: "Qwertz Circle Corner",
        pin,
      })
    ).place.id;
  });
  it("appears through the owner's applied layer as a place", async () => {
    const result = await runMapQuery(
      mapState({ layers: layerSlug }),
      houston,
      alice,
    );
    const item = result.items.find((i) => i.key === `custom:${placeId}`);
    expect(item).toMatchObject({
      type: "place",
      customScope: "user",
      locationStatus: "approximate",
      layers: [layerSlug],
    });
    expect(result.mapped).toBeGreaterThan(0);
  });
  it("never appears for others or in city-wide search", async () => {
    const other = await runMapQuery(
      mapState({ layers: layerSlug }),
      houston,
      bob,
    );
    expect(other.items.some((i) => i.key.startsWith("custom:"))).toBe(false);
    for (const actor of [alice, null])
      for (const layers of ["none", layerSlug]) {
        const search = await runMapQuery(
          mapState({ layers, scope: "city", q: "Qwertz" }),
          houston,
          actor,
        );
        const fromSearch = search.items.filter(
          (i) => i.key.startsWith("custom:") && i.layers.length === 0,
        );
        expect(fromSearch).toEqual([]);
      }
  });
  it("gives the owner a detail limited to same-owner layers", async () => {
    const detail = await getMapItemDetail(`custom:${placeId}`, alice);
    expect(detail.type).toBe("custom");
    if (detail.type !== "custom") return;
    expect(detail.canEdit).toBe(true);
    expect(detail.editableLayers.length).toBeGreaterThan(0);
    expect(detail.editableLayers.map((l) => l.id)).not.toContain(groupLayer);
    expect(
      detail.editableLayers.find((l) => l.slug === layerSlug)?.contains,
    ).toBe(true);
    await expect(
      getMapItemDetail(`custom:${placeId}`, bob),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      getMapItemDetail(`custom:${placeId}`, null),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("lets a group viewer read but not add or edit a group place", async () => {
    const detail = await getMapItemDetail(`custom:${groupPlaceId}`, viewer);
    expect(detail.type).toBe("custom");
    if (detail.type !== "custom") return;
    expect(detail.canEdit).toBe(false);
    expect(detail.editableLayers).toEqual([]);
  });
  it("disappears from the map when the flag is off", async () => {
    flags.layerCustomPlaces = false;
    try {
      const result = await runMapQuery(
        mapState({ layers: layerSlug }),
        houston,
        alice,
      );
      expect(result.items.some((i) => i.key.startsWith("custom:"))).toBe(false);
      await expect(
        getMapItemDetail(`custom:${placeId}`, alice),
      ).rejects.toMatchObject({ status: 404 });
    } finally {
      flags.layerCustomPlaces = true;
    }
  });
});
