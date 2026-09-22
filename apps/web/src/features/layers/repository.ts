import { pool } from "@taiwanhub/database";
import {
  AppError,
  type Actor,
  type LayerAudience,
  type LayerLifecycle,
  type LayerOwnerKind,
  type LayerReviewStatus,
  type LayerSchedule,
  type SystemRule,
  systemRule,
} from "@taiwanhub/shared";
export type GroupRole = "owner" | "editor" | "viewer";
export type LayerRecord = {
  id: string;
  slug: string;
  title: string;
  titleChinese: string;
  description: string;
  descriptionChinese: string;
  cityId: string;
  citySlug: string;
  cityName: string;
  timezone: string;
  ownerKind: LayerOwnerKind;
  ownerUserId: string | null;
  ownerGroupId: string | null;
  ownerName: string;
  ownerSlug: string | null;
  audience: LayerAudience;
  schedule: LayerSchedule;
  startsOn: string | null;
  endsOn: string | null;
  rule: SystemRule | null;
  lifecycle: LayerLifecycle;
  reviewStatus: LayerReviewStatus;
  revision: number;
  coverImage: string | null;
  itemCount: number;
  followerCount: number;
  updatedAt: string;
  updatedByName: string | null;
};
export type LayerAccess = {
  view: boolean;
  apply: boolean;
  edit: boolean;
  manage: boolean;
  following: boolean;
  role: "owner" | "editor" | "viewer" | "system" | "public" | null;
};
export type Memberships = Map<string, GroupRole>;
/** Virtual projection over the user's saved tables; never a second migrated collection. */
export const mySavesSlug = "my-saves";
const columns = `l.id,l.slug,l.title,l.title_chinese,l.description,l.description_chinese,l.city_id,c.slug AS city_slug,c.name AS city_name,c.timezone,l.owner_kind,l.owner_user_id,l.owner_group_id,
  CASE l.owner_kind WHEN 'system' THEN 'TaiwanHub' WHEN 'user' THEN COALESCE(u.name,'') ELSE COALESCE(g.name,'') END AS owner_name,
  CASE l.owner_kind WHEN 'group' THEN g.slug ELSE NULL END AS owner_slug,
  l.audience,l.schedule,l.starts_on::text AS starts_on,l.ends_on::text AS ends_on,l.rule,l.lifecycle,l.review_status,l.revision,l.cover_image,l.updated_at,
  (SELECT count(*)::int FROM layer_item i WHERE i.layer_id=l.id) AS item_count,
  (SELECT count(*)::int FROM layer_follow f WHERE f.layer_id=l.id) AS follower_count,
  (SELECT name FROM "user" ub WHERE ub.id=l.updated_by) AS updated_by_name`;
const from = `FROM layer l JOIN city c ON c.id=l.city_id LEFT JOIN "user" u ON u.id=l.owner_user_id LEFT JOIN "group" g ON g.id=l.owner_group_id`;
function record(row: Record<string, unknown>): LayerRecord {
  const rule = row.rule ? systemRule.safeParse(row.rule) : null;
  return {
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title),
    titleChinese: String(row.title_chinese ?? ""),
    description: String(row.description ?? ""),
    descriptionChinese: String(row.description_chinese ?? ""),
    cityId: String(row.city_id),
    citySlug: String(row.city_slug),
    cityName: String(row.city_name),
    timezone: String(row.timezone),
    ownerKind: row.owner_kind as LayerOwnerKind,
    ownerUserId: (row.owner_user_id as string | null) ?? null,
    ownerGroupId: (row.owner_group_id as string | null) ?? null,
    ownerName: String(row.owner_name ?? ""),
    ownerSlug: (row.owner_slug as string | null) ?? null,
    audience: row.audience as LayerAudience,
    schedule: row.schedule as LayerSchedule,
    startsOn: (row.starts_on as string | null) ?? null,
    endsOn: (row.ends_on as string | null) ?? null,
    rule: rule?.success ? rule.data : null,
    lifecycle: row.lifecycle as LayerLifecycle,
    reviewStatus: row.review_status as LayerReviewStatus,
    revision: Number(row.revision),
    coverImage: (row.cover_image as string | null) ?? null,
    itemCount: Number(row.item_count ?? 0),
    followerCount: Number(row.follower_count ?? 0),
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : String(row.updated_at),
    updatedByName: (row.updated_by_name as string | null) ?? null,
  };
}
export function mySavesLayer(
  actor: Actor,
  city: { id: string; slug: string; name: string; timezone: string },
): LayerRecord {
  return {
    id: `saves:${actor.id}`,
    slug: mySavesSlug,
    title: "My saves",
    titleChinese: "我的收藏",
    description: "Everything you have saved, shown on the map. Private to you.",
    descriptionChinese: "你收藏的所有內容，顯示在地圖上。僅你可見。",
    cityId: city.id,
    citySlug: city.slug,
    cityName: city.name,
    timezone: city.timezone,
    ownerKind: "user",
    ownerUserId: actor.id,
    ownerGroupId: null,
    ownerName: "You",
    ownerSlug: null,
    audience: "private",
    schedule: "evergreen",
    startsOn: null,
    endsOn: null,
    rule: { version: 1, kind: "saves" },
    lifecycle: "active",
    reviewStatus: "unsubmitted",
    revision: 1,
    coverImage: null,
    itemCount: 0,
    followerCount: 0,
    updatedAt: new Date().toISOString(),
    updatedByName: null,
  };
}
export async function getMemberships(userId?: string): Promise<Memberships> {
  if (!userId) return new Map();
  const result = await pool.query<{ group_id: string; role: GroupRole }>(
    "SELECT group_id,role FROM group_member WHERE user_id=$1",
    [userId],
  );
  return new Map(result.rows.map((r) => [r.group_id, r.role]));
}
/** Public visibility means approved review, active lifecycle and a public audience. */
export function isPubliclyVisible(layer: LayerRecord) {
  return (
    layer.audience === "public" &&
    layer.reviewStatus === "approved" &&
    layer.lifecycle === "active"
  );
}
export function accessFor(
  layer: LayerRecord,
  actor: Actor | null,
  memberships: Memberships,
  following = false,
): LayerAccess {
  if (layer.ownerKind === "system")
    return {
      view: true,
      apply: true,
      edit: false,
      manage: false,
      following,
      role: "system",
    };
  if (layer.ownerKind === "user") {
    const owner = !!actor && actor.id === layer.ownerUserId;
    if (owner)
      return {
        view: true,
        apply: true,
        edit: true,
        manage: true,
        following,
        role: "owner",
      };
    const visible = isPubliclyVisible(layer);
    return {
      view: visible,
      apply: visible,
      edit: false,
      manage: false,
      following,
      role: visible ? "public" : null,
    };
  }
  const role = layer.ownerGroupId
    ? (memberships.get(layer.ownerGroupId) ?? null)
    : null;
  if (role)
    return {
      view: true,
      apply: true,
      edit: role !== "viewer",
      manage: role === "owner",
      following,
      role,
    };
  const visible = isPubliclyVisible(layer);
  return {
    view: visible,
    apply: visible,
    edit: false,
    manage: false,
    following,
    role: visible ? "public" : null,
  };
}
async function followingSet(userId?: string) {
  if (!userId) return new Set<string>();
  const result = await pool.query<{ layer_id: string }>(
    "SELECT layer_id FROM layer_follow WHERE user_id=$1",
    [userId],
  );
  return new Set(result.rows.map((r) => r.layer_id));
}
export type LayerWithAccess = { layer: LayerRecord; access: LayerAccess };
/** A layer the actor may view, or null. Inaccessible layers are indistinguishable from missing ones. */
export async function getLayer(
  idOrSlug: string,
  actor: Actor | null,
  city?: { id: string; slug: string; name: string; timezone: string },
): Promise<LayerWithAccess | null> {
  if (idOrSlug === mySavesSlug) {
    if (!actor || !city) return null;
    return {
      layer: mySavesLayer(actor, city),
      access: {
        view: true,
        apply: true,
        edit: false,
        manage: false,
        following: false,
        role: "owner",
      },
    };
  }
  const result = await pool.query<Record<string, unknown>>(
    `SELECT ${columns} ${from} WHERE l.slug=$1 OR l.id::text=$1`,
    [idOrSlug],
  );
  if (!result.rows[0]) return null;
  const layer = record(result.rows[0]);
  const [memberships, following] = await Promise.all([
    getMemberships(actor?.id),
    followingSet(actor?.id),
  ]);
  const access = accessFor(layer, actor, memberships, following.has(layer.id));
  return access.view ? { layer, access } : null;
}
export async function requireEditableLayer(id: string, actor: Actor) {
  const found = await getLayer(id, actor);
  if (!found)
    throw new AppError(404, "NOT_FOUND", "This layer is unavailable.");
  if (!found.access.edit)
    throw new AppError(403, "FORBIDDEN", "You cannot edit this layer.");
  return found;
}
/**
 * Resolve applied layer slugs for a map query. Unavailable slugs are reported
 * without titles or counts; other-city layers are reported so the UI can
 * explain why they were hidden.
 */
export async function resolveLayers(
  slugs: string[],
  actor: Actor | null,
  city: { id: string; slug: string; name: string; timezone: string },
) {
  const resolved: LayerWithAccess[] = [];
  const unavailable: string[] = [];
  const otherCity: LayerWithAccess[] = [];
  if (!slugs.length) return { resolved, unavailable, otherCity };
  const [memberships, following, result] = await Promise.all([
    getMemberships(actor?.id),
    followingSet(actor?.id),
    pool.query<Record<string, unknown>>(
      `SELECT ${columns} ${from} WHERE l.slug=ANY($1::text[])`,
      [slugs.filter((s) => s !== mySavesSlug)],
    ),
  ]);
  const bySlug = new Map(result.rows.map((r) => [String(r.slug), record(r)]));
  for (const slug of slugs) {
    if (slug === mySavesSlug) {
      if (actor)
        resolved.push({
          layer: mySavesLayer(actor, city),
          access: {
            view: true,
            apply: true,
            edit: false,
            manage: false,
            following: false,
            role: "owner",
          },
        });
      else unavailable.push(slug);
      continue;
    }
    const layer = bySlug.get(slug);
    if (!layer) {
      unavailable.push(slug);
      continue;
    }
    const access = accessFor(
      layer,
      actor,
      memberships,
      following.has(layer.id),
    );
    if (!access.view || layer.lifecycle === "archived") {
      unavailable.push(slug);
      continue;
    }
    if (layer.cityId !== city.id) otherCity.push({ layer, access });
    else resolved.push({ layer, access });
  }
  return { resolved, unavailable, otherCity };
}
export type LibraryScope = "discover" | "following" | "mine" | "groups";
/** Library tabs: a finite curated set, not an infinite feed. Search matches title, owner and purpose. */
export async function listLibrary(
  scope: LibraryScope,
  actor: Actor | null,
  city: { id: string; slug: string; name: string; timezone: string },
  q = "",
): Promise<LayerWithAccess[]> {
  const values: unknown[] = [];
  const where: string[] = [];
  if (scope === "discover") {
    values.push(city.id);
    where.push(
      `l.city_id=$1 AND l.lifecycle='active' AND l.audience='public' AND l.review_status='approved'`,
    );
  } else if (!actor) return [];
  else if (scope === "following") {
    values.push(actor.id);
    where.push(
      `l.id IN (SELECT layer_id FROM layer_follow WHERE user_id=$1) AND l.lifecycle<>'archived'`,
    );
  } else if (scope === "mine") {
    values.push(actor.id);
    where.push(`l.owner_kind='user' AND l.owner_user_id=$1`);
  } else {
    values.push(actor.id);
    where.push(
      `l.owner_kind='group' AND l.owner_group_id IN (SELECT group_id FROM group_member WHERE user_id=$1) AND l.lifecycle<>'archived'`,
    );
  }
  if (q) {
    values.push("%" + q.replace(/[\\%_]/g, "\\$&") + "%");
    where.push(
      `(l.title || ' ' || l.title_chinese || ' ' || l.description || ' ' || l.description_chinese || ' ' || COALESCE(u.name,'') || ' ' || COALESCE(g.name,'')) ILIKE $${values.length}`,
    );
  }
  const result = await pool.query<Record<string, unknown>>(
    `SELECT ${columns} ${from} WHERE ${where.join(" AND ")} ORDER BY (l.owner_kind='system') DESC, l.lifecycle='archived', l.updated_at DESC LIMIT 100`,
    values,
  );
  const [memberships, following] = await Promise.all([
    getMemberships(actor?.id),
    followingSet(actor?.id),
  ]);
  const layers = result.rows
    .map(record)
    .map((layer) => ({
      layer,
      access: accessFor(layer, actor, memberships, following.has(layer.id)),
    }))
    .filter((entry) => entry.access.view);
  if (scope === "mine" && actor)
    layers.unshift({
      layer: mySavesLayer(actor, city),
      access: {
        view: true,
        apply: true,
        edit: false,
        manage: false,
        following: false,
        role: "owner",
      },
    });
  return layers;
}
/** Layers the actor can add items to, for the Add-to-layer picker. */
export async function listEditableLayers(actor: Actor) {
  const [mine, groups] = await Promise.all([
    pool.query<Record<string, unknown>>(
      `SELECT ${columns} ${from} WHERE l.owner_kind='user' AND l.owner_user_id=$1 AND l.lifecycle<>'archived' ORDER BY l.updated_at DESC LIMIT 50`,
      [actor.id],
    ),
    pool.query<Record<string, unknown>>(
      `SELECT ${columns} ${from} WHERE l.owner_kind='group' AND l.lifecycle<>'archived' AND l.owner_group_id IN (SELECT group_id FROM group_member WHERE user_id=$1 AND role IN ('owner','editor')) ORDER BY l.updated_at DESC LIMIT 50`,
      [actor.id],
    ),
  ]);
  return [...mine.rows, ...groups.rows].map(record);
}
/** Membership row ids in curated order, for reordering and editor bookkeeping. */
export async function listLayerItemRefs(layerId: string) {
  const result = await pool.query<{
    id: string;
    place_id: string | null;
    event_id: string | null;
    content_id: string | null;
  }>(
    "SELECT id,place_id,event_id,content_id FROM layer_item WHERE layer_id=$1 ORDER BY position, created_at",
    [layerId],
  );
  return result.rows.map((r) => ({
    id: r.id,
    key: r.place_id
      ? `place:${r.place_id}`
      : r.event_id
        ? `event:${r.event_id}`
        : `content:${r.content_id}`,
  }));
}
export async function getMapPreference(userId?: string) {
  if (!userId) return null;
  const result = await pool.query<{
    active_layers: string[];
    view: "map" | "list";
  }>("SELECT active_layers,view FROM user_map_preference WHERE user_id=$1", [
    userId,
  ]);
  return result.rows[0]
    ? { layers: result.rows[0].active_layers, view: result.rows[0].view }
    : null;
}
export async function setMapPreference(
  userId: string,
  preference: { layers: string[]; view: "map" | "list" },
) {
  await pool.query(
    `INSERT INTO user_map_preference(user_id,active_layers,view) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET active_layers=$2,view=$3,updated_at=now()`,
    [userId, JSON.stringify(preference.layers), preference.view],
  );
  return preference;
}
