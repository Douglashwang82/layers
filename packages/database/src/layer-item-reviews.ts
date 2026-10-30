import type { PoolClient } from "pg";
type Db = Pick<PoolClient, "query">;
/**
 * Soft-deletes reviews and detaches them from any subject or layer item so a
 * parent delete cannot erase their history: revision snapshot, superseded
 * pending moderation requests. Already-deleted reviews are only detached.
 */
async function retireReviews(
  db: Db,
  where: string,
  params: unknown[],
  actorId: string | null,
) {
  const retired = await db.query<{ id: string; prev_status: string }>(
    `WITH old AS (
       SELECT id,status FROM place_review WHERE ${where} ORDER BY id FOR UPDATE
     )
     UPDATE place_review r SET
       layer_item_id=NULL,
       subject_id=NULL,
       status='deleted',
       deletion_source=COALESCE(r.deletion_source,'moderator'),
       revision=CASE WHEN old.status='deleted' THEN r.revision ELSE r.revision+1 END,
       updated_at=now()
     FROM old WHERE r.id=old.id
     RETURNING r.id,old.status AS prev_status`,
    params,
  );
  const changed = retired.rows
    .filter((r) => r.prev_status !== "deleted")
    .map((r) => r.id);
  if (changed.length)
    await db.query(
      `INSERT INTO place_review_revision(review_id,revision,actor_id,change_kind,stars,body,status,reason)
       SELECT id,revision,$2,'item_removed',stars,body,status,'Layer item removed' FROM place_review WHERE id=ANY($1::uuid[])`,
      [changed, actorId],
    );
  if (retired.rows.length)
    await db.query(
      "UPDATE submission SET status='superseded',updated_at=now() WHERE entity_type='reviews' AND entity_id=ANY($1::uuid[]) AND status='pending'",
      [retired.rows.map((r) => r.id)],
    );
}
/** Call in the transaction that deletes layer items: their own reviews are soft-deleted and detached first. */
export async function retireLayerItemReviews(
  db: Db,
  itemIds: string[],
  actorId: string | null,
) {
  if (!itemIds.length) return;
  await retireReviews(db, "layer_item_id=ANY($1::uuid[])", [itemIds], actorId);
}
/**
 * A subject item in a layer became a catalog item (no subject any more): the
 * layer's reviews of that subject follow it to the item. When the author
 * already reviewed the item, the existing item review wins and the moved-in
 * one is retired (kept in history), so the result is deterministic.
 */
export async function moveSubjectReviewsToItem(
  db: Db,
  subjectId: string,
  layerId: string,
  itemId: string,
  actorId: string | null,
) {
  await retireReviews(
    db,
    `subject_id=$1 AND layer_id=$2 AND EXISTS (SELECT 1 FROM place_review x WHERE x.layer_item_id=$3 AND x.user_id=place_review.user_id)`,
    [subjectId, layerId, itemId],
    actorId,
  );
  await db.query(
    "UPDATE place_review SET subject_id=NULL,layer_item_id=$3 WHERE subject_id=$1 AND layer_id=$2",
    [subjectId, layerId, itemId],
  );
}
