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
  type CommittedFeature,
  type RestaurantCandidateInput,
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

  it("excludes the same restaurant within 30 days in both directions", () => {
    const committed: CommittedFeature[] = [
      {
        date: "2026-10-20",
        canonicalId: "canonical-100",
        foodType: "sushi",
        pickId: "p1",
      },
    ];
    const c = candidate({ canonicalId: "canonical-100", foodType: "pizza" });
    const within = qualifyRestaurantCandidate(c, "2026-09-27", noon, committed);
    expect(within.codes).toContain("restaurant_recent");
    const c2 = candidate({ canonicalId: "canonical-100", foodType: "pizza" });
    const outside = qualifyRestaurantCandidate(
      c2,
      "2026-09-19",
      noon,
      committed,
    );
    expect(outside.codes).not.toContain("restaurant_recent");
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
    // Higher base quality score than the winner, but ranked below it in the report is fine
    // as long as the reason is explained, not hidden.
    expect(row.score!).toBeGreaterThan(
      outcome.status === "picked"
        ? outcome.report.find((r) => r.decision === "picked")!.score!
        : 0,
    );
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
  it("accepts grounded, well-formed bilingual copy", () => {
    const r = validateRestaurantCopy(
      {
        en: "This spot is known for its handmade tortillas. It also serves a weekend barbacoa special.",
        zh: "以手工玉米餅聞名。週末供應烤肉塔可。",
        factIds: ["f1", "f2"],
        promptVersion: "v1",
        modelVersion: "test",
      },
      facts,
    );
    expect(r.valid).toBe(true);
  });

  it("rejects a fact ID outside the approved evidence set", () => {
    const r = validateRestaurantCopy(
      {
        en: "A. B.",
        zh: "一。二。",
        factIds: ["unknown"],
        promptVersion: "v1",
        modelVersion: "test",
      },
      facts,
    );
    expect(r.valid).toBe(false);
  });

  it("rejects HTML in either language", () => {
    const r = validateRestaurantCopy(
      {
        en: "<b>A</b>. B.",
        zh: "一。二。",
        factIds: ["f1"],
        promptVersion: "v1",
        modelVersion: "test",
      },
      facts,
    );
    expect(r.valid).toBe(false);
  });

  it("rejects English copy outside the two-or-three sentence range", () => {
    const r = validateRestaurantCopy(
      {
        en: "Only one sentence here.",
        zh: "一。二。",
        factIds: ["f1"],
        promptVersion: "v1",
        modelVersion: "test",
      },
      facts,
    );
    expect(r.valid).toBe(false);
  });
});
