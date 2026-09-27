import { z } from "zod";
import { addDays, daysBetween, localDate, zonedMidnight } from "./time";
import { stableHash } from "./daily-pick";

/* ---------------------------------------------------------------------------
   Daily restaurant recommendation (version 2): pure eligibility, ranking and
   report contracts for the Greater Houston restaurant pipeline described in
   docs/plans/daily-restaurant-recommendation-plan.md. This module never
   fetches, geocodes or calls a model; callers supply normalized, validated
   candidate facts and an explicit clock/date. See packages/shared/src/daily-pick.ts
   for the version 1 catalog-place rules, which this module does not replace.
   --------------------------------------------------------------------------- */
export const restaurantSelectionVersion = 2;
/** Tuning defaults from the plan; versioned so a rule change is auditable. */
export const restaurantRuleDefaults = {
  minRating: 4.3,
  minRatingCount: 30,
  /** Same primary food type excluded within this many calendar days either direction. */
  foodRotationDays: 6,
  /** Same canonical restaurant excluded within this many calendar days either direction. */
  restaurantRepeatDays: 30,
  /** Rating-volume adjustment prior and weight (tuning defaults, not measured statistics). */
  ratingPrior: 4.2,
  ratingPriorWeight: 50,
  /** Freshness ceiling for the finalist's rating/status/hours before committing. */
  maxEvidenceAgeMinutes: 30,
  /** At most this many candidates get a copy attempt before a run is marked copy_failed. */
  maxCopyAttempts: 3,
  /** Report shows the winner plus this many other candidates. */
  reportSize: 10,
} as const;
export type RestaurantRuleConfig = typeof restaurantRuleDefaults;

/** A half-open service interval on one calendar date, in UTC instants. */
export type ServiceInterval = { start: Date; end: Date };
/** Raw provider hours for one date, before interval normalization. */
export type DailyHoursSource = {
  date: string;
  /** Minutes since local midnight; `close` past 1440 means it runs past midnight. */
  periods: { open: number; close: number }[];
} | null;

/**
 * Normalize one date's opening periods into half-open UTC intervals. Periods
 * are minutes-since-local-midnight, already resolved by the caller from the
 * provider's date-specific hours (not the weekly regular hours). An overnight
 * period (close > 1440) produces an interval ending after local midnight of
 * the next day; a 24-hour day is `{ open: 0, close: 1440 }`.
 */
export function normalizeDailyIntervals(
  source: DailyHoursSource,
  timeZone: string,
): ServiceInterval[] {
  if (!source || !source.periods.length) return [];
  const midnight = zonedMidnight(source.date, timeZone).getTime();
  return source.periods
    .filter(
      (p) =>
        Number.isFinite(p.open) && Number.isFinite(p.close) && p.close > p.open,
    )
    .map((p) => ({
      start: new Date(midnight + p.open * 60000),
      end: new Date(midnight + p.close * 60000),
    }));
}

/** Whether any normalized interval intersects `[from, to)`. */
export function intervalsIntersect(
  intervals: ServiceInterval[],
  from: Date,
  to: Date,
) {
  return intervals.some(
    (i) => i.start.getTime() < to.getTime() && i.end.getTime() > from.getTime(),
  );
}

/**
 * Whether the restaurant serves on `date` in `timeZone`, given date-specific
 * hours only (never the weekly regular hours, per the plan). `hoursByDate`
 * should include the target date and, for overnight carry-in from the prior
 * day, the day before. Missing or empty hours fails closed (`false`).
 */
export function hasServiceOnDate(
  hoursByDate: Map<string, DailyHoursSource>,
  date: string,
  timeZone: string,
  now: Date,
): boolean {
  const dayStart = zonedMidnight(date, timeZone);
  const dayEnd = zonedMidnight(addDays(date, 1), timeZone);
  const prior = normalizeDailyIntervals(
    hoursByDate.get(addDays(date, -1)) ?? null,
    timeZone,
  );
  const today = normalizeDailyIntervals(
    hoursByDate.get(date) ?? null,
    timeZone,
  );
  const intervals = [...prior, ...today];
  if (!intervalsIntersect(intervals, dayStart, dayEnd)) return false;
  const isToday = localDate(now, timeZone) === date;
  if (!isToday) return true;
  const from = now.getTime() > dayStart.getTime() ? now : dayStart;
  return intervalsIntersect(intervals, from, dayEnd);
}

/** Restaurant business status reported by the provider. */
export type BusinessStatus =
  "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY";

export type RestaurantQualityFacts = {
  rating: number | null;
  ratingCount: number | null;
  businessStatus: BusinessStatus | null;
  /** Provider-attributed retrieval time; used for the freshness gate at commit time. */
  retrievedAt: Date;
};

export type RestaurantVisibility = {
  active: boolean;
  isDemo: boolean;
  inGreaterHouston: boolean;
  /** True once a reviewer has approved a linked catalog place, if any. */
  catalogApproved: boolean;
};

export type RestaurantCandidateInput = {
  subjectId: string;
  canonicalId: string;
  foodType: string | null;
  foodTypeVersion: number | null;
  visibility: RestaurantVisibility;
  quality: RestaurantQualityFacts;
  hoursByDate: Map<string, DailyHoursSource>;
  timeZone: string;
  hasIndependentEvidence: boolean;
};

/** A committed feature elsewhere in the rotation window (published or a future reservation). */
export type CommittedFeature = {
  date: string;
  canonicalId: string;
  foodType: string;
  /** Excluded from conflict checks: the slot being replaced. */
  pickId: string;
};

export const restaurantExclusionCodes = [
  "area_unreviewed",
  "rating_below_minimum",
  "rating_count_below_minimum",
  "quality_unknown",
  "not_operational",
  "hours_unknown",
  "closed_on_date",
  "service_finished",
  "food_type_unknown",
  "food_type_recent",
  "restaurant_recent",
  "insufficient_evidence",
  "copy_failed",
] as const;
export type RestaurantExclusionCode = (typeof restaurantExclusionCodes)[number];

export type QualificationResult = {
  qualified: boolean;
  /** Every applicable exclusion, in priority order; empty when qualified. */
  codes: RestaurantExclusionCode[];
  /** The single reason to display first. */
  primaryCode: RestaurantExclusionCode | null;
};

/**
 * Evaluate one candidate against every hard gate for `date`, in the priority
 * order the plan specifies. All applicable codes are recorded even though
 * only the first is the displayed reason, so the report can show full detail.
 * Copy validation (`insufficient_evidence`/`copy_failed`) is applied by the
 * caller after this function, once ranking has chosen an attempt order.
 */
export function qualifyRestaurantCandidate(
  candidate: RestaurantCandidateInput,
  date: string,
  now: Date,
  committed: CommittedFeature[],
  config: RestaurantRuleConfig = restaurantRuleDefaults,
): QualificationResult {
  const codes: RestaurantExclusionCode[] = [];
  const { visibility, quality } = candidate;
  if (
    !visibility.active ||
    visibility.isDemo ||
    !visibility.inGreaterHouston ||
    !visibility.catalogApproved
  )
    codes.push("area_unreviewed");

  if (quality.rating == null || quality.ratingCount == null)
    codes.push("quality_unknown");
  else {
    if (quality.rating < config.minRating) codes.push("rating_below_minimum");
    if (quality.ratingCount < config.minRatingCount)
      codes.push("rating_count_below_minimum");
  }

  if (quality.businessStatus !== "OPERATIONAL") codes.push("not_operational");

  const todayHours = candidate.hoursByDate.get(date);
  const yesterdayHours = candidate.hoursByDate.get(addDays(date, -1));
  if (!todayHours && !yesterdayHours) codes.push("hours_unknown");
  else if (
    !hasServiceOnDate(candidate.hoursByDate, date, candidate.timeZone, now)
  ) {
    const dayStart = zonedMidnight(date, candidate.timeZone);
    const dayEnd = zonedMidnight(addDays(date, 1), candidate.timeZone);
    const intervals = [
      ...normalizeDailyIntervals(yesterdayHours ?? null, candidate.timeZone),
      ...normalizeDailyIntervals(todayHours ?? null, candidate.timeZone),
    ];
    const servedAtAll = intervalsIntersect(intervals, dayStart, dayEnd);
    codes.push(servedAtAll ? "service_finished" : "closed_on_date");
  }

  if (!candidate.foodType) codes.push("food_type_unknown");
  if (!candidate.hasIndependentEvidence) codes.push("insufficient_evidence");

  if (candidate.foodType) {
    const conflict = committed.some(
      (f) =>
        f.foodType === candidate.foodType &&
        Math.abs(daysBetween(date, f.date)) <= config.foodRotationDays,
    );
    if (conflict) codes.push("food_type_recent");
  }
  const restaurantConflict = committed.some(
    (f) =>
      f.canonicalId === candidate.canonicalId &&
      Math.abs(daysBetween(date, f.date)) <= config.restaurantRepeatDays,
  );
  if (restaurantConflict) codes.push("restaurant_recent");

  return {
    qualified: codes.length === 0,
    codes,
    primaryCode: codes[0] ?? null,
  };
}

/**
 * Rating-volume adjustment: `(ratingCount * rating + weight * prior) / (ratingCount + weight)`.
 * Reduces the influence of small samples without a hard floor. Returns null
 * when rating data is unavailable so callers can sort unknowns last.
 */
export function qualityScore(
  rating: number | null,
  ratingCount: number | null,
  config: RestaurantRuleConfig = restaurantRuleDefaults,
): number | null {
  if (rating == null || ratingCount == null) return null;
  return (
    (ratingCount * rating + config.ratingPriorWeight * config.ratingPrior) /
    (ratingCount + config.ratingPriorWeight)
  );
}

export type RankedCandidate = {
  candidate: RestaurantCandidateInput;
  score: number | null;
  baseRank: number;
};

/** Full-precision score comparison, ties broken by a stable area/date/subject hash. */
export function rankCandidates(
  candidates: RestaurantCandidateInput[],
  areaId: string,
  date: string,
  config: RestaurantRuleConfig = restaurantRuleDefaults,
): RankedCandidate[] {
  const withScore = candidates.map((c) => ({
    candidate: c,
    score: qualityScore(c.quality.rating, c.quality.ratingCount, config),
  }));
  withScore.sort((a, b) => {
    if (a.score == null && b.score == null)
      return (
        stableHash(`${areaId}:${date}:${a.candidate.subjectId}`) -
        stableHash(`${areaId}:${date}:${b.candidate.subjectId}`)
      );
    if (a.score == null) return 1;
    if (b.score == null) return -1;
    if (a.score !== b.score) return b.score - a.score;
    return (
      stableHash(`${areaId}:${date}:${a.candidate.subjectId}`) -
      stableHash(`${areaId}:${date}:${b.candidate.subjectId}`)
    );
  });
  return withScore.map((s, i) => ({ ...s, baseRank: i + 1 }));
}

export type CopyAttemptOutcome =
  "grounded" | "insufficient_evidence" | "copy_failed";
export type ReportDecision = "picked" | "eligible_not_picked" | "excluded";

export type ReportRow = {
  subjectId: string;
  canonicalId: string;
  foodType: string | null;
  foodTypeVersion: number | null;
  baseRank: number;
  eligibleRank: number | null;
  reportPosition: number;
  decision: ReportDecision;
  score: number | null;
  primaryReasonCode:
    | RestaurantExclusionCode
    | "picked"
    | "editorial_selection"
    | "lower_quality_score"
    | "rotation_tie_break"
    | null;
  allReasonCodes: RestaurantExclusionCode[];
};

export type RestaurantRunOutcome =
  | {
      status: "picked";
      winnerSubjectId: string;
      report: ReportRow[];
      poolSize: number;
      evaluatedCount: number;
      excludedCount: number;
    }
  | {
      status: "empty";
      reason: "no_eligible_candidates" | "all_copy_attempts_failed";
      report: ReportRow[];
      poolSize: number;
      evaluatedCount: number;
      excludedCount: number;
    };

/**
 * Build the top-N decision report and choose a winner. Copy validation is
 * modeled through `attemptCopy`, called in ranked order for qualified
 * candidates, at most `config.maxCopyAttempts` times; the first grounded
 * attempt wins. This function is otherwise pure and deterministic given the
 * same candidates, committed history and `attemptCopy` outcomes.
 */
export function buildRestaurantReport(
  candidates: RestaurantCandidateInput[],
  areaId: string,
  date: string,
  now: Date,
  committed: CommittedFeature[],
  attemptCopy: (candidate: RestaurantCandidateInput) => CopyAttemptOutcome,
  config: RestaurantRuleConfig = restaurantRuleDefaults,
): RestaurantRunOutcome {
  const ranked = rankCandidates(candidates, areaId, date, config);
  const qualification = new Map(
    ranked.map((r) => [
      r.candidate.subjectId,
      qualifyRestaurantCandidate(r.candidate, date, now, committed, config),
    ]),
  );
  const eligibleInOrder = ranked.filter(
    (r) => qualification.get(r.candidate.subjectId)!.qualified,
  );
  let eligibleRankCounter = 0;
  const eligibleRank = new Map<string, number>();
  for (const r of eligibleInOrder)
    eligibleRank.set(r.candidate.subjectId, ++eligibleRankCounter);

  let winnerSubjectId: string | null = null;
  const copyOutcome = new Map<string, CopyAttemptOutcome>();
  let attempts = 0;
  for (const r of eligibleInOrder) {
    if (attempts >= config.maxCopyAttempts) break;
    attempts += 1;
    const outcome = attemptCopy(r.candidate);
    copyOutcome.set(r.candidate.subjectId, outcome);
    if (outcome === "grounded") {
      winnerSubjectId = r.candidate.subjectId;
      break;
    }
  }

  const excludedOrder = ranked.filter(
    (r) => !qualification.get(r.candidate.subjectId)!.qualified,
  );
  const others = [
    ...eligibleInOrder.filter((r) => r.candidate.subjectId !== winnerSubjectId),
    ...excludedOrder,
  ];
  const reportCandidates = winnerSubjectId
    ? [
        ranked.find((r) => r.candidate.subjectId === winnerSubjectId)!,
        ...others.slice(0, config.reportSize - 1),
      ]
    : ranked.slice(0, config.reportSize);

  const report: ReportRow[] = reportCandidates.map((r, i) => {
    const q = qualification.get(r.candidate.subjectId)!;
    const copy = copyOutcome.get(r.candidate.subjectId);
    const isWinner = r.candidate.subjectId === winnerSubjectId;
    const decision: ReportDecision = isWinner
      ? "picked"
      : q.qualified
        ? "eligible_not_picked"
        : "excluded";
    let primaryReasonCode: ReportRow["primaryReasonCode"];
    if (isWinner) primaryReasonCode = "picked";
    else if (!q.qualified)
      primaryReasonCode =
        copy === "insufficient_evidence" || copy === "copy_failed"
          ? copy
          : q.primaryCode;
    else primaryReasonCode = "lower_quality_score";
    return {
      subjectId: r.candidate.subjectId,
      canonicalId: r.candidate.canonicalId,
      foodType: r.candidate.foodType,
      foodTypeVersion: r.candidate.foodTypeVersion,
      baseRank: r.baseRank,
      eligibleRank: eligibleRank.get(r.candidate.subjectId) ?? null,
      reportPosition: i + 1,
      decision,
      score: qualityScore(
        r.candidate.quality.rating,
        r.candidate.quality.ratingCount,
        config,
      ),
      primaryReasonCode,
      allReasonCodes: q.codes,
    };
  });

  const poolSize = candidates.length;
  const evaluatedCount = ranked.length;
  const excludedCount = excludedOrder.length;
  if (!winnerSubjectId)
    return {
      status: "empty",
      reason:
        eligibleInOrder.length === 0
          ? "no_eligible_candidates"
          : "all_copy_attempts_failed",
      report,
      poolSize,
      evaluatedCount,
      excludedCount,
    };
  return {
    status: "picked",
    winnerSubjectId,
    report,
    poolSize,
    evaluatedCount,
    excludedCount,
  };
}

export const restaurantEvidenceFact = z.object({
  id: z.string().max(64),
  label: z.string().max(200),
  sourceUrl: z.url().optional(),
});
export type RestaurantEvidenceFact = z.infer<typeof restaurantEvidenceFact>;

/** Copy output the LLM adapter must produce; validated before it can be shown. */
export const restaurantCopyOutput = z.object({
  en: z.string().trim().min(1).max(500),
  zh: z.string().trim().min(1).max(500),
  factIds: z.array(z.string().max(64)).min(1),
  promptVersion: z.string().max(40),
  modelVersion: z.string().max(80),
});
export type RestaurantCopyOutput = z.infer<typeof restaurantCopyOutput>;
const sentenceCount = (text: string) =>
  (text.match(/[.!?。！？]+/g) ?? []).length;

/**
 * Validate copy against the evidence it claims to use: every cited fact ID
 * must exist in the approved evidence set, both languages must be present
 * and within length, and each language needs two or three sentences. This is
 * schema/grounding validation only; it does not detect unsupported
 * superlatives or invented claims, which need the human factual-review rubric
 * described in the plan.
 */
export function validateRestaurantCopy(
  copy: RestaurantCopyOutput,
  approvedFactIds: ReadonlySet<string>,
): { valid: true } | { valid: false; reason: string } {
  if (!copy.factIds.every((id) => approvedFactIds.has(id)))
    return {
      valid: false,
      reason: "Cites a fact ID outside the approved evidence set.",
    };
  for (const [lang, text] of [
    ["en", copy.en] as const,
    ["zh", copy.zh] as const,
  ]) {
    if (/<[a-z][\s\S]*>/i.test(text))
      return { valid: false, reason: `${lang} text contains HTML markup.` };
    const count = sentenceCount(text);
    if (lang === "en" && (count < 2 || count > 3))
      return {
        valid: false,
        reason: "English copy must be two or three sentences.",
      };
  }
  return { valid: true };
}
