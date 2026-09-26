import { pool } from "@taiwanhub/database";
import {
  type Actor,
  type ItemKey,
  dailyPickSlug,
  itemHref,
  itemKey,
  localDate,
} from "@taiwanhub/shared";
type City = { id: string; slug: string; timezone: string };
/** A published pick as the card shows it: dated snapshots plus the canonical place's current facts. */
export type DailyPickCard = {
  id: string;
  date: string;
  selectionKind: "automatic" | "editorial";
  key: ItemKey;
  placeId: string;
  slug: string;
  href: string;
  name: string;
  nameChinese: string;
  category: string;
  neighborhood: string;
  address: string;
  image: string | null;
  latitude: number | null;
  longitude: number | null;
  hours: string | null;
  priceLevel: number | null;
  website: string | null;
  sourceLabel: string;
  sourceUrl: string | null;
  description: string;
  descriptionChinese: string;
  reasonText: string;
  reasonTextChinese: string;
};
export type DailyPickView = {
  layer: string;
  date: string;
  pick: DailyPickCard | null;
  /** Only when today's pick is unavailable: the latest earlier pick, with its own date. */
  previous: DailyPickCard | null;
  /** Whether today's pick survived the current map filters and area. */
  inResults: boolean;
  saved: boolean;
};
/**
 * Every public read re-checks the canonical place: a stored snapshot never
 * keeps a hidden, rejected, deleted, demo or moved place on screen.
 */
const visible = `d.status='published' AND p.status='approved' AND NOT p.is_demo AND p.city_id=d.city_id`;
const columns = `d.id AS pick_id,d.pick_date::text AS pick_date,d.selection_kind,d.description AS pick_description,d.description_chinese AS pick_description_chinese,d.reason_text,d.reason_text_chinese,
  p.*,
  (SELECT r.source_url FROM entity_source es JOIN source_record r ON r.id=es.source_record_id WHERE es.kind='places' AND es.entity_id=p.id ORDER BY es.updated_at DESC LIMIT 1) AS provenance_url,
  (SELECT count(*)::int FROM place_recommendation r WHERE r.place_id=p.id AND r.status='approved') AS responses,
  (SELECT count(*)::int FROM place_recommendation r WHERE r.place_id=p.id AND r.status='approved' AND positive) AS positive`;
const from = `FROM daily_pick d JOIN place p ON p.id=d.place_id`;
/** Only web links are ever rendered as hrefs. */
function webUrl(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
export type DailyPickRow = Record<string, unknown>;
export function dailyPickCard(row: DailyPickRow): DailyPickCard {
  const id = String(row.id);
  const source = String(row.source ?? "");
  const sourceAsUrl = webUrl(source);
  return {
    id: String(row.pick_id),
    date: String(row.pick_date),
    selectionKind:
      row.selection_kind === "editorial" ? "editorial" : "automatic",
    key: itemKey("place", id),
    placeId: id,
    slug: String(row.slug),
    href: itemHref("place", String(row.slug)),
    name: String(row.name),
    nameChinese: String(row.name_chinese ?? ""),
    category: String(row.category ?? ""),
    neighborhood: String(row.neighborhood ?? ""),
    address: String(row.address ?? ""),
    image: (row.image as string | null) || null,
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    hours: String(row.hours ?? "").trim() || null,
    priceLevel:
      row.price_level == null || Number(row.price_level) < 1
        ? null
        : Math.min(4, Number(row.price_level)),
    website: webUrl(row.website),
    sourceLabel: sourceAsUrl ? new URL(sourceAsUrl).hostname : source,
    sourceUrl: webUrl(row.provenance_url) ?? sourceAsUrl,
    description: String(row.pick_description ?? ""),
    descriptionChinese: String(row.pick_description_chinese ?? ""),
    reasonText: String(row.reason_text ?? ""),
    reasonTextChinese: String(row.reason_text_chinese ?? ""),
  };
}
/** Today's (or a given date's) visible pick, with the raw place row for map items. */
export async function findDailyPick(city: City, date: string) {
  const result = await pool.query<DailyPickRow>(
    `SELECT ${columns} ${from} WHERE d.city_id=$1 AND d.pick_date=$2::date AND ${visible}`,
    [city.id, date],
  );
  return result.rows[0] ?? null;
}
async function previousPick(city: City, before: string) {
  const result = await pool.query<DailyPickRow>(
    `SELECT ${columns} ${from} WHERE d.city_id=$1 AND d.pick_date<$2::date AND ${visible} ORDER BY d.pick_date DESC LIMIT 1`,
    [city.id, before],
  );
  return result.rows[0] ? dailyPickCard(result.rows[0]) : null;
}
/** Dated history through `through` (inclusive), newest first, subject to current visibility. */
export async function listDailyPickHistory(
  city: City,
  through: string,
  limit = 30,
) {
  const result = await pool.query<DailyPickRow>(
    `SELECT ${columns} ${from} WHERE d.city_id=$1 AND d.pick_date<=$2::date AND ${visible} ORDER BY d.pick_date DESC LIMIT $3`,
    [city.id, through, Math.min(Math.max(limit, 1), 100)],
  );
  return result.rows.map(dailyPickCard);
}
async function isSaved(actor: Actor | null, placeId: string) {
  if (!actor) return false;
  const result = await pool.query(
    "SELECT 1 FROM saved_place WHERE user_id=$1 AND place_id=$2",
    [actor.id, placeId],
  );
  return (result.rowCount ?? 0) > 0;
}
/** The city's shared pick for its local today. Never depends on viewport or filters. */
export async function loadDailyPickView(
  city: City,
  actor: Actor | null,
  now = new Date(),
) {
  const date = localDate(now, city.timezone);
  const row = await findDailyPick(city, date);
  const pick = row ? dailyPickCard(row) : null;
  const [previous, saved] = await Promise.all([
    pick ? Promise.resolve(null) : previousPick(city, date),
    pick ? isSaved(actor, pick.placeId) : Promise.resolve(false),
  ]);
  return {
    row,
    view: {
      layer: dailyPickSlug(city.slug),
      date,
      pick,
      previous,
      inResults: false,
      saved,
    } satisfies DailyPickView,
  };
}
