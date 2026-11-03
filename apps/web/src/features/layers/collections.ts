import { pool } from "@taiwanhub/database";
import type { PoolClient } from "pg";
import {
  AppError,
  collectionInput,
  collectionLayerInput,
  collectionPatchInput,
  maxCollectionDepth,
  requireActor,
  type Actor,
} from "@taiwanhub/shared";
import {
  getLayer,
  getLayersById,
  getMemberships,
  listEditableLayers,
  mySavesSlug,
  type Memberships,
} from "./repository";
import { slugify, transaction, writable } from "./service";
import {
  collectionAccessFor,
  findCollection,
  listRootCollections,
  loadMembers,
  loadSubtrees,
  nextChildPosition,
  rootOf,
  subtreeOf,
  type CollectionRecord,
} from "./collections-repository";
import type {
  CollectionCandidate,
  CollectionChild,
  CollectionNode,
} from "./collections-types";

export { collectionAccessFor } from "./collections-repository";
export type { CollectionRecord } from "./collections-repository";

/** Builds nested nodes (with the viewer's access) for the trees under `roots`. */
async function buildNodes(
  roots: CollectionRecord[],
  actor: Actor | null,
  memberships: Memberships,
): Promise<CollectionNode[]> {
  const folders = await loadSubtrees(roots.map((r) => r.id));
  const members = await loadMembers(folders.map((f) => f.id));
  const layers = await getLayersById(
    [...new Set(members.map((m) => m.layerId))],
    actor,
  );
  const subfolders = new Map<string, CollectionRecord[]>();
  for (const folder of folders)
    if (folder.parentId)
      subfolders.set(folder.parentId, [
        ...(subfolders.get(folder.parentId) ?? []),
        folder,
      ]);
  const membersOf = new Map<string, typeof members>();
  for (const m of members)
    membersOf.set(m.folderId, [...(membersOf.get(m.folderId) ?? []), m]);
  const node = (rec: CollectionRecord): CollectionNode => {
    const access = collectionAccessFor(rec, actor, memberships);
    const ordered: Array<{ position: number; child: CollectionChild }> = [];
    let hiddenCount = 0;
    for (const sub of subfolders.get(rec.id) ?? [])
      ordered.push({
        position: sub.position,
        child: { kind: "folder", folder: node(sub) },
      });
    for (const m of membersOf.get(rec.id) ?? []) {
      const found = layers.get(m.layerId);
      if (
        !found ||
        !found.access.view ||
        found.layer.lifecycle === "archived"
      ) {
        hiddenCount++;
        continue;
      }
      const l = found.layer;
      ordered.push({
        position: m.position,
        child: {
          kind: "layer",
          layer: {
            id: l.id,
            slug: l.slug,
            title: l.title,
            titleChinese: l.titleChinese,
            ownerName: l.ownerName,
            count: l.itemCount,
          },
        },
      });
    }
    // Folders sort before layers at the same position; positions are normally unique.
    ordered.sort(
      (a, b) =>
        a.position - b.position ||
        (a.child.kind === b.child.kind
          ? 0
          : a.child.kind === "folder"
            ? -1
            : 1),
    );
    return {
      id: rec.id,
      slug: rec.slug,
      title: rec.title,
      titleChinese: rec.titleChinese,
      description: rec.description,
      descriptionChinese: rec.descriptionChinese,
      citySlug: rec.citySlug,
      depth: rec.depth,
      parentId: rec.parentId,
      revision: rec.revision,
      ownerKind: rec.ownerKind,
      ownerGroupId: rec.ownerGroupId,
      ownerName: rec.ownerName,
      audience: rec.audience,
      canEdit: access.edit,
      canManage: access.manage,
      children: ordered.map((o) => o.child),
      hiddenCount,
    };
  };
  return roots.map(node);
}

/** A folder tree the actor may view, or null (indistinguishable from missing). */
export async function getCollection(
  idOrSlug: string,
  actor: Actor | null,
): Promise<CollectionNode | null> {
  const rec = await findCollection(pool, idOrSlug);
  if (!rec) return null;
  const memberships = await getMemberships(actor?.id);
  if (!collectionAccessFor(rec, actor, memberships).view) return null;
  return (await buildNodes([rec], actor, memberships))[0];
}

/** Top-level folders (with their trees) the actor owns or reaches through a group. */
export async function listCollections(
  scope: "mine" | "groups",
  actor: Actor | null,
  q = "",
): Promise<CollectionNode[]> {
  const a = requireActor(actor);
  const roots = await listRootCollections(scope, a, { q });
  return buildNodes(roots, a, await getMemberships(a.id));
}

/** The map's folder picker: own and group folders, from any city (layers have no city limit). */
export async function listMapCollections(
  actor: Actor,
  city: { id: string },
): Promise<CollectionNode[]> {
  void city;
  const options = {};
  const [mine, groups] = await Promise.all([
    listRootCollections("mine", actor, options),
    listRootCollections("groups", actor, options),
  ]);
  const seen = new Set<string>();
  const roots = [...mine, ...groups].filter(
    (r) => !seen.has(r.id) && !!seen.add(r.id),
  );
  return buildNodes(roots, actor, await getMemberships(actor.id));
}

async function requireFolder(
  idOrSlug: string,
  actor: Actor,
  need: "edit" | "manage",
) {
  const rec = await findCollection(pool, idOrSlug);
  const memberships = await getMemberships(actor.id);
  const access = rec ? collectionAccessFor(rec, actor, memberships) : null;
  if (!rec || !access?.view)
    throw new AppError(404, "NOT_FOUND", "This folder is unavailable.");
  if (!access[need])
    throw new AppError(403, "FORBIDDEN", "You cannot change this folder.");
  return { rec, memberships };
}

/**
 * Serializes structural changes on every tree the folders belong to: one
 * advisory lock per root, taken in root-id order. The roots are re-read after
 * locking in case a concurrent move changed them.
 */
async function lockTrees(tx: PoolClient, folderIds: string[]) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const roots = await rootsOf(tx, folderIds);
    for (const root of roots)
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `layer_collection_tree:${root}`,
      ]);
    const again = await rootsOf(tx, folderIds);
    if (again.join() === roots.join()) return;
  }
  throw new AppError(
    409,
    "VERSION_CONFLICT",
    "Someone else changed these folders. Reload to review the latest version.",
  );
}

async function rootsOf(tx: PoolClient, folderIds: string[]) {
  const roots = new Set<string>();
  for (const id of folderIds) {
    const root = await rootOf(tx, id);
    if (!root)
      throw new AppError(404, "NOT_FOUND", "This folder is unavailable.");
    roots.add(root);
  }
  return [...roots].sort();
}

function conflict(error: unknown): never {
  if ((error as { code?: string }).code === "23505")
    throw new AppError(
      409,
      "SLUG_CONFLICT",
      "A folder with this name already exists. Try again.",
    );
  throw error;
}

/** Creates a top-level folder owned by the actor or a group, or a sub-folder inheriting its parent. */
export async function createCollection(actor: Actor | null, body: unknown) {
  writable();
  const a = requireActor(actor);
  const input = collectionInput.parse(body);
  const memberships = await getMemberships(a.id);
  const id = crypto.randomUUID();
  await transaction(async (tx) => {
    let ownerUser: string | null = a.id;
    let ownerGroup: string | null = null;
    let cityId: string;
    let audience: "private" | "group" = "private";
    let parentId: string | null = null;
    let depth = 1;
    let position: number;
    if (input.parentId) {
      const known = await findCollection(tx, input.parentId);
      if (!known)
        throw new AppError(404, "NOT_FOUND", "This folder is unavailable.");
      await lockTrees(tx, [known.id]);
      const parent = (await findCollection(tx, known.id, true))!;
      const access = collectionAccessFor(parent, a, memberships);
      if (!access.view)
        throw new AppError(404, "NOT_FOUND", "This folder is unavailable.");
      if (!access.edit)
        throw new AppError(403, "FORBIDDEN", "You cannot change this folder.");
      depth = parent.depth + 1;
      if (depth > maxCollectionDepth)
        throw new AppError(
          400,
          "FOLDER_TOO_DEEP",
          `Folders nest at most ${maxCollectionDepth} levels.`,
        );
      ownerUser = parent.ownerUserId;
      ownerGroup = parent.ownerGroupId;
      cityId = parent.cityId;
      audience = parent.audience === "group" ? "group" : "private";
      parentId = parent.id;
      position = await nextChildPosition(tx, parent.id);
    } else {
      const city = await tx.query<{ id: string }>(
        "SELECT id FROM city WHERE slug=$1",
        [input.city],
      );
      if (!city.rows[0])
        throw new AppError(400, "INVALID_CITY", "Choose a supported city.");
      cityId = city.rows[0].id;
      if (input.audience === "group") {
        const role = memberships.get(input.groupId!);
        if (!role || role === "viewer")
          throw new AppError(
            403,
            "FORBIDDEN",
            "You need an editor role in this group.",
          );
        const group = await tx.query<{ city_id: string }>(
          'SELECT city_id FROM "group" WHERE id=$1',
          [input.groupId],
        );
        if (group.rows[0]?.city_id !== cityId)
          throw new AppError(
            400,
            "CITY_MISMATCH",
            "The group belongs to a different city.",
          );
        ownerUser = null;
        ownerGroup = input.groupId!;
        audience = "group";
      }
      const next = await tx.query<{ next: number }>(
        `SELECT COALESCE(max(position),-1)+1 AS next FROM layer_collection WHERE parent_id IS NULL AND owner_user_id IS NOT DISTINCT FROM $1 AND owner_group_id IS NOT DISTINCT FROM $2`,
        [ownerUser, ownerGroup],
      );
      position = Number(next.rows[0].next);
    }
    try {
      await tx.query(
        `INSERT INTO layer_collection(id,slug,title,title_chinese,description,description_chinese,city_id,owner_user_id,owner_group_id,parent_id,depth,position,audience,created_by,updated_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)`,
        [
          id,
          slugify(input.title, id),
          input.title,
          input.titleChinese,
          input.description,
          input.descriptionChinese,
          cityId,
          ownerUser,
          ownerGroup,
          parentId,
          depth,
          position,
          audience,
          a.id,
        ],
      );
    } catch (error) {
      conflict(error);
    }
  });
  return (await getCollection(id, a))!;
}

/** Version-checked metadata, move and order changes. */
export async function updateCollection(
  actor: Actor | null,
  idOrSlug: string,
  body: unknown,
) {
  writable();
  const a = requireActor(actor);
  const input = collectionPatchInput.parse(body);
  const { rec, memberships } = await requireFolder(idOrSlug, a, "edit");
  await transaction(async (tx) => {
    const moving =
      input.parentId !== undefined && input.parentId !== rec.parentId;
    let targetId: string | null = null;
    if (moving && input.parentId) {
      const known = await findCollection(tx, input.parentId);
      if (!known)
        throw new AppError(404, "NOT_FOUND", "This folder is unavailable.");
      targetId = known.id;
    }
    await lockTrees(tx, targetId ? [rec.id, targetId] : [rec.id]);
    const subtree = await subtreeOf(tx, rec.id);
    await tx.query(
      "SELECT id FROM layer_collection WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [
        targetId
          ? [...subtree.map((s) => s.id), targetId]
          : subtree.map((s) => s.id),
      ],
    );
    const cur = await findCollection(tx, rec.id);
    if (!cur)
      throw new AppError(404, "NOT_FOUND", "This folder is unavailable.");
    if (cur.revision !== input.revision)
      throw new AppError(
        409,
        "VERSION_CONFLICT",
        "Someone else changed this folder. Reload to review the latest version.",
      );
    if (moving) {
      const target = targetId ? await findCollection(tx, targetId) : null;
      if (target) {
        const targetAccess = collectionAccessFor(target, a, memberships);
        if (!targetAccess.view)
          throw new AppError(404, "NOT_FOUND", "This folder is unavailable.");
        if (!targetAccess.edit)
          throw new AppError(
            403,
            "FORBIDDEN",
            "You cannot change this folder.",
          );
        if (
          target.ownerUserId !== cur.ownerUserId ||
          target.ownerGroupId !== cur.ownerGroupId ||
          target.cityId !== cur.cityId
        )
          throw new AppError(
            400,
            "FOLDER_MISMATCH",
            "A folder can only move within the same owner and city.",
          );
        if (subtree.some((s) => s.id === target.id))
          throw new AppError(
            400,
            "FOLDER_CYCLE",
            "A folder cannot move into itself or its sub-folders.",
          );
      }
      const height = Math.max(...subtree.map((s) => s.depth)) - cur.depth + 1;
      const newDepth = target ? target.depth + 1 : 1;
      if (newDepth + height - 1 > maxCollectionDepth)
        throw new AppError(
          400,
          "FOLDER_TOO_DEEP",
          `Folders nest at most ${maxCollectionDepth} levels.`,
        );
      await tx.query(
        "UPDATE layer_collection SET depth=depth+$2 WHERE id=ANY($1::uuid[])",
        [subtree.map((s) => s.id), newDepth - cur.depth],
      );
      let position: number;
      if (target) position = await nextChildPosition(tx, target.id);
      else {
        const next = await tx.query<{ next: number }>(
          `SELECT COALESCE(max(position),-1)+1 AS next FROM layer_collection WHERE parent_id IS NULL AND owner_user_id IS NOT DISTINCT FROM $1 AND owner_group_id IS NOT DISTINCT FROM $2`,
          [cur.ownerUserId, cur.ownerGroupId],
        );
        position = Number(next.rows[0].next);
      }
      await tx.query(
        "UPDATE layer_collection SET parent_id=$2,position=$3 WHERE id=$1",
        [cur.id, target?.id ?? null, position],
      );
    }
    if (input.order) await reorderChildren(tx, cur.id, input.order);
    await tx.query(
      `UPDATE layer_collection SET title=COALESCE($2,title),title_chinese=COALESCE($3,title_chinese),description=COALESCE($4,description),description_chinese=COALESCE($5,description_chinese),revision=revision+1,updated_by=$6,updated_at=now() WHERE id=$1`,
      [
        cur.id,
        input.title ?? null,
        input.titleChinese ?? null,
        input.description ?? null,
        input.descriptionChinese ?? null,
        a.id,
      ],
    );
  });
  return (await getCollection(rec.id, a))!;
}

/** Re-sequences direct children: listed ones first in the given order, unlisted ones after. */
async function reorderChildren(
  tx: PoolClient,
  folderId: string,
  order: Array<{ kind: "folder" | "layer"; id: string }>,
) {
  const [folders, layers] = await Promise.all([
    tx.query<{ id: string; position: number }>(
      "SELECT id,position FROM layer_collection WHERE parent_id=$1",
      [folderId],
    ),
    tx.query<{ id: string; position: number }>(
      "SELECT layer_id AS id,position FROM layer_collection_member WHERE collection_id=$1",
      [folderId],
    ),
  ]);
  const current = [
    ...folders.rows.map((r) => ({ kind: "folder" as const, ...r })),
    ...layers.rows.map((r) => ({ kind: "layer" as const, ...r })),
  ];
  const keyOf = (c: { kind: string; id: string }) => `${c.kind}:${c.id}`;
  const known = new Set(current.map(keyOf));
  const listed = new Set<string>();
  for (const entry of order) {
    const key = keyOf(entry);
    if (!known.has(key) || listed.has(key))
      throw new AppError(
        400,
        "ORDER_MISMATCH",
        "The order must list direct children of this folder, once each.",
      );
    listed.add(key);
  }
  const rest = current
    .filter((c) => !listed.has(keyOf(c)))
    .sort((x, y) => x.position - y.position);
  for (const [position, entry] of [...order, ...rest].entries())
    if (entry.kind === "folder")
      await tx.query(
        "UPDATE layer_collection SET position=$2 WHERE id=$1 AND parent_id=$3",
        [entry.id, position, folderId],
      );
    else
      await tx.query(
        "UPDATE layer_collection_member SET position=$3 WHERE collection_id=$1 AND layer_id=$2",
        [folderId, entry.id, position],
      );
}

/** Deleting a folder removes its sub-folders and memberships, never layers. */
export async function deleteCollection(actor: Actor | null, idOrSlug: string) {
  writable();
  const a = requireActor(actor);
  const { rec } = await requireFolder(idOrSlug, a, "manage");
  await transaction(async (tx) => {
    await lockTrees(tx, [rec.id]);
    const subtree = await subtreeOf(tx, rec.id);
    await tx.query(
      "SELECT id FROM layer_collection WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [subtree.map((s) => s.id)],
    );
    await tx.query("DELETE FROM layer_collection WHERE id=$1", [rec.id]);
  });
  return { deleted: true };
}

export async function addLayerToCollection(
  actor: Actor | null,
  idOrSlug: string,
  body: unknown,
) {
  writable();
  const a = requireActor(actor);
  const input = collectionLayerInput.parse(body);
  const { rec } = await requireFolder(idOrSlug, a, "edit");
  const found = await getLayer(input.layerId, a);
  if (!found)
    throw new AppError(404, "NOT_FOUND", "This layer is unavailable.");
  if (
    found.layer.ownerKind === "system" ||
    found.layer.slug === mySavesSlug ||
    found.layer.lifecycle === "archived"
  )
    throw new AppError(
      400,
      "LAYER_NOT_ALLOWED",
      "This layer cannot be added to a folder.",
    );
  await transaction(async (tx) => {
    const locked = await findCollection(tx, rec.id, true);
    if (!locked)
      throw new AppError(404, "NOT_FOUND", "This folder is unavailable.");
    const position = await nextChildPosition(tx, rec.id);
    const added = await tx.query(
      "INSERT INTO layer_collection_member(collection_id,layer_id,position) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [rec.id, found.layer.id, position],
    );
    if (added.rowCount)
      await tx.query(
        "UPDATE layer_collection SET revision=revision+1,updated_by=$2,updated_at=now() WHERE id=$1",
        [rec.id, a.id],
      );
  });
  return (await getCollection(rec.id, a))!;
}

export async function removeLayerFromCollection(
  actor: Actor | null,
  idOrSlug: string,
  layerId: string,
) {
  writable();
  const a = requireActor(actor);
  const { rec } = await requireFolder(idOrSlug, a, "edit");
  await transaction(async (tx) => {
    await findCollection(tx, rec.id, true);
    const removed = await tx.query(
      "DELETE FROM layer_collection_member WHERE collection_id=$1 AND layer_id=$2",
      [rec.id, layerId],
    );
    if (removed.rowCount)
      await tx.query(
        "UPDATE layer_collection SET revision=revision+1,updated_by=$2,updated_at=now() WHERE id=$1",
        [rec.id, a.id],
      );
  });
  return (await getCollection(rec.id, a))!;
}

/** Layers the actor can edit that may be added to this folder (not already in it). */
export async function listCollectionCandidates(
  actor: Actor | null,
  idOrSlug: string,
): Promise<CollectionCandidate[]> {
  const a = requireActor(actor);
  const { rec } = await requireFolder(idOrSlug, a, "edit");
  const [editable, members] = await Promise.all([
    listEditableLayers(a),
    loadMembers([rec.id]),
  ]);
  const inFolder = new Set(members.map((m) => m.layerId));
  return editable
    .filter((l) => !inFolder.has(l.id) && l.lifecycle !== "archived")
    .map((l) => ({
      id: l.id,
      slug: l.slug,
      title: l.title,
      titleChinese: l.titleChinese,
      ownerName: l.ownerName,
    }));
}
