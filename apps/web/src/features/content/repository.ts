import { pool } from "@taiwanhub/database";
import {
  AppError,
  isModerator,
  type Actor,
  type LocationStatus,
} from "@taiwanhub/shared";
/** A local tip, short guide, photo note or sourced link. Its location can be optional. */
export type ContentPost = {
  id: string;
  slug: string;
  title: string;
  titleChinese: string;
  body: string;
  image: string | null;
  sourceUrl: string | null;
  authorId: string;
  authorName: string;
  cityId: string;
  citySlug: string;
  placeId: string | null;
  placeName: string | null;
  placeSlug: string | null;
  eventId: string | null;
  eventName: string | null;
  eventSlug: string | null;
  locationStatus: LocationStatus;
  neighborhood: string;
  latitude: number | null;
  longitude: number | null;
  validFrom: string | null;
  validUntil: string | null;
  status: string;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  saved: boolean;
};
const select = `SELECT c.*, u.name AS author_name, ci.slug AS city_slug, p.name AS place_name, p.slug AS place_slug, e.name AS event_name, e.slug AS event_slug,
  COALESCE(p.latitude, c.latitude) AS point_latitude, COALESCE(p.longitude, c.longitude) AS point_longitude
  FROM content_post c JOIN "user" u ON u.id=c.author_id JOIN city ci ON ci.id=c.city_id
  LEFT JOIN place p ON p.id=c.place_id AND p.status='approved'
  LEFT JOIN event e ON e.id=c.event_id AND e.status='approved'`;
const iso = (v: unknown) =>
  v instanceof Date ? v.toISOString() : v == null ? null : String(v);
export function contentPost(
  r: Record<string, unknown>,
  saved = false,
): ContentPost {
  const status = String(r.location_status) as LocationStatus;
  const mapped = status === "exact" && r.point_latitude != null;
  return {
    id: String(r.id),
    slug: String(r.slug),
    title: String(r.title),
    titleChinese: String(r.title_chinese ?? ""),
    body: String(r.body),
    image: (r.image as string) ?? null,
    sourceUrl: (r.source_url as string) ?? null,
    authorId: String(r.author_id),
    authorName: String(r.author_name ?? ""),
    cityId: String(r.city_id),
    citySlug: String(r.city_slug),
    placeId: (r.place_id as string) ?? null,
    placeName: (r.place_name as string) ?? null,
    placeSlug: (r.place_slug as string) ?? null,
    eventId: (r.event_id as string) ?? null,
    eventName: (r.event_name as string) ?? null,
    eventSlug: (r.event_slug as string) ?? null,
    locationStatus: status,
    neighborhood: String(r.neighborhood ?? ""),
    latitude: mapped ? Number(r.point_latitude) : null,
    longitude: mapped ? Number(r.point_longitude) : null,
    validFrom: iso(r.valid_from),
    validUntil: iso(r.valid_until),
    status: String(r.status),
    isDemo: Boolean(r.is_demo),
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    saved,
  };
}
/** Approved posts are public; authors and moderators can also read pending/hidden ones. */
export async function getContentPost(idOrSlug: string, actor: Actor | null) {
  const result = await pool.query<Record<string, unknown>>(
    `${select} WHERE (c.id::text=$1 OR c.slug=$1)`,
    [idOrSlug],
  );
  const row = result.rows[0];
  if (!row) throw new AppError(404, "NOT_FOUND", "This item is unavailable.");
  const own = !!actor && actor.id === row.author_id;
  const privileged = !!actor && isModerator(actor.role);
  if (row.status !== "approved" && !own && !privileged)
    throw new AppError(404, "NOT_FOUND", "This item is unavailable.");
  const saved = actor
    ? !!(
        await pool.query(
          "SELECT 1 FROM saved_content WHERE content_id=$1 AND user_id=$2",
          [row.id, actor.id],
        )
      ).rowCount
    : false;
  return contentPost(row, saved);
}
export async function listContentPosts(input: {
  city: string;
  q?: string;
  authorId?: string;
  includeOwnPending?: boolean;
  limit?: number;
}) {
  const values: unknown[] = [input.city];
  const where = [`ci.slug=$1`];
  if (input.authorId) {
    values.push(input.authorId);
    where.push(`c.author_id=$${values.length}`);
    if (!input.includeOwnPending) where.push(`c.status='approved'`);
  } else where.push(`c.status='approved'`);
  if (input.q) {
    values.push("%" + input.q.replace(/[\\%_]/g, "\\$&") + "%");
    where.push(
      `(c.title || ' ' || c.title_chinese || ' ' || c.body) ILIKE $${values.length}`,
    );
  }
  const result = await pool.query<Record<string, unknown>>(
    `${select} WHERE ${where.join(" AND ")} ORDER BY c.created_at DESC LIMIT ${Math.min(input.limit ?? 50, 200)}`,
    values,
  );
  return result.rows.map((r) => contentPost(r));
}
