import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { pool } from "../../packages/database/src";
import { resolvePlaceSubject } from "../../apps/web/src/features/place-subjects/service";
import { createGroup } from "../../apps/web/src/features/groups/service";
import {
  createLayer,
  removeLayerItem,
} from "../../apps/web/src/features/layers/service";
import { patchSubject } from "../../apps/web/src/features/place-subjects/admin";
import {
  decideReview,
  deleteItemReview,
  deleteReview,
  writeItemReview,
  writeReview,
} from "../../apps/web/src/features/reviews/service";
import {
  listItemReviews,
  listLayerItemRatings,
  listScopeReviews,
} from "../../apps/web/src/features/reviews/repository";
import { flags } from "../../apps/web/src/lib/config";
import type { Actor } from "../../packages/shared/src";

const alice: Actor = { id: crypto.randomUUID(), role: "USER" },
  bob: Actor = { id: crypto.randomUUID(), role: "USER" },
  carol: Actor = { id: crypto.randomUUID(), role: "USER" },
  moderator: Actor = { id: crypto.randomUUID(), role: "MODERATOR" };
const users = [alice, bob, carol, moderator];
const houston = "00000000-0000-4000-8000-000000001001";
const placeId = crypto.randomUUID();
const googleId = `test-${crypto.randomUUID()}`;
let groupId: string;
let sharedLayerId: string;
let privateLayerId: string;
let publicLayerId: string;
let sharedItem: string;
let privateItem: string;
let publicItem: string;
let subjectId: string;
let subjectItem: string;

async function addPlaceItem(layerId: string) {
  const r = await pool.query<{ id: string }>(
    "INSERT INTO layer_item(layer_id,place_id,position) VALUES($1,$2,0) RETURNING id",
    [layerId, placeId],
  );
  return r.rows[0].id;
}
const input = (
  stars: number | null,
  body = "",
  expectedRevision: number | null = null,
) => ({
  stars,
  body,
  expectedRevision,
});

beforeAll(async () => {
  for (const u of users)
    await pool.query(
      'INSERT INTO "user"(id,name,email,role) VALUES($1,$2,$3,$4)',
      [u.id, `Item reviewer ${u.role}`, `${u.id}@example.test`, u.role],
    );
  await pool.query(
    `INSERT INTO place(id,slug,name,image,category,city_id,neighborhood,address,latitude,longitude,status)
     VALUES($1,$2,'Item review place','https://example.test/x.png','Taiwanese',$3,'Test','1 Test St',29.7,-95.4,'approved')`,
    [placeId, `item-review-${placeId.slice(0, 8)}`, houston],
  );
  flags.placeReviewWrites = true;
  flags.googlePlacesDiscovery = true;
  flags.externalPlaceCollections = true;
  const group = await createGroup(alice, {
    name: "Item Circle",
    city: "houston",
  });
  groupId = group.group.id;
  await pool.query(
    "INSERT INTO group_member(group_id,user_id,role) VALUES($1,$2,'viewer')",
    [groupId, bob.id],
  );
  const shared = await createLayer(alice, {
    title: "Item shared layer",
    city: "houston",
    audience: "group",
    groupId,
  });
  sharedLayerId = shared.layer.id;
  privateLayerId = (
    await createLayer(alice, { title: "Item private layer", city: "houston" })
  ).layer.id;
  publicLayerId = (
    await createLayer(alice, { title: "Item public layer", city: "houston" })
  ).layer.id;
  await pool.query(
    "UPDATE layer SET audience='public',review_status='approved',lifecycle='active' WHERE id=$1",
    [publicLayerId],
  );
  sharedItem = await addPlaceItem(sharedLayerId);
  privateItem = await addPlaceItem(privateLayerId);
  publicItem = await addPlaceItem(publicLayerId);
  const resolved = await resolvePlaceSubject(alice, {
    provider: "google",
    providerPlaceId: googleId,
  });
  subjectId = resolved.subjectId;
  const si = await pool.query<{ id: string }>(
    "INSERT INTO layer_item(layer_id,subject_id,position) VALUES($1,$2,1) RETURNING id",
    [sharedLayerId, subjectId],
  );
  subjectItem = si.rows[0].id;
});

afterAll(async () => {
  const layers = [sharedLayerId, privateLayerId, publicLayerId];
  await pool.query("DELETE FROM place_review WHERE layer_id=ANY($1::uuid[])", [
    layers,
  ]);
  await pool.query("DELETE FROM submission WHERE user_id=ANY($1::uuid[])", [
    users.map((u) => u.id),
  ]);
  await pool.query(
    "DELETE FROM moderation_action WHERE actor_id=ANY($1::uuid[])",
    [users.map((u) => u.id)],
  );
  await pool.query("DELETE FROM layer WHERE id=ANY($1::uuid[])", [layers]);
  await pool.query('DELETE FROM "group" WHERE id=$1', [groupId]);
  await pool.query("DELETE FROM place_provider_reference WHERE subject_id=$1", [
    subjectId,
  ]);
  await pool.query("DELETE FROM place_subject WHERE id=$1", [subjectId]);
  await pool.query("DELETE FROM place WHERE id=$1", [placeId]);
  await pool.query('DELETE FROM "user" WHERE id=ANY($1::uuid[])', [
    users.map((u) => u.id),
  ]);
  await pool.end();
});

describe("layer item reviews", () => {
  it("hides the item and refuses writes for non-viewers", async () => {
    // carol is not in the group and the shared layer is not public.
    expect(
      await listItemReviews(sharedLayerId, sharedItem, carol, undefined),
    ).toBeNull();
    expect(
      await listItemReviews(sharedLayerId, sharedItem, null, undefined),
    ).toBeNull();
    await expect(
      writeItemReview(carol, sharedLayerId, sharedItem, input(4, "hi")),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      deleteItemReview(carol, sharedLayerId, sharedItem, {
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await listLayerItemRatings(sharedLayerId, carol)).toBeNull();
    // An item of another layer is not found through this layer.
    expect(
      await listItemReviews(sharedLayerId, privateItem, alice, undefined),
    ).toBeNull();
    await expect(
      writeItemReview(alice, sharedLayerId, privateItem, input(4)),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      writeItemReview(null, sharedLayerId, sharedItem, input(4)),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("shows private/shared layer reviews immediately to every viewer", async () => {
    const own = await writeItemReview(
      alice,
      sharedLayerId,
      sharedItem,
      input(4, "Great"),
    );
    expect(own).toMatchObject({ status: "approved", revision: 1, stars: 4 });
    const bobView = await listItemReviews(
      sharedLayerId,
      sharedItem,
      bob,
      undefined,
    );
    expect(bobView).toMatchObject({
      summary: { totalReviews: 1, ratedCount: 1, averageStars: 4 },
      own: null,
      canReview: true,
      nextCursor: null,
    });
    expect(bobView!.reviews).toHaveLength(1);
    expect(bobView!.reviews[0]).toMatchObject({ body: "Great", mine: false });
    const bobs = await writeItemReview(
      bob,
      sharedLayerId,
      sharedItem,
      input(null, "Nice"),
    );
    expect(bobs.status).toBe("approved");
    const aliceView = await listItemReviews(
      sharedLayerId,
      sharedItem,
      alice,
      undefined,
    );
    expect(aliceView!.summary).toMatchObject({
      totalReviews: 2,
      ratedCount: 1,
    });
    expect(aliceView!.reviews.map((r) => r.mine).sort()).toEqual([false, true]);
    expect(await listLayerItemRatings(sharedLayerId, bob)).toEqual({
      ratings: { [sharedItem]: { averageStars: 4, ratedCount: 1 } },
    });
  });

  it("enforces the revision check and soft deletes", async () => {
    await expect(
      writeItemReview(alice, sharedLayerId, sharedItem, input(2, "x", null)),
    ).rejects.toMatchObject({ status: 409, code: "REVISION_CONFLICT" });
    const edited = await writeItemReview(
      alice,
      sharedLayerId,
      sharedItem,
      input(5, "Even better", 1),
    );
    expect(edited.revision).toBe(2);
    await expect(
      writeItemReview(alice, sharedLayerId, sharedItem, input(1, "stale", 1)),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      deleteItemReview(alice, sharedLayerId, sharedItem, {
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({ status: 409 });
    const deleted = await deleteItemReview(alice, sharedLayerId, sharedItem, {
      expectedRevision: 2,
    });
    expect(deleted).toMatchObject({ status: "deleted", stars: null, body: "" });
    const view = await listItemReviews(
      sharedLayerId,
      sharedItem,
      bob,
      undefined,
    );
    expect(view!.summary.totalReviews).toBe(1);
    const row = await pool.query(
      "SELECT 1 FROM place_review WHERE layer_item_id=$1 AND status='deleted'",
      [sharedItem],
    );
    expect(row.rowCount).toBe(1);
  });

  it("keeps a public-layer review pending and visible only to its author", async () => {
    const carols = await writeItemReview(
      carol,
      publicLayerId,
      publicItem,
      input(3, "Okay"),
    );
    expect(carols.status).toBe("pending");
    const own = await listItemReviews(
      publicLayerId,
      publicItem,
      carol,
      undefined,
    );
    expect(own!.own).toMatchObject({ status: "pending" });
    expect(own!.reviews).toHaveLength(1);
    expect(own!.summary.totalReviews).toBe(0);
    const bobView = await listItemReviews(
      publicLayerId,
      publicItem,
      bob,
      undefined,
    );
    expect(bobView!.reviews).toHaveLength(0);
    const anon = await listItemReviews(
      publicLayerId,
      publicItem,
      null,
      undefined,
    );
    expect(anon).toMatchObject({ reviews: [], own: null, canReview: false });
    // A moderator approves it; then everyone sees it. The queue row has no subject.
    const queued = await pool.query<{ entity_revision: number }>(
      "SELECT entity_revision FROM submission WHERE entity_type='reviews' AND entity_id=$1 AND status='pending'",
      [carols.id],
    );
    expect(queued.rows[0].entity_revision).toBe(1);
    await decideReview(moderator, carols.id, {
      action: "approved",
      expectedRevision: 1,
      reason: "ok",
    });
    const after = await listItemReviews(
      publicLayerId,
      publicItem,
      bob,
      undefined,
    );
    expect(after!.summary).toMatchObject({ totalReviews: 1, averageStars: 3 });
    expect(after!.reviews[0]).toMatchObject({ body: "Okay", mine: false });
    expect(
      (await listLayerItemRatings(publicLayerId, null))!.ratings[publicItem],
    ).toEqual({
      averageStars: 3,
      ratedCount: 1,
    });
  });

  it("paginates with a cursor", async () => {
    await pool.query(
      `INSERT INTO "user"(id,name,email,role) SELECT gen_random_uuid(),'Bulk '||g,'bulk-'||g||'-'||$1||'@example.test','USER' FROM generate_series(1,22) g`,
      [crypto.randomUUID()],
    );
    const ids = await pool.query<{ id: string }>(
      `SELECT id FROM "user" WHERE name LIKE 'Bulk %' AND email LIKE 'bulk-%@example.test' AND id NOT IN (SELECT user_id FROM place_review WHERE layer_item_id=$1)`,
      [privateItem],
    );
    try {
      for (const u of ids.rows)
        await pool.query(
          `INSERT INTO place_review(layer_item_id,user_id,scope_kind,layer_id,stars,body,status) VALUES($1,$2,'layer',$3,5,'bulk','approved')`,
          [privateItem, u.id, privateLayerId],
        );
      const first = await listItemReviews(
        privateLayerId,
        privateItem,
        alice,
        undefined,
      );
      expect(first!.reviews).toHaveLength(20);
      expect(first!.nextCursor).not.toBeNull();
      const second = await listItemReviews(
        privateLayerId,
        privateItem,
        alice,
        first!.nextCursor!,
      );
      expect(second!.reviews.length).toBe(ids.rows.length - 20);
      expect(second!.nextCursor).toBeNull();
      const seen = new Set(
        [...first!.reviews, ...second!.reviews].map((r) => r.id),
      );
      expect(seen.size).toBe(ids.rows.length);
    } finally {
      await pool.query("DELETE FROM place_review WHERE layer_item_id=$1", [
        privateItem,
      ]);
      await pool.query(`DELETE FROM "user" WHERE id=ANY($1::uuid[])`, [
        ids.rows.map((r) => r.id),
      ]);
    }
  });

  it("shares the subject review for place-subject items", async () => {
    const mine = await writeItemReview(
      alice,
      sharedLayerId,
      subjectItem,
      input(5, "Via item"),
    );
    expect(mine.status).toBe("approved");
    const row = await pool.query(
      "SELECT subject_id,layer_item_id FROM place_review WHERE id=$1",
      [mine.id],
    );
    expect(row.rows[0]).toEqual({ subject_id: subjectId, layer_item_id: null });
    // The existing subject endpoint sees the same review in that layer scope.
    const viaSubject = await listScopeReviews(
      subjectId,
      { kind: "layer", id: sharedLayerId },
      bob,
      1,
    );
    expect(viaSubject).toMatchObject({ totalReviews: 1, averageStars: 5 });
    // And a subject-endpoint edit shows on the item.
    await writeReview(alice, subjectId, {
      scope: `layer:${sharedLayerId}`,
      stars: 3,
      body: "Via subject",
      expectedRevision: mine.revision,
    });
    const view = await listItemReviews(
      sharedLayerId,
      subjectItem,
      bob,
      undefined,
    );
    expect(view!.summary).toMatchObject({ totalReviews: 1, averageStars: 3 });
    expect(
      (await listLayerItemRatings(sharedLayerId, bob))!.ratings[subjectItem],
    ).toEqual({
      averageStars: 3,
      ratedCount: 1,
    });
    const current = await deleteReview(alice, subjectId, {
      scope: `layer:${sharedLayerId}`,
      expectedRevision: 2,
    });
    expect(current.status).toBe("deleted");
  });
});

describe("layer item review lifecycle", () => {
  const extraLayers: string[] = [];
  const extraPlaces: string[] = [];
  const extraSubjects: string[] = [];
  async function layerWith(audience: "private" | "public") {
    const id = (
      await createLayer(alice, {
        title: `Lifecycle ${audience}`,
        city: "houston",
      })
    ).layer.id;
    extraLayers.push(id);
    if (audience === "public")
      await pool.query(
        "UPDATE layer SET audience='public',review_status='approved',lifecycle='active' WHERE id=$1",
        [id],
      );
    return id;
  }
  async function newPlace() {
    const id = crypto.randomUUID();
    extraPlaces.push(id);
    await pool.query(
      `INSERT INTO place(id,slug,name,image,category,city_id,neighborhood,address,latitude,longitude,status)
       VALUES($1,$2,'Lifecycle place','https://example.test/x.png','Taiwanese',$3,'Test','1 Test St',29.7,-95.4,'approved')`,
      [id, `lifecycle-${id.slice(0, 8)}`, houston],
    );
    return id;
  }
  async function placeItem(layerId: string, place: string) {
    const r = await pool.query<{ id: string }>(
      "INSERT INTO layer_item(layer_id,place_id,position) VALUES($1,$2,0) RETURNING id",
      [layerId, place],
    );
    return r.rows[0].id;
  }
  async function subjectItem(layerId: string) {
    const resolved = await resolvePlaceSubject(alice, {
      provider: "google",
      providerPlaceId: `test-${crypto.randomUUID()}`,
    });
    extraSubjects.push(resolved.subjectId);
    const r = await pool.query<{ id: string }>(
      "INSERT INTO layer_item(layer_id,subject_id,position) VALUES($1,$2,0) RETURNING id",
      [layerId, resolved.subjectId],
    );
    return { item: r.rows[0].id, subjectId: resolved.subjectId };
  }
  afterAll(async () => {
    await pool.query(
      "DELETE FROM place_review WHERE layer_id=ANY($1::uuid[])",
      [extraLayers],
    );
    await pool.query("DELETE FROM submission WHERE user_id=ANY($1::uuid[])", [
      users.map((u) => u.id),
    ]);
    await pool.query("DELETE FROM layer WHERE id=ANY($1::uuid[])", [
      extraLayers,
    ]);
    await pool.query(
      "DELETE FROM place_provider_reference WHERE subject_id=ANY($1::uuid[])",
      [extraSubjects],
    );
    await pool.query("DELETE FROM place_subject WHERE id=ANY($1::uuid[])", [
      extraSubjects,
    ]);
    await pool.query("DELETE FROM place WHERE id=ANY($1::uuid[])", [
      extraPlaces,
    ]);
  });

  it("keeps review history and supersedes pending requests when an item is removed", async () => {
    const layerId = await layerWith("public");
    const place = await newPlace();
    const item = await placeItem(layerId, place);
    const review = await writeItemReview(bob, layerId, item, input(4, "Tasty"));
    expect(review.status).toBe("pending");
    const result = await removeLayerItem(alice, layerId, `place:${place}`);
    expect(result.removed).toBe(true);
    const row = await pool.query(
      "SELECT layer_item_id,subject_id,status,revision FROM place_review WHERE id=$1",
      [review.id],
    );
    expect(row.rows[0]).toEqual({
      layer_item_id: null,
      subject_id: null,
      status: "deleted",
      revision: 2,
    });
    const history = await pool.query<{ change_kind: string }>(
      "SELECT change_kind FROM place_review_revision WHERE review_id=$1 ORDER BY revision",
      [review.id],
    );
    expect(history.rows.map((r) => r.change_kind)).toEqual([
      "created",
      "item_removed",
    ]);
    const pending = await pool.query<{ status: string }>(
      "SELECT status FROM submission WHERE entity_type='reviews' AND entity_id=$1",
      [review.id],
    );
    expect(pending.rows.map((r) => r.status)).toEqual(["superseded"]);
  });

  it("answers a concurrent first review with a revision conflict, not a server error", async () => {
    const layerId = await layerWith("private");
    const item = await placeItem(layerId, await newPlace());
    const results = await Promise.allSettled([
      writeItemReview(alice, layerId, item, input(5, "one")),
      writeItemReview(alice, layerId, item, input(3, "two")),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    expect(failed!.reason).toMatchObject({
      status: 409,
      code: "REVISION_CONFLICT",
    });
  });

  it("moves a subject's layer reviews onto the item when linked to the catalog", async () => {
    const layerId = await layerWith("private");
    const place = await newPlace();
    const { item, subjectId: sid } = await subjectItem(layerId);
    const mine = await writeItemReview(alice, layerId, item, input(5, "Keep"));
    const revision = (
      await pool.query<{ revision: number }>(
        "SELECT revision FROM place_subject WHERE id=$1",
        [sid],
      )
    ).rows[0].revision;
    await patchSubject(moderator, sid, {
      expectedRevision: revision,
      reason: "link",
      linkCatalogPlaceId: place,
    });
    const row = await pool.query(
      "SELECT subject_id,layer_item_id,status,revision FROM place_review WHERE id=$1",
      [mine.id],
    );
    expect(row.rows[0]).toEqual({
      subject_id: null,
      layer_item_id: item,
      status: "approved",
      revision: 1,
    });
    const view = await listItemReviews(layerId, item, alice, undefined);
    expect(view!.summary).toMatchObject({ totalReviews: 1, averageStars: 5 });
    expect(view!.own).toMatchObject({ id: mine.id, revision: 1 });
  });

  it("merges into an existing catalog item without losing the author's review", async () => {
    const layerId = await layerWith("private");
    const place = await newPlace();
    const twin = await placeItem(layerId, place);
    const { item, subjectId: sid } = await subjectItem(layerId);
    const old = await writeItemReview(alice, layerId, item, input(2, "Old"));
    const kept = await writeItemReview(alice, layerId, twin, input(5, "Twin"));
    const viaSubject = (
      await pool.query<{ id: string }>(
        `INSERT INTO place_review(subject_id,user_id,scope_kind,layer_id,stars,body,status)
         SELECT subject_id,$2,'layer',layer_id,4,'B','approved' FROM place_review WHERE id=$1 RETURNING id`,
        [old.id, bob.id],
      )
    ).rows[0];
    const revision = (
      await pool.query<{ revision: number }>(
        "SELECT revision FROM place_subject WHERE id=$1",
        [sid],
      )
    ).rows[0].revision;
    await patchSubject(moderator, sid, {
      expectedRevision: revision,
      reason: "merge",
      linkCatalogPlaceId: place,
    });
    const rows = await pool.query<{
      id: string;
      layer_item_id: string | null;
      status: string;
    }>(
      "SELECT id,layer_item_id,status FROM place_review WHERE id=ANY($1::uuid[])",
      [[old.id, kept.id, viaSubject.id]],
    );
    const by = new Map(rows.rows.map((r) => [r.id, r]));
    // Alice keeps her existing twin review; her older subject review is retired.
    expect(by.get(kept.id)).toMatchObject({ layer_item_id: twin });
    expect(by.get(old.id)).toMatchObject({
      layer_item_id: null,
      status: "deleted",
    });
    expect(by.get(viaSubject.id)).toMatchObject({
      layer_item_id: twin,
      status: "approved",
    });
  });

  it("hides items of blocked subjects from reads", async () => {
    const layerId = await layerWith("private");
    const { item, subjectId: sid } = await subjectItem(layerId);
    await writeItemReview(alice, layerId, item, input(4, "ok"));
    expect(
      await listItemReviews(layerId, item, alice, undefined),
    ).not.toBeNull();
    expect(
      (await listLayerItemRatings(layerId, alice))!.ratings[item],
    ).toBeDefined();
    await pool.query("UPDATE place_subject SET status='hidden' WHERE id=$1", [
      sid,
    ]);
    expect(await listItemReviews(layerId, item, alice, undefined)).toBeNull();
    expect(
      (await listLayerItemRatings(layerId, alice))!.ratings[item],
    ).toBeUndefined();
  });

  it("pages through reviews created within the same millisecond", async () => {
    const layerId = await layerWith("private");
    const item = await placeItem(layerId, await newPlace());
    const tag = crypto.randomUUID();
    const bulk = await pool.query<{ id: string }>(
      `INSERT INTO "user"(id,name,email,role) SELECT gen_random_uuid(),'Micro '||g,'micro-'||g||'-'||$1||'@example.test','USER' FROM generate_series(1,23) g RETURNING id`,
      [tag],
    );
    try {
      let n = 0;
      for (const u of bulk.rows)
        await pool.query(
          `INSERT INTO place_review(layer_item_id,user_id,scope_kind,layer_id,stars,body,status,created_at)
           VALUES($1,$2,'layer',$3,5,'m','approved',timestamptz '2026-01-01 00:00:00.100000+00' + ($4::int * interval '1 microsecond'))`,
          [item, u.id, layerId, n++],
        );
      const seen = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await listItemReviews(layerId, item, alice, cursor);
        for (const r of page!.reviews) seen.add(r.id);
        cursor = page!.nextCursor ?? undefined;
      } while (cursor);
      expect(seen.size).toBe(23);
    } finally {
      await pool.query("DELETE FROM place_review WHERE layer_item_id=$1", [
        item,
      ]);
      await pool.query('DELETE FROM "user" WHERE id=ANY($1::uuid[])', [
        bulk.rows.map((r) => r.id),
      ]);
    }
  });
});
