import { z } from "zod";
export const placeCategories = [
  "Taiwanese",
  "Bubble Tea",
  "Bakery",
  "Hot Pot",
  "Breakfast",
  "Dessert",
  "Asian Grocery",
  "Japanese",
  "Korean",
  "Chinese",
  "Cafe",
  "Other",
] as const;
export const eventCategories = [
  "Food",
  "Sports",
  "Social",
  "Networking",
  "Culture",
  "Festival",
  "Student",
  "Family",
  "Outdoor",
  "Professional",
  "Other",
] as const;
export const kinds = ["places", "events", "products", "organizations"] as const;
export type Kind = (typeof kinds)[number];
export type Role = "USER" | "MODERATOR" | "ADMIN";
export type Actor = { id: string; role: Role };
export const plainText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (v) => !/[<>\u0000-\u0008]/.test(v),
      "Use plain text without markup.",
    );
export const imageUrl = z
  .string()
  .max(2048)
  .refine(
    (v) =>
      /^\/uploads\/[a-f0-9-]+\.(png|jpg|webp)$/.test(v) ||
      /^\/demo\/product-\d+\.svg$/.test(v) ||
      z.url({ protocol: /^https$/ }).safeParse(v).success,
    "Use an HTTPS image URL or an uploaded image.",
  );
export const recommendationInput = z.object({
  positive: z.boolean(),
  note: plainText(300).optional(),
});
export const sightingInput = z.object({
  productId: z.uuid(),
  placeId: z.uuid(),
  price: z.number().min(0).max(10000).optional(),
  image: imageUrl.optional(),
  observedAt: z.iso
    .datetime()
    .refine(
      (v) => new Date(v).getTime() <= Date.now(),
      "Date cannot be in the future.",
    ),
});
const baseSubmission = z.object({
  name: plainText(120),
  nameChinese: z.string().trim().max(120).default(""),
  description: plainText(2000),
  cityId: z.uuid(),
  neighborhood: plainText(80),
  address: plainText(250),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  image: imageUrl.default(
    "https://images.unsplash.com/photo-1511795409834-ef04bbd61622?w=1200",
  ),
});
export const placeInput = baseSubmission.extend({
  category: z.enum(placeCategories),
});
export const eventInput = baseSubmission
  .extend({
    category: z.enum(eventCategories),
    organizerId: z.uuid(),
    venue: plainText(150),
    startTime: z.iso.datetime(),
    endTime: z.iso.datetime(),
    capacity: z.number().int().min(1).max(100000).optional(),
  })
  .refine(
    (v) => new Date(v.endTime) > new Date(v.startTime),
    "End must be after start.",
  )
  .refine(
    (v) => new Date(v.startTime).getTime() > Date.now(),
    "Event must be in the future.",
  );
export const moderationEntityTypes = [
  "places",
  "events",
  "products",
  "organizations",
  "notes",
  "sightings",
  "recommendations",
  "layers",
  "content",
] as const;
export const moderationInput = z.object({
  entityType: z.enum(moderationEntityTypes),
  entityId: z.uuid(),
  action: z.enum(["approved", "rejected", "hidden", "deleted"]),
  reason: plainText(500),
});
export const editInput = z.object({
  name: plainText(120),
  nameChinese: z.string().max(120),
  description: plainText(2000),
  image: imageUrl,
  category: plainText(80),
  descriptionChinese: z.string().max(2000).optional(),
  aliases: z.string().max(500).optional(),
  address: plainText(250).optional(),
  neighborhood: plainText(80).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  website: z.union([z.literal(""), z.url({ protocol: /^https?$/ })]).optional(),
  phone: z.string().max(40).optional(),
  hours: z.string().max(500).optional(),
  venue: plainText(150).optional(),
  startTime: z.iso.datetime().optional(),
  endTime: z.iso.datetime().optional(),
  capacity: z.number().int().min(1).max(100000).nullable().optional(),
  brand: plainText(80).optional(),
  onlineUrl: z
    .union([z.literal(""), z.url({ protocol: /^https?$/ })])
    .optional(),
  instagram: z
    .union([z.literal(""), z.url({ protocol: /^https?$/ })])
    .optional(),
  facebook: z
    .union([z.literal(""), z.url({ protocol: /^https?$/ })])
    .optional(),
});
export const listInput = z.object({
  city: z.string().max(80).default("houston"),
  q: z.string().trim().max(100).default(""),
  category: z.string().max(80).optional(),
  neighborhood: z.string().max(80).optional(),
  organization: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.uuid().optional(),
  ),
  sort: z.enum(["popular", "score", "date"]).default("popular"),
  period: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.enum(["today", "weekend", "week"]).optional(),
  ),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
export type ListInput = z.infer<typeof listInput>;
export function recommendationScore(
  positive: number,
  total: number,
): number | null {
  return total <= 0 ? null : Math.round((positive / total) * 100);
}
export function placeRank(positive: number, total: number): number {
  return total === 0
    ? 0
    : ((positive + 2) / (total + 4)) * 100 + Math.log1p(total) * 4;
}
export function eventRank(
  start: Date,
  attendees: number,
  followed: boolean,
  featured: boolean,
  now = new Date(),
): number {
  return (
    (followed ? 20 : 0) +
    (featured ? 10 : 0) +
    Math.log1p(attendees) -
    Math.max(0, (start.getTime() - now.getTime()) / 86400000)
  );
}
export function isModerator(role: Role) {
  return role === "MODERATOR" || role === "ADMIN";
}
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function requireActor(actor: Actor | null): Actor {
  if (!actor) throw new AppError(401, "UNAUTHORIZED", "Sign in to continue.");
  return actor;
}
export function requireModerator(actor: Actor | null): Actor {
  const a = requireActor(actor);
  if (!isModerator(a.role))
    throw new AppError(403, "FORBIDDEN", "Moderator access required.");
  return a;
}

/** Browser form fields are strings; the API validates converted domain values using the schemas above. */
export type SubmissionFields = Partial<
  Record<
    | keyof z.infer<typeof placeInput>
    | keyof z.infer<typeof eventInput>
    | keyof z.infer<typeof sightingInput>,
    string
  >
>;

/* ---------------------------------------------------------------------------
   Layers and map query contract. A product "layer" is a saved collection; a
   Mapbox rendering layer is an internal drawing primitive and never uses these
   types. Pure functions here are shared by the server query, the client map
   state controller and the unit tests.
   --------------------------------------------------------------------------- */
export const itemTypes = ["place", "event", "content"] as const;
export type ItemType = (typeof itemTypes)[number];
export const layerOwnerKinds = ["system", "user", "group"] as const;
export type LayerOwnerKind = (typeof layerOwnerKinds)[number];
export const layerAudiences = ["public", "private", "group"] as const;
export type LayerAudience = (typeof layerAudiences)[number];
export const layerSchedules = [
  "evergreen",
  "day",
  "range",
  "rolling_today",
] as const;
export type LayerSchedule = (typeof layerSchedules)[number];
export const layerLifecycles = ["draft", "active", "archived"] as const;
export type LayerLifecycle = (typeof layerLifecycles)[number];
export const layerReviewStatuses = [
  "unsubmitted",
  "pending",
  "approved",
  "rejected",
  "hidden",
] as const;
export type LayerReviewStatus = (typeof layerReviewStatuses)[number];
/** System rule layers use a versioned, allowlisted rule; never user-authored SQL. */
export const systemRuleKinds = [
  "discover",
  "today",
  "weekend",
  "food",
  "community",
  "saves",
] as const;
export type SystemRuleKind = (typeof systemRuleKinds)[number];
export const systemRule = z.object({
  version: z.literal(1),
  kind: z.enum(systemRuleKinds),
});
export type SystemRule = z.infer<typeof systemRule>;
export const locationStatuses = [
  "exact",
  "approximate",
  "citywide",
  "online",
  "unspecified",
] as const;
export type LocationStatus = (typeof locationStatuses)[number];
export const maxAppliedLayers = 5;
export const maxMapPoints = 1000;
export const mapPageSize = 20;
/** `place:{uuid}` — the stable item identity shared by pins, rows and selection. */
export type ItemKey = `${ItemType}:${string}`;
export const itemKeyPattern = /^(place|event|content):([0-9a-f-]{36})$/;
export function itemKey(type: ItemType, id: string): ItemKey {
  return `${type}:${id}`;
}
export function parseItemKey(value: string | undefined | null) {
  const match = value ? itemKeyPattern.exec(value) : null;
  return match ? { type: match[1] as ItemType, id: match[2] } : null;
}
/** Canonical detail destination by item type; the old map popup always linked to places. */
export function itemHref(type: ItemType, slug: string) {
  return type === "place"
    ? `/places/${slug}`
    : type === "event"
      ? `/events/${slug}`
      : `/content/${slug}`;
}
export const slugPattern = /^[a-z0-9-]{1,80}$/;
const slugList = z
  .string()
  .max(400)
  .transform((v) =>
    Array.from(
      new Set(
        v
          .split(",")
          .map((s) => s.trim())
          .filter((s) => slugPattern.test(s)),
      ),
    ).slice(0, maxAppliedLayers),
  );
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
export function daysBetween(a: string, b: string) {
  return Math.round(
    (Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000,
  );
}
/** upcoming | today | weekend | YYYY-MM-DD | YYYY-MM-DD..YYYY-MM-DD (at most 31 days) */
export const dateFilter = z
  .string()
  .max(24)
  .refine(
    (v) =>
      ["upcoming", "today", "weekend"].includes(v) ||
      isoDate.test(v) ||
      (/^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/.test(v) &&
        v.slice(0, 10) <= v.slice(12) &&
        daysBetween(v.slice(0, 10), v.slice(12)) <= 31),
    "Unsupported date filter.",
  );
export type DateFilter = z.infer<typeof dateFilter>;
export const bounds = z
  .string()
  .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/)
  .transform(
    (v) => v.split(",").map(Number) as [number, number, number, number],
  )
  .refine(
    ([w, s, e, n]) =>
      w >= -180 && e <= 180 && s >= -90 && n <= 90 && w < e && s < n,
    "Invalid map area.",
  );
export type Bounds = [west: number, south: number, east: number, north: number];
const optionalString = (v: unknown) =>
  v === undefined || v === null || v === "" ? undefined : String(v);
/** Validated public map state. Only supported values are serialized back into the URL. */
export const mapQueryInput = z.object({
  city: z.string().max(80).default("houston"),
  layers: z.preprocess(
    optionalString,
    z.union([z.literal("none"), slugList]).optional(),
  ),
  date: dateFilter.default("upcoming"),
  types: z.preprocess(
    optionalString,
    z
      .string()
      .max(40)
      .transform((v) => itemTypes.filter((type) => v.split(",").includes(type)))
      .optional(),
  ),
  q: z.string().trim().max(100).default(""),
  scope: z.enum(["layers", "city"]).default("layers"),
  area: z.preprocess(optionalString, bounds.optional()),
  item: z.preprocess(
    optionalString,
    z.string().regex(itemKeyPattern).optional(),
  ),
  view: z.enum(["map", "list"]).default("map"),
  page: z.coerce.number().int().min(1).max(500).default(1),
});
export type MapQueryInput = z.infer<typeof mapQueryInput>;
export function parseMapQuery(params: Record<string, string | undefined>) {
  const parsed = mapQueryInput.safeParse(params);
  if (parsed.success) return parsed.data;
  // Drop each invalid field rather than the whole state so a bad date never resets the city.
  const safe: Record<string, string | undefined> = { ...params };
  for (const issue of parsed.error.issues) delete safe[String(issue.path[0])];
  return mapQueryInput.parse(safe);
}
export type MapState = Omit<MapQueryInput, "layers"> & {
  layers: string[] | "none";
};
/** Serialize only non-default, supported values. Never private notes or precise geolocation. */
export function serializeMapQuery(
  state: Partial<MapState>,
  options: { includeCity?: boolean } = {},
) {
  const params = new URLSearchParams();
  if (options.includeCity && state.city) params.set("city", state.city);
  if (state.layers === "none") params.set("layers", "none");
  else if (state.layers?.length) params.set("layers", state.layers.join(","));
  if (state.date && state.date !== "upcoming") params.set("date", state.date);
  if (state.types?.length && state.types.length < itemTypes.length)
    params.set("types", state.types.join(","));
  if (state.q) params.set("q", state.q);
  if (state.scope && state.scope !== "layers") params.set("scope", state.scope);
  if (state.area)
    params.set("area", state.area.map((n) => n.toFixed(5)).join(","));
  if (state.item) params.set("item", state.item);
  if (state.view && state.view !== "map") params.set("view", state.view);
  if (state.page && state.page > 1) params.set("page", String(state.page));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}
/* Dates: half-open intervals resolved at the city's local day boundaries. */
function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
      get("weekday"),
    ),
  };
}
/** Calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function localDate(date: Date, timeZone: string) {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
/** The instant when the given calendar date begins in a time zone, DST-safe. */
export function zonedMidnight(isoDay: string, timeZone: string) {
  const [y, m, d] = isoDay.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(new Date(guess), timeZone);
    const local = Date.UTC(
      p.year,
      p.month - 1,
      p.day,
      p.hour,
      p.minute,
      p.second,
    );
    const diff = local - target;
    if (diff === 0) break;
    guess -= diff;
  }
  return new Date(guess);
}
export function addDays(isoDay: string, days: number) {
  const t = Date.parse(isoDay + "T00:00:00Z") + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}
export type DateWindow = { start: Date; end: Date | null; label: DateFilter };
/**
 * Today runs from local midnight to the next local midnight. This weekend is
 * Saturday 00:00 to Monday 00:00, or the ongoing weekend on Saturday/Sunday.
 * Upcoming begins now and has no end. Ranges are inclusive calendar days.
 */
export function resolveDateWindow(
  filter: DateFilter,
  timeZone: string,
  now = new Date(),
): DateWindow {
  if (filter === "upcoming") return { start: now, end: null, label: filter };
  const today = localDate(now, timeZone);
  if (filter === "today")
    return {
      start: zonedMidnight(today, timeZone),
      end: zonedMidnight(addDays(today, 1), timeZone),
      label: filter,
    };
  if (filter === "weekend") {
    const weekday = zonedParts(now, timeZone).weekday;
    const untilSaturday = weekday === 0 ? -1 : 6 - weekday;
    const saturday = addDays(today, untilSaturday);
    return {
      start: zonedMidnight(saturday, timeZone),
      end: zonedMidnight(addDays(saturday, 2), timeZone),
      label: filter,
    };
  }
  const [from, to] = filter.includes("..")
    ? filter.split("..")
    : [filter, filter];
  return {
    start: zonedMidnight(from, timeZone),
    end: zonedMidnight(addDays(to, 1), timeZone),
    label: filter,
  };
}
/** Half-open overlap: item.start < window.end && item.end > window.start. */
export function overlapsWindow(
  start: Date | string,
  end: Date | string,
  window: DateWindow,
) {
  const s = new Date(start).getTime(),
    e = new Date(end).getTime();
  return (
    (window.end === null || s < window.end.getTime()) &&
    e > window.start.getTime()
  );
}
/** Merge memberships by identity: an item in three layers is one entity "in 3 layers". */
export function unionItems<T extends { key: string; layers: string[] }>(
  groups: T[][],
): T[] {
  const byKey = new Map<string, T>();
  for (const group of groups)
    for (const item of group) {
      const existing = byKey.get(item.key);
      if (existing)
        existing.layers = Array.from(
          new Set([...existing.layers, ...item.layers]),
        );
      else byKey.set(item.key, { ...item, layers: [...item.layers] });
    }
  return Array.from(byKey.values());
}
export function withinBounds(
  latitude: number,
  longitude: number,
  [w, s, e, n]: Bounds,
) {
  return longitude >= w && longitude <= e && latitude >= s && latitude <= n;
}
export const layerInput = z
  .object({
    title: plainText(80),
    titleChinese: z.string().trim().max(80).default(""),
    description: z.string().trim().max(500).default(""),
    descriptionChinese: z.string().trim().max(500).default(""),
    city: z.string().regex(slugPattern),
    audience: z.enum(["private", "group"]).default("private"),
    groupId: z.uuid().optional(),
    schedule: z.enum(["evergreen", "day", "range"]).default("evergreen"),
    startsOn: z.preprocess(
      optionalString,
      z.string().regex(isoDate).optional(),
    ),
    endsOn: z.preprocess(optionalString, z.string().regex(isoDate).optional()),
  })
  .refine(
    (v) =>
      v.schedule === "evergreen" ||
      (v.schedule === "day" && v.startsOn) ||
      (v.schedule === "range" &&
        v.startsOn &&
        v.endsOn &&
        v.startsOn <= v.endsOn &&
        daysBetween(v.startsOn, v.endsOn) <= 31),
    "Choose valid dates for this schedule (up to 31 days).",
  )
  .refine(
    (v) => v.audience !== "group" || v.groupId,
    "Choose a group for a group layer.",
  );
export type LayerInput = z.infer<typeof layerInput>;
export const layerPatchInput = z.object({
  revision: z.number().int().min(1),
  title: plainText(80).optional(),
  titleChinese: z.string().trim().max(80).optional(),
  description: z.string().trim().max(500).optional(),
  descriptionChinese: z.string().trim().max(500).optional(),
  schedule: z.enum(["evergreen", "day", "range"]).optional(),
  startsOn: z.preprocess(optionalString, z.string().regex(isoDate).optional()),
  endsOn: z.preprocess(optionalString, z.string().regex(isoDate).optional()),
  lifecycle: z.enum(["draft", "active", "archived"]).optional(),
  order: z.array(z.uuid()).max(500).optional(),
});
export type LayerPatchInput = z.infer<typeof layerPatchInput>;
export const layerItemInput = z.object({
  key: z.string().regex(itemKeyPattern),
  note: z.string().trim().max(300).default(""),
});
export const mapPreferenceInput = z.object({
  layers: z.array(z.string().regex(slugPattern)).max(maxAppliedLayers),
  view: z.enum(["map", "list"]).default("map"),
});
