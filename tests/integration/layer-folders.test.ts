import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pool } from "../../packages/database/src";
import {
  maxExpandedLayers,
  parseMapQuery,
  type Actor,
  type MapState,
} from "../../packages/shared/src";
import {
  addLayerToCollection,
  createCollection,
  deleteCollection,
  getCollection,
  listCollectionCandidates,
  listCollections,
  listMapCollections,
  removeLayerFromCollection,
  updateCollection,
} from "../../apps/web/src/features/layers/collections";
import {
  addLayerItem,
  createLayer,
} from "../../apps/web/src/features/layers/service";
import { setMapPreference } from "../../apps/web/src/features/layers/repository";
import { createGroup } from "../../apps/web/src/features/groups/service";
import { runMapQuery } from "../../apps/web/src/features/map/query";
import { resolveAppliedLayers } from "../../apps/web/src/features/map/applied";
import { collectExternalReferences } from "../../apps/web/src/features/map/external";
import { resolveMapRequest } from "../../apps/web/src/features/map/request";

const houston = {
  id: "00000000-0000-4000-8000-000000001001",
  slug: "houston",
  name: "Houston",
  timezone: "America/Chicago",
  latitude: 29.7604,
  longitude: -95.3698,
};
vi.mock("@/lib/city", () => ({
  getActiveCity: async () => ({ city: houston, cities: [houston] }),
}));

const alice: Actor = { id: crypto.randomUUID(), role: "USER" },
  bob: Actor = { id: crypto.randomUUID(), role: "USER" },
  editor: Actor = { id: crypto.randomUUID(), role: "USER" },
  viewer: Actor = { id: crypto.randomUUID(), role: "USER" };
const users = [alice, bob, editor, viewer];
const demoPlace = "00000000-0000-4000-8000-000000005000";
const layerIds: string[] = [];
let groupId: string;

async function layer(owner: Actor, title: string) {
  const created = await createLayer(owner, { title, city: "houston" });
  layerIds.push(created.layer.id);
  return created.layer;
}
const folder = (owner: Actor, title: string, parentId?: string) =>
  createCollection(owner, { title, city: "houston", parentId });
const state = (over: Partial<MapState>): MapState => ({
  ...parseMapQuery({ city: "houston" }),
  layers: "none",
  collections: [],
  ...over,
});

beforeAll(async () => {
  for (const actor of users)
    await pool.query(
      'INSERT INTO "user"(id,name,email,role) VALUES($1,$2,$3,$4)',
      [actor.id, "Folders", `${actor.id}@folders.example`, actor.role],
    );
  groupId = (
    await createGroup(alice, { name: "Folder Circle", city: "houston" })
  ).group.id;
  await pool.query(
    "INSERT INTO group_member(group_id,user_id,role) VALUES($1,$2,'editor'),($1,$3,'viewer')",
    [groupId, editor.id, viewer.id],
  );
});
afterAll(async () => {
  await pool.query("DELETE FROM layer WHERE id=ANY($1::uuid[])", [layerIds]);
  await pool.query(
    "DELETE FROM layer WHERE owner_user_id=ANY($1::uuid[]) OR owner_group_id=$2",
    [users.map((u) => u.id), groupId],
  );
  await pool.query('DELETE FROM "group" WHERE id=$1', [groupId]);
  await pool.query('DELETE FROM "user" WHERE id=ANY($1::uuid[])', [
    users.map((u) => u.id),
  ]);
  await pool.end();
});

describe("folder tree", () => {
  it("creates top-level and sub-folders and stops at depth 3", async () => {
    const a = await folder(alice, "Trip");
    expect(a).toMatchObject({ depth: 1, parentId: null, canEdit: true });
    const b = await folder(alice, "Day one", a.id);
    const c = await folder(alice, "Lunch", b.id);
    expect([b.depth, c.depth]).toEqual([2, 3]);
    expect(c.citySlug).toBe("houston");
    await expect(folder(alice, "Too deep", c.id)).rejects.toMatchObject({
      status: 400,
      code: "FOLDER_TOO_DEEP",
    });
    const tree = (await getCollection(a.slug, alice))!;
    expect(tree.children).toHaveLength(1);
  });

  it("rejects moving past depth 3 and into its own subtree, and recomputes depth on a valid move", async () => {
    const a = await folder(alice, "Chain");
    const b = await folder(alice, "Chain 2", a.id);
    const c = await folder(alice, "Chain 3", b.id);
    const d = await folder(alice, "Loose");
    const e = await folder(alice, "Loose child", d.id);
    await expect(
      updateCollection(alice, d.id, { revision: d.revision, parentId: c.id }),
    ).rejects.toMatchObject({ code: "FOLDER_TOO_DEEP" });
    await expect(
      updateCollection(alice, a.id, { revision: a.revision, parentId: c.id }),
    ).rejects.toMatchObject({ code: "FOLDER_CYCLE" });
    await expect(
      updateCollection(alice, a.id, { revision: a.revision, parentId: a.id }),
    ).rejects.toMatchObject({ code: "FOLDER_CYCLE" });
    const moved = await updateCollection(alice, d.id, {
      revision: d.revision,
      parentId: a.id,
    });
    expect(moved.revision).toBe(d.revision + 1);
    const child = await getCollection(e.id, alice);
    expect(child?.depth).toBe(3);
    const top = await updateCollection(alice, d.id, {
      revision: moved.revision,
      parentId: null,
    });
    expect(top.depth).toBe(1);
    expect((await getCollection(e.id, alice))?.depth).toBe(2);
  });

  it("rejects a stale revision", async () => {
    const f = await folder(alice, "Versioned");
    await updateCollection(alice, f.id, { revision: f.revision, title: "One" });
    await expect(
      updateCollection(alice, f.id, { revision: f.revision, title: "Two" }),
    ).rejects.toMatchObject({ status: 409, code: "VERSION_CONFLICT" });
  });

  it("reorders direct children and rejects ids that are not children", async () => {
    const f = await folder(alice, "Ordered");
    const sub = await folder(alice, "Sub", f.id);
    const l1 = await layer(alice, "Ordered one");
    const l2 = await layer(alice, "Ordered two");
    await addLayerToCollection(alice, f.id, { layerId: l1.id });
    const withLayers = await addLayerToCollection(alice, f.id, {
      layerId: l2.id,
    });
    const order = [
      { kind: "layer" as const, id: l2.id },
      { kind: "folder" as const, id: sub.id },
      { kind: "layer" as const, id: l1.id },
    ];
    const next = await updateCollection(alice, f.id, {
      revision: withLayers.revision,
      order,
    });
    expect(
      next.children.map((c) =>
        c.kind === "folder" ? c.folder.id : c.layer.id,
      ),
    ).toEqual(order.map((o) => o.id));
    await expect(
      updateCollection(alice, f.id, {
        revision: next.revision,
        order: [{ kind: "layer", id: crypto.randomUUID() }],
      }),
    ).rejects.toMatchObject({ code: "ORDER_MISMATCH" });
  });

  it("deletes sub-folders with the folder but never the layers", async () => {
    const f = await folder(alice, "Doomed");
    const sub = await folder(alice, "Doomed sub", f.id);
    const l = await layer(alice, "Survivor");
    await addLayerToCollection(alice, sub.id, { layerId: l.id });
    await expect(deleteCollection(bob, f.id)).rejects.toMatchObject({
      status: 404,
    });
    await deleteCollection(alice, f.id);
    expect(await getCollection(sub.id, alice)).toBeNull();
    const rows = await pool.query("SELECT 1 FROM layer WHERE id=$1", [l.id]);
    expect(rows.rowCount).toBe(1);
  });
});

describe("folder access and membership", () => {
  it("hides private and group folders from non-members", async () => {
    const mine = await folder(alice, "Private folder");
    expect(await getCollection(mine.slug, bob)).toBeNull();
    expect(await getCollection(mine.slug, null)).toBeNull();
    await expect(
      updateCollection(bob, mine.id, { revision: 1, title: "Hijack" }),
    ).rejects.toMatchObject({ status: 404 });
    const shared = await createCollection(alice, {
      title: "Circle folder",
      city: "houston",
      audience: "group",
      groupId,
    });
    expect(shared).toMatchObject({ ownerKind: "group", audience: "group" });
    expect(await getCollection(shared.slug, bob)).toBeNull();
    expect((await getCollection(shared.slug, viewer))?.canEdit).toBe(false);
    expect((await getCollection(shared.slug, editor))?.canEdit).toBe(true);
    expect((await getCollection(shared.slug, editor))?.canManage).toBe(false);
    await expect(
      createCollection(viewer, {
        title: "Nope",
        city: "houston",
        audience: "group",
        groupId,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      updateCollection(viewer, shared.id, { revision: 1, title: "Nope" }),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      (await listCollections("groups", viewer)).map((f) => f.id),
    ).toContain(shared.id);
    expect(await listCollections("groups", bob)).toEqual([]);
    expect((await listMapCollections(bob, houston)).length).toBe(0);
  });

  it("requires the actor to view the layer and counts unseen layers as hidden", async () => {
    const bobFolder = await folder(bob, "Bob folder");
    const alicePrivate = await layer(alice, "Alice private");
    await expect(
      addLayerToCollection(bob, bobFolder.id, { layerId: alicePrivate.id }),
    ).rejects.toMatchObject({ status: 404 });
    const shared = await createCollection(alice, {
      title: "Hidden count",
      city: "houston",
      audience: "group",
      groupId,
    });
    const groupLayer = (
      await createLayer(alice, {
        title: "Group layer",
        city: "houston",
        audience: "group",
        groupId,
      })
    ).layer;
    layerIds.push(groupLayer.id);
    await addLayerToCollection(alice, shared.id, { layerId: groupLayer.id });
    const withPrivate = await addLayerToCollection(alice, shared.id, {
      layerId: alicePrivate.id,
    });
    expect(withPrivate.children).toHaveLength(2);
    const seen = (await getCollection(shared.id, viewer))!;
    expect(seen.children).toHaveLength(1);
    expect(seen.hiddenCount).toBe(1);
    // Adding is idempotent and does not bump the revision twice.
    const again = await addLayerToCollection(alice, shared.id, {
      layerId: alicePrivate.id,
    });
    expect(again.revision).toBe(withPrivate.revision);
    const removed = await removeLayerFromCollection(
      alice,
      shared.id,
      alicePrivate.id,
    );
    expect(removed.children).toHaveLength(1);
    await expect(
      removeLayerFromCollection(alice, shared.id, alicePrivate.id),
    ).resolves.toMatchObject({ revision: removed.revision });
  });

  it("lists candidates without layers already in the folder", async () => {
    const f = await folder(alice, "Candidates");
    const inside = await layer(alice, "Already inside");
    const outside = await layer(alice, "Still outside");
    await addLayerToCollection(alice, f.id, { layerId: inside.id });
    const ids = (await listCollectionCandidates(alice, f.id)).map((c) => c.id);
    expect(ids).toContain(outside.id);
    expect(ids).not.toContain(inside.id);
    await expect(listCollectionCandidates(bob, f.id)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("applying a folder to the map", () => {
  it("returns the folder's items and availability, and reports unviewable folders as unavailable", async () => {
    const f = await folder(alice, "On the map");
    const l = await layer(alice, "Mapped layer");
    await addLayerItem(alice, l.id, { key: `place:${demoPlace}` });
    await addLayerToCollection(alice, f.id, { layerId: l.id });
    const result = await runMapQuery(
      state({ layers: "none", collections: [f.slug] }),
      houston,
      alice,
    );
    expect(result.layers).toEqual([]);
    expect(result.items.map((i) => i.id)).toContain(demoPlace);
    expect(result.items.find((i) => i.id === demoPlace)?.layers).toEqual([
      l.slug,
    ]);
    expect(result.collections).toEqual([
      expect.objectContaining({
        slug: f.slug,
        id: f.id,
        status: "ok",
        layerSlugs: [l.slug],
        hiddenCount: 0,
        truncated: false,
        count: 1,
      }),
    ]);
    expect(result.state.collections).toEqual([f.slug]);
    const outsider = await runMapQuery(
      state({ layers: "none", collections: [f.slug, "no-such-folder"] }),
      houston,
      bob,
    );
    expect(outsider.items).toEqual([]);
    expect(outsider.collections).toEqual([
      expect.objectContaining({
        slug: f.slug,
        title: "",
        status: "unavailable",
        layerSlugs: [],
        count: 0,
      }),
      expect.objectContaining({
        slug: "no-such-folder",
        status: "unavailable",
      }),
    ]);
    expect(outsider.state.collections).toEqual([f.slug, "no-such-folder"]);
    expect(
      await collectExternalReferences(
        state({ layers: "none", collections: [f.slug] }),
        houston,
        alice,
      ),
    ).toEqual([]);
  });

  it("expands sub-folders in tree order, dedupes against explicit layers and caps after access", async () => {
    const root = await folder(alice, "Big folder");
    const sub = await folder(alice, "Big sub", root.id);
    const hidden = await layer(bob, "Bob only");
    const bobFolder = await folder(bob, "Bob shares");
    await addLayerToCollection(bob, bobFolder.id, { layerId: hidden.id });
    const first = await layer(alice, "Direct layer");
    await addLayerToCollection(alice, root.id, { layerId: first.id });
    const many: string[] = [];
    for (let i = 0; i < maxExpandedLayers + 2; i++) {
      const l = await layer(alice, `Bulk ${i}`);
      many.push(l.slug);
      await addLayerToCollection(alice, sub.id, { layerId: l.id });
    }
    const applied = await resolveAppliedLayers(
      { layers: [first.slug], collections: [root.slug] },
      alice,
      houston,
    );
    const slugs = applied.resolved.map((r) => r.layer.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    // The explicit layer is not part of the cap.
    expect(slugs).toHaveLength(maxExpandedLayers + 1);
    expect(applied.collections[0]).toMatchObject({
      status: "ok",
      truncated: true,
      layerSlugs: [...many.slice(0, maxExpandedLayers), first.slug],
    });
    // A folder holding a layer the viewer cannot see reports it as hidden and spends no cap on it.
    const mixed = await createCollection(alice, {
      title: "Mixed",
      city: "houston",
    });
    await addLayerToCollection(alice, mixed.id, { layerId: first.id });
    await pool.query(
      "INSERT INTO layer_collection_member(collection_id,layer_id,position) VALUES($1,$2,5)",
      [mixed.id, hidden.id],
    );
    const viewed = await resolveAppliedLayers(
      { layers: "none", collections: [mixed.slug] },
      alice,
      houston,
    );
    expect(viewed.collections[0]).toMatchObject({
      layerSlugs: [first.slug],
      hiddenCount: 1,
      truncated: false,
    });
    expect(viewed.resolved.map((r) => r.layer.slug)).toEqual([first.slug]);
  });

  it("restores a folder-only preference and treats explicit URLs as authoritative", async () => {
    const f = await folder(alice, "Remembered");
    await setMapPreference(alice.id, {
      layers: [],
      collections: [f.slug],
      view: "map",
    });
    const restored = await resolveMapRequest({}, alice);
    expect(restored.state.collections).toEqual([f.slug]);
    expect(restored.state.layers).toEqual([]);
    const folderOnly = await resolveMapRequest({ collections: f.slug }, bob);
    expect(folderOnly.state).toMatchObject({
      layers: "none",
      collections: [f.slug],
    });
    const layersOnly = await resolveMapRequest({ layers: "none" }, alice);
    expect(layersOnly.state).toMatchObject({ layers: "none", collections: [] });
    const slots = await resolveMapRequest(
      { layers: "a,b,c,d", collections: "x,y" },
      alice,
    );
    expect(slots.state.layers).toHaveLength(4);
    expect(slots.state.collections).toEqual(["x"]);
    await setMapPreference(alice.id, {
      layers: [],
      collections: [],
      view: "map",
    });
  });
});
