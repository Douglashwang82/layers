import { pool } from "@taiwanhub/database";
import {
  type Actor,
  type ItemKey,
  type SubjectKey,
  dailyPickSlug,
  itemHref,
  itemKey,
  localDate,
  subjectKey,
} from "@taiwanhub/shared";
type City = { id: string; slug: string; timezone: string };
type DailyPickCardBase = {
  id: string;
  date: string;
  selectionKind: "automatic" | "editorial";
  description: string;
  descriptionChinese: string;
  reasonText: string;
  reasonTextChinese: string;
};
/** A published catalog-place pick as the card shows it: dated snapshots plus the canonical place's current facts. */
export type DailyPickCatalogCard = DailyPickCardBase & {
  kind: "catalog";
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
};
/**
 * A published external (non-catalog) version 2 winner. The server never
 * stores the provider's name, address, hours or coordinates as an
 * unrestricted cache (see the Phase 0 ADR); the client resolves and displays
 * those live through the Google UI Kit `ProviderDetails` component keyed by
 * `providerPlaceId`, with an honest unavailable state when it can't.
 */
export type DailyPickExternalCard = DailyPickCardBase & {
  kind: "external";
  key: SubjectKey;
  subjectId: string;
  href: string;
  providerPlaceId: string | null;
  foodType: string | null;
};
export type DailyPickCard = DailyPickCatalogCard | DailyPickExternalCard;
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
 * Every public read re-checks current visibility: a stored snapshot never
 * keeps a hidden, rejected, deleted, demo, moved, or different-city-reviewed
 * place/subject on screen. A catalog-linked pick (place_id set, whether
 * version 1 or a version 2 winner that happens to also be a catalog place)
 * is checked against the catalog place; an external-only version 2 winner
 * (place_id null, subject_id set) is checked against its subject.
 */
const visible = `d.status='published'
  AND (d.subject_id IS NULL OR (s.status='active' AND s.city_review_status='approved' AND s.city_id=d.city_id))
  AND ((p.id IS NOT NULL AND p.status='approved' AND NOT p.is_demo AND p.city_id=d.city_id)
    OR (d.place_id IS NULL AND s.catalog_place_id IS NULL AND s.id IS NOT NULL))`;

const columns = `d.id AS pick_id,d.pick_date::text AS pick_date,d.selection_kind,d.description AS pick_description,d.description_chinese AS pick_description_chinese,d.reason_text,d.reason_text_chinese,
  COALESCE(d.place_id,s.catalog_place_id) AS place_id,d.subject_id,d.food_type,
  (SELECT r.provider_place_id FROM place_provider_reference r WHERE r.subject_id=s.id AND r.state='current' LIMIT 1) AS provider_place_id,
  p.*,
  (SELECT r.source_url FROM entity_source es JOIN source_record r ON r.id=es.source_record_id WHERE es.kind='places' AND es.entity_id=p.id ORDER BY es.updated_at DESC LIMIT 1) AS provenance_url,
  (SELECT count(*)::int FROM place_recommendation r WHERE r.place_id=p.id AND r.status='approved') AS responses,
  (SELECT count(*)::int FROM place_recommendation r WHERE r.place_id=p.id AND r.status='approved' AND positive) AS positive`;
const from = `FROM daily_pick d LEFT JOIN place_subject s ON s.id=d.subject_id LEFT JOIN place p ON p.id=COALESCE(d.place_id,s.catalog_place_id)`;
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
  const base: DailyPickCardBase = {
    id: String(row.pick_id),
    date: String(row.pick_date),
    selectionKind:
      row.selection_kind === "editorial" ? "editorial" : "automatic",
    description: String(row.pick_description ?? ""),
    descriptionChinese: String(row.pick_description_chinese ?? ""),
    reasonText: String(row.reason_text ?? ""),
    reasonTextChinese: String(row.reason_text_chinese ?? ""),
  };
  if (row.place_id) {
    const id = String(row.place_id);
    const source = String(row.source ?? "");
    const sourceAsUrl = webUrl(source);
    return {
      ...base,
      kind: "catalog",
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
    };
  }
  const subjectId = String(row.subject_id);
  return {
    ...base,
    kind: "external",
    key: subjectKey(subjectId),
    subjectId,
    href: `/place-subjects/${subjectId}`,
    providerPlaceId: (row.provider_place_id as string | null) ?? null,
    foodType: (row.food_type as string | null) ?? null,
  };
}
/** Today's (or a given date's) visible pick, with the raw row for map items. */
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
async function isSaved(actor: Actor | null, pick: DailyPickCard) {
  if (!actor) return false;
  const result = await pool.query(
    pick.kind === "catalog"
      ? "SELECT 1 FROM saved_place WHERE user_id=$1 AND place_id=$2"
      : "SELECT 1 FROM saved_place_subject WHERE user_id=$1 AND subject_id=$2",
    [actor.id, pick.kind === "catalog" ? pick.placeId : pick.subjectId],
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
    pick ? isSaved(actor, pick) : Promise.resolve(false),
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
