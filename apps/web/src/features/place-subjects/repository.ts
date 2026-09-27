import { pool } from "@taiwanhub/database";
import type { PoolClient } from "pg";
import {
  canonicalSubjectKey,
  isModerator,
  subjectHref,
  type Actor,
  type CityReviewStatus,
  type PlaceProvider,
  type PlaceSubjectStatus,
} from "@taiwanhub/shared";
import { listEditableLayers } from "@/features/layers/repository";
type Queryable = Pick<PoolClient, "query">;
/**
 * Visibility predicate for subject `s` (with its linked catalog place `p` LEFT
 * JOINed). $1 is the actor ID or null, $2 whether the actor is a moderator.
 *
 * Active subject AND no hidden/deleted/unapproved linked catalog record AND one of:
 * an approved linked catalog place, the actor's own save or live review, an
 * approved review in one of the actor's groups, or membership in a layer the
 * actor may view. Public layers additionally require a reviewed subject city.
 * Moderators see everything for moderation.
 */
export const visibleSubject = `($2::boolean OR (
  s.status='active'
  AND (s.catalog_place_id IS NULL OR p.status='approved')
  AND (
    p.status='approved'
    OR ($1::uuid IS NOT NULL AND EXISTS (SELECT 1 FROM saved_place_subject ss WHERE ss.subject_id=s.id AND ss.user_id=$1::uuid))
    OR ($1::uuid IS NOT NULL AND EXISTS (SELECT 1 FROM place_review pr WHERE pr.subject_id=s.id AND pr.user_id=$1::uuid AND pr.status<>'deleted'))
    OR ($1::uuid IS NOT NULL AND EXISTS (SELECT 1 FROM place_review pr JOIN group_member gm ON gm.group_id=pr.group_id AND gm.user_id=$1::uuid WHERE pr.subject_id=s.id AND pr.status='approved'))
    OR EXISTS (
      SELECT 1 FROM layer_item li JOIN layer l ON l.id=li.layer_id
      WHERE li.subject_id=s.id AND (
        -- A system layer (Discover, Daily Pick) still requires the layer's
        -- own active/public state AND the subject's own city review — a
        -- membership row existing is never sufficient by itself, since that
        -- would bypass the review gate for any subject some future system
        -- layer happens to reference.
        (l.owner_kind='system' AND l.lifecycle='active' AND s.city_review_status='approved')
        OR (l.audience='public' AND l.review_status='approved' AND l.lifecycle='active' AND s.city_review_status='approved')
        OR ($1::uuid IS NOT NULL AND l.owner_kind='user' AND l.owner_user_id=$1::uuid)
        OR ($1::uuid IS NOT NULL AND l.owner_kind='group' AND EXISTS (SELECT 1 FROM group_member gm WHERE gm.group_id=l.owner_group_id AND gm.user_id=$1::uuid))
      )
    )
  )
))`;
export const subjectFrom = `FROM place_subject s LEFT JOIN place p ON p.id=s.catalog_place_id LEFT JOIN city c ON c.id=s.city_id`;
const subjectColumns = `s.id,s.catalog_place_id,s.city_review_status,s.status,s.revision,p.slug AS catalog_slug,p.status AS catalog_status,p.is_demo AS catalog_is_demo,c.slug AS city_slug,c.name AS city_name`;
export type SubjectRow = {
  id: string;
  catalog_place_id: string | null;
  city_review_status: CityReviewStatus;
  status: PlaceSubjectStatus;
  revision: number;
  catalog_slug: string | null;
  catalog_status: string | null;
  catalog_is_demo: boolean | null;
  city_slug: string | null;
  city_name: string | null;
};
export function actorParams(actor: Actor | null) {
  return [actor?.id ?? null, !!actor && isModerator(actor.role)] as const;
}
/** Blocked: not active, or linked to a catalog place that is not publicly approved. */
export function isBlocked(row: SubjectRow) {
  return (
    row.status !== "active" ||
    (row.catalog_place_id !== null && row.catalog_status !== "approved")
  );
}
export async function findSubjectById(db: Queryable, id: string) {
  const result = await db.query<SubjectRow>(
    `SELECT ${subjectColumns} ${subjectFrom} WHERE s.id=$1`,
    [id],
  );
  return result.rows[0] ?? null;
}
export async function findSubjectByProvider(
  db: Queryable,
  provider: PlaceProvider,
  providerPlaceId: string,
) {
  // Superseded aliases resolve to the same subject as the current ID.
  const result = await db.query<SubjectRow>(
    `SELECT ${subjectColumns} ${subjectFrom} JOIN place_provider_reference r ON r.subject_id=s.id WHERE r.provider=$1 AND r.provider_place_id=$2`,
    [provider, providerPlaceId],
  );
  return result.rows[0] ?? null;
}
export async function findSubjectByCatalogPlace(
  db: Queryable,
  placeId: string,
) {
  const result = await db.query<SubjectRow>(
    `SELECT ${subjectColumns} ${subjectFrom} WHERE s.catalog_place_id=$1`,
    [placeId],
  );
  return result.rows[0] ?? null;
}
/** A subject the actor may see, or null. Missing and unauthorized are indistinguishable. */
export async function getVisibleSubject(
  id: string,
  actor: Actor | null,
  db: Queryable = pool,
) {
  const result = await db.query<SubjectRow>(
    `SELECT ${subjectColumns} ${subjectFrom} WHERE s.id=$3 AND ${visibleSubject}`,
    [...actorParams(actor), id],
  );
  return result.rows[0] ?? null;
}
export async function isSavedBy(row: SubjectRow, userId: string) {
  const result = row.catalog_place_id
    ? await pool.query(
        "SELECT 1 FROM saved_place WHERE user_id=$1 AND place_id=$2",
        [userId, row.catalog_place_id],
      )
    : await pool.query(
        "SELECT 1 FROM saved_place_subject WHERE user_id=$1 AND subject_id=$2",
        [userId, row.id],
      );
  return (result.rowCount ?? 0) > 0;
}
async function currentProviderReference(subjectId: string) {
  const result = await pool.query<{
    provider: PlaceProvider;
    provider_place_id: string;
  }>(
    "SELECT provider,provider_place_id FROM place_provider_reference WHERE subject_id=$1 AND state='current' ORDER BY provider LIMIT 1",
    [subjectId],
  );
  const row = result.rows[0];
  return row
    ? { provider: row.provider, providerPlaceId: row.provider_place_id }
    : null;
}
/**
 * Authorized local metadata only. Provider display data (name, address,
 * photos, hours, coordinates) is never stored, so it is never returned here;
 * the client renders it live through the provider component.
 */
export async function getSubjectDetail(id: string, actor: Actor | null) {
  const row = await getVisibleSubject(id, actor);
  if (!row) return null;
  return {
    subjectId: row.id,
    canonicalKey: canonicalSubjectKey({
      id: row.id,
      catalogPlaceId: row.catalog_place_id,
    }),
    href: row.catalog_slug
      ? `/places/${row.catalog_slug}`
      : subjectHref(row.id),
    catalogPlaceId: row.catalog_place_id,
    isDemo: row.catalog_is_demo === true,
    cityReviewStatus: row.city_review_status,
    city:
      row.city_review_status === "approved" && row.city_slug
        ? { slug: row.city_slug, name: row.city_name ?? "" }
        : null,
    providerReference: await currentProviderReference(row.id),
    saved: actor ? await isSavedBy(row, actor.id) : false,
    ...(actor && isModerator(actor.role) ? { status: row.status } : {}),
  };
}
/** Public lookup: only what this actor may already see; unknown and unauthorized both return no match. */
export async function lookupSubject(
  provider: PlaceProvider,
  providerPlaceId: string,
  actor: Actor | null,
) {
  const result = await pool.query<SubjectRow>(
    `SELECT ${subjectColumns} ${subjectFrom} JOIN place_provider_reference r ON r.subject_id=s.id
     WHERE r.provider=$3 AND r.provider_place_id=$4 AND ${visibleSubject}`,
    [...actorParams(actor), provider, providerPlaceId],
  );
  const row = result.rows[0];
  if (!row) return { subjectId: null };
  return {
    subjectId: row.id,
    canonicalKey: canonicalSubjectKey({
      id: row.id,
      catalogPlaceId: row.catalog_place_id,
    }),
    cityReviewStatus: row.city_review_status,
  };
}
/**
 * The actor's editable layers for the add-to-layer picker, marking those that
 * already hold this subject (by subject or by its linked catalog place). Only
 * the actor's own layers are inspected, so nothing about others leaks.
 */
export async function editableLayersForSubject(
  actor: Actor,
  subjectId: string | null,
) {
  const layers = await listEditableLayers(actor);
  if (!layers.length) return [];
  const has = new Set<string>();
  if (subjectId) {
    const contains = await pool.query<{ layer_id: string }>(
      `SELECT i.layer_id FROM layer_item i JOIN place_subject s ON s.id=$1
       WHERE i.layer_id=ANY($2::uuid[]) AND (i.subject_id=s.id OR (s.catalog_place_id IS NOT NULL AND i.place_id=s.catalog_place_id))`,
      [subjectId, layers.map((l) => l.id)],
    );
    for (const row of contains.rows) has.add(row.layer_id);
  }
  return layers.map((l) => ({
    id: l.id,
    slug: l.slug,
    title: l.title,
    titleChinese: l.titleChinese,
    audience: l.audience,
    citySlug: l.citySlug,
    contains: has.has(l.id),
  }));
}
