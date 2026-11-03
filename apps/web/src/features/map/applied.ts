import { pool } from "@taiwanhub/database";
import {
  maxExpandedLayers,
  type Actor,
  type MapState,
} from "@taiwanhub/shared";
import {
  getMemberships,
  resolveLayers,
  type LayerWithAccess,
} from "../layers/repository";
import {
  collectionAccessFor,
  findCollectionsBySlug,
} from "../layers/collections-repository";
import type { CollectionAvailability } from "../layers/collections-types";

type City = { id: string; slug: string; name: string; timezone: string };

/** The explicitly applied layer slugs (`none` means none). */
export function explicitLayers(state: Pick<MapState, "layers">) {
  return state.layers === "none" ? [] : state.layers;
}

/** True when the state applies at least one layer or folder. */
export function hasApplied(state: Pick<MapState, "layers" | "collections">) {
  return explicitLayers(state).length > 0 || !!state.collections?.length;
}

/** Upper bound on layers read per applied folder before access filtering. */
const folderLayerScanLimit = 500;

/**
 * Layers of each applied folder's subtree in tree order (depth-first by
 * position), for the folders the viewer may see. Missing, unviewable and
 * archived folders are `unavailable`.
 */
async function expandFolders(slugs: string[], actor: Actor | null) {
  const found = await findCollectionsBySlug(slugs);
  const memberships = await getMemberships(actor?.id);
  const bySlug = new Map(found.map((rec) => [rec.slug, rec]));
  const usable = new Map(
    found
      .filter(
        (rec) =>
          collectionAccessFor(rec, actor, memberships).view &&
          rec.lifecycle !== "archived",
      )
      .map((rec) => [rec.id, rec]),
  );
  const layersByRoot = new Map<string, string[]>();
  if (usable.size) {
    const rows = await pool.query<{ root: string; slug: string }>(
      `WITH RECURSIVE t AS (
         SELECT id, id AS root, ARRAY[]::int[] AS path FROM layer_collection WHERE id=ANY($1::uuid[])
         UNION ALL
         SELECT c.id, t.root, t.path || c.position FROM layer_collection c JOIN t ON c.parent_id=t.id
       )
       SELECT root, slug FROM (
         SELECT t.root, l.slug,
                row_number() OVER (PARTITION BY t.root ORDER BY (t.path || m.position), l.slug) AS rn,
                t.path || m.position AS ord
         FROM t JOIN layer_collection_member m ON m.collection_id=t.id JOIN layer l ON l.id=m.layer_id
       ) ranked
       WHERE rn <= $2
       ORDER BY root, rn`,
      [[...usable.keys()], folderLayerScanLimit],
    );
    // A layer filed twice in one tree counts once, at its first position.
    for (const row of rows.rows) {
      const list = layersByRoot.get(row.root) ?? [];
      if (!list.includes(row.slug)) list.push(row.slug);
      layersByRoot.set(row.root, list);
    }
  }
  return slugs.map((slug) => {
    const rec = bySlug.get(slug);
    const available = rec ? usable.get(rec.id) : undefined;
    return {
      slug,
      rec: available ?? null,
      layerSlugs: available ? (layersByRoot.get(available.id) ?? []) : [],
    };
  });
}

/**
 * Resolves the explicit layers plus the layers of every applied folder.
 * Folder layers go through the same access checks as explicit ones; the
 * `maxExpandedLayers` cap applies to what survives them, across all folders.
 * `resolved` holds explicit and expanded layers; `unavailable` and
 * `disabled` report explicit slugs only.
 */
export async function resolveAppliedLayers(
  state: Pick<MapState, "layers" | "collections">,
  actor: Actor | null,
  city: City,
) {
  const explicit = explicitLayers(state);
  const folders = await expandFolders(state.collections ?? [], actor);
  const explicitSet = new Set(explicit);
  const candidates = new Set(explicit);
  for (const folder of folders)
    for (const slug of folder.layerSlugs) candidates.add(slug);
  const base = await resolveLayers([...candidates], actor, city);
  const okBySlug = new Map(base.resolved.map((r) => [r.layer.slug, r]));
  const kept = new Set<string>();
  const counted = new Set<string>();
  const collections: CollectionAvailability[] = [];
  for (const folder of folders) {
    if (!folder.rec) {
      collections.push({
        slug: folder.slug,
        title: "",
        titleChinese: "",
        status: "unavailable",
        layerSlugs: [],
        hiddenCount: 0,
        truncated: false,
        count: 0,
      });
      continue;
    }
    const layerSlugs: string[] = [];
    let truncated = false;
    let visible = 0;
    for (const slug of folder.layerSlugs) {
      if (!okBySlug.has(slug)) continue;
      visible++;
      if (explicitSet.has(slug) || counted.has(slug)) {
        layerSlugs.push(slug);
        kept.add(slug);
      } else if (counted.size < maxExpandedLayers) {
        counted.add(slug);
        kept.add(slug);
        layerSlugs.push(slug);
      } else truncated = true;
    }
    collections.push({
      slug: folder.slug,
      id: folder.rec.id,
      title: folder.rec.title,
      titleChinese: folder.rec.titleChinese,
      status: "ok",
      layerSlugs,
      hiddenCount: folder.layerSlugs.length - visible,
      truncated,
      count: 0,
    });
  }
  const resolved: LayerWithAccess[] = base.resolved.filter(
    (r) => explicitSet.has(r.layer.slug) || kept.has(r.layer.slug),
  );
  return {
    resolved,
    unavailable: base.unavailable.filter((s) => explicitSet.has(s)),
    disabled: base.disabled.filter((s) => explicitSet.has(s)),
    collections,
  };
}
