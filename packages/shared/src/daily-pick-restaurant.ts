import { z } from "zod";
import {
  addDays,
  daysBetween,
  localDate,
  zonedMidnight,
  zonedParts,
} from "./time";
import { stableHash } from "./daily-pick";

/* ---------------------------------------------------------------------------
   Daily restaurant recommendation (version 2): pure eligibility, ranking and
   report contracts for the Greater Houston restaurant pipeline described in
   docs/plans/daily-restaurant-recommendation-implementation-plan.md. This
   module never fetches, geocodes or calls a model; callers supply normalized,
   validated candidate facts and an explicit clock/date. See
   packages/shared/src/daily-pick.ts for the version 1 catalog-place rules,
   which this module does not replace.
   --------------------------------------------------------------------------- */
export const restaurantSelectionVersion = 2;
/** Tuning defaults from the plan; versioned so a rule change is auditable. */
export const restaurantRuleConfigSchema = z.object({
  minRating: z.number().finite().min(0).max(5),
  minRatingCount: z.number().finite().int().min(0),
  /** Same primary food type excluded within this many calendar days either direction. */
  foodRotationDays: z.number().finite().int().min(0),
  /** Same canonical restaurant excluded within at least this many calendar days either direction. */
  restaurantRepeatDays: z.number().finite().int().min(0),
  /** Rating-volume adjustment prior and weight (tuning defaults, not measured statistics). */
  ratingPrior: z.number().finite().min(0).max(5),
  ratingPriorWeight: z.number().finite().min(0),
  /** Freshness ceiling for the finalist's rating/status/hours before committing. */
  maxEvidenceAgeMinutes: z.number().finite().int().min(1),
  /** At most this many candidates get a copy attempt before a run is marked copy_failed. */
  maxCopyAttempts: z.number().finite().int().min(1),
  /** Report shows the winner plus this many other candidates. */
  reportSize: z.number().finite().int().min(1),
});
/** Validated, numeric (not literal-typed) run configuration. */
export type RestaurantRuleConfig = z.infer<typeof restaurantRuleConfigSchema>;
export const restaurantRuleDefaults: RestaurantRuleConfig =
  restaurantRuleConfigSchema.parse({
    minRating: 4.3,
    minRatingCount: 30,
    foodRotationDays: 6,
    restaurantRepeatDays: 30,
    ratingPrior: 4.2,
    ratingPriorWeight: 50,
    maxEvidenceAgeMinutes: 30,
    maxCopyAttempts: 3,
    reportSize: 10,
  });

/** A half-open service interval on one calendar date, in UTC instants. */
export type ServiceInterval = { start: Date; end: Date };
/** Raw provider hours for one date, before interval normalization. */
export type DailyHoursSource = {
  date: string;
  /** Minutes since local midnight; `close` past 1440 means it runs past midnight. */
  periods: { open: number; close: number }[];
} | null;

function offsetMinutesAt(instant: number, timeZone: string) {
  const p = zonedParts(new Date(instant), timeZone);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return (asUtc - instant) / 60000;
}
function wallClockMatches(
  instant: number,
  y: number,
  m: number,
  d: number,
  hour: number,
  minute: number,
  timeZone: string,
) {
  const p = zonedParts(new Date(instant), timeZone);
  return (
    p.year === y &&
    p.month === m &&
    p.day === d &&
    p.hour === hour &&
    p.minute === minute
  );
}
/**
 * Resolve a wall-clock time (a calendar date plus minutes-since-midnight, so
 * values >= 1440 roll into the next day) to its actual UTC instant in a time
 * zone, correcting for the zone's real offset at that moment rather than
 * assuming a fixed midnight-plus-minutes offset (which drifts by an hour
 * across a DST transition). Ambiguous local times (a "fall back" repeated
 * hour) resolve to their first, earlier occurrence; nonexistent local times
 * (a "spring forward" skipped hour) resolve to the instant immediately after
 * the gap, matching how providers report a skipped opening time.
 */
export function zonedInstant(
  dateIso: string,
  minutesSinceMidnight: number,
  timeZone: string,
): Date {
  const days = Math.floor(minutesSinceMidnight / 1440);
  const rem = minutesSinceMidnight - days * 1440;
  const dateForDay = days !== 0 ? addDays(dateIso, days) : dateIso;
  const [y, m, d] = dateForDay.split("-").map(Number);
  const hour = Math.floor(rem / 60);
  const minute = rem % 60;
  const naiveUtc = Date.UTC(y, m - 1, d, hour, minute, 0);
  const offset0 = offsetMinutesAt(naiveUtc, timeZone);
  const candidateA = naiveUtc - offset0 * 60000;
  const offsetA = offsetMinutesAt(candidateA, timeZone);
  if (offsetA === offset0) return new Date(candidateA);
  const candidateB = naiveUtc - offsetA * 60000;
  const matchA = wallClockMatches(candidateA, y, m, d, hour, minute, timeZone);
  const matchB = wallClockMatches(candidateB, y, m, d, hour, minute, timeZone);
  if (matchA && matchB) return new Date(Math.min(candidateA, candidateB));
  if (matchB) return new Date(candidateB);
  if (matchA) return new Date(candidateA);
  return new Date(Math.max(candidateA, candidateB));
}

/**
 * Normalize one date's opening periods into half-open UTC intervals. Periods
 * are minutes-since-local-midnight, already resolved by the caller from the
 * provider's date-specific hours (not the weekly regular hours). An overnight
 * period (close > 1440) produces an interval ending after local midnight of
 * the next day; a 24-hour day is `{ open: 0, close: 1440 }`. Each endpoint is
 * resolved independently through `zonedInstant`, so a period spanning a DST
 * transition yields a genuinely 23- or 25-hour interval rather than a fixed
 * offset from midnight.
 */
export function normalizeDailyIntervals(
  source: DailyHoursSource,
  timeZone: string,
): ServiceInterval[] {
  if (!source || !source.periods.length) return [];
  return source.periods
    .filter(
      (p) =>
        Number.isFinite(p.open) && Number.isFinite(p.close) && p.close > p.open,
    )
    .map((p) => ({
      start: zonedInstant(source.date, p.open, timeZone),
      end: zonedInstant(source.date, p.close, timeZone),
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

/**
 * A rating/count pair is only usable when both are present, finite and in a
 * physically sensible range; anything else (NaN, negative counts, a rating
 * above 5) is treated the same as missing data (`quality_unknown`), never as
 * a passing or failing numeric value.
 */
function usableQuality(rating: number | null, ratingCount: number | null) {
  return (
    rating != null &&
    ratingCount != null &&
    Number.isFinite(rating) &&
    Number.isFinite(ratingCount) &&
    rating >= 0 &&
    rating <= 5 &&
    ratingCount >= 0
  );
}

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

/**
 * A committed feature elsewhere in the rotation window: published, withdrawn
 * (withdrawal never resets rotation), or a future reservation. `foodType` is
 * null for legacy version 1 history or any feature whose food type was never
 * classified; such a row still consumes the restaurant-repeat window but
 * cannot produce a food-type-recent conflict, since there is nothing honest
 * to compare it against.
 */
export type CommittedFeature = {
  date: string;
  canonicalId: string;
  foodType: string | null;
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
 * Copy validation (`insufficient_evidence`/`copy_failed`) is layered on by
 * `buildRestaurantReport` after this function, once ranking has chosen an
 * attempt order.
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

  if (!usableQuality(quality.rating, quality.ratingCount))
    codes.push("quality_unknown");
  else {
    if (quality.rating! < config.minRating) codes.push("rating_below_minimum");
    if (quality.ratingCount! < config.minRatingCount)
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
  // "At least N days between features": distance N itself is allowed, only
  // strictly smaller distances conflict.
  const restaurantConflict = committed.some(
    (f) =>
      f.canonicalId === candidate.canonicalId &&
      Math.abs(daysBetween(date, f.date)) < config.restaurantRepeatDays,
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
 * when rating data is unavailable or out of range so callers can sort
 * unknowns last instead of scoring them as zero.
 */
export function qualityScore(
  rating: number | null,
  ratingCount: number | null,
  config: RestaurantRuleConfig = restaurantRuleDefaults,
): number | null {
  if (!usableQuality(rating, ratingCount)) return null;
  return (
    (ratingCount! * rating! + config.ratingPriorWeight * config.ratingPrior) /
    (ratingCount! + config.ratingPriorWeight)
  );
}

/** Deterministic order for a hash tie: fall back to a plain string compare. */
function stableCompare(areaId: string, date: string, a: string, b: string) {
  const hashA = stableHash(`${areaId}:${date}:${a}`);
  const hashB = stableHash(`${areaId}:${date}:${b}`);
  if (hashA !== hashB) return hashA - hashB;
  return a < b ? -1 : a > b ? 1 : 0;
}

export type RankedCandidate = {
  candidate: RestaurantCandidateInput;
  score: number | null;
  baseRank: number;
};

/**
 * Full-precision score comparison, ties broken by a stable area/date/subject
 * hash and, if that also collides, by the subject ID itself so ordering
 * never depends on incidental array/sort-implementation order.
 */
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
      return stableCompare(
        areaId,
        date,
        a.candidate.subjectId,
        b.candidate.subjectId,
      );
    if (a.score == null) return 1;
    if (b.score == null) return -1;
    if (a.score !== b.score) return b.score - a.score;
    return stableCompare(
      areaId,
      date,
      a.candidate.subjectId,
      b.candidate.subjectId,
    );
  });
  return withScore.map((s, i) => ({ ...s, baseRank: i + 1 }));
}

export type CopyAttemptOutcome =
  "grounded" | "insufficient_evidence" | "copy_failed";
export type ReportDecision = "picked" | "eligible_not_picked" | "excluded";
export type ReportReasonCode =
  | RestaurantExclusionCode
  | "picked"
  | "editorial_selection"
  | "lower_quality_score"
  | "rotation_tie_break";

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
  primaryReasonCode: ReportReasonCode | null;
  allReasonCodes: (
    RestaurantExclusionCode | "copy_failed" | "insufficient_evidence"
  )[];
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
 * modeled through `attemptCopy`, called in ranked order for hard-gate-qualified
 * candidates, at most `config.maxCopyAttempts` times; the first grounded
 * attempt wins. A qualified candidate whose copy attempt failed is reported
 * as `excluded` with the copy failure code, never as merely outranked. This
 * function is otherwise pure and deterministic given the same candidates,
 * committed history and `attemptCopy` outcomes.
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
  const winnerScore = winnerSubjectId
    ? qualityScore(
        ranked.find((r) => r.candidate.subjectId === winnerSubjectId)!.candidate
          .quality.rating,
        ranked.find((r) => r.candidate.subjectId === winnerSubjectId)!.candidate
          .quality.ratingCount,
        config,
      )
    : null;

  // Others follow base quality order (score, then deterministic tie-break),
  // exactly as ranked: an excellent but hard-gate-excluded candidate can
  // still appear ahead of a lower-scoring eligible one, and the report says
  // why instead of silently sorting excluded candidates to the bottom.
  const others = ranked.filter(
    (r) => r.candidate.subjectId !== winnerSubjectId,
  );
  const reportCandidates = winnerSubjectId
    ? [
        ranked.find((r) => r.candidate.subjectId === winnerSubjectId)!,
        ...others.slice(0, config.reportSize - 1),
      ]
    : ranked.slice(0, config.reportSize);

  const report: ReportRow[] = reportCandidates.map((r, i) => {
    const q = qualification.get(r.candidate.subjectId)!;
    const copy = copyOutcome.get(r.candidate.subjectId);
    const copyFailed =
      copy === "insufficient_evidence" || copy === "copy_failed";
    const isWinner = r.candidate.subjectId === winnerSubjectId;
    const rowScore = qualityScore(
      r.candidate.quality.rating,
      r.candidate.quality.ratingCount,
      config,
    );
    const decision: ReportDecision = isWinner
      ? "picked"
      : q.qualified && !copyFailed
        ? "eligible_not_picked"
        : "excluded";
    let primaryReasonCode: ReportRow["primaryReasonCode"];
    let allReasonCodes: ReportRow["allReasonCodes"] = q.codes;
    if (isWinner) primaryReasonCode = "picked";
    else if (copyFailed) {
      primaryReasonCode = copy;
      allReasonCodes = [...q.codes, copy!];
    } else if (!q.qualified) primaryReasonCode = q.primaryCode;
    else
      primaryReasonCode =
        winnerScore != null && rowScore === winnerScore
          ? "rotation_tie_break"
          : "lower_quality_score";
    return {
      subjectId: r.candidate.subjectId,
      canonicalId: r.candidate.canonicalId,
      foodType: r.candidate.foodType,
      foodTypeVersion: r.candidate.foodTypeVersion,
      baseRank: r.baseRank,
      eligibleRank: eligibleRank.get(r.candidate.subjectId) ?? null,
      reportPosition: i + 1,
      decision,
      score: rowScore,
      primaryReasonCode,
      allReasonCodes,
    };
  });

  const copyFailedIds = new Set(
    [...copyOutcome].filter(([, o]) => o !== "grounded").map(([id]) => id),
  );
  const poolSize = candidates.length;
  const evaluatedCount = ranked.length;
  const excludedCount = ranked.filter(
    (r) =>
      !qualification.get(r.candidate.subjectId)!.qualified ||
      copyFailedIds.has(r.candidate.subjectId),
  ).length;
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

const noHtml = (label: string) =>
  z
    .string()
    .trim()
    .min(1)
    .max(250)
    .refine(
      (v) => !/<[a-z][\s\S]*>/i.test(v),
      `${label} must not contain HTML markup.`,
    );
/** One recommendation sentence and the specific approved facts it relies on. */
export const restaurantCopySentence = z.object({
  text: noHtml("Sentence"),
  factIds: z.array(z.string().max(64)).min(1),
});
export type RestaurantCopySentence = z.infer<typeof restaurantCopySentence>;
/**
 * Copy output the LLM adapter must produce: two or three sentences per
 * language, each citing the specific evidence it relies on (not one global
 * fact-ID list for the whole paragraph), plus the prompt/model versions used.
 */
export const restaurantCopyOutput = z.object({
  enSentences: z.array(restaurantCopySentence).min(2).max(3),
  zhSentences: z.array(restaurantCopySentence).min(2).max(3),
  promptVersion: z.string().max(40),
  modelVersion: z.string().max(80),
});
export type RestaurantCopyOutput = z.infer<typeof restaurantCopyOutput>;
/** A validated copy record awaiting or holding the pilot's required moderator approval. */
export const restaurantCopyReviewStatuses = [
  "pending",
  "approved",
  "rejected",
] as const;
export type RestaurantCopyReviewStatus =
  (typeof restaurantCopyReviewStatuses)[number];
export type RestaurantCopyRecord = {
  copy: RestaurantCopyOutput;
  reviewStatus: RestaurantCopyReviewStatus;
  reviewedBy: string | null;
  reviewedAt: Date | null;
};

const maxCombinedLength = 500;

/**
 * Validate copy against the evidence it claims to use: every sentence's
 * cited fact IDs must exist in the approved evidence set, both languages
 * need two or three sentences within the combined length cap, and no
 * sentence may contain markup. This is schema/grounding validation only; it
 * does not by itself detect unsupported superlatives or invented claims,
 * which the plan requires a human factual-review rubric to catch during the
 * initial pilot (`RestaurantCopyRecord.reviewStatus` models that required
 * approval step; this function does not set it).
 */
export function validateRestaurantCopy(
  copy: RestaurantCopyOutput,
  approvedFactIds: ReadonlySet<string>,
): { valid: true } | { valid: false; reason: string } {
  for (const [lang, sentences] of [
    ["en", copy.enSentences] as const,
    ["zh", copy.zhSentences] as const,
  ]) {
    if (sentences.length < 2 || sentences.length > 3)
      return {
        valid: false,
        reason: `${lang} copy must be two or three sentences.`,
      };
    for (const sentence of sentences) {
      if (!sentence.factIds.every((id) => approvedFactIds.has(id)))
        return {
          valid: false,
          reason: `${lang} sentence cites a fact ID outside the approved evidence set.`,
        };
      if (/<[a-z][\s\S]*>/i.test(sentence.text))
        return {
          valid: false,
          reason: `${lang} sentence contains HTML markup.`,
        };
    }
    const combined = sentences.map((s) => s.text).join(" ");
    if (combined.length > maxCombinedLength)
      return { valid: false, reason: `${lang} copy exceeds the length cap.` };
  }
  return { valid: true };
}
