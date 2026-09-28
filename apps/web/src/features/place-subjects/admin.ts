import { pool } from "@taiwanhub/database";
import type { PoolClient } from "pg";
import { z } from "zod";
import {
  AppError,
  canonicalSubjectKey,
  cityReviewStatuses,
  placeSubjectStatuses,
  providerPlaceId,
  requireModerator,
  type Actor,
} from "@taiwanhub/shared";
import { transaction } from "./service";
export const cityQueuePageSize = 20;
/**
 * Subjects awaiting (or past) city curation that someone actually uses — a
 * save, review or layer reference. Unused resolutions never flood the queue.
 * Moderators see usage counts; members never do.
 */
export async function listCityReviewQueue(
  actor: Actor | null,
  query: Record<string, string>,
) {
  requireModerator(actor);
  const status = z
    .enum(cityReviewStatuses)
    .catch("unreviewed")
    .parse(query.cityReviewStatus);
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(500)
    .catch(1)
    .parse(query.page ?? 1);
  const used = `(EXISTS (SELECT 1 FROM saved_place_subject x WHERE x.subject_id=s.id) OR EXISTS (SELECT 1 FROM place_review x WHERE x.subject_id=s.id) OR EXISTS (SELECT 1 FROM layer_item x WHERE x.subject_id=s.id))`;
  const rows = await pool.query<{
    id: string;
    status: string;
    revision: number;
    city_slug: string | null;
    provider_place_id: string | null;
    saves: number;
    reviews: number;
    layers: number;
    created_at: Date;
  }>(
    `SELECT s.id,s.status,s.revision,c.slug AS city_slug,s.created_at,
       (SELECT provider_place_id FROM place_provider_reference r WHERE r.subject_id=s.id AND r.state='current' LIMIT 1) AS provider_place_id,
       (SELECT count(*)::int FROM saved_place_subject x WHERE x.subject_id=s.id) AS saves,
       (SELECT count(*)::int FROM place_review x WHERE x.subject_id=s.id AND x.status<>'deleted') AS reviews,
       (SELECT count(*)::int FROM layer_item x WHERE x.subject_id=s.id) AS layers
     FROM place_subject s LEFT JOIN city c ON c.id=s.city_id
     WHERE s.catalog_place_id IS NULL AND s.city_review_status=$1 AND s.status<>'deleted' AND ${used}
     ORDER BY s.created_at, s.id LIMIT $2 OFFSET $3`,
    [status, cityQueuePageSize, (page - 1) * cityQueuePageSize],
  );
  return {
    items: rows.rows.map((r) => ({
      subjectId: r.id,
      status: r.status,
      revision: r.revision,
      city: r.city_slug,
      providerPlaceId: r.provider_place_id,
      usage: { saves: r.saves, reviews: r.reviews, layers: r.layers },
      createdAt: r.created_at.toISOString(),
    })),
    page,
    pageSize: cityQueuePageSize,
  };
}
const base = {
  expectedRevision: z.number().int().min(1),
  reason: z.string().trim().min(1).max(500),
};
/** Exactly one operation per request. City is TaiwanHub curation metadata, not a Google verification claim. */
export const subjectPatchInput = z.union([
  z.strictObject({ ...base, cityId: z.uuid() }),
  z.strictObject({ ...base, status: z.enum(placeSubjectStatuses) }),
  z.strictObject({ ...base, linkCatalogPlaceId: z.uuid() }),
  z.strictObject({ ...base, replaceProviderPlaceId: providerPlaceId }),
]);
async function lockSubject(
  tx: PoolClient,
  id: string,
  expectedRevision: number,
) {
  const result = await tx.query<{
    id: string;
    catalog_place_id: string | null;
    city_id: string | null;
    revision: number;
  }>(
    "SELECT id,catalog_place_id,city_id,revision FROM place_subject WHERE id=$1 FOR UPDATE",
    [id],
  );
  const row = result.rows[0];
  if (!row) throw new AppError(404, "NOT_FOUND", "This place is unavailable.");
  if (row.revision !== expectedRevision)
    throw new AppError(
      409,
      "REVISION_CONFLICT",
      "This place changed since you loaded it. Reload and try again.",
    );
  return row;
}
/** Layers holding the subject must match the city it is being given. */
async function assertLayerCities(
  tx: PoolClient,
  subjectId: string,
  cityId: string,
) {
  const mismatch = await tx.query(
    "SELECT 1 FROM layer_item i JOIN layer l ON l.id=i.layer_id WHERE i.subject_id=$1 AND l.city_id<>$2 LIMIT 1",
    [subjectId, cityId],
  );
  if (mismatch.rowCount)
    throw new AppError(
      400,
      "CITY_MISMATCH",
      "Layers containing this place belong to a different city.",
    );
}
/**
 * Link an external subject to a catalog place and canonicalize its saves and
 * layer memberships onto the catalog identity. A catalog place that already
 * has its own subject needs an audited merge (not automatic), and differing
 * layer notes need an operator decision rather than a silent overwrite.
 */
async function linkCatalogPlace(
  tx: PoolClient,
  subjectId: string,
  placeId: string,
) {
  const place = await tx.query<{
    city_id: string;
    status: string;
    is_demo: boolean;
  }>("SELECT city_id,status,is_demo FROM place WHERE id=$1 FOR SHARE", [
    placeId,
  ]);
  const p = place.rows[0];
  if (!p || p.status !== "approved" || p.is_demo)
    throw new AppError(
      400,
      "INVALID_LINK",
      "Link only to an approved, non-demo catalog place.",
    );
  const other = await tx.query(
    "SELECT 1 FROM place_subject WHERE catalog_place_id=$1",
    [placeId],
  );
  if (other.rowCount)
    throw new AppError(
      409,
      "SUBJECT_MERGE_REQUIRED",
      "This catalog place already has its own contributions; merging needs a separate reviewed operation.",
    );
  await assertLayerCities(tx, subjectId, p.city_id);
  const items = await tx.query<{ id: string; layer_id: string; note: string }>(
    "SELECT id,layer_id,note FROM layer_item WHERE subject_id=$1 ORDER BY id FOR UPDATE",
    [subjectId],
  );
  for (const item of items.rows) {
    const existing = await tx.query<{ id: string; note: string }>(
      "SELECT id,note FROM layer_item WHERE layer_id=$1 AND place_id=$2 FOR UPDATE",
      [item.layer_id, placeId],
    );
    const twin = existing.rows[0];
    if (!twin) {
      await tx.query(
        "UPDATE layer_item SET place_id=$2,subject_id=NULL WHERE id=$1",
        [item.id, placeId],
      );
      continue;
    }
    if (twin.note && item.note && twin.note !== item.note)
      throw new AppError(
        409,
        "LINK_NOTE_CONFLICT",
        "A layer has different notes for both entries; resolve them before linking.",
      );
    if (!twin.note && item.note)
      await tx.query("UPDATE layer_item SET note=$2 WHERE id=$1", [
        twin.id,
        item.note,
      ]);
    await tx.query(
      "UPDATE daily_pick_layer_membership SET layer_item_id=$2 WHERE layer_item_id=$1",
      [item.id, twin.id],
    );
    await tx.query("DELETE FROM layer_item WHERE id=$1", [item.id]);
  }
  await tx.query(
    "INSERT INTO saved_place(user_id,place_id) SELECT user_id,$2 FROM saved_place_subject WHERE subject_id=$1 ON CONFLICT DO NOTHING",
    [subjectId, placeId],
  );
  await tx.query("DELETE FROM saved_place_subject WHERE subject_id=$1", [
    subjectId,
  ]);
  await tx.query(
    "UPDATE place_subject SET catalog_place_id=$2,city_id=$3,city_review_status='approved' WHERE id=$1",
    [subjectId, placeId, p.city_id],
  );
}
export async function patchSubject(
  actor: Actor | null,
  id: string,
  body: unknown,
) {
  const a = requireModerator(actor);
  const input = subjectPatchInput.parse(body);
  if ("status" in input && input.status === "deleted" && a.role !== "ADMIN")
    throw new AppError(
      403,
      "FORBIDDEN",
      "Only administrators can delete content.",
    );
  return transaction(async (tx) => {
    const subject = await lockSubject(tx, id, input.expectedRevision);
    let action: string;
    if ("cityId" in input) {
      if (subject.catalog_place_id)
        throw new AppError(
          400,
          "LINKED",
          "A linked catalog place keeps its catalog city.",
        );
      const city = await tx.query("SELECT 1 FROM city WHERE id=$1", [
        input.cityId,
      ]);
      if (!city.rowCount)
        throw new AppError(400, "INVALID_CITY", "Choose a supported city.");
      await assertLayerCities(tx, id, input.cityId);
      await tx.query(
        "UPDATE place_subject SET city_id=$2,city_review_status='approved',city_reviewed_by=$3,city_reviewed_at=now() WHERE id=$1",
        [id, input.cityId, a.id],
      );
      action = "city_approved";
    } else if ("status" in input) {
      await tx.query("UPDATE place_subject SET status=$2 WHERE id=$1", [
        id,
        input.status,
      ]);
      action = `status_${input.status}`;
    } else if ("linkCatalogPlaceId" in input) {
      if (subject.catalog_place_id)
        throw new AppError(
          409,
          "LINKED",
          "This place is already linked to the catalog.",
        );
      await linkCatalogPlace(tx, id, input.linkCatalogPlaceId);
      action = "catalog_linked";
    } else {
      // Audited replacement keeps the old ID as an alias; a client can never move a review.
      const taken = await tx.query<{ subject_id: string }>(
        "SELECT subject_id FROM place_provider_reference WHERE provider='google' AND provider_place_id=$1",
        [input.replaceProviderPlaceId],
      );
      if (taken.rows[0] && taken.rows[0].subject_id !== id)
        throw new AppError(
          409,
          "SUBJECT_MERGE_REQUIRED",
          "That provider ID belongs to another place.",
        );
      await tx.query(
        "UPDATE place_provider_reference SET state='superseded',updated_at=now() WHERE subject_id=$1 AND provider='google' AND state='current'",
        [id],
      );
      if (taken.rows[0])
        await tx.query(
          "UPDATE place_provider_reference SET state='current',updated_at=now() WHERE provider='google' AND provider_place_id=$1",
          [input.replaceProviderPlaceId],
        );
      else
        await tx.query(
          "INSERT INTO place_provider_reference(subject_id,provider,provider_place_id) VALUES($1,'google',$2)",
          [id, input.replaceProviderPlaceId],
        );
      action = "provider_replaced";
    }
    const updated = await tx.query<{
      revision: number;
      catalog_place_id: string | null;
      status: string;
      city_review_status: string;
    }>(
      "UPDATE place_subject SET revision=revision+1,updated_at=now() WHERE id=$1 RETURNING revision,catalog_place_id,status,city_review_status",
      [id],
    );
    await tx.query(
      "INSERT INTO moderation_action(actor_id,entity_type,entity_id,action,reason) VALUES($1,'place_subjects',$2,$3,$4)",
      [a.id, id, action, input.reason],
    );
    const row = updated.rows[0];
    return {
      subjectId: id,
      canonicalKey: canonicalSubjectKey({
        id,
        catalogPlaceId: row.catalog_place_id,
      }),
      status: row.status,
      cityReviewStatus: row.city_review_status,
      revision: row.revision,
    };
  });
}
