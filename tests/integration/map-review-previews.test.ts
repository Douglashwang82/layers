import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { pool } from "../../packages/database/src";
import { resolvePlaceSubject } from "../../apps/web/src/features/place-subjects/service";
import { createGroup } from "../../apps/web/src/features/groups/service";
import { createLayer } from "../../apps/web/src/features/layers/service";
import { writeItemReview } from "../../apps/web/src/features/reviews/service";
import { listMapReviewPreviews } from "../../apps/web/src/features/reviews/map-previews";
import { flags } from "../../apps/web/src/lib/config";
import type { Actor } from "../../packages/shared/src";

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
const state = (layers: string[]) => ({
  city: "houston",
  layers,
  date: "upcoming" as const,
  q: "",
  scope: "layers" as const,
  view: "map" as const,
  page: 1,
});
const placeId = crypto.randomUUID();
const googleId = `test-${crypto.randomUUID()}`;
let groupId: string;
let shared: { id: string; slug: string };
let open: { id: string; slug: string };
let sharedItem: string;
let subjectId: string;
let subjectItem: string;

beforeAll(async () => {
  for (const [i, u] of users.entries())
    await pool.query(
      'INSERT INTO "user"(id,name,email,role,image) VALUES($1,$2,$3,$4,$5)',
      [
        u.id,
        `Preview reviewer ${i}`,
        `${u.id}@example.test`,
        u.role,
        i === 0 ? "https://example.test/a.png" : "javascript:alert(1)",
      ],
    );
  await pool.query(
    `INSERT INTO place(id,slug,name,image,category,city_id,neighborhood,address,latitude,longitude,status)
     VALUES($1,$2,'Preview place','https://example.test/x.png','Taiwanese',$3,'Test','1 Test St',29.7,-95.4,'approved')`,
    [placeId, `preview-${placeId.slice(0, 8)}`, city.id],
  );
  flags.placeReviewWrites = true;
  flags.googlePlacesDiscovery = true;
  flags.externalPlaceCollections = true;
  groupId = (
    await createGroup(alice, { name: "Preview Circle", city: "houston" })
  ).group.id;
  await pool.query(
    "INSERT INTO group_member(group_id,user_id,role) VALUES($1,$2,'viewer')",
    [groupId, bob.id],
  );
  shared = (
    await createLayer(alice, {
      title: "Preview shared layer",
      city: "houston",
      audience: "group",
      groupId,
    })
  ).layer;
  open = (
    await createLayer(alice, { title: "Preview public layer", city: "houston" })
  ).layer;
  await pool.query(
    "UPDATE layer SET audience='public',review_status='approved',lifecycle='active' WHERE id=$1",
    [open.id],
  );
  sharedItem = (
    await pool.query<{ id: string }>(
      "INSERT INTO layer_item(layer_id,place_id,position) VALUES($1,$2,0) RETURNING id",
      [shared.id, placeId],
    )
  ).rows[0].id;
  subjectId = (
    await resolvePlaceSubject(alice, {
      provider: "google",
      providerPlaceId: googleId,
    })
  ).subjectId;
  subjectItem = (
    await pool.query<{ id: string }>(
      "INSERT INTO layer_item(layer_id,subject_id,position) VALUES($1,$2,0) RETURNING id",
      [open.id, subjectId],
    )
  ).rows[0].id;
});

afterAll(async () => {
  const layers = [shared.id, open.id];
  await pool.query("DELETE FROM place_review WHERE layer_id=ANY($1::uuid[])", [
    layers,
  ]);
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
  await pool.query('DELETE FROM "user" WHERE id=ANY($1::uuid[])', [
    users.map((u) => u.id),
  ]);
  await pool.end();
});

describe("map review previews", () => {
  it("summarizes approved reviews for members and hides the layer from others", async () => {
    await writeItemReview(alice, shared.id, sharedItem, {
      stars: 4,
      body: "Great",
      expectedRevision: null,
    });
    await writeItemReview(bob, shared.id, sharedItem, {
      stars: 1,
      body: "  ",
      expectedRevision: null,
    });
    const key = `place:${placeId}`;
    const view = await listMapReviewPreviews(state([shared.slug]), city, bob);
    expect(view.previews[key]).toEqual({
      averageStars: 2.5,
      ratedCount: 2,
      commentCount: 1,
      reviewerCount: 2,
      reviewers: [
        // Newest first; an unsafe image URL is dropped.
        { name: "Preview reviewer 1", image: null },
        { name: "Preview reviewer 0", image: "https://example.test/a.png" },
      ],
    });
    expect(
      (await listMapReviewPreviews(state([shared.slug]), city, carol)).previews,
    ).toEqual({});
    expect(
      (await listMapReviewPreviews(state([shared.slug]), city, null)).previews,
    ).toEqual({});
  });

  it("omits items the map hides from the viewer", async () => {
    // An approved review of an external place not yet city-reviewed: only
    // the layer's owner sees that pin, so only the owner gets its preview.
    await pool.query(
      `INSERT INTO place_review(subject_id,user_id,scope_kind,layer_id,stars,body,status)
       VALUES($1,$2,'layer',$3,5,'Lovely','approved')`,
      [subjectId, carol.id, open.id],
    );
    const key = `subject:${subjectId}`;
    const owner = await listMapReviewPreviews(state([open.slug]), city, alice);
    expect(owner.previews[key]).toMatchObject({
      averageStars: 5,
      commentCount: 1,
      reviewerCount: 1,
    });
    const anon = await listMapReviewPreviews(state([open.slug]), city, null);
    expect(anon.previews[key]).toBeUndefined();
    await pool.query(
      "UPDATE place_subject SET city_review_status='approved',city_id=$2 WHERE id=$1",
      [subjectId, city.id],
    );
    const approved = await listMapReviewPreviews(
      state([open.slug]),
      city,
      null,
    );
    expect(approved.previews[key]).toMatchObject({ ratedCount: 1 });
    // A scheduled item is not on the map yet.
    await pool.query(
      "UPDATE layer_item SET valid_from=now()+interval '1 day' WHERE id=$1",
      [subjectItem],
    );
    const scheduled = await listMapReviewPreviews(
      state([open.slug]),
      city,
      null,
    );
    expect(scheduled.previews[key]).toBeUndefined();
  });
});
