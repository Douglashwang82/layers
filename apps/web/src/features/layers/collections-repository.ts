import { pool } from "@taiwanhub/database";
import type { PoolClient } from "pg";
import type { Actor } from "@taiwanhub/shared";
import type { Memberships } from "./repository";

/** Anything that can run a query: the pool or a transaction client. */
export type Db = Pick<PoolClient, "query">;

export type CollectionRecord = {
  id: string;
  slug: string;
  title: string;
  titleChinese: string;
  description: string;
  descriptionChinese: string;
  cityId: string;
  citySlug: string;
  ownerKind: "user" | "group";
  ownerUserId: string | null;
  ownerGroupId: string | null;
  ownerName: string;
  parentId: string | null;
  depth: number;
  position: number;
  audience: "private" | "group" | "public";
  reviewStatus: string;
  lifecycle: string;
  revision: number;
  sourceUrl: string;
};

export type CollectionAccess = {
  view: boolean;
  edit: boolean;
  manage: boolean;
  role: "owner" | "editor" | "viewer" | "public" | null;
};

const columns = `c.id,c.slug,c.title,c.title_chinese,c.description,c.description_chinese,c.city_id,ci.slug AS city_slug,c.owner_user_id,c.owner_group_id,
  COALESCE(u.name,g.name,'') AS owner_name,c.parent_id,c.depth,c.position,c.audience,c.review_status,c.lifecycle,c.revision,c.source_url`;
const from = `FROM layer_collection c JOIN city ci ON ci.id=c.city_id LEFT JOIN "user" u ON u.id=c.owner_user_id LEFT JOIN "group" g ON g.id=c.owner_group_id`;

function record(row: Record<string, unknown>): CollectionRecord {
  return {
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title),
    titleChinese: String(row.title_chinese ?? ""),
    description: String(row.description ?? ""),
    descriptionChinese: String(row.description_chinese ?? ""),
    cityId: String(row.city_id),
    citySlug: String(row.city_slug),
    ownerKind: row.owner_group_id ? "group" : "user",
    ownerUserId: (row.owner_user_id as string | null) ?? null,
    ownerGroupId: (row.owner_group_id as string | null) ?? null,
    ownerName: String(row.owner_name ?? ""),
    parentId: (row.parent_id as string | null) ?? null,
    depth: Number(row.depth),
    position: Number(row.position),
    audience: row.audience as CollectionRecord["audience"],
    reviewStatus: String(row.review_status),
    lifecycle: String(row.lifecycle),
    revision: Number(row.revision),
    sourceUrl: String(row.source_url ?? ""),
  };
}

/**
 * What an actor may do with a folder. Sub-folders always share their root's
 * owner, so the same rule applies at every level of a tree.
 */
export function collectionAccessFor(
  rec: CollectionRecord,
  actor: Actor | null,
  memberships: Memberships,
): CollectionAccess {
  if (rec.ownerUserId)
    return actor && actor.id === rec.ownerUserId
      ? { view: true, edit: true, manage: true, role: "owner" }
      : publicAccess(rec);
  const role = rec.ownerGroupId
    ? (memberships.get(rec.ownerGroupId) ?? null)
    : null;
  if (role)
    return {
      view: true,
      edit: role !== "viewer",
      manage: role === "owner",
      role,
    };
  return publicAccess(rec);
}

function publicAccess(rec: CollectionRecord): CollectionAccess {
  // Nothing sets a folder public yet; kept so the rule matches layers.
  const visible =
    rec.audience === "public" &&
    rec.reviewStatus === "approved" &&
    rec.lifecycle === "active";
  return {
    view: visible,
    edit: false,
    manage: false,
    role: visible ? "public" : null,
  };
}

/** One folder by id or slug, optionally locked for update. No access check. */
export async function findCollection(
  db: Db,
  idOrSlug: string,
  lock = false,
): Promise<CollectionRecord | null> {
  const result = await db.query<Record<string, unknown>>(
    `SELECT ${columns} ${from} WHERE c.slug=$1 OR c.id::text=$1${lock ? " FOR UPDATE OF c" : ""}`,
    [idOrSlug],
  );
  return result.rows[0] ? record(result.rows[0]) : null;
}

export async function findCollectionsBySlug(slugs: string[]) {
  if (!slugs.length) return [];
  const result = await pool.query<Record<string, unknown>>(
    `SELECT ${columns} ${from} WHERE c.slug=ANY($1::text[])`,
    [slugs],
  );
  return result.rows.map(record);
}

/** Top-level folders owned by the actor or by one of their groups. */
export async function listRootCollections(
  scope: "mine" | "groups",
  actor: Actor,
  options: { cityId?: string; q?: string } = {},
) {
  const values: unknown[] = [actor.id];
  const where = [
    "c.parent_id IS NULL",
    scope === "mine"
      ? "c.owner_user_id=$1"
      : "c.owner_group_id IN (SELECT group_id FROM group_member WHERE user_id=$1)",
  ];
  if (options.cityId) {
    values.push(options.cityId);
    where.push(`c.city_id=$${values.length}`);
  }
  if (options.q) {
    values.push("%" + options.q.replace(/[\\%_]/g, "\\$&") + "%");
    where.push(`(c.title || ' ' || c.title_chinese) ILIKE $${values.length}`);
  }
  const result = await pool.query<Record<string, unknown>>(
    `SELECT ${columns} ${from} WHERE ${where.join(" AND ")} ORDER BY c.updated_at DESC, c.id LIMIT 100`,
    values,
  );
  return result.rows.map(record);
}

/** Every folder in the trees under the given roots (roots included). */
export async function loadSubtrees(rootIds: string[]) {
  if (!rootIds.length) return [];
  const result = await pool.query<Record<string, unknown>>(
    `WITH RECURSIVE t AS (
       SELECT id FROM layer_collection WHERE id=ANY($1::uuid[])
       UNION
       SELECT c.id FROM layer_collection c JOIN t ON c.parent_id=t.id
     )
     SELECT ${columns} ${from} WHERE c.id IN (SELECT id FROM t)`,
    [rootIds],
  );
  return result.rows.map(record);
}

export async function loadMembers(folderIds: string[]) {
  if (!folderIds.length) return [];
  const result = await pool.query<{
    collection_id: string;
    layer_id: string;
    position: number;
  }>(
    "SELECT collection_id,layer_id,position FROM layer_collection_member WHERE collection_id=ANY($1::uuid[]) ORDER BY position, layer_id",
    [folderIds],
  );
  return result.rows.map((r) => ({
    folderId: r.collection_id,
    layerId: r.layer_id,
    position: Number(r.position),
  }));
}

/** The root of the tree a folder is in, walking up at most three hops. */
export async function rootOf(db: Db, folderId: string) {
  const result = await db.query<{ id: string }>(
    `WITH RECURSIVE up AS (
       SELECT id,parent_id,1 AS n FROM layer_collection WHERE id=$1
       UNION ALL
       SELECT c.id,c.parent_id,up.n+1 FROM layer_collection c JOIN up ON c.id=up.parent_id WHERE up.n<4
     )
     SELECT id FROM up WHERE parent_id IS NULL`,
    [folderId],
  );
  return result.rows[0]?.id ?? null;
}

/** Folder ids in the subtree of `folderId` with their depth, itself included. */
export async function subtreeOf(db: Db, folderId: string) {
  const result = await db.query<{ id: string; depth: number }>(
    `WITH RECURSIVE t AS (
       SELECT id,depth FROM layer_collection WHERE id=$1
       UNION ALL
       SELECT c.id,c.depth FROM layer_collection c JOIN t ON c.parent_id=t.id
     )
     SELECT id,depth FROM t`,
    [folderId],
  );
  return result.rows.map((r) => ({ id: r.id, depth: Number(r.depth) }));
}

/** The next free position among a folder's children (sub-folders and layers). */
export async function nextChildPosition(db: Db, parentId: string) {
  const result = await db.query<{ next: number }>(
    `SELECT GREATEST(
       COALESCE((SELECT max(position) FROM layer_collection WHERE parent_id=$1),-1),
       COALESCE((SELECT max(position) FROM layer_collection_member WHERE collection_id=$1),-1)
     )+1 AS next`,
    [parentId],
  );
  return Number(result.rows[0].next);
}
