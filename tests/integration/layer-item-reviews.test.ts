import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { pool } from "../../packages/database/src";
import { resolvePlaceSubject } from "../../apps/web/src/features/place-subjects/service";
import { createGroup } from "../../apps/web/src/features/groups/service";
import { createLayer } from "../../apps/web/src/features/layers/service";
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
