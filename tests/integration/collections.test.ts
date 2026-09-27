import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { pool } from "../../packages/database/src";
import {
  resolvePlaceSubject,
  savePlaceSubject,
} from "../../apps/web/src/features/place-subjects/service";
import { patchSubject } from "../../apps/web/src/features/place-subjects/admin";
import {
  addLayerItem,
  createLayer,
  removeLayerItem,
} from "../../apps/web/src/features/layers/service";
import { listLayerItemRefs } from "../../apps/web/src/features/layers/repository";
import {
  listExternalReferences,
  listSavedExternalPlaces,
} from "../../apps/web/src/features/map/external";
import { flags } from "../../apps/web/src/lib/config";
import type { Actor, MapState } from "../../packages/shared/src";
const alice: Actor = { id: crypto.randomUUID(), role: "USER" },
  bob: Actor = { id: crypto.randomUUID(), role: "USER" },
  moderator: Actor = { id: crypto.randomUUID(), role: "MODERATOR" };
const users = [alice, bob, moderator];
const city = {
  id: "00000000-0000-4000-8000-000000001001",
  slug: "houston",
  name: "Houston",
  timezone: "America/Chicago",
  latitude: 29.7604,
  longitude: -95.3698,
};
const otherCity = crypto.randomUUID();
const subjects = new Set<string>();
const layers: string[] = [];
let layerId: string;
let layerSlug: string;
let subjectId: string;
let grant: string;
const state = (overrides: Partial<MapState>): MapState => ({
  city: "houston",
  layers: [layerSlug],
  date: "upcoming",
  q: "",
  scope: "layers",
  view: "map",
  page: 1,
  ...overrides,
});
async function external(
  providerPlaceId = `test-${crypto.randomUUID()}`,
  actor = alice,
) {
  const resolved = await resolvePlaceSubject(actor, {
    provider: "google",
    providerPlaceId,
  });
  subjects.add(resolved.subjectId);
  return resolved;
}
async function approveCity(id: string, cityId = city.id) {
  const { rows } = await pool.query<{ revision: number }>(
    "SELECT revision FROM place_subject WHERE id=$1",
    [id],
  );
  await patchSubject(moderator, id, {
    expectedRevision: rows[0].revision,
    reason: "Checked",
    cityId,
  });
}
beforeAll(async () => {
  for (const actor of users)
    await pool.query(
      'INSERT INTO "user"(id,name,email,role) VALUES($1,$2,$3,$4)',
      [actor.id, "Collections", `${actor.id}@example.test`, actor.role],
    );
  await pool.query(
    "INSERT INTO city(id,slug,name,region,country,timezone,latitude,longitude) VALUES($1,$2,'Test City','TX','US','America/Chicago',30,-97)",
    [otherCity, `test-city-${otherCity.slice(0, 8)}`],
  );
  flags.googlePlacesDiscovery = true;
  flags.externalPlaceCollections = true;
  const created = await createLayer(alice, {
    title: "External test layer",
    city: "houston",
  });
  layerId = created.layer.id;
  layerSlug = created.layer.slug;
  layers.push(layerId);
  const resolved = await external();
  subjectId = resolved.subjectId;
  grant = resolved.selectionGrant;
});
afterAll(async () => {
  const ids = [...subjects];
  await pool.query("DELETE FROM layer WHERE id=ANY($1::uuid[])", [layers]);
  await pool.query("DELETE FROM submission WHERE user_id=ANY($1::uuid[])", [
    users.map((u) => u.id),
  ]);
  await pool.query(
    "DELETE FROM moderation_action WHERE actor_id=ANY($1::uuid[])",
    [users.map((u) => u.id)],
  );
  await pool.query(
    "DELETE FROM saved_place_subject WHERE subject_id=ANY($1::uuid[])",
    [ids],
  );
  await pool.query(
    "DELETE FROM place_provider_reference WHERE subject_id=ANY($1::uuid[])",
    [ids],
  );
  await pool.query("DELETE FROM place_subject WHERE id=ANY($1::uuid[])", [ids]);
  await pool.query("DELETE FROM city WHERE id=$1", [otherCity]);
  await pool.query('DELETE FROM "user" WHERE id=ANY($1::uuid[])', [
    users.map((u) => u.id),
  ]);
  await pool.end();
});
describe("external places in layers", () => {
  it("takes an unreviewed external place into a private layer but not a public one", async () => {
    // Private and group layers need no moderation (layer-scoped places, C5).
    const unreviewed = await external();
    const privateLayer = (
      await createLayer(alice, {
        title: "Private external test",
        city: "houston",
      })
    ).layer.id;
    layers.push(privateLayer);
    await expect(
      addLayerItem(alice, privateLayer, {
        key: `subject:${unreviewed.subjectId}`,
        selectionGrant: unreviewed.selectionGrant,
      }),
    ).resolves.toMatchObject({ added: true });
    const publicLayer = (
      await createLayer(alice, {
        title: "Public external test",
        city: "houston",
      })
    ).layer.id;
    layers.push(publicLayer);
    await pool.query(
      "UPDATE layer SET audience='public', review_status='approved', lifecycle='active' WHERE id=$1",
      [publicLayer],
    );
    await expect(
      addLayerItem(alice, publicLayer, {
        key: `subject:${subjectId}`,
        selectionGrant: grant,
      }),
    ).rejects.toMatchObject({ status: 409, code: "CITY_REVIEW_REQUIRED" });
  });
  it("keeps a reviewed external place in its own city", async () => {
    await approveCity(subjectId, otherCity);
    await expect(
      addLayerItem(alice, layerId, {
        key: `subject:${subjectId}`,
        selectionGrant: grant,
      }),
    ).rejects.toMatchObject({ code: "CITY_MISMATCH" });
  });
  it("adds an approved external place once, with the grant bridging first access", async () => {
    const fresh = await external();
    await approveCity(fresh.subjectId);
    await expect(
      addLayerItem(alice, layerId, { key: `subject:${fresh.subjectId}` }),
    ).rejects.toMatchObject({
      status: 404,
    });
    const added = await addLayerItem(alice, layerId, {
      key: `subject:${fresh.subjectId}`,
      note: "Try the pork chop rice",
      selectionGrant: fresh.selectionGrant,
    });
    expect(added).toEqual({ added: true, key: `subject:${fresh.subjectId}` });
    // Now visible through the layer: no grant needed, and duplicates are no-ops.
    expect(
      await addLayerItem(alice, layerId, { key: `subject:${fresh.subjectId}` }),
    ).toMatchObject({ added: false });
    expect((await listLayerItemRefs(layerId)).map((r) => r.key)).toContain(
      `subject:${fresh.subjectId}`,
    );
    subjectId = fresh.subjectId;
  });
  it("gates new external additions on the collections flag but keeps removal", async () => {
    const other = await external();
    await approveCity(other.subjectId);
    flags.externalPlaceCollections = false;
    try {
      await expect(
        addLayerItem(alice, layerId, {
          key: `subject:${other.subjectId}`,
          selectionGrant: other.selectionGrant,
        }),
      ).rejects.toMatchObject({ code: "DISABLED" });
      flags.externalPlaceCollections = true;
      await addLayerItem(alice, layerId, {
        key: `subject:${other.subjectId}`,
        selectionGrant: other.selectionGrant,
      });
      flags.externalPlaceCollections = false;
      expect(
        await removeLayerItem(alice, layerId, `subject:${other.subjectId}`),
      ).toMatchObject({ removed: true });
    } finally {
      flags.externalPlaceCollections = true;
    }
  });
  it("stores a catalog-linked subject as its catalog place", async () => {
    const demoPlace = "00000000-0000-4000-8000-000000005000";
    const catalog = await resolvePlaceSubject(alice, {
      catalogPlaceId: demoPlace,
    });
    subjects.add(catalog.subjectId);
    const added = await addLayerItem(alice, layerId, {
      key: `subject:${catalog.subjectId}`,
    });
    expect(added.key).toBe(`place:${demoPlace}`);
    expect((await listLayerItemRefs(layerId)).map((r) => r.key)).toContain(
      `place:${demoPlace}`,
    );
    await removeLayerItem(alice, layerId, `place:${demoPlace}`);
  });
  it("returns an approved public layer to review when an external place is added", async () => {
    const pub = await createLayer(alice, {
      title: "Public external",
      city: "houston",
    });
    layers.push(pub.layer.id);
    await pool.query(
      "UPDATE layer SET audience='public',review_status='approved',lifecycle='active' WHERE id=$1",
      [pub.layer.id],
    );
    const fresh = await external();
    await approveCity(fresh.subjectId);
    await addLayerItem(alice, pub.layer.id, {
      key: `subject:${fresh.subjectId}`,
      selectionGrant: fresh.selectionGrant,
    });
    const layer = await pool.query(
      "SELECT review_status FROM layer WHERE id=$1",
      [pub.layer.id],
    );
    expect(layer.rows[0].review_status).toBe("pending");
  });
});
describe("external reference projection", () => {
  it("lists authorized references with notes and never for outsiders", async () => {
    const result = await listExternalReferences(state({}), city, alice, 0);
    expect(result).toMatchObject({
      pageSize: 12,
      spatialFilter: "pending-provider-resolution",
      totalAuthorizedReferences: 1,
      nextCursor: null,
    });
    expect(result.references[0]).toMatchObject({
      subjectId,
      canonicalKey: `subject:${subjectId}`,
      localNote: "Try the pork chop rice",
      layers: [layerSlug],
      cityReviewStatus: "approved",
    });
    expect(result.references[0].providerPlaceId).toMatch(/^test-/);
    expect(
      (await listExternalReferences(state({}), city, bob, 0)).references,
    ).toEqual([]);
    expect(
      (await listExternalReferences(state({}), city, null, 0)).references,
    ).toEqual([]);
  });
  it("respects type, text and city-search scope without using provider fields", async () => {
    expect(
      (
        await listExternalReferences(
          state({ types: ["event"] }),
          city,
          alice,
          0,
        )
      ).references,
    ).toEqual([]);
    expect(
      (await listExternalReferences(state({ q: "pork chop" }), city, alice, 0))
        .totalAuthorizedReferences,
    ).toBe(1);
    expect(
      (await listExternalReferences(state({ q: "ramen" }), city, alice, 0))
        .totalAuthorizedReferences,
    ).toBe(0);
    expect(
      (
        await listExternalReferences(
          state({ scope: "city", q: "pork" }),
          city,
          alice,
          0,
        )
      ).references,
    ).toEqual([]);
  });
  it("pages at 12 with a cursor and projects own saves for My saves", async () => {
    for (let i = 0; i < 13; i++) {
      const fresh = await external(undefined, bob);
      await savePlaceSubject(bob, fresh.subjectId, {
        selectionGrant: fresh.selectionGrant,
      });
    }
    const first = await listExternalReferences(
      state({ layers: ["my-saves"] }),
      city,
      bob,
      0,
    );
    expect(first.references).toHaveLength(12);
    expect(first).toMatchObject({
      totalAuthorizedReferences: 13,
      nextCursor: "12",
    });
    const second = await listExternalReferences(
      state({ layers: ["my-saves"] }),
      city,
      bob,
      12,
    );
    expect(second.references).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(
      new Set(
        [...first.references, ...second.references].map((r) => r.subjectId),
      ).size,
    ).toBe(13);
    expect((await listSavedExternalPlaces(bob.id)).length).toBe(13);
    expect(
      (
        await listExternalReferences(
          state({ layers: ["my-saves"] }),
          city,
          alice,
          0,
        )
      ).references,
    ).toEqual([]);
  });
});
