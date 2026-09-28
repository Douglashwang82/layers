import { pool } from "@taiwanhub/database";
import {
  localDate,
  subjectKey,
  type Actor,
  type MapState,
} from "@taiwanhub/shared";
import { resolveLayers } from "../layers/repository";
import type { MapCity } from "./query";
export const externalPageSize = 12;
export type ExternalReference = {
  subjectId: string;
  canonicalKey: `subject:${string}`;
  providerPlaceId: string | null;
  localNote: string | null;
  layers: string[];
  cityReviewStatus: "unreviewed" | "approved";
  isDailyPick?: boolean;
};
/**
 * Authorized external (provider-referenced) places for the same layer/type/
 * date context as the map query, or the actor's own saves. The server stores
 * no provider names or coordinates, so it cannot search, sort or spatially
 * filter these by business fields: text search covers TaiwanHub-authored notes
 * only, and location is resolved client-side through the provider component.
 */
export async function listExternalReferences(
  state: MapState,
  city: MapCity,
  actor: Actor | null,
  cursor: number,
  now = new Date(),
) {
  const empty = {
    references: [] as ExternalReference[],
    nextCursor: null as string | null,
    totalAuthorizedReferences: 0,
    pageSize: externalPageSize,
    spatialFilter: "pending-provider-resolution" as const,
  };
  const types = state.types?.length ? state.types : ["place"];
  // External places are places; city-wide text search only covers the catalog.
  if (!types.includes("place") || state.layers === "none") return empty;
  if (state.scope === "city" && state.q) return empty;
  const { resolved } = await resolveLayers(state.layers, actor, city);
  const ordered: ExternalReference[] = [];
  const byId = new Map<string, ExternalReference>();
  const add = (row: {
    subject_id: string;
    provider_place_id: string | null;
    note: string | null;
    city_review_status: "unreviewed" | "approved";
    slug: string;
  }) => {
    const existing = byId.get(row.subject_id);
    if (existing) {
      if (!existing.layers.includes(row.slug)) existing.layers.push(row.slug);
      existing.localNote ??= row.note || null;
      return;
    }
    const ref: ExternalReference = {
      subjectId: row.subject_id,
      canonicalKey: subjectKey(row.subject_id),
      providerPlaceId: row.provider_place_id,
      localNote: row.note || null,
      layers: [row.slug],
      cityReviewStatus: row.city_review_status,
    };
    byId.set(row.subject_id, ref);
    ordered.push(ref);
  };
  const provider = `(SELECT r.provider_place_id FROM place_provider_reference r WHERE r.subject_id=s.id AND r.state='current' LIMIT 1) AS provider_place_id`;
  for (const { layer, access } of resolved) {
    if (layer.rule?.kind === "saves") {
      if (!actor) continue;
      const saves = await pool.query(
        `SELECT s.id AS subject_id,${provider},NULL AS note,s.city_review_status
         FROM saved_place_subject x JOIN place_subject s ON s.id=x.subject_id
         WHERE x.user_id=$1 AND s.status='active' AND s.catalog_place_id IS NULL
         ORDER BY x.created_at DESC, s.id`,
        [actor.id],
      );
      for (const row of saves.rows) add({ ...row, slug: layer.slug });
      continue;
    }
    if (layer.ownerKind === "system") {
      // Every other system layer (today/weekend/food/community/daily_pick's
      // own catalog rendering) is rule-derived from the public catalog and
      // never carries external-subject layer_item rows. Discover and Daily
      // Pick are the two exceptions: a published version 2 external winner
      // is attached as an ordinary layer_item so it is included here, but
      // only ever as public, reviewed, currently-valid content — never a
      // moderator-only or future-reservation view, since `member` is
      // unconditionally false for a system layer.
      if (layer.rule?.kind !== "discover" && layer.rule?.kind !== "daily_pick")
        continue;
      const rows = await pool.query(
        `SELECT s.id AS subject_id,${provider},i.note,s.city_review_status
         FROM layer_item i JOIN place_subject s ON s.id=i.subject_id
         WHERE i.layer_id=$1 AND s.status='active' AND s.catalog_place_id IS NULL
           AND s.city_review_status='approved'
           AND s.city_id=$3
           AND (NOT i.restaurant_managed OR EXISTS(SELECT 1 FROM daily_pick_layer_membership m JOIN daily_pick d ON d.id=m.pick_id WHERE m.layer_item_id=i.id AND d.status='published' AND d.pick_date<=$5::date))
           AND ($4::boolean = false OR EXISTS (
             SELECT 1 FROM daily_pick_layer_membership m JOIN daily_pick d ON d.id=m.pick_id
             WHERE m.layer_item_id=i.id AND d.status='published' AND d.pick_date=$5::date
           ))
           AND (i.valid_from IS NULL OR i.valid_from <= $2) AND (i.valid_until IS NULL OR i.valid_until > $2)
         ORDER BY i.position, i.id`,
        [
          layer.id,
          now,
          city.id,
          layer.rule.kind === "daily_pick",
          localDate(now, city.timezone),
        ],
      );
      for (const row of rows.rows) add({ ...row, slug: layer.slug });
      continue;
    }
    // Public viewers see only city-reviewed external places; owners and members see their own curation.
    const member = access.role !== "public";
    const rows = await pool.query(
      `SELECT s.id AS subject_id,${provider},i.note,s.city_review_status
       FROM layer_item i JOIN place_subject s ON s.id=i.subject_id
       WHERE i.layer_id=$1 AND s.status='active' AND s.catalog_place_id IS NULL
         AND ($2::boolean OR s.city_review_status='approved')
         AND (i.valid_from IS NULL OR i.valid_from <= $3) AND (i.valid_until IS NULL OR i.valid_until > $3)
       ORDER BY i.position, i.id`,
      [layer.id, member, now],
    );
    for (const row of rows.rows) add({ ...row, slug: layer.slug });
  }
  const q = state.q.toLowerCase();
  const matching = q
    ? ordered.filter((r) => (r.localNote ?? "").toLowerCase().includes(q))
    : ordered;
  const page = matching.slice(cursor, cursor + externalPageSize);
  if (page.length) {
    const picks = await pool.query<{ subject_id: string }>(
      `SELECT subject_id FROM daily_pick WHERE city_id=$1 AND pick_date=$2 AND status='published' AND subject_id=ANY($3::uuid[])`,
      [city.id, localDate(now, city.timezone), page.map((r) => r.subjectId)],
    );
    const picked = new Set(picks.rows.map((r) => r.subject_id));
    for (const ref of page) ref.isDailyPick = picked.has(ref.subjectId);
  }
  return {
    ...empty,
    references: page,
    nextCursor:
      cursor + externalPageSize < matching.length
        ? String(cursor + externalPageSize)
        : null,
    totalAuthorizedReferences: matching.length,
  };
}
/** The actor's saved external places, for the My saves page. Owner-only. */
export async function listSavedExternalPlaces(userId: string) {
  const result = await pool.query<{
    subject_id: string;
    provider_place_id: string | null;
    city_review_status: "unreviewed" | "approved";
    status: string;
  }>(
    `SELECT s.id AS subject_id,s.city_review_status,s.status,
       (SELECT r.provider_place_id FROM place_provider_reference r WHERE r.subject_id=s.id AND r.state='current' LIMIT 1) AS provider_place_id
     FROM saved_place_subject x JOIN place_subject s ON s.id=x.subject_id
     WHERE x.user_id=$1 AND s.catalog_place_id IS NULL
     ORDER BY x.created_at DESC, s.id LIMIT 100`,
    [userId],
  );
  return result.rows.map((r) => ({
    subjectId: r.subject_id,
    providerPlaceId: r.provider_place_id,
    cityReviewStatus: r.city_review_status,
    /** Hidden/deleted references stay listed so the owner can remove them, without details. */
    available: r.status === "active",
  }));
}
