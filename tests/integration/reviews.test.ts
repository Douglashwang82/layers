import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { pool } from "../../packages/database/src";
import {
  resolvePlaceSubject,
  savePlaceSubject,
} from "../../apps/web/src/features/place-subjects/service";
import { getSubjectDetail } from "../../apps/web/src/features/place-subjects/repository";
import {
  listCityReviewQueue,
  patchSubject,
} from "../../apps/web/src/features/place-subjects/admin";
import {
  decideReview,
  deleteReview,
  writeReview,
} from "../../apps/web/src/features/reviews/service";
import {
  listReviewScopes,
  listScopeReviews,
} from "../../apps/web/src/features/reviews/repository";
import { createGroup } from "../../apps/web/src/features/groups/service";
import {
  createLayer,
  publishLayer,
} from "../../apps/web/src/features/layers/service";
import { moderate } from "../../apps/web/src/features/community/service";
import { flags } from "../../apps/web/src/lib/config";
import type { Actor, ReviewScope } from "../../packages/shared/src";
const alice: Actor = { id: crypto.randomUUID(), role: "USER" },
  bob: Actor = { id: crypto.randomUUID(), role: "USER" },
  carol: Actor = { id: crypto.randomUUID(), role: "USER" },
  moderator: Actor = { id: crypto.randomUUID(), role: "MODERATOR" },
  admin: Actor = { id: crypto.randomUUID(), role: "ADMIN" };
const users = [alice, bob, carol, moderator, admin];
const houston = "00000000-0000-4000-8000-000000001001";
const demoPlace = "00000000-0000-4000-8000-000000005000";
const catalogPlace = crypto.randomUUID();
const googleId = `test-${crypto.randomUUID()}`;
const otherGoogleId = `test-${crypto.randomUUID()}`;
const subjects = new Set<string>();
let subjectId: string;
let groupScope: ReviewScope;
let layerScope: ReviewScope;
let layerId: string;
let groupId: string;
const scopeKey = (s: ReviewScope) => `${s.kind}:${s.id}`;
beforeAll(async () => {
  for (const actor of users)
    await pool.query(
      'INSERT INTO "user"(id,name,email,role) VALUES($1,$2,$3,$4)',
      [
        actor.id,
        `Reviewer ${actor.role}`,
        `${actor.id}@example.test`,
        actor.role,
      ],
    );
  await pool.query(
    `INSERT INTO place(id,slug,name,image,category,city_id,neighborhood,address,latitude,longitude,status)
     VALUES($1,$2,'Review link target','https://example.test/x.png','Taiwanese',$3,'Test','1 Test St',29.7,-95.4,'approved')`,
    [catalogPlace, `review-link-${catalogPlace.slice(0, 8)}`, houston],
  );
  flags.googlePlacesDiscovery = true;
  flags.externalPlaceCollections = true;
  flags.placeReviewWrites = true;
  const resolved = await resolvePlaceSubject(alice, {
    provider: "google",
    providerPlaceId: googleId,
  });
  subjectId = resolved.subjectId;
  subjects.add(subjectId);
  await savePlaceSubject(alice, subjectId, {
    selectionGrant: resolved.selectionGrant,
  });
  const group = await createGroup(alice, {
    name: "Review Circle",
    city: "houston",
  });
  groupId = group.group.id;
  await pool.query(
    "INSERT INTO group_member(group_id,user_id,role) VALUES($1,$2,'viewer')",
    [groupId, bob.id],
  );
  groupScope = { kind: "group", id: groupId };
  const layer = await createLayer(alice, {
    title: "Review test layer",
    city: "houston",
  });
  layerId = layer.layer.id;
  layerScope = { kind: "layer", id: layerId };
});
afterAll(async () => {
  const ids = [...subjects];
  await pool.query(
    "DELETE FROM place_review WHERE subject_id=ANY($1::uuid[])",
    [ids],
  );
  await pool.query("DELETE FROM submission WHERE user_id=ANY($1::uuid[])", [
    users.map((u) => u.id),
  ]);
  await pool.query(
    "DELETE FROM moderation_action WHERE actor_id=ANY($1::uuid[])",
    [users.map((u) => u.id)],
  );
  await pool.query("DELETE FROM layer WHERE id=$1", [layerId]);
  await pool.query('DELETE FROM "group" WHERE id=$1', [groupId]);
  await pool.query(
    "DELETE FROM saved_place_subject WHERE subject_id=ANY($1::uuid[])",
    [ids],
  );
  await pool.query(
    "DELETE FROM place_provider_reference WHERE subject_id=ANY($1::uuid[])",
    [ids],
  );
  await pool.query("DELETE FROM place_subject WHERE id=ANY($1::uuid[])", [ids]);
  await pool.query("DELETE FROM place WHERE id=$1", [catalogPlace]);
  await pool.query('DELETE FROM "user" WHERE id=ANY($1::uuid[])', [
    users.map((u) => u.id),
  ]);
  await pool.end();
});
describe("group-scoped reviews", () => {
  let bobRevision: number;
  it("refuses writes while the review flag is off", async () => {
    flags.placeReviewWrites = false;
    try {
      await expect(
        writeReview(alice, subjectId, {
          scope: scopeKey(groupScope),
          stars: 5,
          body: "",
          expectedRevision: null,
        }),
      ).rejects.toMatchObject({ code: "DISABLED" });
    } finally {
      flags.placeReviewWrites = true;
    }
  });
  it("publishes a member's group review to the group immediately", async () => {
    const { selectionGrant } = await resolvePlaceSubject(bob, {
      provider: "google",
      providerPlaceId: googleId,
    });
    const own = await writeReview(bob, subjectId, {
      scope: scopeKey(groupScope),
      stars: 4,
      body: "Great beef noodle soup",
      expectedRevision: null,
      selectionGrant,
    });
    expect(own).toMatchObject({ status: "approved", revision: 1, stars: 4 });
    bobRevision = own.revision;
    await writeReview(alice, subjectId, {
      scope: scopeKey(groupScope),
      stars: 5,
      body: "",
      expectedRevision: null,
    });
    const list = await listScopeReviews(subjectId, groupScope, alice, 1);
    expect(list).toMatchObject({
      totalReviews: 2,
      ratedCount: 2,
      averageStars: 4.5,
      ownReview: { stars: 5, status: "approved" },
    });
    expect(list!.items.map((i) => i.body)).toContain("Great beef noodle soup");
    // Group reviews make the subject visible to members, but never to outsiders.
    expect(await getSubjectDetail(subjectId, bob)).not.toBeNull();
    expect(await listScopeReviews(subjectId, groupScope, carol, 1)).toBeNull();
    expect(await listScopeReviews(subjectId, groupScope, null, 1)).toBeNull();
    await expect(
      writeReview(carol, subjectId, {
        scope: scopeKey(groupScope),
        stars: 1,
        body: "",
        expectedRevision: null,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("keeps one review per member and scope with revision checks", async () => {
    await expect(
      writeReview(bob, subjectId, {
        scope: scopeKey(groupScope),
        stars: 3,
        body: "",
        expectedRevision: null,
      }),
    ).rejects.toMatchObject({ status: 409, code: "REVISION_CONFLICT" });
    const edited = await writeReview(bob, subjectId, {
      scope: scopeKey(groupScope),
      stars: null,
      body: "Comment only now",
      expectedRevision: bobRevision,
    });
    expect(edited).toMatchObject({
      revision: 2,
      stars: null,
      status: "approved",
    });
    await expect(
      writeReview(bob, subjectId, {
        scope: scopeKey(groupScope),
        stars: 2,
        body: "",
        expectedRevision: bobRevision,
      }),
    ).rejects.toMatchObject({ status: 409 });
    bobRevision = edited.revision;
    const list = await listScopeReviews(subjectId, groupScope, bob, 1);
    // Comment-only reviews count as reviews but not ratings.
    expect(list).toMatchObject({
      totalReviews: 2,
      ratedCount: 1,
      averageStars: 5,
    });
    const history = await pool.query(
      "SELECT revision,change_kind FROM place_review_revision WHERE review_id=$1 ORDER BY revision",
      [edited.id],
    );
    expect(history.rows).toEqual([
      { revision: 1, change_kind: "created" },
      { revision: 2, change_kind: "edited" },
    ]);
  });
  it("rejects empty reviews and out-of-range stars", async () => {
    for (const body of [
      {
        scope: scopeKey(groupScope),
        stars: null,
        body: "   ",
        expectedRevision: null,
      },
      {
        scope: scopeKey(groupScope),
        stars: 0,
        body: "x",
        expectedRevision: null,
      },
      {
        scope: scopeKey(groupScope),
        stars: 4.5,
        body: "x",
        expectedRevision: null,
      },
      {
        scope: `layer:${crypto.randomUUID()}x`,
        stars: 3,
        body: "",
        expectedRevision: null,
      },
    ])
      await expect(writeReview(bob, subjectId, body)).rejects.toMatchObject({
        name: "ZodError",
      });
  });
  it("keeps a hidden review hidden when its author edits it", async () => {
    const hidden = await decideReview(
      moderator,
      (await ownReviewId(bob, groupScope))!,
      {
        action: "hidden",
        expectedRevision: bobRevision,
        reason: "Reported",
      },
    );
    expect(hidden.status).toBe("hidden");
    const edited = await writeReview(bob, subjectId, {
      scope: scopeKey(groupScope),
      stars: 3,
      body: "Edited after hiding",
      expectedRevision: hidden.revision,
    });
    expect(edited.status).toBe("hidden");
    const list = await listScopeReviews(subjectId, groupScope, alice, 1);
    expect(list!.items.map((i) => i.body)).not.toContain("Edited after hiding");
    bobRevision = edited.revision;
  });
  it("lets authors delete idempotently but never revive a moderator deletion", async () => {
    const own = (await listScopeReviews(subjectId, groupScope, alice, 1))!
      .ownReview!;
    const deleted = await deleteReview(alice, subjectId, {
      scope: scopeKey(groupScope),
      expectedRevision: own.revision,
    });
    expect(deleted.status).toBe("deleted");
    const again = await deleteReview(alice, subjectId, {
      scope: scopeKey(groupScope),
      expectedRevision: own.revision,
    });
    expect(again.revision).toBe(deleted.revision);
    const back = await writeReview(alice, subjectId, {
      scope: scopeKey(groupScope),
      stars: 4,
      body: "",
      expectedRevision: deleted.revision,
    });
    expect(back.status).toBe("approved");
    await expect(
      decideReview(moderator, back.id, {
        action: "deleted",
        expectedRevision: back.revision,
        reason: "x",
      }),
    ).rejects.toMatchObject({ status: 403 });
    const removed = await decideReview(admin, back.id, {
      action: "deleted",
      expectedRevision: back.revision,
      reason: "Abuse",
    });
    await expect(
      writeReview(alice, subjectId, {
        scope: scopeKey(groupScope),
        stars: 5,
        body: "",
        expectedRevision: removed.revision,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
async function ownReviewId(actor: Actor, scope: ReviewScope) {
  return (await listScopeReviews(subjectId, scope, actor, 1))?.ownReview?.id;
}
describe("layer-scoped reviews and publication", () => {
  let aliceReview: { id: string; revision: number };
  it("requires the place to be in the layer and the layer to be viewable", async () => {
    await expect(
      writeReview(alice, subjectId, {
        scope: scopeKey(layerScope),
        stars: 5,
        body: "",
        expectedRevision: null,
      }),
    ).rejects.toMatchObject({ code: "NOT_IN_LAYER" });
    await pool.query(
      "INSERT INTO layer_item(layer_id,subject_id,position) VALUES($1,$2,0)",
      [layerId, subjectId],
    );
    const own = await writeReview(alice, subjectId, {
      scope: scopeKey(layerScope),
      stars: 5,
      body: "Private layer note",
      expectedRevision: null,
    });
    // Private layer: visible to its audience immediately.
    expect(own.status).toBe("approved");
    aliceReview = own;
    await expect(
      writeReview(bob, subjectId, {
        scope: scopeKey(layerScope),
        stars: 1,
        body: "",
        expectedRevision: null,
      }),
    ).rejects.toMatchObject({ status: 404 });
    // Scopes never merge: the layer average ignores group reviews.
    expect(
      await listScopeReviews(subjectId, layerScope, alice, 1),
    ).toMatchObject({
      totalReviews: 1,
      averageStars: 5,
    });
    const scopes = await listReviewScopes(subjectId, alice);
    expect(scopes!.scopes.map((s) => s.scope).sort()).toEqual(
      [scopeKey(groupScope), scopeKey(layerScope)].sort(),
    );
  });
  it("sends scope-approved reviews back to moderation when the layer is published", async () => {
    await publishLayer(alice, layerId, true);
    const own = (await listScopeReviews(subjectId, layerScope, alice, 1))!;
    expect(own.ownReview).toMatchObject({
      status: "pending",
      revision: aliceReview.revision + 1,
    });
    expect(own.totalReviews).toBe(0);
    const submission = await pool.query(
      "SELECT entity_revision FROM submission WHERE entity_type='reviews' AND entity_id=$1 AND status='pending'",
      [aliceReview.id],
    );
    expect(submission.rows).toEqual([
      { entity_revision: aliceReview.revision + 1 },
    ]);
    // A decision against the old snapshot is refused.
    await expect(
      decideReview(moderator, aliceReview.id, {
        action: "approved",
        expectedRevision: aliceReview.revision,
        reason: "ok",
      }),
    ).rejects.toMatchObject({ status: 409 });
    // The generic moderation route requires a revision for reviews.
    await expect(
      moderate(moderator, {
        entityType: "reviews",
        entityId: aliceReview.id,
        action: "approved",
        reason: "ok",
      }),
    ).rejects.toMatchObject({ code: "REVISION_REQUIRED" });
    const approved = await moderate(moderator, {
      entityType: "reviews",
      entityId: aliceReview.id,
      action: "approved",
      reason: "ok",
      expectedRevision: aliceReview.revision + 1,
    });
    expect(approved).toMatchObject({ status: "approved" });
    const resolved = await pool.query(
      "SELECT status FROM submission WHERE entity_type='reviews' AND entity_id=$1",
      [aliceReview.id],
    );
    expect(resolved.rows).toEqual([{ status: "approved" }]);
  });
  it("shows public-layer reviews to everyone only after layer approval, city review and moderation", async () => {
    await moderate(moderator, {
      entityType: "layers",
      entityId: layerId,
      action: "approved",
      reason: "ok",
    });
    // Unreviewed external city keeps the subject out of the public layer.
    expect(await listScopeReviews(subjectId, layerScope, carol, 1)).toBeNull();
    const queue = await listCityReviewQueue(moderator, {});
    const entry = queue.items.find((i) => i.subjectId === subjectId)!;
    expect(entry).toMatchObject({ providerPlaceId: googleId, city: null });
    expect(entry.usage.layers).toBe(1);
    await expect(listCityReviewQueue(carol, {})).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      patchSubject(moderator, subjectId, {
        expectedRevision: entry.revision + 1,
        reason: "x",
        cityId: houston,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await patchSubject(moderator, subjectId, {
      expectedRevision: entry.revision,
      reason: "Checked address",
      cityId: houston,
    });
    const publicList = await listScopeReviews(subjectId, layerScope, carol, 1);
    expect(publicList).toMatchObject({ totalReviews: 1, averageStars: 5 });
    // A public-layer review from a non-member waits for a moderator.
    const carols = await writeReview(carol, subjectId, {
      scope: scopeKey(layerScope),
      stars: 1,
      body: "Too salty",
      expectedRevision: null,
    });
    expect(carols.status).toBe("pending");
    expect(
      await listScopeReviews(subjectId, layerScope, null, 1),
    ).toMatchObject({ totalReviews: 1, ownReview: null });
    expect(
      (await listScopeReviews(subjectId, layerScope, carol, 1))!.ownReview,
    ).toMatchObject({ status: "pending" });
    // A rejected review goes back to a moderator when edited, whatever the scope.
    const rejected = await decideReview(moderator, carols.id, {
      action: "rejected",
      expectedRevision: carols.revision,
      reason: "Off-topic",
    });
    const reedited = await writeReview(carol, subjectId, {
      scope: scopeKey(layerScope),
      stars: 2,
      body: "Revised",
      expectedRevision: rejected.revision,
    });
    expect(reedited.status).toBe("pending");
  });
});
describe("catalog linking", () => {
  it("rejects demo places and merges with existing catalog subjects", async () => {
    const detail = await pool.query<{ revision: number }>(
      "SELECT revision FROM place_subject WHERE id=$1",
      [subjectId],
    );
    const revision = detail.rows[0].revision;
    await expect(
      patchSubject(moderator, subjectId, {
        expectedRevision: revision,
        reason: "x",
        linkCatalogPlaceId: demoPlace,
      }),
    ).rejects.toMatchObject({ code: "INVALID_LINK" });
    const other = await resolvePlaceSubject(alice, {
      catalogPlaceId: catalogPlace,
    });
    subjects.add(other.subjectId);
    await expect(
      patchSubject(moderator, subjectId, {
        expectedRevision: revision,
        reason: "x",
        linkCatalogPlaceId: catalogPlace,
      }),
    ).rejects.toMatchObject({ code: "SUBJECT_MERGE_REQUIRED" });
    await pool.query("DELETE FROM place_subject WHERE id=$1", [
      other.subjectId,
    ]);
    subjects.delete(other.subjectId);
  });
  it("links an external subject and canonicalizes saves and layer items", async () => {
    const revision = (
      await pool.query<{ revision: number }>(
        "SELECT revision FROM place_subject WHERE id=$1",
        [subjectId],
      )
    ).rows[0].revision;
    const linked = await patchSubject(moderator, subjectId, {
      expectedRevision: revision,
      reason: "Same business",
      linkCatalogPlaceId: catalogPlace,
    });
    expect(linked).toMatchObject({
      canonicalKey: `place:${catalogPlace}`,
      cityReviewStatus: "approved",
    });
    const saves = await pool.query(
      "SELECT 1 FROM saved_place WHERE user_id=$1 AND place_id=$2",
      [alice.id, catalogPlace],
    );
    expect(saves.rowCount).toBe(1);
    const external = await pool.query(
      "SELECT 1 FROM saved_place_subject WHERE subject_id=$1",
      [subjectId],
    );
    expect(external.rowCount).toBe(0);
    const items = await pool.query(
      "SELECT place_id,subject_id FROM layer_item WHERE layer_id=$1",
      [layerId],
    );
    expect(items.rows).toEqual([{ place_id: catalogPlace, subject_id: null }]);
    // Reviews stay attached to the subject and remain readable in their scope.
    expect(
      await listScopeReviews(subjectId, layerScope, carol, 1),
    ).toMatchObject({ totalReviews: 1 });
    const audit = await pool.query(
      "SELECT action FROM moderation_action WHERE entity_type='place_subjects' AND entity_id=$1 ORDER BY created_at",
      [subjectId],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      "city_approved",
      "catalog_linked",
    ]);
    // The old provider ID still reaches the same, now-canonical subject.
    const again = await resolvePlaceSubject(bob, {
      provider: "google",
      providerPlaceId: googleId,
    });
    expect(again).toMatchObject({
      subjectId,
      canonicalKey: `place:${catalogPlace}`,
    });
  });
  it("replaces a provider ID only through an audited operation that keeps the alias", async () => {
    const revision = (
      await pool.query<{ revision: number }>(
        "SELECT revision FROM place_subject WHERE id=$1",
        [subjectId],
      )
    ).rows[0].revision;
    await patchSubject(moderator, subjectId, {
      expectedRevision: revision,
      reason: "Google ID changed",
      replaceProviderPlaceId: otherGoogleId,
    });
    const refs = await pool.query(
      "SELECT provider_place_id,state FROM place_provider_reference WHERE subject_id=$1 ORDER BY state",
      [subjectId],
    );
    expect(refs.rows).toEqual([
      { provider_place_id: otherGoogleId, state: "current" },
      { provider_place_id: googleId, state: "superseded" },
    ]);
    expect(
      (
        await resolvePlaceSubject(bob, {
          provider: "google",
          providerPlaceId: googleId,
        })
      ).subjectId,
    ).toBe(subjectId);
  });
});
