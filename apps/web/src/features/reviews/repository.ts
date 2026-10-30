import { pool } from "@taiwanhub/database";
import type { PoolClient } from "pg";
import {
  decodeReviewCursor,
  encodeReviewCursor,
  reviewScopeKey,
  type Actor,
  type RatingSummary,
  type ReviewScope,
  type ReviewStatus,
} from "@taiwanhub/shared";
import { getLayer } from "@/features/layers/repository";
import { getVisibleSubject } from "@/features/place-subjects/repository";
type Queryable = Pick<PoolClient, "query">;
export const reviewPageSize = 20;
/** Scope filter on alias `r`. Parameter indexes are supplied by the caller; the column is allowlisted. */
function scopeColumn(scope: ReviewScope) {
  return scope.kind === "layer" ? "r.layer_id" : "r.group_id";
}
export type ScopeAccess = {
  scope: ReviewScope;
  title: string;
  titleChinese: string;
  audience: "public" | "private" | "group";
  /** Reviews in a public-audience layer wait for a moderator before others see them. */
  needsModeration: boolean;
};
/**
 * The actor's view of a review scope, or null. A layer scope follows layer
 * view access; a group scope requires membership. Missing and unauthorized
 * scopes are indistinguishable.
 */
export async function getScopeAccess(
  scope: ReviewScope,
  actor: Actor | null,
): Promise<ScopeAccess | null> {
  if (scope.kind === "layer") {
    const found = await getLayer(scope.id, actor);
    if (!found || found.layer.id !== scope.id) return null;
    return {
      scope,
      title: found.layer.title,
      titleChinese: found.layer.titleChinese,
      audience: found.layer.audience,
      needsModeration: found.layer.audience === "public",
    };
  }
  if (!actor) return null;
  const result = await pool.query<{ name: string; name_chinese: string }>(
    `SELECT g.name,g.name_chinese FROM "group" g JOIN group_member m ON m.group_id=g.id AND m.user_id=$2 WHERE g.id=$1`,
    [scope.id, actor.id],
  );
  const row = result.rows[0];
  return row
    ? {
        scope,
        title: row.name,
        titleChinese: row.name_chinese,
        audience: "group",
        needsModeration: false,
      }
    : null;
}
/** Layer reviews are about places in that layer (catalog-linked subjects match by place). */
export async function subjectInLayer(
  db: Queryable,
  subject: { id: string; catalog_place_id: string | null },
  layerId: string,
) {
  const result = await db.query(
    "SELECT 1 FROM layer_item WHERE layer_id=$1 AND (subject_id=$2 OR ($3::uuid IS NOT NULL AND place_id=$3::uuid)) LIMIT 1",
    [layerId, subject.id, subject.catalog_place_id],
  );
  return (result.rowCount ?? 0) > 0;
}
export type ReviewRow = {
  id: string;
  subject_id: string | null;
  layer_item_id: string | null;
  user_id: string;
  scope_kind: "layer" | "group";
  layer_id: string | null;
  group_id: string | null;
  stars: number | null;
  body: string;
  status: ReviewStatus;
  deletion_source: "author" | "moderator" | null;
  moderated_by: string | null;
  revision: number;
  created_at: Date;
  updated_at: Date;
};
/** What a review is about: a place subject, or any other layer item. */
export type ReviewTarget = { subjectId: string } | { layerItemId: string };
export async function findOwnTargetReview(
  db: Queryable,
  target: ReviewTarget,
  userId: string,
  scope: ReviewScope,
  lock = false,
) {
  const [column, value] =
    "subjectId" in target
      ? ["r.subject_id", target.subjectId]
      : ["r.layer_item_id", target.layerItemId];
  const result = await db.query<ReviewRow>(
    `SELECT r.* FROM place_review r WHERE ${column}=$1 AND r.user_id=$2 AND ${scopeColumn(scope)}=$3${lock ? " FOR UPDATE" : ""}`,
    [value, userId, scope.id],
  );
  return result.rows[0] ?? null;
}
export function findOwnReview(
  db: Queryable,
  subjectId: string,
  userId: string,
  scope: ReviewScope,
  lock = false,
) {
  return findOwnTargetReview(db, { subjectId }, userId, scope, lock);
}
/** The author's own view, including pending/hidden state; never shown to anyone else. */
export function ownReviewView(row: ReviewRow | null) {
  if (!row) return null;
  return {
    id: row.id,
    scope: reviewScopeKey({
      kind: row.scope_kind,
      id: (row.layer_id ?? row.group_id)!,
    }),
    stars: row.status === "deleted" ? null : row.stars,
    body: row.status === "deleted" ? "" : row.body,
    status: row.status,
    removedByModerator: row.deletion_source === "moderator",
    revision: row.revision,
    updatedAt: row.updated_at.toISOString(),
  };
}
async function summary(
  subjectId: string,
  scope: ReviewScope,
): Promise<RatingSummary> {
  const result = await pool.query<{
    total: number;
    rated: number;
    average: string | null;
  }>(
    `SELECT count(*)::int AS total,count(r.stars)::int AS rated,round(avg(r.stars)::numeric,1)::text AS average
     FROM place_review r WHERE r.subject_id=$1 AND ${scopeColumn(scope)}=$2 AND r.status='approved'`,
    [subjectId, scope.id],
  );
  const row = result.rows[0];
  return {
    totalReviews: row.total,
    ratedCount: row.rated,
    averageStars: row.average === null ? null : Number(row.average),
  };
}
/**
 * Approved reviews for one subject in one scope, newest first. Only approved
 * rows count or appear; the actor's own review is returned separately.
 */
export async function listScopeReviews(
  subjectId: string,
  scope: ReviewScope,
  actor: Actor | null,
  page: number,
) {
  const [subject, access] = await Promise.all([
    getVisibleSubject(subjectId, actor),
    getScopeAccess(scope, actor),
  ]);
  if (!subject || !access) return null;
  const items = await pool.query<{
    id: string;
    stars: number | null;
    body: string;
    author_name: string;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT r.id,r.stars,r.body,u.name AS author_name,r.created_at,r.updated_at
     FROM place_review r JOIN "user" u ON u.id=r.user_id
     WHERE r.subject_id=$1 AND ${scopeColumn(scope)}=$2 AND r.status='approved'
     ORDER BY r.created_at DESC, r.id DESC LIMIT $3 OFFSET $4`,
    [subjectId, scope.id, reviewPageSize, (page - 1) * reviewPageSize],
  );
  return {
    scope: reviewScopeKey(scope),
    title: access.title,
    titleChinese: access.titleChinese,
    audience: access.audience,
    needsModeration: access.needsModeration,
    items: items.rows.map((r) => ({
      id: r.id,
      stars: r.stars,
      body: r.body,
      authorName: r.author_name,
      createdAt: r.created_at.toISOString(),
      edited: r.updated_at.getTime() - r.created_at.getTime() > 1000,
    })),
    ...(await summary(subjectId, scope)),
    page,
    pageSize: reviewPageSize,
    ownReview: actor
      ? ownReviewView(await findOwnReview(pool, subjectId, actor.id, scope))
      : null,
  };
}
/**
 * Scopes where the actor may read (and, if signed in, write) reviews of this
 * subject: viewable layers that contain it, plus every group the actor
 * belongs to. Each carries its own summary; scopes are never merged.
 */
export async function listReviewScopes(subjectId: string, actor: Actor | null) {
  const subject = await getVisibleSubject(subjectId, actor);
  if (!subject) return null;
  const layerIds = await pool.query<{ layer_id: string }>(
    `SELECT DISTINCT layer_id FROM layer_item WHERE subject_id=$1 OR ($2::uuid IS NOT NULL AND place_id=$2::uuid) LIMIT 50`,
    [subject.id, subject.catalog_place_id],
  );
  const groupIds = actor
    ? await pool.query<{ group_id: string }>(
        "SELECT group_id FROM group_member WHERE user_id=$1 LIMIT 50",
        [actor.id],
      )
    : { rows: [] };
  const scopes: ReviewScope[] = [
    ...layerIds.rows.map((r) => ({ kind: "layer" as const, id: r.layer_id })),
    ...groupIds.rows.map((r) => ({ kind: "group" as const, id: r.group_id })),
  ];
  const results = await Promise.all(
    scopes.map(async (scope) => {
      const access = await getScopeAccess(scope, actor);
      if (!access) return null;
      return {
        scope: reviewScopeKey(scope),
        kind: scope.kind,
        title: access.title,
        titleChinese: access.titleChinese,
        audience: access.audience,
        needsModeration: access.needsModeration,
        ...(await summary(subject.id, scope)),
        ownReview: actor
          ? ownReviewView(
              await findOwnReview(pool, subject.id, actor.id, scope),
            )
          : null,
      };
    }),
  );
  return {
    subjectId: subject.id,
    scopes: results.filter((r) => r !== null),
  };
}
export const itemReviewPageSize = 20;
export type LayerItemRef = { id: string; subject_id: string | null };
/** The item within its layer, or null; an item of another layer is never matched. */
export async function findLayerItem(
  db: Queryable,
  layerId: string,
  itemId: string,
  lock = false,
) {
  const result = await db.query<LayerItemRef>(
    `SELECT id,subject_id FROM layer_item WHERE id=$1 AND layer_id=$2${lock ? " FOR SHARE" : ""}`,
    [itemId, layerId],
  );
  return result.rows[0] ?? null;
}
/** Place-subject items share the subject review in the layer scope; others use their own rows. */
export function itemTarget(item: LayerItemRef): ReviewTarget {
  return item.subject_id
    ? { subjectId: item.subject_id }
    : { layerItemId: item.id };
}
function targetWhere(target: ReviewTarget) {
  return "subjectId" in target
    ? { sql: "r.subject_id=$1", value: target.subjectId }
    : { sql: "r.layer_item_id=$1", value: target.layerItemId };
}
/**
 * Reviews of one layer item as the actor sees them: approved reviews by
 * others plus the actor's own pending/approved one, newest first. Null when
 * the layer is not viewable or does not contain the item.
 */
export async function listItemReviews(
  layerId: string,
  itemId: string,
  actor: Actor | null,
  cursorToken: string | undefined,
) {
  const scope: ReviewScope = { kind: "layer", id: layerId };
  const access = await getScopeAccess(scope, actor);
  if (!access) return null;
  const item = await findLayerItem(pool, layerId, itemId);
  if (!item) return null;
  const target = targetWhere(itemTarget(item));
  const cursor = decodeReviewCursor(cursorToken);
  const params: unknown[] = [target.value, layerId, actor?.id ?? null];
  let after = "";
  if (cursor) {
    params.push(cursor.createdAt, cursor.id);
    after = "AND (r.created_at,r.id) < ($4::timestamptz,$5::uuid)";
  }
  const rows = await pool.query<{
    id: string;
    user_id: string;
    stars: number | null;
    body: string;
    author_name: string;
    author_image: string | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT r.id,r.user_id,r.stars,r.body,u.name AS author_name,u.image AS author_image,r.created_at,r.updated_at
     FROM place_review r JOIN "user" u ON u.id=r.user_id
     WHERE ${target.sql} AND r.layer_id=$2
       AND (r.status='approved' OR (r.user_id=$3::uuid AND r.status='pending')) ${after}
     ORDER BY r.created_at DESC, r.id DESC LIMIT ${itemReviewPageSize + 1}`,
    params,
  );
  const page = rows.rows.slice(0, itemReviewPageSize);
  const last = page[page.length - 1];
  const stats = await pool.query<{
    total: number;
    rated: number;
    average: string | null;
  }>(
    `SELECT count(*)::int AS total,count(r.stars)::int AS rated,round(avg(r.stars)::numeric,1)::text AS average
     FROM place_review r WHERE ${target.sql} AND r.layer_id=$2 AND r.status='approved'`,
    [target.value, layerId],
  );
  const own = actor
    ? ownReviewView(
        await findOwnTargetReview(pool, itemTarget(item), actor.id, scope),
      )
    : null;
  return {
    summary: {
      totalReviews: stats.rows[0].total,
      ratedCount: stats.rows[0].rated,
      averageStars:
        stats.rows[0].average === null ? null : Number(stats.rows[0].average),
    } satisfies RatingSummary,
    reviews: page.map((r) => ({
      id: r.id,
      author: { name: r.author_name, image: r.author_image },
      stars: r.stars,
      body: r.body,
      updatedAt: r.updated_at.toISOString(),
      mine: actor !== null && r.user_id === actor.id,
    })),
    nextCursor:
      rows.rows.length > itemReviewPageSize && last
        ? encodeReviewCursor(last.created_at, last.id)
        : null,
    own: own ? stripScope(own) : null,
    canReview: actor !== null,
  };
}
/** The item-route author view omits the scope key (it is always the URL's layer). */
export function stripScope<T extends { scope: string }>(view: T) {
  const { scope: _scope, ...rest } = view;
  void _scope;
  return rest;
}
/** Approved rating per item of a viewable layer; items without approved reviews are absent. */
export async function listLayerItemRatings(
  layerId: string,
  actor: Actor | null,
) {
  const access = await getScopeAccess({ kind: "layer", id: layerId }, actor);
  if (!access) return null;
  const result = await pool.query<{
    id: string;
    rated: number;
    average: string | null;
  }>(
    `SELECT i.id,count(r.stars)::int AS rated,round(avg(r.stars)::numeric,1)::text AS average
     FROM layer_item i
     JOIN place_review r ON r.status='approved' AND r.layer_id=i.layer_id
       AND (r.layer_item_id=i.id OR (i.subject_id IS NOT NULL AND r.subject_id=i.subject_id))
     WHERE i.layer_id=$1 GROUP BY i.id`,
    [layerId],
  );
  const ratings: Record<
    string,
    { averageStars: number | null; ratedCount: number }
  > = {};
  for (const r of result.rows)
    ratings[r.id] = {
      averageStars: r.average === null ? null : Number(r.average),
      ratedCount: r.rated,
    };
  return { ratings };
}
