import { z } from "zod";
import { plainText } from "./text";
/* ---------------------------------------------------------------------------
   Daily Pick: one shared place per city and city-local date. Selection is a
   pure, deterministic function of the eligible catalog and the city's pick
   history; the server job persists the result with the reasons that actually
   decided it. See docs/daily-pick-layer-design.md and docs/daily-pick.md.
   --------------------------------------------------------------------------- */
export const dailyPickSelectionVersion = 1;
/** Repeat windows tried in order; the catalog must be very small to reach 7. */
export const dailyPickRepeatSteps = [30, 21, 14, 7] as const;
/** Category/neighborhood diversity looks at this many previous picks. */
export const dailyPickDiversityWindow = 7;
/** Community signals only count with at least this many responses. */
export const dailyPickMinResponses = 3;
export const dailyPickMinDescription = 40;
export const dailyPickSlug = (citySlug: string) => `daily-pick-${citySlug}`;
export type DailyPickCandidate = {
  id: string;
  status: string;
  isDemo: boolean;
  cityId: string;
  category: string;
  neighborhood: string;
  description: string;
  descriptionChinese: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  /** Attribution label for where the listing came from. */
  source: string;
  website: string | null;
  /** Provenance page of collected content, when the listing was collected. */
  provenanceUrl: string | null;
  hours: string | null;
  verificationStatus: string;
  positive: number;
  responses: number;
};
/** A published pick of the city on another date (past or scheduled). */
export type DailyPickHistoryEntry = {
  date: string;
  placeId: string;
  category: string;
  neighborhood: string;
};
export const documentationFields = [
  "detailed_description",
  "chinese_description",
  "official_link",
  "hours",
  "verified",
] as const;
export type DocumentationField = (typeof documentationFields)[number];
export const dailyPickReason = z.discriminatedUnion("code", [
  z.object({
    code: z.literal("editorial"),
    note: z.string().max(280),
    noteChinese: z.string().max(280),
  }),
  z.object({
    code: z.literal("category_rotation"),
    category: z.string().max(80),
    recentPicks: z.number().int().min(1),
  }),
  z.object({
    code: z.literal("neighborhood_rotation"),
    neighborhood: z.string().max(80),
    recentPicks: z.number().int().min(1),
  }),
  z.object({
    code: z.literal("community_recommendations"),
    positive: z.number().int().min(0),
    responses: z.number().int().min(1),
  }),
  z.object({
    code: z.literal("well_documented"),
    fields: z.array(z.enum(documentationFields)).min(1),
  }),
  z.object({
    code: z.literal("not_recently_featured"),
    windowDays: z.number().int().min(1),
    lastFeaturedOn: z.string().nullable(),
  }),
  z.object({
    code: z.literal("rotation_tie_break"),
    tied: z.number().int().min(2),
  }),
]);
export type DailyPickReason = z.infer<typeof dailyPickReason>;
export type DailyPickIneligibility =
  | "not_public"
  | "demo"
  | "other_city"
  | "no_description"
  | "no_source"
  | "no_location";
/**
 * Why a place cannot be a Daily Pick, or null when it can. There is no
 * permanent-closure field in the catalog, so closure is only excluded through
 * the explicit moderation status (hidden/rejected/deleted).
 */
export function dailyPickIneligibility(
  c: DailyPickCandidate,
  cityId: string,
): DailyPickIneligibility | null {
  if (c.status !== "approved") return "not_public";
  if (c.isDemo) return "demo";
  if (c.cityId !== cityId) return "other_city";
  if (c.description.trim().length < dailyPickMinDescription)
    return "no_description";
  if (!c.source.trim()) return "no_source";
  if (
    c.latitude == null ||
    c.longitude == null ||
    !Number.isFinite(c.latitude) ||
    !Number.isFinite(c.longitude) ||
    (c.latitude === 0 && c.longitude === 0) ||
    !c.address.trim()
  )
    return "no_location";
  return null;
}
export function documentedFields(c: DailyPickCandidate): DocumentationField[] {
  const fields: DocumentationField[] = [];
  if (c.description.trim().length >= 120) fields.push("detailed_description");
  if (c.descriptionChinese.trim().length >= 10)
    fields.push("chinese_description");
  if (c.website || c.provenanceUrl) fields.push("official_link");
  if (c.hours?.trim()) fields.push("hours");
  if (c.verificationStatus && c.verificationStatus !== "UNVERIFIED")
    fields.push("verified");
  return fields;
}
/** Smoothed positive share, only with enough responses and a clear majority. */
export function communityPoints(positive: number, responses: number) {
  if (responses < dailyPickMinResponses || positive / responses < 0.6) return 0;
  return Math.round(
    ((positive + 2) / (responses + 4)) * 40 +
      Math.min(10, Math.log1p(responses) * 3),
  );
}
/** FNV-1a: a stable, dependency-free hash for the city/date tie-break. */
export function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
const dayNumber = (iso: string) =>
  Math.round(Date.parse(iso + "T00:00:00Z") / 86400000);
const norm = (v: string) => v.trim().toLowerCase();
export type DailyPickSelection = {
  placeId: string;
  reasons: DailyPickReason[];
  evidence: {
    selectionVersion: number;
    date: string;
    candidates: number;
    eligible: number;
    pool: number;
    repeatWindowDays: number;
    recentCategories: string[];
    recentNeighborhoods: string[];
    documentation: DocumentationField[];
    documentationPoints: number;
    communityPoints: number;
    positive: number;
    responses: number;
    tied: number;
    lastFeaturedOn: string | null;
  };
};
export type DailyPickEmpty = {
  placeId: null;
  reason: "no_eligible_places" | "all_recently_featured";
  eligible: number;
};
/**
 * The first-release rules, in order: eligibility; no repeat within 30 days
 * (shortened explicitly to at least 7 for a small catalog); categories, then
 * neighborhoods, underrepresented in the previous seven picks; documentation
 * and community signals; a deterministic city/date tie-break. Only rules that
 * changed the outcome are recorded as reasons.
 */
export function selectDailyPick(input: {
  cityId: string;
  date: string;
  candidates: DailyPickCandidate[];
  history: DailyPickHistoryEntry[];
}): DailyPickSelection | DailyPickEmpty {
  const { cityId, date } = input;
  const eligible = input.candidates.filter(
    (c) => dailyPickIneligibility(c, cityId) === null,
  );
  if (!eligible.length)
    return { placeId: null, reason: "no_eligible_places", eligible: 0 };
  const today = dayNumber(date);
  const others = input.history.filter((h) => h.date !== date);
  const gap = new Map<string, number>();
  const lastFeatured = new Map<string, string>();
  for (const h of others) {
    const distance = Math.abs(dayNumber(h.date) - today);
    gap.set(h.placeId, Math.min(gap.get(h.placeId) ?? Infinity, distance));
    if (h.date < date && (lastFeatured.get(h.placeId) ?? "") < h.date)
      lastFeatured.set(h.placeId, h.date);
  }
  let window: number = dailyPickRepeatSteps[0];
  let pool: DailyPickCandidate[] = [];
  for (const step of dailyPickRepeatSteps) {
    window = step;
    pool = eligible.filter((c) => (gap.get(c.id) ?? Infinity) >= step);
    if (pool.length) break;
  }
  if (!pool.length)
    return {
      placeId: null,
      reason: "all_recently_featured",
      eligible: eligible.length,
    };
  const recent = others
    .filter((h) => h.date < date)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, dailyPickDiversityWindow);
  const count = (key: "category" | "neighborhood", value: string) =>
    recent.filter((h) => norm(h[key]) === norm(value)).length;
  const minBy = (
    list: DailyPickCandidate[],
    f: (c: DailyPickCandidate) => number,
  ) => {
    const least = Math.min(...list.map(f));
    return list.filter((c) => f(c) === least);
  };
  const byCategory = minBy(pool, (c) => count("category", c.category));
  const byNeighborhood = minBy(byCategory, (c) =>
    c.neighborhood.trim() ? count("neighborhood", c.neighborhood) : 0,
  );
  const scored = byNeighborhood.map((c) => {
    const documentation = documentedFields(c);
    const community = communityPoints(c.positive, c.responses);
    return {
      c,
      documentation,
      documentationPoints: documentation.length * 10,
      community,
      total: documentation.length * 10 + community,
    };
  });
  const best = Math.max(...scored.map((s) => s.total));
  const tied = scored
    .filter((s) => s.total === best)
    .sort(
      (a, b) =>
        stableHash(`${cityId}:${date}:${a.c.id}`) -
          stableHash(`${cityId}:${date}:${b.c.id}`) ||
        (a.c.id < b.c.id ? -1 : 1),
    );
  const winner = tied[0];
  const reasons: DailyPickReason[] = [];
  // Rotation is stated only when it is literally true: no recent pick shared it.
  if (
    recent.length &&
    byCategory.length < pool.length &&
    count("category", winner.c.category) === 0
  )
    reasons.push({
      code: "category_rotation",
      category: winner.c.category,
      recentPicks: recent.length,
    });
  if (
    recent.length &&
    winner.c.neighborhood.trim() &&
    byNeighborhood.length < byCategory.length &&
    count("neighborhood", winner.c.neighborhood) === 0
  )
    reasons.push({
      code: "neighborhood_rotation",
      neighborhood: winner.c.neighborhood.trim(),
      recentPicks: recent.length,
    });
  // Score components are reasons only when they separated the winner from others.
  if (
    winner.community > 0 &&
    scored.some((s) => s.community < winner.community)
  )
    reasons.push({
      code: "community_recommendations",
      positive: winner.c.positive,
      responses: winner.c.responses,
    });
  if (
    winner.documentationPoints > 0 &&
    scored.some((s) => s.documentationPoints < winner.documentationPoints)
  )
    reasons.push({ code: "well_documented", fields: winner.documentation });
  reasons.push({
    code: "not_recently_featured",
    windowDays: window,
    lastFeaturedOn: lastFeatured.get(winner.c.id) ?? null,
  });
  if (tied.length > 1)
    reasons.push({ code: "rotation_tie_break", tied: tied.length });
  return {
    placeId: winner.c.id,
    reasons,
    evidence: {
      selectionVersion: dailyPickSelectionVersion,
      date,
      candidates: input.candidates.length,
      eligible: eligible.length,
      pool: pool.length,
      repeatWindowDays: window,
      recentCategories: recent.map((h) => h.category),
      recentNeighborhoods: recent.map((h) => h.neighborhood),
      documentation: winner.documentation,
      documentationPoints: winner.documentationPoints,
      communityPoints: winner.community,
      positive: winner.c.positive,
      responses: winner.c.responses,
      tied: tied.length,
      lastFeaturedOn: lastFeatured.get(winner.c.id) ?? null,
    },
  };
}
/** Up to two sentences of the approved description, never extended. */
export function summarizeDescription(text: string, maxLength = 280) {
  const clean = text.replace(/\s+/g, " ").trim();
  const sentences = clean.match(/[^.!?。！？]+[.!?。！？]+["'」』）)]*\s*/g);
  let summary = sentences ? sentences.slice(0, 2).join("").trim() : clean;
  if (!summary) summary = clean;
  if (summary.length <= maxLength) return summary;
  const cut = summary.slice(0, maxLength - 1);
  const space = cut.lastIndexOf(" ");
  return (space > maxLength / 2 ? cut.slice(0, space) : cut).trimEnd() + "…";
}
const categoryChinese: Record<string, string> = {
  Taiwanese: "台灣料理",
  "Bubble Tea": "手搖飲",
  Bakery: "麵包店",
  "Hot Pot": "火鍋",
  Breakfast: "早餐",
  Dessert: "甜點",
  "Asian Grocery": "亞洲超市",
  Japanese: "日式料理",
  Korean: "韓式料理",
  Chinese: "中式料理",
  Cafe: "咖啡廳",
  Other: "其他",
};
const fieldLabels: Record<DocumentationField, { en: string; zh: string }> = {
  detailed_description: { en: "a detailed description", zh: "詳細介紹" },
  chinese_description: { en: "a Chinese description", zh: "中文介紹" },
  official_link: { en: "a source link", zh: "來源連結" },
  hours: { en: "opening hours", zh: "營業時間" },
  verified: { en: "verified details", zh: "已驗證資訊" },
};
const reasonPriority: DailyPickReason["code"][] = [
  "editorial",
  "category_rotation",
  "community_recommendations",
  "neighborhood_rotation",
  "well_documented",
  "not_recently_featured",
  "rotation_tie_break",
];
function sentence(reason: DailyPickReason, zh: boolean) {
  switch (reason.code) {
    case "editorial":
      return zh
        ? reason.noteChinese || reason.note || "由 TaiwanHub 編輯挑選。"
        : reason.note || "Chosen by the TaiwanHub editors.";
    case "category_rotation":
      return zh
        ? `今天介紹「${categoryChinese[reason.category] ?? reason.category}」；前 ${reason.recentPicks} 次精選都不是這個類別。`
        : `We're highlighting ${reason.category} today; none of the last ${reason.recentPicks} picks were in this category.`;
    case "neighborhood_rotation":
      return zh
        ? `位於${reason.neighborhood}，前 ${reason.recentPicks} 次精選都不在這一區。`
        : `It's in ${reason.neighborhood}, an area none of the last ${reason.recentPicks} picks were in.`;
    case "community_recommendations":
      return zh
        ? `${reason.responses} 則社群回應中有 ${reason.positive} 則推薦。`
        : `${reason.positive} of ${reason.responses} community responses recommend it.`;
    case "well_documented": {
      const labels = reason.fields.map((f) => fieldLabels[f][zh ? "zh" : "en"]);
      return zh
        ? `資訊完整且有來源，包括${labels.join("、")}。`
        : `Its listing has sourced details, including ${labels.length > 1 ? labels.slice(0, -1).join(", ") + " and " + labels.at(-1) : labels[0]}.`;
    }
    case "not_recently_featured":
      return reason.lastFeaturedOn
        ? zh
          ? `過去 ${reason.windowDays} 天內沒有被選為每日精選。`
          : `It hasn't been a Daily Pick in the last ${reason.windowDays} days.`
        : zh
          ? "這是它第一次成為每日精選。"
          : "It hasn't been a Daily Pick before.";
    case "rotation_tie_break":
      return zh
        ? `今天有 ${reason.tied} 個地點條件相同，此地點依固定的每日輪替選出，與熱門程度無關。`
        : `${reason.tied} places qualified equally today; this one came up in a fixed daily rotation, not by popularity.`;
  }
}
/**
 * "Why we picked it": the one or two highest-priority recorded reasons. The
 * full structured list stays in the stored evidence. The tie-break is always
 * shown when it decided the pick, so a rotation is never read as popularity.
 */
export function renderDailyPickReasons(
  reasons: DailyPickReason[],
  locale: "en" | "zh-TW",
) {
  const zh = locale === "zh-TW";
  const ordered = [...reasons].sort(
    (a, b) => reasonPriority.indexOf(a.code) - reasonPriority.indexOf(b.code),
  );
  const tieBreak = ordered.find((r) => r.code === "rotation_tie_break");
  const shown: DailyPickReason[] = ordered
    .filter((r) => r.code !== "rotation_tie_break")
    .slice(0, tieBreak ? 1 : 2);
  if (tieBreak) shown.push(tieBreak);
  return shown.map((r) => sentence(r, zh)).join(zh ? "" : " ");
}
/** A real YYYY-MM-DD calendar date: rejects 2026-02-30, 2026-13-01 and 2027-02-29. */
export function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}
export const calendarDate = z
  .string()
  .refine(isCalendarDate, "Use a real calendar date (YYYY-MM-DD).");
const noMarkup = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(
      (v) => !/[<>\u0000-\u0008]/.test(v),
      "Use plain text without markup.",
    )
    .default("");
/** Moderator scheduling or replacement of one city/date slot. */
export const dailyPickScheduleInput = z.object({
  city: z.string().regex(/^[a-z0-9-]{1,80}$/),
  date: calendarDate,
  placeId: z.uuid(),
  /** Internal audit reason, recorded with the moderation action. */
  reason: plainText(500),
  /** Optional public explanation shown as the editorial reason. */
  note: noMarkup(280),
  noteChinese: noMarkup(280),
  /** The published pick being replaced; null when the slot is empty. */
  expectedPickId: z.uuid().nullable().default(null),
});
export type DailyPickScheduleInput = z.infer<typeof dailyPickScheduleInput>;
export const dailyPickWithdrawInput = z.object({ reason: plainText(500) });
