import { pool } from "@taiwanhub/database";
import {
  type Actor,
  type Bounds,
  type DateWindow,
  type ItemKey,
  type ItemType,
  type LocationStatus,
  type MapState,
  itemHref,
  itemKey,
  itemTypes,
  maxMapPoints,
  overlapsWindow,
  recommendationScore,
  resolveDateWindow,
  unionItems,
  withinBounds,
  placeRank,
} from "@taiwanhub/shared";
import {
  type LayerRecord,
  type LayerWithAccess,
  resolveLayers,
} from "../layers/repository";
import { flags } from "@/lib/config";
export type MapCity = {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  latitude: number;
  longitude: number;
};
/** One row/pin: a typed reference to a canonical entity plus its layer memberships. */
export type MapItem = {
  key: ItemKey;
  type: ItemType;
  id: string;
  slug: string;
  href: string;
  name: string;
  nameChinese: string;
  category: string;
  image: string | null;
  neighborhood: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  locationStatus: LocationStatus;
  isDemo: boolean;
  score: number | null;
  responses: number;
  priceLevel: number | null;
  startTime: string | null;
  endTime: string | null;
  eventStatus: "scheduled" | "postponed" | "cancelled" | null;
  attending: number;
  capacity: number | null;
  organizerName: string | null;
  authorName: string | null;
  publishedAt: string | null;
  sourceUrl: string | null;
  excerpt: string | null;
  layers: string[];
  note: string | null;
  /** Ordering signal for stable, explainable sorting. */
  rank: number;
};
export type LayerAvailability = {
  slug: string;
  title: string;
  titleChinese: string;
  ownerKind: LayerRecord["ownerKind"];
  ownerName: string;
  audience: LayerRecord["audience"];
  schedule: LayerRecord["schedule"];
  startsOn: string | null;
  endsOn: string | null;
  status: "ok" | "unavailable" | "other-city";
  /** Contribution to the current query, never the layer's total size. */
  count: number;
  cityName?: string;
};
export type MapQueryResult = {
  generatedAt: string;
  city: MapCity;
  state: MapState;
  layers: LayerAvailability[];
  window: { start: string; end: string | null; label: string };
  items: MapItem[];
  total: number;
  mapped: number;
  unmapped: number;
  truncated: boolean;
  searchScope: "layers" | "city";
};
type Row = Record<string, unknown>;
const iso = (v: unknown) =>
  v instanceof Date ? v.toISOString() : v == null ? null : String(v);
function placeItem(r: Row): MapItem {
  const positive = Number(r.positive ?? 0),
    responses = Number(r.responses ?? 0);
  return {
    key: itemKey("place", String(r.id)),
    type: "place",
    id: String(r.id),
    slug: String(r.slug),
    href: itemHref("place", String(r.slug)),
    name: String(r.name),
    nameChinese: String(r.name_chinese ?? ""),
    category: String(r.category),
    image: (r.image as string) ?? null,
    neighborhood: String(r.neighborhood ?? ""),
    address: String(r.address ?? ""),
    latitude: r.latitude == null ? null : Number(r.latitude),
    longitude: r.longitude == null ? null : Number(r.longitude),
    locationStatus: r.latitude == null ? "unspecified" : "exact",
    isDemo: Boolean(r.is_demo),
    score: recommendationScore(positive, responses),
    responses,
    priceLevel: r.price_level == null ? null : Number(r.price_level),
    startTime: null,
    endTime: null,
    eventStatus: null,
    attending: 0,
    capacity: null,
    organizerName: null,
    authorName: null,
    publishedAt: null,
    sourceUrl: null,
    excerpt: null,
    layers: [],
    note: null,
    rank: placeRank(positive, responses),
  };
}
function eventItem(r: Row): MapItem {
  return {
    key: itemKey("event", String(r.id)),
    type: "event",
    id: String(r.id),
    slug: String(r.slug),
    href: itemHref("event", String(r.slug)),
    name: String(r.name),
    nameChinese: String(r.name_chinese ?? ""),
    category: String(r.category),
    image: (r.image as string) ?? null,
    neighborhood: String(r.neighborhood ?? ""),
    address: String(r.venue ?? r.address ?? ""),
    latitude: r.latitude == null ? null : Number(r.latitude),
    longitude: r.longitude == null ? null : Number(r.longitude),
    locationStatus: r.latitude == null ? "unspecified" : "exact",
    isDemo: Boolean(r.is_demo),
    score: null,
    responses: 0,
    priceLevel: null,
    startTime: iso(r.start_time),
    endTime: iso(r.end_time),
    eventStatus: (r.event_status as MapItem["eventStatus"]) ?? "scheduled",
    attending: Number(r.attending ?? 0),
    capacity: r.capacity == null ? null : Number(r.capacity),
    organizerName: (r.organizer_name as string) ?? null,
    authorName: null,
    publishedAt: null,
    sourceUrl: null,
    excerpt: null,
    layers: [],
    note: null,
    rank: -new Date(String(r.start_time)).getTime() / 1e12,
  };
}
function contentItem(r: Row): MapItem {
  const status = String(r.location_status) as LocationStatus;
  const mapped = status === "exact" && r.latitude != null;
  return {
    key: itemKey("content", String(r.id)),
    type: "content",
    id: String(r.id),
    slug: String(r.slug),
    href: itemHref("content", String(r.slug)),
    name: String(r.title),
    nameChinese: String(r.title_chinese ?? ""),
    category: String(r.category ?? "Local content"),
    image: (r.image as string) ?? null,
    neighborhood: String(r.neighborhood ?? ""),
    address: String(r.place_name ?? ""),
    latitude: mapped ? Number(r.latitude) : null,
    longitude: mapped ? Number(r.longitude) : null,
    locationStatus: status,
    isDemo: Boolean(r.is_demo),
    score: null,
    responses: 0,
    priceLevel: null,
    startTime: iso(r.valid_from),
    endTime: iso(r.valid_until),
    eventStatus: null,
    attending: 0,
    capacity: null,
    organizerName: null,
    authorName: (r.author_name as string) ?? null,
    publishedAt: iso(r.created_at),
    sourceUrl: (r.source_url as string) ?? null,
    excerpt: String(r.body ?? "").slice(0, 160),
    layers: [],
    note: null,
    rank: new Date(String(r.created_at)).getTime() / 1e12,
  };
}
const foodExclusions = ["Asian Grocery", "Other"];
const communityCategories = [
  "Social",
  "Networking",
  "Student",
  "Culture",
  "Family",
  "Professional",
];
/** Candidate entities for a city: approved catalog rows plus approved content, bounded. */
async function loadCandidates(city: MapCity, since: Date) {
  const [places, events, content] = await Promise.all([
    pool.query<Row>(
      `SELECT p.*, (SELECT count(*)::int FROM place_recommendation r WHERE r.place_id=p.id AND r.status='approved') AS responses, (SELECT count(*)::int FROM place_recommendation r WHERE r.place_id=p.id AND r.status='approved' AND positive) AS positive FROM place p WHERE p.status='approved' AND p.city_id=$1 LIMIT ${maxMapPoints + 1}`,
      [city.id],
    ),
    pool.query<Row>(
      `SELECT p.*, (SELECT count(*)::int FROM event_rsvp r WHERE r.event_id=p.id) AS attending, (SELECT name FROM organization o WHERE o.id=p.organizer_id) AS organizer_name FROM event p WHERE p.status='approved' AND p.city_id=$1 AND p.end_time > $2 ORDER BY p.start_time LIMIT ${maxMapPoints + 1}`,
      [city.id, since],
    ),
    flags.content
      ? pool.query<Row>(
          `SELECT c.*, u.name AS author_name, pl.name AS place_name, COALESCE(pl.latitude,c.latitude) AS latitude, COALESCE(pl.longitude,c.longitude) AS longitude, COALESCE(NULLIF(c.neighborhood,''),pl.neighborhood,'') AS neighborhood FROM content_post c JOIN "user" u ON u.id=c.author_id LEFT JOIN place pl ON pl.id=c.place_id AND pl.status='approved' WHERE c.status='approved' AND c.city_id=$1 ORDER BY c.created_at DESC LIMIT ${maxMapPoints + 1}`,
          [city.id],
        )
      : Promise.resolve({ rows: [] as Row[] }),
  ]);
  return {
    places: places.rows.map(placeItem),
    events: events.rows.map(eventItem),
    content: content.rows.map(contentItem),
    truncated:
      places.rows.length > maxMapPoints ||
      events.rows.length > maxMapPoints ||
      content.rows.length > maxMapPoints,
  };
}
type Candidates = Awaited<ReturnType<typeof loadCandidates>>;
const tagged = (items: MapItem[], slug: string) =>
  items.map((item) => ({ ...item, layers: [slug] }));
const scheduled = (events: MapItem[]) =>
  events.filter((e) => e.eventStatus === "scheduled");
/** System rules are versioned and allowlisted; each resolves against the loaded candidates. */
function ruleMembers(
  layer: LayerRecord,
  candidates: Candidates,
  timezone: string,
  now: Date,
): MapItem[] {
  const { places, events, content } = candidates;
  switch (layer.rule?.kind) {
    case "discover":
      return tagged(
        [
          ...places,
          ...scheduled(events).filter((e) => new Date(e.endTime!) > now),
          ...content,
        ],
        layer.slug,
      );
    case "today": {
      const today = resolveDateWindow("today", timezone, now);
      const picks = places
        .filter((p) => !foodExclusions.includes(p.category))
        .sort((a, b) => b.rank - a.rank)
        .slice(0, 12);
      const timely = content.filter(
        (c) =>
          c.startTime &&
          c.endTime &&
          overlapsWindow(c.startTime, c.endTime, today),
      );
      return tagged(
        [
          ...scheduled(events).filter((e) =>
            overlapsWindow(e.startTime!, e.endTime!, today),
          ),
          ...picks,
          ...timely,
        ],
        layer.slug,
      );
    }
    case "weekend": {
      const weekend = resolveDateWindow("weekend", timezone, now);
      return tagged(
        scheduled(events).filter((e) =>
          overlapsWindow(e.startTime!, e.endTime!, weekend),
        ),
        layer.slug,
      );
    }
    case "food":
      return tagged(
        places.filter((p) => !foodExclusions.includes(p.category)),
        layer.slug,
      );
    case "community":
      return tagged(
        scheduled(events).filter(
          (e) =>
            communityCategories.includes(e.category) &&
            new Date(e.endTime!) > now,
        ),
        layer.slug,
      );
    default:
      return [];
  }
}
async function savedMembers(
  actor: Actor,
  candidates: Candidates,
  slug: string,
) {
  const [places, events, content] = await Promise.all([
    pool.query<{ place_id: string }>(
      "SELECT place_id FROM saved_place WHERE user_id=$1",
      [actor.id],
    ),
    pool.query<{ event_id: string }>(
      "SELECT event_id FROM saved_event WHERE user_id=$1",
      [actor.id],
    ),
    flags.content
      ? pool.query<{ content_id: string }>(
          "SELECT content_id FROM saved_content WHERE user_id=$1",
          [actor.id],
        )
      : Promise.resolve({ rows: [] as { content_id: string }[] }),
  ]);
  const ids = new Set([
    ...places.rows.map((r) => `place:${r.place_id}`),
    ...events.rows.map((r) => `event:${r.event_id}`),
    ...content.rows.map((r) => `content:${r.content_id}`),
  ]);
  return tagged(
    [...candidates.places, ...candidates.events, ...candidates.content].filter(
      (item) => ids.has(item.key),
    ),
    slug,
  );
}
/** Curated memberships for the accessible layers, with curator notes scoped to those layers. */
async function curatedMembers(
  layers: LayerRecord[],
  candidates: Candidates,
  now: Date,
) {
  if (!layers.length) return [] as MapItem[][];
  const result = await pool.query<{
    layer_id: string;
    place_id: string | null;
    event_id: string | null;
    content_id: string | null;
    note: string;
    position: number;
    valid_from: Date | null;
    valid_until: Date | null;
  }>(
    "SELECT layer_id,place_id,event_id,content_id,note,position,valid_from,valid_until FROM layer_item WHERE layer_id=ANY($1::uuid[]) ORDER BY position, created_at",
    [layers.map((l) => l.id)],
  );
  const byKey = new Map<string, MapItem>();
  for (const item of [
    ...candidates.places,
    ...candidates.events,
    ...candidates.content,
  ])
    byKey.set(item.key, item);
  const slugById = new Map(layers.map((l) => [l.id, l.slug]));
  const groups = new Map<string, MapItem[]>();
  for (const row of result.rows) {
    if (
      (row.valid_from && row.valid_from > now) ||
      (row.valid_until && row.valid_until <= now)
    )
      continue;
    const key = row.place_id
      ? `place:${row.place_id}`
      : row.event_id
        ? `event:${row.event_id}`
        : `content:${row.content_id}`;
    const item = byKey.get(key);
    if (!item) continue;
    const slug = slugById.get(row.layer_id)!;
    const list = groups.get(slug) ?? [];
    list.push({
      ...item,
      layers: [slug],
      note: row.note || null,
      rank: item.rank - row.position / 1e6,
    });
    groups.set(slug, list);
  }
  return Array.from(groups.values());
}
function matchesSearch(item: MapItem, q: string) {
  const needle = q.toLowerCase();
  return [
    item.name,
    item.nameChinese,
    item.category,
    item.neighborhood,
    item.address,
    item.excerpt ?? "",
  ]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}
function eventMatchesDate(item: MapItem, window: DateWindow) {
  return (
    !!item.startTime &&
    !!item.endTime &&
    overlapsWindow(item.startTime, item.endTime, window)
  );
}
/**
 * The map query: resolve accessible layers, union their members, intersect
 * with date/type/search/area filters, deduplicate by identity and return stable
 * rows. Pins, rows and counts all derive from the returned list.
 */
export async function runMapQuery(
  state: MapState,
  city: MapCity,
  actor: Actor | null,
  now = new Date(),
): Promise<MapQueryResult> {
  const window = resolveDateWindow(state.date, city.timezone, now);
  const candidates = await loadCandidates(city, window.start);
  const slugs = state.layers === "none" ? [] : state.layers;
  const { resolved, unavailable, otherCity } = await resolveLayers(
    slugs,
    actor,
    city,
  );
  const searchAll = state.scope === "city" && state.q.length > 0;
  const groups: MapItem[][] = [];
  if (searchAll)
    groups.push(
      tagged(
        [
          ...candidates.places,
          ...scheduled(candidates.events),
          ...candidates.content,
        ],
        "",
      ).map((item) => ({ ...item, layers: [] })),
    );
  else {
    for (const { layer } of resolved) {
      if (layer.rule?.kind === "saves" && actor)
        groups.push(await savedMembers(actor, candidates, layer.slug));
      else if (layer.ownerKind === "system")
        groups.push(ruleMembers(layer, candidates, city.timezone, now));
    }
    groups.push(
      ...(await curatedMembers(
        resolved
          .filter(
            (r) =>
              r.layer.ownerKind !== "system" && r.layer.rule?.kind !== "saves",
          )
          .map((r) => r.layer),
        candidates,
        now,
      )),
    );
  }
  const types = state.types?.length ? state.types : [...itemTypes];
  const filtered = unionItems(groups).filter((item) => {
    if (!types.includes(item.type)) return false;
    if (item.type === "content" && !flags.content) return false;
    if (item.type === "event" && !eventMatchesDate(item, window)) return false;
    if (
      item.type === "content" &&
      item.startTime &&
      item.endTime &&
      !overlapsWindow(item.startTime, item.endTime, window)
    )
      return false;
    if (state.q && !matchesSearch(item, state.q)) return false;
    return true;
  });
  const area: Bounds | undefined = state.area;
  const items = filtered
    .filter(
      (item) =>
        !area ||
        item.latitude == null ||
        item.longitude == null ||
        withinBounds(item.latitude, item.longitude, area),
    )
    .sort((a, b) => {
      // Places by community rank, then events by start, then content by recency.
      if (a.type !== b.type)
        return a.type === "place"
          ? -1
          : b.type === "place"
            ? 1
            : a.type === "event"
              ? -1
              : 1;
      if (a.type === "event")
        return (
          new Date(a.startTime!).getTime() - new Date(b.startTime!).getTime()
        );
      return b.rank - a.rank || a.name.localeCompare(b.name);
    })
    .slice(0, maxMapPoints);
  const mapped = items.filter(
    (i) => i.latitude != null && i.longitude != null,
  ).length;
  const counts = new Map<string, number>();
  for (const item of items)
    for (const slug of item.layers)
      counts.set(slug, (counts.get(slug) ?? 0) + 1);
  const availability: LayerAvailability[] = [];
  const describe = (
    { layer }: LayerWithAccess,
    status: LayerAvailability["status"],
  ): LayerAvailability => ({
    slug: layer.slug,
    title: layer.title,
    titleChinese: layer.titleChinese,
    ownerKind: layer.ownerKind,
    ownerName: layer.ownerName,
    audience: layer.audience,
    schedule: layer.schedule,
    startsOn: layer.startsOn,
    endsOn: layer.endsOn,
    status,
    count: counts.get(layer.slug) ?? 0,
    cityName: layer.cityName,
  });
  for (const slug of slugs) {
    const ok = resolved.find((r) => r.layer.slug === slug);
    const other = otherCity.find((r) => r.layer.slug === slug);
    if (ok) availability.push(describe(ok, "ok"));
    else if (other) availability.push(describe(other, "other-city"));
    else if (unavailable.includes(slug))
      availability.push({
        slug,
        title: "",
        titleChinese: "",
        ownerKind: "user",
        ownerName: "",
        audience: "private",
        schedule: "evergreen",
        startsOn: null,
        endsOn: null,
        status: "unavailable",
        count: 0,
      });
  }
  return {
    generatedAt: now.toISOString(),
    city,
    state: { ...state, layers: state.layers === "none" ? "none" : slugs },
    layers: availability,
    window: {
      start: window.start.toISOString(),
      end: window.end?.toISOString() ?? null,
      label: window.label,
    },
    items,
    total: items.length,
    mapped,
    unmapped: items.length - mapped,
    truncated: candidates.truncated || filtered.length > maxMapPoints,
    searchScope: searchAll ? "city" : "layers",
  };
}
