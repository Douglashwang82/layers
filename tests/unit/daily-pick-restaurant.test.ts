import { describe, it, expect } from "vitest";
import {
  buildRestaurantReport,
  hasServiceOnDate,
  normalizeDailyIntervals,
  qualifyRestaurantCandidate,
  qualityScore,
  rankCandidates,
  restaurantRuleDefaults,
  validateRestaurantCopy,
  zonedInstant,
  type CommittedFeature,
  type RestaurantCandidateInput,
  type RestaurantCopyOutput,
  type DailyHoursSource,
} from "../../packages/shared/src";

const tz = "America/Chicago";
let n = 0;
function candidate(
  overrides: Partial<RestaurantCandidateInput> = {},
): RestaurantCandidateInput {
  n += 1;
  return {
    subjectId: `subject-${n}`,
    canonicalId: `canonical-${n}`,
    foodType: "tacos",
    foodTypeVersion: 1,
    visibility: {
      active: true,
      isDemo: false,
      inGreaterHouston: true,
      catalogApproved: true,
    },
    quality: {
      rating: 4.5,
      ratingCount: 100,
      businessStatus: "OPERATIONAL",
      retrievedAt: new Date("2026-09-27T12:00:00Z"),
    },
    hoursByDate: new Map<string, DailyHoursSource>([
      [
        "2026-09-27",
        { date: "2026-09-27", periods: [{ open: 660, close: 1320 }] },
      ],
    ]),
    timeZone: tz,
    hasIndependentEvidence: true,
    ...overrides,
  };
}
const noon = new Date("2026-09-27T17:00:00Z"); // noon CDT
function copySentences(text: string) {
  return [
    { text, factIds: ["f1"] },
    { text, factIds: ["f2"] },
  ];
}
function copyOutput(
  overrides: Partial<RestaurantCopyOutput> = {},
): RestaurantCopyOutput {
  return {
    enSentences: copySentences("A fact-supported sentence."),
    zhSentences: copySentences("一句有事實依據的句子。"),
    promptVersion: "v1",
    modelVersion: "test",
    ...overrides,
  };
}

describe("zonedInstant DST handling", () => {
  // America/Chicago springs forward 2026-03-08 02:00 CST -> 03:00 CDT (2:00-2:59 does not exist)
  // and falls back 2026-11-01 02:00 CDT -> 01:00 CST (1:00-1:59 occurs twice).
  it("resolves a normal wall-clock time to the correct offset (CDT, UTC-5)", () => {
    const instant = zonedInstant("2026-09-27", 12 * 60, tz); // noon CDT
    expect(instant.toISOString()).toBe("2026-09-27T17:00:00.000Z");
  });

  it("pushes a nonexistent spring-forward local time to the instant after the gap", () => {
    // 02:30 local doesn't exist on 2026-03-08; the correct resolved instant is 03:30 CDT = 08:30Z.
    const instant = zonedInstant("2026-03-08", 2 * 60 + 30, tz);
    expect(instant.toISOString()).toBe("2026-03-08T08:30:00.000Z");
  });

  it("resolves an ambiguous fall-back local time to its first (earlier) occurrence", () => {
    // 01:30 local occurs twice on 2026-11-01: first at 06:30Z (CDT, UTC-5), then at 07:30Z (CST, UTC-6).
    const instant = zonedInstant("2026-11-01", 1 * 60 + 30, tz);
    expect(instant.toISOString()).toBe("2026-11-01T06:30:00.000Z");
  });

  it("produces a genuinely 23-hour all-day interval on the spring-forward day", () => {
    const intervals = normalizeDailyIntervals(
      { date: "2026-03-08", periods: [{ open: 0, close: 1440 }] },
      tz,
    );
    expect(intervals).toHaveLength(1);
    const hours =
      (intervals[0].end.getTime() - intervals[0].start.getTime()) / 3600000;
    expect(hours).toBe(23);
  });

  it("produces a genuinely 25-hour all-day interval on the fall-back day", () => {
    const intervals = normalizeDailyIntervals(
      { date: "2026-11-01", periods: [{ open: 0, close: 1440 }] },
      tz,
    );
    expect(intervals).toHaveLength(1);
    const hours =
      (intervals[0].end.getTime() - intervals[0].start.getTime()) / 3600000;
    expect(hours).toBe(25);
  });

  it("keeps a service interval that spans the spring-forward gap at the correct wall-clock length", () => {
    // 01:00 - 04:00 local on the spring-forward day is only 2 real hours (01:00-02:00, then 03:00-04:00).
    const intervals = normalizeDailyIntervals(
      { date: "2026-03-08", periods: [{ open: 60, close: 240 }] },
      tz,
    );
    const hours =
      (intervals[0].end.getTime() - intervals[0].start.getTime()) / 3600000;
    expect(hours).toBe(2);
  });
});

describe("normalizeDailyIntervals / hasServiceOnDate", () => {
  it("returns no intervals for missing hours", () => {
    expect(normalizeDailyIntervals(null, tz)).toEqual([]);
  });

  it("finds a normal daytime interval", () => {
    const hours = new Map<string, DailyHoursSource>([
      [
        "2026-09-27",
        { date: "2026-09-27", periods: [{ open: 660, close: 1320 }] },
      ],
    ]);
    expect(hasServiceOnDate(hours, "2026-09-27", tz, noon)).toBe(true);
  });

  it("qualifies a dinner restaurant already open at 06:00 local", () => {
    const earlyMorning = new Date("2026-09-27T11:00:00Z"); // 06:00 CDT
    const hours = new Map<string, DailyHoursSource>([
      [
        "2026-09-27",
        { date: "2026-09-27", periods: [{ open: 1020, close: 1380 }] },
      ], // 17:00-23:00
    ]);
    expect(hasServiceOnDate(hours, "2026-09-27", tz, earlyMorning)).toBe(true);
  });

  it("rejects an already-finished breakfast service for a late replacement", () => {
    const lateNight = new Date("2026-09-28T02:00:00Z"); // 21:00 CDT same local day
    const hours = new Map<string, DailyHoursSource>([
      [
        "2026-09-27",
        { date: "2026-09-27", periods: [{ open: 360, close: 660 }] },
      ], // 06:00-11:00
    ]);
    expect(hasServiceOnDate(hours, "2026-09-27", tz, lateNight)).toBe(false);
  });

  it("handles an overnight interval crossing local midnight", () => {
    const hours = new Map<string, DailyHoursSource>([
      [
        "2026-09-26",
        { date: "2026-09-26", periods: [{ open: 1320, close: 1560 }] },
      ], // 22:00 -> 02:00 next day
    ]);
    const oneAm = new Date("2026-09-27T06:30:00Z"); // 01:30 CDT on the 27th
    expect(hasServiceOnDate(hours, "2026-09-27", tz, oneAm)).toBe(true);
  });

  it("fails closed when hours are missing entirely (holiday/unknown)", () => {
    expect(hasServiceOnDate(new Map(), "2026-09-27", tz, noon)).toBe(false);
  });
});

describe("qualifyRestaurantCandidate", () => {
  it("qualifies a fully valid candidate", () => {
    const r = qualifyRestaurantCandidate(candidate(), "2026-09-27", noon, []);
    expect(r.qualified).toBe(true);
    expect(r.codes).toEqual([]);
  });

  it("fails a 4.2 rating even with many ratings", () => {
    const c = candidate({
      quality: {
        rating: 4.2,
        ratingCount: 500,
        businessStatus: "OPERATIONAL",
        retrievedAt: noon,
      },
    });
    const r = qualifyRestaurantCandidate(c, "2026-09-27", noon, []);
    expect(r.codes).toContain("rating_below_minimum");
  });

  it("keeps a high-rated restaurant with too few ratings in the pool but fails the count gate", () => {
    const c = candidate({
      quality: {
        rating: 4.9,
        ratingCount: 12,
        businessStatus: "OPERATIONAL",
        retrievedAt: noon,
      },
    });
    const r = qualifyRestaurantCandidate(c, "2026-09-27", noon, []);
    expect(r.qualified).toBe(false);
    expect(r.codes).toContain("rating_count_below_minimum");
  });

  it("marks missing rating data as quality_unknown, not a zero score", () => {
    const c = candidate({
      quality: {
        rating: null,
        ratingCount: null,
        businessStatus: "OPERATIONAL",
        retrievedAt: noon,
      },
    });
    const r = qualifyRestaurantCandidate(c, "2026-09-27", noon, []);
    expect(r.codes).toContain("quality_unknown");
    expect(r.codes).not.toContain("rating_below_minimum");
  });

  it("treats NaN, negative and out-of-range rating/count as unknown, not passing or failing", () => {
    for (const bad of [
      { rating: Number.NaN, ratingCount: 100 },
      { rating: 4.9, ratingCount: -1 },
      { rating: 5.5, ratingCount: 100 },
      { rating: -0.1, ratingCount: 100 },
    ]) {
      const c = candidate({
        quality: {
          rating: bad.rating,
          ratingCount: bad.ratingCount,
          businessStatus: "OPERATIONAL",
          retrievedAt: noon,
        },
      });
      const r = qualifyRestaurantCandidate(c, "2026-09-27", noon, []);
      expect(r.codes).toContain("quality_unknown");
      expect(r.codes).not.toContain("rating_below_minimum");
      expect(r.codes).not.toContain("rating_count_below_minimum");
      expect(qualityScore(bad.rating, bad.ratingCount)).toBeNull();
    }
  });

  it("excludes food type within the rotation window (Monday tacos through Sunday)", () => {
    const committed: CommittedFeature[] = [
      {
        date: "2026-09-21",
        canonicalId: "other",
        foodType: "tacos",
        pickId: "p1",
      }, // Monday
    ];
    // Following Sunday is within 6 days
    const sunday = qualifyRestaurantCandidate(
      candidate(),
      "2026-09-27",
      noon,
      committed,
    );
    expect(sunday.codes).toContain("food_type_recent");
    // The following Monday (7 days later) is allowed again
    const nextMonday = qualifyRestaurantCandidate(
      candidate(),
      "2026-09-28",
      noon,
      committed,
    );
    expect(nextMonday.codes).not.toContain("food_type_recent");
  });

  it("excludes the same restaurant strictly within 30 days in both directions", () => {
    const committed: CommittedFeature[] = [
      {
        date: "2026-10-20",
        canonicalId: "canonical-100",
        foodType: "sushi",
        pickId: "p1",
      },
    ];
    const within = qualifyRestaurantCandidate(
      candidate({ canonicalId: "canonical-100", foodType: "pizza" }),
      "2026-09-21", // 29 days before
      noon,
      committed,
    );
    expect(within.codes).toContain("restaurant_recent");
    const outside = qualifyRestaurantCandidate(
      candidate({ canonicalId: "canonical-100", foodType: "pizza" }),
      "2026-09-20", // 30 days before: "at least 30 days" allows exactly 30
      noon,
      committed,
    );
    expect(outside.codes).not.toContain("restaurant_recent");
  });

  it("allows a restaurant exactly 30 days after its last feature, on the other side too", () => {
    const committed: CommittedFeature[] = [
      {
        date: "2026-09-20",
        canonicalId: "canonical-200",
        foodType: "sushi",
        pickId: "p1",
      },
    ];
    const exactlyThirty = qualifyRestaurantCandidate(
      candidate({ canonicalId: "canonical-200", foodType: "pizza" }),
      "2026-10-20",
      noon,
      committed,
    );
    expect(exactlyThirty.codes).not.toContain("restaurant_recent");
    const twentyNine = qualifyRestaurantCandidate(
      candidate({ canonicalId: "canonical-200", foodType: "pizza" }),
      "2026-10-19",
      noon,
      committed,
    );
    expect(twentyNine.codes).toContain("restaurant_recent");
  });

  it("does not retroactively fail a restaurant that served customers earlier and is now closed for the night", () => {
    const c = candidate({
      hoursByDate: new Map([
        [
          "2026-09-27",
          { date: "2026-09-27", periods: [{ open: 660, close: 1320 }] },
        ],
      ]),
    });
    const lateAtNight = new Date("2026-09-28T04:00:00Z"); // 23:00 CDT, well after close
    const r = qualifyRestaurantCandidate(c, "2026-09-27", lateAtNight, []);
    // The gate is only evaluated "as of" the run time relative to the target date semantics;
    // a past date's service already happened and is not re-checked against "now".
    expect(r.codes).not.toContain("closed_on_date");
  });
});

describe("qualityScore / rankCandidates", () => {
  it("returns null when rating data is unavailable", () => {
    expect(qualityScore(null, null)).toBeNull();
  });

  it("pulls a tiny sample toward the prior more than a large one", () => {
    const tiny = qualityScore(5, 1, restaurantRuleDefaults)!;
    const large = qualityScore(5, 1000, restaurantRuleDefaults)!;
    expect(tiny).toBeLessThan(large);
    expect(tiny).toBeGreaterThan(restaurantRuleDefaults.ratingPrior);
  });

  it("sorts unknown-score candidates after known ones", () => {
    const known = candidate();
    const unknown = candidate({
      quality: {
        rating: null,
        ratingCount: null,
        businessStatus: "OPERATIONAL",
        retrievedAt: noon,
      },
    });
    const ranked = rankCandidates([unknown, known], "area-1", "2026-09-27");
    expect(ranked[0].candidate.subjectId).toBe(known.subjectId);
    expect(ranked[1].candidate.subjectId).toBe(unknown.subjectId);
  });

  it("produces an identical order for identical input (deterministic tie-break)", () => {
    const a = candidate({
      subjectId: "a",
      quality: {
        rating: 4.5,
        ratingCount: 50,
        businessStatus: "OPERATIONAL",
        retrievedAt: noon,
      },
    });
    const b = candidate({
      subjectId: "b",
      quality: {
        rating: 4.5,
        ratingCount: 50,
        businessStatus: "OPERATIONAL",
        retrievedAt: noon,
      },
    });
    const r1 = rankCandidates([a, b], "area-1", "2026-09-27").map(
      (r) => r.candidate.subjectId,
    );
    const r2 = rankCandidates([b, a], "area-1", "2026-09-27").map(
      (r) => r.candidate.subjectId,
    );
    expect(r1).toEqual(r2);
  });
});

describe("buildRestaurantReport", () => {
  it("includes the winner and honestly reports fewer than ten with a small pool", () => {
    const candidates = [candidate(), candidate({ foodType: "pizza" })];
    const outcome = buildRestaurantReport(
      candidates,
      "area-1",
      "2026-09-27",
      noon,
      [],
      () => "grounded",
    );
    expect(outcome.status).toBe("picked");
    expect(outcome.report.length).toBe(2);
    expect(outcome.report[0].decision).toBe("picked");
  });

  it("includes an excellent-but-closed alternative in the shortlist with an honest reason", () => {
    const winner = candidate({ foodType: "pizza" });
    const closedButExcellent = candidate({
      foodType: "sushi",
      quality: {
        rating: 4.9,
        ratingCount: 900,
        businessStatus: "CLOSED_TEMPORARILY",
        retrievedAt: noon,
      },
    });
    const outcome = buildRestaurantReport(
      [winner, closedButExcellent],
      "area-1",
      "2026-09-27",
      noon,
      [],
      (c) =>
        c.subjectId === closedButExcellent.subjectId
          ? "copy_failed"
          : "grounded",
    );
    expect(outcome.status).toBe("picked");
    const row = outcome.report.find(
      (r) => r.subjectId === closedButExcellent.subjectId,
    )!;
    expect(row.decision).toBe("excluded");
    expect(row.allReasonCodes).toContain("not_operational");
    expect(row.score!).toBeGreaterThan(
      outcome.status === "picked"
        ? outcome.report.find((r) => r.decision === "picked")!.score!
        : 0,
    );
  });

  it("places the winner outside the base top ten and still shows the higher-ranked excluded candidates", () => {
    // 12 candidates ranked strictly by score; the top 10 by base quality are all excluded
    // (closed), and the winner is base rank 11.
    const candidates = Array.from({ length: 12 }, (_, i) => {
      if (i < 10)
        return candidate({
          foodType: `cuisine-${i}`,
          quality: {
            rating: 4.9,
            ratingCount: 900 - i,
            businessStatus: "CLOSED_TEMPORARILY",
            retrievedAt: noon,
          },
        });
      return candidate({
        foodType: `cuisine-${i}`,
        quality: {
          rating: 4.3,
          ratingCount: 30,
          businessStatus: "OPERATIONAL",
          retrievedAt: noon,
        },
      });
    });
    const outcome = buildRestaurantReport(
      candidates,
      "area-1",
      "2026-09-27",
      noon,
      [],
      () => "grounded",
    );
    expect(outcome.status).toBe("picked");
    if (outcome.status !== "picked") throw new Error("unreachable");
    const winnerRow = outcome.report.find(
      (r) => r.subjectId === outcome.winnerSubjectId,
    )!;
    expect(winnerRow.baseRank).toBeGreaterThan(10);
    // reportSize (10) = the winner plus nine base-quality-ordered others; since
    // the ten highest-scoring candidates are all excluded (closed), every slot
    // besides the winner is one of those excluded, higher-scoring candidates.
    expect(outcome.report.length).toBe(restaurantRuleDefaults.reportSize);
    const excludedRows = outcome.report.filter(
      (r) => r.decision === "excluded",
    );
    expect(excludedRows.length).toBe(restaurantRuleDefaults.reportSize - 1);
    for (const row of excludedRows)
      expect(row.allReasonCodes).toContain("not_operational");
  });

  it("marks a qualified candidate whose copy failed as excluded with the copy reason, not lower_quality_score", () => {
    const better = candidate({
      foodType: "pizza",
      quality: {
        rating: 4.9,
        ratingCount: 900,
        businessStatus: "OPERATIONAL",
        retrievedAt: noon,
      },
    });
    const winner = candidate({
      foodType: "ramen",
      quality: {
        rating: 4.3,
        ratingCount: 30,
        businessStatus: "OPERATIONAL",
        retrievedAt: noon,
      },
    });
    const outcome = buildRestaurantReport(
      [better, winner],
      "area-1",
      "2026-09-27",
      noon,
      [],
      (c) =>
        c.subjectId === better.subjectId ? "insufficient_evidence" : "grounded",
    );
    expect(outcome.status).toBe("picked");
    const row = outcome.report.find((r) => r.subjectId === better.subjectId)!;
    expect(row.decision).toBe("excluded");
    expect(row.primaryReasonCode).toBe("insufficient_evidence");
    expect(row.allReasonCodes).toContain("insufficient_evidence");
    if (outcome.status === "picked") expect(outcome.excludedCount).toBe(1);
  });

  it("labels an exact-score loser as rotation_tie_break, not lower_quality_score", () => {
    const shared = {
      rating: 4.5,
      ratingCount: 100,
      businessStatus: "OPERATIONAL" as const,
      retrievedAt: noon,
    };
    const a = candidate({
      subjectId: "tie-a",
      foodType: "pizza",
      quality: shared,
    });
    const b = candidate({
      subjectId: "tie-b",
      foodType: "ramen",
      quality: shared,
    });
    const outcome = buildRestaurantReport(
      [a, b],
      "area-1",
      "2026-09-27",
      noon,
      [],
      () => "grounded",
    );
    expect(outcome.status).toBe("picked");
    if (outcome.status !== "picked") throw new Error("unreachable");
    const loserId = outcome.winnerSubjectId === "tie-a" ? "tie-b" : "tie-a";
    const loser = outcome.report.find((r) => r.subjectId === loserId)!;
    expect(loser.decision).toBe("eligible_not_picked");
    expect(loser.primaryReasonCode).toBe("rotation_tie_break");
  });

  it("labels a strictly lower-scoring eligible loser as lower_quality_score", () => {
    const winner = candidate({
      foodType: "pizza",
      quality: {
        rating: 4.9,
        ratingCount: 900,
        businessStatus: "OPERATIONAL",
        retrievedAt: noon,
      },
    });
    const loser = candidate({
      foodType: "ramen",
      quality: {
        rating: 4.3,
        ratingCount: 30,
        businessStatus: "OPERATIONAL",
        retrievedAt: noon,
      },
    });
    const outcome = buildRestaurantReport(
      [winner, loser],
      "area-1",
      "2026-09-27",
      noon,
      [],
      () => "grounded",
    );
    expect(outcome.status).toBe("picked");
    const row = outcome.report.find((r) => r.subjectId === loser.subjectId)!;
    expect(row.decision).toBe("eligible_not_picked");
    expect(row.primaryReasonCode).toBe("lower_quality_score");
  });

  it("reports no result honestly with diagnostics when nothing qualifies", () => {
    const c = candidate({
      quality: {
        rating: 3.9,
        ratingCount: 5,
        businessStatus: "OPERATIONAL",
        retrievedAt: noon,
      },
    });
    const outcome = buildRestaurantReport(
      [c],
      "area-1",
      "2026-09-27",
      noon,
      [],
      () => "grounded",
    );
    expect(outcome.status).toBe("empty");
    if (outcome.status === "empty")
      expect(outcome.reason).toBe("no_eligible_candidates");
    expect(outcome.report.length).toBe(1);
  });

  it("tries up to three eligible candidates for copy before failing the run", () => {
    const cands = [
      candidate(),
      candidate({ foodType: "pizza" }),
      candidate({ foodType: "ramen" }),
      candidate({ foodType: "sushi" }),
    ];
    let attempts = 0;
    const outcome = buildRestaurantReport(
      cands,
      "area-1",
      "2026-09-27",
      noon,
      [],
      () => {
        attempts += 1;
        return "copy_failed";
      },
    );
    expect(attempts).toBe(restaurantRuleDefaults.maxCopyAttempts);
    expect(outcome.status).toBe("empty");
    if (outcome.status === "empty")
      expect(outcome.reason).toBe("all_copy_attempts_failed");
  });

  it("never pads the report with invented entries", () => {
    const outcome = buildRestaurantReport(
      [candidate()],
      "area-1",
      "2026-09-27",
      noon,
      [],
      () => "grounded",
    );
    expect(outcome.report.length).toBe(1);
  });
});

describe("validateRestaurantCopy", () => {
  const facts = new Set(["f1", "f2"]);
  it("accepts grounded, well-formed bilingual sentence-level copy", () => {
    const r = validateRestaurantCopy(
      copyOutput({
        enSentences: [
          {
            text: "This spot is known for its handmade tortillas.",
            factIds: ["f1"],
          },
          {
            text: "It also serves a weekend barbacoa special.",
            factIds: ["f2"],
          },
        ],
        zhSentences: [
          { text: "以手工玉米餅聞名。", factIds: ["f1"] },
          { text: "週末供應烤肉塔可。", factIds: ["f2"] },
        ],
      }),
      facts,
    );
    expect(r.valid).toBe(true);
  });

  it("rejects a fact ID outside the approved evidence set", () => {
    const r = validateRestaurantCopy(
      copyOutput({
        enSentences: copySentences("Text.").map((s, i) =>
          i === 0 ? { ...s, factIds: ["unknown"] } : s,
        ),
      }),
      facts,
    );
    expect(r.valid).toBe(false);
  });

  it("rejects HTML in a sentence", () => {
    const r = validateRestaurantCopy(
      copyOutput({
        enSentences: [
          { text: "<b>A</b> claim.", factIds: ["f1"] },
          { text: "Another sentence.", factIds: ["f2"] },
        ],
      }),
      facts,
    );
    expect(r.valid).toBe(false);
  });

  it("rejects English copy outside the two-or-three sentence range", () => {
    const r = validateRestaurantCopy(
      copyOutput({
        enSentences: [{ text: "Only one sentence here.", factIds: ["f1"] }],
      }),
      facts,
    );
    expect(r.valid).toBe(false);
  });

  it("rejects Chinese copy outside the two-or-three sentence range", () => {
    const r = validateRestaurantCopy(
      copyOutput({ zhSentences: [{ text: "只有一句。", factIds: ["f1"] }] }),
      facts,
    );
    expect(r.valid).toBe(false);
  });

  it("rejects copy exceeding the combined length cap", () => {
    const long = "x".repeat(300);
    const r = validateRestaurantCopy(
      copyOutput({
        enSentences: [
          { text: long, factIds: ["f1"] },
          { text: long, factIds: ["f2"] },
        ],
      }),
      facts,
    );
    expect(r.valid).toBe(false);
  });
});
