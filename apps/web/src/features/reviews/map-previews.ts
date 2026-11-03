import { pool } from "@taiwanhub/database";
import type { Actor, MapState } from "@taiwanhub/shared";
import { hasApplied, resolveAppliedLayers } from "@/features/map/applied";
import { collectExternalReferences } from "@/features/map/external";
import { runMapQuery, type MapCity } from "@/features/map/query";
import { flags } from "@/lib/config";

export const previewReviewerLimit = 3;
/** Comment excerpt length in characters; the card clamps it to two lines. */
export const previewCommentLimit = 140;
const nameLimit = 80;
const imageByteLimit = 2048;

export type ReviewPreview = {
  /** Distinct reviewers; more than `reviews.length` means "+N more". */
  reviewerCount: number;
  /** Each reviewer's newest review, newest first. */
  reviews: {
    name: string;
    image: string | null;
    stars: number | null;
    /** Trimmed excerpt, "" without a comment. */
    comment: string;
  }[];
};
/** One approved review of a layer item, with the item's identifying columns. */
export type PreviewRow = {
  review_id: string;
  layer_id: string;
  place_id: string | null;
  event_id: string | null;
  subject_id: string | null;
  custom_place_id: string | null;
  catalog_id: string | null;
  user_id: string;
  stars: number | null;
  /** At most previewCommentLimit + 1 characters of the trimmed body. */
  body: string;
  author_name: string;
  author_image: string | null;
  created_at: Date;
};

/**
 * Keys the map could render a layer item under. A custom place may show as
 * its catalog place (`catalog_id` is set only for an approved, active
 * suggestion), and only while custom places are enabled.
 */
function candidateKeys(row: PreviewRow) {
  if (row.place_id) return [`place:${row.place_id}`];
  if (row.event_id) return [`event:${row.event_id}`];
  if (row.subject_id) return [`subject:${row.subject_id}`];
  if (row.custom_place_id && flags.layerCustomPlaces)
    return [
      `custom:${row.custom_place_id}`,
      ...(row.catalog_id ? [`place:${row.catalog_id}`] : []),
    ];
  return [];
}

/** `body` arrives trimmed by SQL (whitespace class below) and cut at limit + 1, so length alone says whether it was cut. */
function excerpt(body: string) {
  const chars = Array.from(body);
  return chars.length > previewCommentLimit
    ? `${chars
        .slice(0, previewCommentLimit - 1)
        .join("")
        .trimEnd()}…`
    : chars.join("");
}

function safeImage(image: string | null) {
  if (!image || Buffer.byteLength(image) > imageByteLimit) return null;
  try {
    return new URL(image).protocol === "https:" ? image : null;
  } catch {
    return null;
  }
}

/**
 * Folds review rows into previews by marker key. A row counts only when its
 * item renders under that key in that layer (`visible`: key → layer ids), so
 * hidden, unreviewed or scheduled items never appear. A person who reviewed
 * one place in two layers is shown once, with the newer review.
 */
export function aggregateReviewPreviews(
  rows: PreviewRow[],
  visible: Map<string, Set<string>>,
) {
  const byKey = new Map<string, PreviewRow[]>();
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.review_id)) continue;
    const key = candidateKeys(row).find((k) =>
      visible.get(k)?.has(row.layer_id),
    );
    if (!key) continue;
    seen.add(row.review_id);
    const list = byKey.get(key) ?? [];
    list.push(row);
    byKey.set(key, list);
  }
  const previews: Record<string, ReviewPreview> = {};
  for (const [key, list] of byKey) {
    list.sort(
      (a, b) =>
        b.created_at.getTime() - a.created_at.getTime() ||
        (a.review_id < b.review_id ? 1 : -1),
    );
    const users = new Map<string, PreviewRow>();
    for (const r of list) if (!users.has(r.user_id)) users.set(r.user_id, r);
    previews[key] = {
      reviewerCount: users.size,
      reviews: [...users.values()].slice(0, previewReviewerLimit).map((r) => ({
        name: r.author_name.slice(0, nameLimit),
        image: safeImage(r.author_image),
        stars: r.stars,
        comment: excerpt(r.body),
      })),
    };
  }
  return previews;
}

/**
 * Approved-review previews for the pins of one map query, keyed by marker
 * key. Only items the same query renders for this actor are included.
 */
export async function listMapReviewPreviews(
  state: MapState,
  city: MapCity,
  actor: Actor | null,
) {
  if (!hasApplied(state)) return { previews: {} };
  const now = new Date();
  const [{ resolved }, result, external] = await Promise.all([
    resolveAppliedLayers(state, actor, city),
    runMapQuery(state, city, actor, now),
    collectExternalReferences(state, city, actor, now),
  ]);
  const idBySlug = new Map(resolved.map((r) => [r.layer.slug, r.layer.id]));
  const visible = new Map<string, Set<string>>();
  for (const item of [
    ...result.items.map((i) => ({ key: i.key, layers: i.layers })),
    ...external.map((r) => ({ key: r.canonicalKey, layers: r.layers })),
  ]) {
    const ids = visible.get(item.key) ?? new Set<string>();
    for (const slug of item.layers) {
      const id = idBySlug.get(slug);
      if (id) ids.add(id);
    }
    visible.set(item.key, ids);
  }
  const layerIds = [...idBySlug.values()];
  if (!layerIds.length || !visible.size) return { previews: {} };
  // Two branches so each uses its own index: item reviews and subject reviews.
  const rows = await pool.query<PreviewRow>(
    `SELECT x.review_id,x.layer_id,x.place_id,x.event_id,x.subject_id,x.custom_place_id,x.catalog_id,
       r.user_id,r.stars,left(btrim(r.body,E' \t\r\n\f\v'),${previewCommentLimit + 1}) AS body,u.name AS author_name,u.image AS author_image,r.created_at
     FROM (
       SELECT r.id AS review_id,i.layer_id,i.place_id,i.event_id,NULL::uuid AS subject_id,i.custom_place_id,CASE WHEN cp.status='active' AND cpp.status='approved' THEN cp.catalog_place_id END AS catalog_id
       FROM layer_item i
       JOIN place_review r ON r.layer_item_id=i.id AND r.layer_id=i.layer_id AND r.status='approved'
       LEFT JOIN custom_place cp ON cp.id=i.custom_place_id
       LEFT JOIN place cpp ON cpp.id=cp.catalog_place_id
       WHERE i.layer_id=ANY($1::uuid[])
       UNION ALL
       SELECT r.id,i.layer_id,NULL,NULL,i.subject_id,NULL,NULL
       FROM layer_item i
       JOIN place_review r ON r.subject_id=i.subject_id AND r.layer_id=i.layer_id AND r.status='approved'
       WHERE i.layer_id=ANY($1::uuid[]) AND i.subject_id IS NOT NULL
     ) x
     JOIN place_review r ON r.id=x.review_id
     JOIN "user" u ON u.id=r.user_id`,
    [layerIds],
  );
  return { previews: aggregateReviewPreviews(rows.rows, visible) };
}
