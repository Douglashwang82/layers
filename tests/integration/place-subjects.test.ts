import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { pool } from "../../packages/database/src";
import {
  resolvePlaceSubject,
  savePlaceSubject,
  unsavePlaceSubject,
} from "../../apps/web/src/features/place-subjects/service";
import {
  getSubjectDetail,
  lookupSubject,
} from "../../apps/web/src/features/place-subjects/repository";
import { flags } from "../../apps/web/src/lib/config";
import type { Actor } from "../../packages/shared/src";
const alice: Actor = { id: crypto.randomUUID(), role: "USER" },
  bob: Actor = { id: crypto.randomUUID(), role: "USER" },
  carol: Actor = { id: crypto.randomUUID(), role: "USER" },
  moderator: Actor = { id: crypto.randomUUID(), role: "MODERATOR" };
const houston = "00000000-0000-4000-8000-000000001001";
const demoPlace = "00000000-0000-4000-8000-000000005000";
const hiddenPlace = crypto.randomUUID();
// Synthetic provider IDs: no live key or provider call is involved anywhere here.
const googleId = `test-${crypto.randomUUID()}`;
const layerIds: string[] = [];
const createdSubjects = new Set<string>();
async function orphanCount() {
  const result = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM place_subject s WHERE s.catalog_place_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM place_provider_reference r WHERE r.subject_id=s.id)`,
  );
  return result.rows[0].count;
}
async function createLayer(
  owner: Actor,
  audience: "private" | "public",
  reviewStatus: "unsubmitted" | "approved",
) {
  const id = crypto.randomUUID();
  layerIds.push(id);
  await pool.query(
    `INSERT INTO layer(id,slug,title,city_id,owner_kind,owner_user_id,audience,lifecycle,review_status)
     VALUES($1,$2,'Subject test',$3,'user',$4,$5,'active',$6)`,
    [
      id,
      `subject-test-${id.slice(0, 8)}`,
      houston,
      owner.id,
      audience,
      reviewStatus,
    ],
  );
  return id;
}
beforeAll(async () => {
  for (const actor of [alice, bob, carol, moderator])
    await pool.query(
      'INSERT INTO "user"(id,name,email,role) VALUES($1,$2,$3,$4)',
      [actor.id, "Subject Test", `${actor.id}@example.test`, actor.role],
    );
  await pool.query(
    `INSERT INTO place(id,slug,name,image,category,city_id,neighborhood,address,latitude,longitude,status)
     VALUES($1,$2,'Hidden test place','https://example.test/x.png','Other',$3,'Test','1 Test St',29.7,-95.4,'hidden')`,
    [hiddenPlace, `subject-hidden-${hiddenPlace.slice(0, 8)}`, houston],
  );
  flags.googlePlacesDiscovery = true;
  flags.externalPlaceCollections = true;
});
afterAll(async () => {
  const subjects = [...createdSubjects];
  await pool.query("DELETE FROM layer WHERE id=ANY($1::uuid[])", [layerIds]);
  await pool.query(
    "DELETE FROM saved_place_subject WHERE subject_id=ANY($1::uuid[])",
    [subjects],
  );
  await pool.query(
    "DELETE FROM place_provider_reference WHERE subject_id=ANY($1::uuid[])",
    [subjects],
  );
  await pool.query("DELETE FROM place_subject WHERE id=ANY($1::uuid[])", [
    subjects,
  ]);
  await pool.query("DELETE FROM place WHERE id=$1", [hiddenPlace]);
  await pool.query('DELETE FROM "user" WHERE id=ANY($1::uuid[])', [
    [alice.id, bob.id, carol.id, moderator.id],
  ]);
  await pool.end();
});
describe("place subject identity and resolution", () => {
  let subjectId: string;
  let aliceGrant: string;
  it("resolves one provider reference under concurrency with no orphan subject", async () => {
    const orphansBefore = await orphanCount();
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        resolvePlaceSubject(alice, {
          provider: "google",
          providerPlaceId: googleId,
        }),
      ),
    );
    subjectId = results[0].subjectId;
    createdSubjects.add(subjectId);
    expect(new Set(results.map((r) => r.subjectId)).size).toBe(1);
    expect(results[0]).toMatchObject({
      canonicalKey: `subject:${subjectId}`,
      cityReviewStatus: "unreviewed",
    });
    const refs = await pool.query(
      "SELECT subject_id FROM place_provider_reference WHERE provider='google' AND provider_place_id=$1",
      [googleId],
    );
    expect(refs.rows).toEqual([{ subject_id: subjectId }]);
    expect(await orphanCount()).toBe(orphansBefore);
    aliceGrant = results[0].selectionGrant;
  });
  it("stores no provider display data", async () => {
    const columns = await pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name IN ('place_subject','place_provider_reference')",
    );
    const names = columns.rows.map((r) => r.column_name);
    for (const forbidden of [
      "name",
      "address",
      "latitude",
      "longitude",
      "rating",
      "photo",
    ])
      expect(names).not.toContain(forbidden);
  });
  it("refuses provider resolution while discovery is disabled", async () => {
    flags.googlePlacesDiscovery = false;
    try {
      await expect(
        resolvePlaceSubject(alice, {
          provider: "google",
          providerPlaceId: googleId,
        }),
      ).rejects.toMatchObject({ status: 404, code: "DISABLED" });
    } finally {
      flags.googlePlacesDiscovery = true;
    }
  });
  it("resolving alone grants no visibility, and lookup never reveals private existence", async () => {
    expect(await lookupSubject("google", googleId, alice)).toEqual({
      subjectId: null,
    });
    expect(await lookupSubject("google", googleId, null)).toEqual({
      subjectId: null,
    });
    expect(await getSubjectDetail(subjectId, alice)).toBeNull();
    expect(
      await lookupSubject("google", `test-${crypto.randomUUID()}`, alice),
    ).toEqual({ subjectId: null });
  });
  it("lets the resolving member save with their grant, keeping the save private", async () => {
    await expect(savePlaceSubject(alice, subjectId, {})).rejects.toMatchObject({
      status: 404,
    });
    const saved = await savePlaceSubject(alice, subjectId, {
      selectionGrant: aliceGrant,
    });
    expect(saved).toEqual({
      saved: true,
      subjectId,
      canonicalKey: `subject:${subjectId}`,
    });
    // Idempotent.
    await savePlaceSubject(alice, subjectId, {});
    expect(await lookupSubject("google", googleId, alice)).toMatchObject({
      subjectId,
    });
    expect(await getSubjectDetail(subjectId, alice)).toMatchObject({
      subjectId,
      saved: true,
      href: `/place-subjects/${subjectId}`,
      city: null,
      providerReference: { provider: "google", providerPlaceId: googleId },
    });
    expect(await lookupSubject("google", googleId, bob)).toEqual({
      subjectId: null,
    });
    expect(await lookupSubject("google", googleId, null)).toEqual({
      subjectId: null,
    });
    expect(await getSubjectDetail(subjectId, bob)).toBeNull();
  });
  it("lets a second member select and save the same business without learning about the first", async () => {
    const forBob = await resolvePlaceSubject(bob, {
      provider: "google",
      providerPlaceId: googleId,
    });
    expect(forBob.subjectId).toBe(subjectId);
    expect(Object.keys(forBob).sort()).toEqual([
      "canonicalKey",
      "cityReviewStatus",
      "selectionGrant",
      "subjectId",
    ]);
    // Another member's grant or a forged one is rejected.
    for (const selectionGrant of [
      aliceGrant,
      "forged.grant",
      forBob.selectionGrant + "x",
    ])
      await expect(
        savePlaceSubject(bob, subjectId, { selectionGrant }),
      ).rejects.toMatchObject({ status: 404 });
    await expect(
      savePlaceSubject(carol, subjectId, {
        selectionGrant: forBob.selectionGrant,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await savePlaceSubject(bob, subjectId, {
      selectionGrant: forBob.selectionGrant,
    });
    const detail = await getSubjectDetail(subjectId, bob);
    expect(detail).toMatchObject({ saved: true });
    expect(JSON.stringify(detail)).not.toContain(alice.id);
    expect(await getSubjectDetail(subjectId, carol)).toBeNull();
  });
  it("gates new external saves on the collections flag but always allows unsave", async () => {
    const forCarol = await resolvePlaceSubject(carol, {
      provider: "google",
      providerPlaceId: googleId,
    });
    flags.externalPlaceCollections = false;
    try {
      await expect(
        savePlaceSubject(carol, subjectId, {
          selectionGrant: forCarol.selectionGrant,
        }),
      ).rejects.toMatchObject({ code: "DISABLED" });
      expect(await unsavePlaceSubject(bob, subjectId)).toEqual({
        saved: false,
        subjectId,
      });
    } finally {
      flags.externalPlaceCollections = true;
    }
    expect(await getSubjectDetail(subjectId, bob)).toBeNull();
    // Unsave answers the same for something never saved.
    expect(await unsavePlaceSubject(carol, crypto.randomUUID())).toMatchObject({
      saved: false,
    });
  });
  it("shows subjects through authorized layer membership only", async () => {
    const privateLayer = await createLayer(carol, "private", "unsubmitted");
    await pool.query(
      "INSERT INTO layer_item(layer_id,subject_id,position) VALUES($1,$2,0)",
      [privateLayer, subjectId],
    );
    expect(await getSubjectDetail(subjectId, carol)).toMatchObject({
      subjectId,
      saved: false,
    });
    expect(await getSubjectDetail(subjectId, bob)).toBeNull();
    const publicLayer = await createLayer(carol, "public", "approved");
    await pool.query(
      "INSERT INTO layer_item(layer_id,subject_id,position) VALUES($1,$2,0)",
      [publicLayer, subjectId],
    );
    // A public layer does not publish an external subject whose city is unreviewed.
    expect(await getSubjectDetail(subjectId, null)).toBeNull();
    await pool.query(
      "UPDATE place_subject SET city_id=$2,city_review_status='approved',city_reviewed_by=$3,city_reviewed_at=now() WHERE id=$1",
      [subjectId, houston, moderator.id],
    );
    expect(await getSubjectDetail(subjectId, null)).toMatchObject({
      subjectId,
      city: { slug: "houston" },
    });
    expect(await lookupSubject("google", googleId, null)).toMatchObject({
      subjectId,
      cityReviewStatus: "approved",
    });
  });
  it("enforces one subject per layer and exactly one target per layer item", async () => {
    await expect(
      pool.query(
        "INSERT INTO layer_item(layer_id,subject_id,position) VALUES($1,$2,1)",
        [layerIds[0], subjectId],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      pool.query(
        "INSERT INTO layer_item(layer_id,subject_id,place_id,position) VALUES($1,$2,$3,1)",
        [layerIds[0], subjectId, demoPlace],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("keeps a hidden subject blocked through every path except moderation and unsave", async () => {
    await pool.query("UPDATE place_subject SET status='hidden' WHERE id=$1", [
      subjectId,
    ]);
    await expect(
      resolvePlaceSubject(alice, {
        provider: "google",
        providerPlaceId: googleId,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(savePlaceSubject(alice, subjectId, {})).rejects.toMatchObject({
      status: 404,
    });
    expect(await getSubjectDetail(subjectId, alice)).toBeNull();
    expect(await getSubjectDetail(subjectId, null)).toBeNull();
    expect(await lookupSubject("google", googleId, alice)).toEqual({
      subjectId: null,
    });
    expect(await getSubjectDetail(subjectId, moderator)).toMatchObject({
      status: "hidden",
    });
    await unsavePlaceSubject(alice, subjectId);
    const remaining = await pool.query(
      "SELECT 1 FROM saved_place_subject WHERE subject_id=$1 AND user_id=$2",
      [subjectId, alice.id],
    );
    expect(remaining.rowCount).toBe(0);
  });
  it("enforces provider reference uniqueness and bounds in the database", async () => {
    await expect(
      pool.query(
        "INSERT INTO place_provider_reference(subject_id,provider,provider_place_id) VALUES($1,'google',$2)",
        [subjectId, googleId],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      pool.query(
        "INSERT INTO place_provider_reference(subject_id,provider,provider_place_id) VALUES($1,'yelp','x')",
        [subjectId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      pool.query(
        "INSERT INTO place_subject(city_review_status) VALUES('approved')",
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
describe("catalog place subjects", () => {
  it("lazily wraps an approved catalog place once, inheriting its city", async () => {
    const [first, second] = await Promise.all([
      resolvePlaceSubject(alice, { catalogPlaceId: demoPlace }),
      resolvePlaceSubject(bob, { catalogPlaceId: demoPlace }),
    ]);
    createdSubjects.add(first.subjectId);
    expect(second.subjectId).toBe(first.subjectId);
    expect(first).toMatchObject({
      canonicalKey: `place:${demoPlace}`,
      cityReviewStatus: "approved",
    });
    const detail = await getSubjectDetail(first.subjectId, null);
    expect(detail).toMatchObject({
      catalogPlaceId: demoPlace,
      isDemo: true,
      city: { slug: "houston" },
      providerReference: null,
      saved: false,
    });
    expect(detail?.href).toMatch(/^\/places\/demo-/);
  });
  it("saves a catalog-linked subject into the canonical saved_place row", async () => {
    const { subjectId } = await resolvePlaceSubject(alice, {
      catalogPlaceId: demoPlace,
    });
    // Catalog saves are not gated by the external collections flag.
    flags.externalPlaceCollections = false;
    try {
      await savePlaceSubject(alice, subjectId, {});
    } finally {
      flags.externalPlaceCollections = true;
    }
    const saved = await pool.query(
      "SELECT 1 FROM saved_place WHERE user_id=$1 AND place_id=$2",
      [alice.id, demoPlace],
    );
    expect(saved.rowCount).toBe(1);
    const external = await pool.query(
      "SELECT 1 FROM saved_place_subject WHERE subject_id=$1",
      [subjectId],
    );
    expect(external.rowCount).toBe(0);
    expect(await getSubjectDetail(subjectId, alice)).toMatchObject({
      saved: true,
    });
    await unsavePlaceSubject(alice, subjectId);
    expect(await getSubjectDetail(subjectId, alice)).toMatchObject({
      saved: false,
    });
  });
  it("refuses hidden, missing, and unapproved catalog places", async () => {
    await expect(
      resolvePlaceSubject(alice, { catalogPlaceId: hiddenPlace }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      resolvePlaceSubject(alice, { catalogPlaceId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      resolvePlaceSubject(null, { catalogPlaceId: demoPlace }),
    ).rejects.toMatchObject({
      status: 401,
    });
  });
});
