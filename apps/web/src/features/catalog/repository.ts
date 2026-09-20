import { pool } from "@taiwanhub/database";
import {
  AppError,
  type Kind,
  type ListInput,
  placeRank,
  recommendationScore,
} from "@taiwanhub/shared";
export const tables = {
  places: "place",
  events: "event",
  products: "product",
  organizations: "organization",
} as const;
export type Content = {
  id: string;
  slug: string;
  name: string;
  nameChinese: string;
  description: string;
  descriptionChinese: string;
  image: string;
  category: string;
  status: string;
  isDemo: boolean;
  cityId?: string;
  neighborhood?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  positive: number;
  responses: number;
  score: number | null;
  attending: number;
  organizerId?: string;
  organizerName?: string;
  startTime?: string;
  endTime?: string;
  capacity?: number;
  venue?: string;
  hours?: string;
  priceLevel?: number;
  externalRating?: number;
  website?: string;
  phone?: string;
  brand?: string;
  onlineUrl?: string;
  source: string;
  aliases?: string;
  instagram?: string;
  facebook?: string;
  verificationStatus: string;
  lastVerifiedAt?: string;
};
function camel(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      v instanceof Date ? v.toISOString() : v,
    ]),
  );
}
function content(row: Record<string, unknown>): Content {
  const r = camel(row);
  const positive = Number(r.positive ?? 0),
    responses = Number(r.responses ?? 0);
  return {
    ...r,
    positive,
    responses,
    score: recommendationScore(positive, responses),
    attending: Number(r.attending ?? 0),
  } as Content;
}
const extra = (kind: Kind) =>
  kind === "places"
    ? `, (SELECT count(*)::int FROM place_recommendation r WHERE r.place_id = p.id AND r.status = 'approved') AS responses, (SELECT count(*)::int FROM place_recommendation r WHERE r.place_id = p.id AND r.status = 'approved' AND positive) AS positive`
    : kind === "events"
      ? `, (SELECT count(*)::int FROM event_rsvp r WHERE r.event_id=p.id) AS attending, (SELECT name FROM organization o WHERE o.id=p.organizer_id) AS organizer_name`
      : "";
export async function getCities() {
  return (
    await pool.query<{
      id: string;
      slug: string;
      name: string;
      timezone: string;
    }>("SELECT id,slug,name,timezone FROM city ORDER BY name")
  ).rows;
}
export async function listContent(kind: Kind, input: ListInput) {
  const values: unknown[] = [];
  const bind = (v: unknown) => {
    values.push(v);
    return `$${values.length}`;
  };
  const where = [`p.status='approved'`];
  if (kind !== "products")
    where.push(
      `p.city_id=(SELECT id FROM city WHERE slug=${bind(input.city)})`,
    );
  if (input.q)
    where.push(
      `(p.name || ' ' || p.name_chinese || ' ' || p.aliases || ' ' || p.description) ILIKE ${bind("%" + input.q.replace(/[\\%_]/g, "\\$&") + "%")}`,
    );
  if (input.category) where.push(`p.category=${bind(input.category)}`);
  if (input.neighborhood && (kind === "places" || kind === "events"))
    where.push(`p.neighborhood=${bind(input.neighborhood)}`);
  if (kind === "events") {
    where.push("p.end_time > now()");
    if (input.organization)
      where.push(`p.organizer_id=${bind(input.organization)}`);
    const zone = `(SELECT timezone FROM city WHERE id=p.city_id)`;
    const today = `date_trunc('day',now() AT TIME ZONE ${zone})`;
    const week = `date_trunc('week',now() AT TIME ZONE ${zone})`;
    if (input.period === "today")
      where.push(
        `p.start_time < ((${today}+interval '1 day') AT TIME ZONE ${zone})`,
      );
    if (input.period === "week")
      where.push(
        `p.start_time < ((${week}+interval '7 days') AT TIME ZONE ${zone})`,
      );
    if (input.period === "weekend")
      where.push(
        `p.start_time >= ((${week}+interval '5 days') AT TIME ZONE ${zone}) AND p.start_time < ((${week}+interval '7 days') AT TIME ZONE ${zone})`,
      );
  }
  const order =
    kind === "events"
      ? "p.start_time ASC"
      : kind === "places"
        ? input.sort === "score"
          ? `COALESCE((SELECT avg(positive::int) FROM place_recommendation r WHERE r.place_id=p.id AND status='approved'),-1) DESC, responses DESC`
          : `((positive+2.0)/(responses+4.0)*100+ln(1+responses)*4) DESC`
        : "p.created_at DESC";
  const base = `SELECT p.* ${extra(kind)} FROM ${tables[kind]} p WHERE ${where.join(" AND ")}`;
  const count = await pool.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM (${base}) AS matches`,
    values,
  );
  const result = await pool.query<Record<string, unknown>>(
    `SELECT * FROM (${base}) p ORDER BY ${order} LIMIT 12 OFFSET ${bind((input.page - 1) * 12)}`,
    values,
  );
  return {
    items: result.rows.map(content),
    total: count.rows[0].total,
    page: input.page,
    pageSize: 12,
  };
}
export async function getContent(
  kind: Kind,
  idOrSlug: string,
  includeHidden = false,
) {
  const result = await pool.query<Record<string, unknown>>(
    `SELECT p.* ${extra(kind)} FROM ${tables[kind]} p WHERE (p.id::text=$1 OR p.slug=$1) ${includeHidden ? "" : "AND p.status='approved'"}`,
    [idOrSlug],
  );
  if (!result.rows[0])
    throw new AppError(404, "NOT_FOUND", "This item is unavailable.");
  return content(result.rows[0]);
}
export async function getSightings(productId?: string, city = "houston") {
  return (
    await pool.query<{
      id: string;
      product_id: string;
      product_name: string;
      product_slug: string;
      product_image: string;
      place_name: string;
      place_slug: string;
      observed_at: Date;
      price: number | null;
      is_demo: boolean;
    }>(
      `SELECT s.id,s.product_id,p.name AS product_name,p.slug AS product_slug,p.image AS product_image,l.name AS place_name,l.slug AS place_slug,s.observed_at,s.price,s.is_demo FROM product_sighting s JOIN product p ON p.id=s.product_id JOIN place l ON l.id=s.place_id JOIN city c ON c.id=l.city_id WHERE s.status='approved' AND p.status='approved' AND l.status='approved' AND c.slug=$2 AND ($1::uuid IS NULL OR s.product_id=$1) ORDER BY s.observed_at DESC LIMIT 20`,
      [productId ?? null, city],
    )
  ).rows;
}
export async function getNotes(placeId: string) {
  return (
    await pool.query<{
      id: string;
      body: string;
      name: string;
      created_at: Date;
    }>(
      `SELECT n.id,n.body,u.name,n.created_at FROM place_note n JOIN "user" u ON u.id=n.user_id WHERE n.place_id=$1 AND n.status='approved' ORDER BY n.created_at DESC LIMIT 20`,
      [placeId],
    )
  ).rows;
}
export async function getRecommendations(placeId: string) {
  return (
    await pool.query<{
      id: string;
      name: string;
      positive: boolean;
      updated_at: Date;
    }>(
      `SELECT r.id,u.name,r.positive,r.updated_at FROM place_recommendation r JOIN "user" u ON u.id=r.user_id WHERE r.place_id=$1 AND r.status='approved' ORDER BY r.updated_at DESC LIMIT 8`,
      [placeId],
    )
  ).rows;
}
export async function getState(kind: Kind, id: string, userId?: string) {
  if (!userId)
    return { saved: false, going: false, following: false, vote: null };
  const saved =
    kind === "organizations"
      ? false
      : !!(
          await pool.query(
            `SELECT 1 FROM saved_${tables[kind]} WHERE ${tables[kind]}_id=$1 AND user_id=$2`,
            [id, userId],
          )
        ).rowCount;
  const going =
    kind === "events" &&
    !!(
      await pool.query(
        "SELECT 1 FROM event_rsvp WHERE event_id=$1 AND user_id=$2",
        [id, userId],
      )
    ).rowCount;
  const following =
    kind === "organizations" &&
    !!(
      await pool.query(
        "SELECT 1 FROM organization_follow WHERE organization_id=$1 AND user_id=$2",
        [id, userId],
      )
    ).rowCount;
  const vote =
    kind === "places"
      ? ((
          await pool.query<{ positive: boolean }>(
            "SELECT positive FROM place_recommendation WHERE place_id=$1 AND user_id=$2",
            [id, userId],
          )
        ).rows[0]?.positive ?? null)
      : null;
  return { saved, going, following, vote };
}
export async function getSaved(userId: string) {
  const result: Partial<Record<Kind, Content[]>> = {};
  for (const kind of ["places", "events", "products"] as const) {
    result[kind] = (
      await pool.query<Record<string, unknown>>(
        `SELECT p.* ${extra(kind)} FROM ${tables[kind]} p JOIN saved_${tables[kind]} s ON s.${tables[kind]}_id=p.id WHERE s.user_id=$1 AND p.status='approved' ORDER BY s.created_at DESC LIMIT 100`,
        [userId],
      )
    ).rows.map(content);
  }
  return result;
}
export async function getHomeFeed(city: string, userId?: string) {
  const input = { city, q: "", sort: "popular", page: 1 } as const;
  const [places, events, sightings] = await Promise.all([
    listContent("places", input),
    listContent("events", { ...input, period: "weekend" }),
    getSightings(undefined, city),
  ]);
  const ranked = places.items
    .filter((p) => p.category !== "Asian Grocery")
    .sort(
      (a, b) =>
        placeRank(b.positive, b.responses) - placeRank(a.positive, a.responses),
    );
  const followedOrganizationEvents = userId
    ? (
        await pool.query<Record<string, unknown>>(
          `SELECT e.* FROM event e JOIN organization_follow f ON f.organization_id=e.organizer_id JOIN city c ON c.id=e.city_id WHERE f.user_id=$1 AND c.slug=$2 AND e.status='approved' AND e.end_time>now() ORDER BY e.start_time LIMIT 6`,
          [userId, city],
        )
      ).rows.map(content)
    : [];
  return {
    featuredPlaces: ranked.slice(0, 4),
    trendingPlaces: ranked.slice(4, 8),
    upcomingEvents: events.items.slice(0, 3),
    recentProductSightings: sightings.slice(0, 4),
    followedOrganizationEvents,
  };
}
