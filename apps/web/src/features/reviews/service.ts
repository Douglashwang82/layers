import type { PoolClient } from "pg";
import {
  AppError,
  ownerWriteStatus,
  layerItemReviewDeleteInput,
  layerItemReviewInput,
  placeReviewDeleteInput,
  placeReviewInput,
  requireActor,
  requireModerator,
  reviewDecisionInput,
  type Actor,
  type ReviewScope,
  type ReviewStatus,
} from "@taiwanhub/shared";
import { flags } from "@/lib/config";
import {
  requireActionableSubject,
  transaction,
} from "@/features/place-subjects/service";
import {
  findSubjectById,
  isBlocked,
} from "@/features/place-subjects/repository";
import {
  findLayerItem,
  findOwnTargetReview,
  getScopeAccess,
  itemTarget,
  ownReviewView,
  stripScope,
  subjectInLayer,
  type ReviewRow,
  type ReviewTarget,
} from "./repository";
async function record(
  tx: PoolClient,
  userId: string,
  name: string,
  properties: Record<string, string | number | boolean>,
) {
  // Allowlisted, coarse properties only: never review text, stars per user or locations.
  await tx.query(
    "INSERT INTO analytics_event(user_id,name,properties) VALUES($1,$2,$3)",
    [userId, name, JSON.stringify(properties)],
  );
}
async function snapshot(
  tx: PoolClient,
  review: Pick<ReviewRow, "id" | "revision" | "stars" | "body" | "status">,
  actorId: string,
  changeKind: string,
  reason: string | null = null,
) {
  await tx.query(
    "INSERT INTO place_review_revision(review_id,revision,actor_id,change_kind,stars,body,status,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      review.id,
      review.revision,
      actorId,
      changeKind,
      review.stars,
      review.body,
      review.status,
      reason,
    ],
  );
}
/** Earlier pending moderation requests for older revisions no longer apply. */
async function supersedeSubmissions(tx: PoolClient, reviewId: string) {
  await tx.query(
    "UPDATE submission SET status='superseded',updated_at=now() WHERE entity_type='reviews' AND entity_id=$1 AND status='pending' AND entity_revision IS NOT NULL",
    [reviewId],
  );
}
async function queueSubmission(
  tx: PoolClient,
  userId: string,
  review: Pick<ReviewRow, "id" | "revision">,
) {
  await tx.query(
    "INSERT INTO submission(user_id,entity_type,entity_id,entity_revision) VALUES($1,'reviews',$2,$3)",
    [userId, review.id, review.revision],
  );
}
const conflict = () =>
  new AppError(
    409,
    "REVISION_CONFLICT",
    "This review changed since you loaded it. Reload to see the latest version.",
  );
/**
 * Lock order: subject, then the scope's layer row (so a concurrent publish is
 * serialized), then the review. Returns whether the scope needs moderation.
 */
async function lockScope(
  tx: PoolClient,
  actor: Actor,
  subject: { id: string; catalog_place_id: string | null },
  scope: ReviewScope,
) {
  const access = await getScopeAccess(scope, actor);
  if (!access)
    throw new AppError(404, "NOT_FOUND", "This layer or group is unavailable.");
  if (scope.kind === "group") return false;
  const layer = await tx.query<{ audience: string }>(
    "SELECT audience FROM layer WHERE id=$1 FOR SHARE",
    [scope.id],
  );
  if (!layer.rows[0])
    throw new AppError(404, "NOT_FOUND", "This layer or group is unavailable.");
  if (!(await subjectInLayer(tx, subject, scope.id)))
    throw new AppError(
      400,
      "NOT_IN_LAYER",
      "Add this place to the layer before reviewing it there.",
    );
  return layer.rows[0].audience === "public";
}
/**
 * Create or edit the actor's one review of a target in one scope. The caller
 * has authorized the actor and holds the target and scope locks; this locks the
 * review row, checks the revision, and writes content, history, the moderation
 * request and analytics together.
 */
async function upsertReview(
  tx: PoolClient,
  a: Actor,
  target: ReviewTarget,
  scope: ReviewScope,
  needsModeration: boolean,
  input: {
    stars: number | null;
    body: string;
    expectedRevision: number | null;
  },
) {
  const existing = await findOwnTargetReview(tx, target, a.id, scope, true);
  if ((existing?.revision ?? null) !== input.expectedRevision) throw conflict();
  const status = ownerWriteStatus(
    existing
      ? { status: existing.status, deletionSource: existing.deletion_source }
      : null,
    needsModeration,
  );
  if (!status)
    throw new AppError(
      403,
      "FORBIDDEN",
      "A moderator removed this review; it cannot be restored.",
    );
  let row: ReviewRow;
  if (!existing) {
    const inserted = await tx.query<ReviewRow>(
      `INSERT INTO place_review(subject_id,layer_item_id,user_id,scope_kind,layer_id,group_id,stars,body,status)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        "subjectId" in target ? target.subjectId : null,
        "layerItemId" in target ? target.layerItemId : null,
        a.id,
        scope.kind,
        scope.kind === "layer" ? scope.id : null,
        scope.kind === "group" ? scope.id : null,
        input.stars,
        input.body,
        status,
      ],
    );
    row = inserted.rows[0];
  } else {
    const updated = await tx.query<ReviewRow>(
      `UPDATE place_review SET stars=$2,body=$3,status=$4,deletion_source=NULL,moderated_by=NULL,moderated_at=NULL,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *`,
      [existing.id, input.stars, input.body, status],
    );
    row = updated.rows[0];
    await supersedeSubmissions(tx, row.id);
  }
  await snapshot(
    tx,
    row,
    a.id,
    !existing
      ? "created"
      : existing.status === "deleted"
        ? "resubmitted"
        : "edited",
  );
  if (status === "pending") await queueSubmission(tx, a.id, row);
  await record(
    tx,
    a.id,
    existing ? "place_review_edited" : "place_review_created",
    { scope: scope.kind, rated: input.stars !== null, status },
  );
  return ownReviewView(row)!;
}
/** Owner soft-delete. Repeating it on an already author-deleted review changes nothing. */
async function softDelete(
  tx: PoolClient,
  a: Actor,
  target: ReviewTarget,
  scope: ReviewScope,
  expectedRevision: number,
) {
  const existing = await findOwnTargetReview(tx, target, a.id, scope, true);
  if (!existing)
    throw new AppError(404, "NOT_FOUND", "This review is unavailable.");
  if (existing.status === "deleted") return ownReviewView(existing)!;
  if (existing.revision !== expectedRevision) throw conflict();
  const updated = await tx.query<ReviewRow>(
    `UPDATE place_review SET status='deleted',deletion_source='author',revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *`,
    [existing.id],
  );
  const row = updated.rows[0];
  await snapshot(tx, row, a.id, "deleted");
  await supersedeSubmissions(tx, row.id);
  await record(tx, a.id, "place_review_deleted", { scope: row.scope_kind });
  return ownReviewView(row)!;
}
/**
 * Create or edit the actor's one review of this subject in one scope. A null
 * expectedRevision creates; an existing review requires its current revision.
 * Content, history, moderation request and analytics commit together.
 */
export async function writeReview(
  actor: Actor | null,
  subjectId: string,
  body: unknown,
) {
  const a = requireActor(actor);
  const input = placeReviewInput.parse(body);
  if (!flags.placeReviewWrites)
    throw new AppError(404, "DISABLED", "Reviews are unavailable.");
  return transaction(async (tx) => {
    const subject = await requireActionableSubject(
      tx,
      a,
      subjectId,
      input.selectionGrant,
    );
    const needsModeration = await lockScope(tx, a, subject, input.scope);
    return upsertReview(
      tx,
      a,
      { subjectId: subject.id },
      input.scope,
      needsModeration,
      input,
    );
  });
}
export async function deleteReview(
  actor: Actor | null,
  subjectId: string,
  body: unknown,
) {
  const a = requireActor(actor);
  const input = placeReviewDeleteInput.parse(body);
  return transaction(async (tx) =>
    softDelete(tx, a, { subjectId }, input.scope, input.expectedRevision),
  );
}
/**
 * Resolve a layer item the actor may view. Lock order matches writeReview:
 * the subject (for a place-subject item), the layer row, then the item, so a
 * concurrent publish or item removal is serialized. Returns the review target
 * and whether the layer moderates new reviews.
 */
async function lockItem(
  tx: PoolClient,
  actor: Actor,
  layerId: string,
  itemId: string,
) {
  const notFound = () =>
    new AppError(404, "NOT_FOUND", "This layer or item is unavailable.");
  const scope: ReviewScope = { kind: "layer", id: layerId };
  if (!(await getScopeAccess(scope, actor))) throw notFound();
  const peek = await findLayerItem(tx, layerId, itemId);
  if (!peek) throw notFound();
  if (peek.subject_id) {
    await tx.query("SELECT id FROM place_subject WHERE id=$1 FOR UPDATE", [
      peek.subject_id,
    ]);
    const subject = await findSubjectById(tx, peek.subject_id);
    if (!subject || isBlocked(subject)) throw notFound();
  }
  const layer = await tx.query<{ audience: string }>(
    "SELECT audience FROM layer WHERE id=$1 FOR SHARE",
    [layerId],
  );
  if (!layer.rows[0]) throw notFound();
  const item = await findLayerItem(tx, layerId, itemId, true);
  if (!item || item.subject_id !== peek.subject_id) throw notFound();
  return {
    scope,
    target: itemTarget(item),
    needsModeration: layer.rows[0].audience === "public",
  };
}
/** Create or edit the actor's one review of a layer item in that layer. */
export async function writeItemReview(
  actor: Actor | null,
  layerId: string,
  itemId: string,
  body: unknown,
) {
  const a = requireActor(actor);
  const input = layerItemReviewInput.parse(body);
  if (!flags.placeReviewWrites)
    throw new AppError(404, "DISABLED", "Reviews are unavailable.");
  return transaction(async (tx) => {
    const locked = await lockItem(tx, a, layerId, itemId);
    return stripScope(
      await upsertReview(
        tx,
        a,
        locked.target,
        locked.scope,
        locked.needsModeration,
        input,
      ),
    );
  });
}
/** Author soft-delete of the actor's review of a layer item. */
export async function deleteItemReview(
  actor: Actor | null,
  layerId: string,
  itemId: string,
  body: unknown,
) {
  const a = requireActor(actor);
  const input = layerItemReviewDeleteInput.parse(body);
  return transaction(async (tx) => {
    const locked = await lockItem(tx, a, layerId, itemId);
    return stripScope(
      await softDelete(
        tx,
        a,
        locked.target,
        locked.scope,
        input.expectedRevision,
      ),
    );
  });
}
/**
 * Moderator decision on the current revision only. A decision on an older
 * snapshot (the author edited meanwhile) is a 409. Deletion needs ADMIN.
 */
export async function decideReview(
  actor: Actor | null,
  reviewId: string,
  body: unknown,
) {
  const a = requireModerator(actor);
  const input = reviewDecisionInput.parse(body);
  if (input.action === "deleted" && a.role !== "ADMIN")
    throw new AppError(
      403,
      "FORBIDDEN",
      "Only administrators can delete content.",
    );
  return transaction(async (tx) => {
    const current = await tx.query<ReviewRow>(
      "SELECT * FROM place_review WHERE id=$1 FOR UPDATE",
      [reviewId],
    );
    const existing = current.rows[0];
    if (!existing) throw new AppError(404, "NOT_FOUND", "Content not found.");
    if (existing.revision !== input.expectedRevision) throw conflict();
    const status: ReviewStatus = input.action;
    const updated = await tx.query<ReviewRow>(
      `UPDATE place_review SET status=$2,deletion_source=$3,moderated_by=$4,moderated_at=now(),revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *`,
      [existing.id, status, status === "deleted" ? "moderator" : null, a.id],
    );
    const row = updated.rows[0];
    await snapshot(tx, row, a.id, `moderator_${input.action}`, input.reason);
    // Resolve the request for this revision plus any reports; leave unrelated history alone.
    await tx.query(
      "UPDATE submission SET status=$1,updated_at=now() WHERE entity_type='reviews' AND entity_id=$2 AND status='pending' AND (entity_revision=$3 OR entity_revision IS NULL)",
      [input.action, existing.id, existing.revision],
    );
    await tx.query(
      "INSERT INTO moderation_action(actor_id,entity_type,entity_id,action,reason) VALUES($1,'reviews',$2,$3,$4)",
      [a.id, existing.id, input.action, input.reason],
    );
    return { status: row.status, revision: row.revision };
  });
}
/**
 * Publishing a layer sends reviews that were only scope-approved (never seen by
 * a moderator) back to moderation, so publication never exposes unreviewed text.
 * Runs inside the publishing transaction.
 */
export async function requeueLayerReviews(
  tx: PoolClient,
  layerId: string,
  actorId: string,
) {
  const rows = await tx.query<ReviewRow>(
    `UPDATE place_review SET status='pending',revision=revision+1,updated_at=now()
     WHERE layer_id=$1 AND status='approved' AND moderated_by IS NULL RETURNING *`,
    [layerId],
  );
  for (const row of rows.rows) {
    await snapshot(tx, row, actorId, "requeued_for_publication");
    await supersedeSubmissions(tx, row.id);
    await queueSubmission(tx, row.user_id, row);
  }
  return rows.rowCount ?? 0;
}
