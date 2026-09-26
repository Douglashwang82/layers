import { describe, it, expect } from "vitest";
import {
  dailyPickIneligibility,
  dailyPickReason,
  dailyPickScheduleInput,
  isCalendarDate,
  localDate,
  renderDailyPickReasons,
  selectDailyPick,
  summarizeDescription,
  systemRule,
  type DailyPickCandidate,
  type DailyPickHistoryEntry,
  type DailyPickReason,
} from "../../packages/shared/src";
import { parseDailyPickArgs } from "../../packages/database/src/daily-pick-args";
import { pickDateLabel, pickText } from "../../apps/web/src/lib/daily-pick";
const cityId = "00000000-0000-4000-8000-00000000c001";
const longText =
  "A neighborhood tea shop serving Taiwanese teas. Its published menu includes oolong and seasonal selections.";
let n = 0;
function place(
  overrides: Partial<DailyPickCandidate> = {},
): DailyPickCandidate {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    status: "approved",
    isDemo: false,
    cityId,
    category: "Bubble Tea",
    neighborhood: "Bellaire",
    description: longText,
    descriptionChinese: "",
    address: "1 Example St",
    latitude: 29.7,
    longitude: -95.5,
    source: "Community submission",
    website: null,
    provenanceUrl: null,
    hours: null,
    verificationStatus: "UNVERIFIED",
    positive: 0,
    responses: 0,
    ...overrides,
  };
}
const history = (
  entries: [date: string, p: DailyPickCandidate][],
): DailyPickHistoryEntry[] =>
  entries.map(([date, p]) => ({
    date,
    placeId: p.id,
    category: p.category,
    neighborhood: p.neighborhood,
  }));
function pick(
  candidates: DailyPickCandidate[],
  date = "2026-09-26",
  past: DailyPickHistoryEntry[] = [],
) {
  return selectDailyPick({ cityId, date, candidates, history: past });
}
const codes = (reasons: DailyPickReason[]) => reasons.map((r) => r.code);
describe("Daily Pick eligibility", () => {
  it("excludes hidden, demo, other-city and insufficiently documented places", () => {
    const cases: [Partial<DailyPickCandidate>, string][] = [
      [{ status: "hidden" }, "not_public"],
      [{ status: "rejected" }, "not_public"],
      [{ status: "deleted" }, "not_public"],
      [{ isDemo: true }, "demo"],
      [{ cityId: "00000000-0000-4000-8000-00000000c002" }, "other_city"],
      [{ description: "Tea." }, "no_description"],
      [{ source: "  " }, "no_source"],
      [{ latitude: null }, "no_location"],
      [{ latitude: 0, longitude: 0 }, "no_location"],
      [{ address: "" }, "no_location"],
    ];
    for (const [overrides, reason] of cases)
      expect(dailyPickIneligibility(place(overrides), cityId)).toBe(reason);
    expect(dailyPickIneligibility(place(), cityId)).toBeNull();
  });
  it("publishes an honest empty result when nothing qualifies", () => {
    const result = pick([place({ isDemo: true }), place({ status: "hidden" })]);
    expect(result.placeId).toBeNull();
    expect(result).toMatchObject({ reason: "no_eligible_places" });
  });
});
describe("Daily Pick selection", () => {
  it("is deterministic for a city and date, independent of input order", () => {
    const places = Array.from({ length: 8 }, () => place());
    const a = pick(places);
    const b = pick([...places].reverse());
    expect(a.placeId).not.toBeNull();
    expect(b.placeId).toBe(a.placeId);
    expect(pick(places).placeId).toBe(a.placeId);
    // Different dates rotate among equally qualified places.
    const days = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"];
    const chosen = new Set(
      days.map((d) => pick(places, `2026-10-${d}`).placeId),
    );
    expect(chosen.size).toBeGreaterThan(1);
  });
  it("avoids repeating a place within 30 days", () => {
    const a = place(),
      b = place();
    const result = pick([a, b], "2026-09-26", history([["2026-09-16", a]]));
    expect(result.placeId).toBe(b.id);
    if (result.placeId === null) throw new Error("expected a pick");
    const repeat = result.reasons.find(
      (r) => r.code === "not_recently_featured",
    );
    expect(repeat).toMatchObject({ windowDays: 30, lastFeaturedOn: null });
  });
  it("shortens the repeat window explicitly for a small catalog, never below 7 days", () => {
    const a = place(),
      b = place();
    const recent = history([
      ["2026-09-16", a],
      ["2026-09-06", b],
    ]);
    const result = pick([a, b], "2026-09-26", recent);
    expect(result.placeId).toBe(b.id);
    if (result.placeId === null) throw new Error("expected a pick");
    expect(result.evidence.repeatWindowDays).toBe(14);
    expect(result.reasons).toContainEqual({
      code: "not_recently_featured",
      windowDays: 14,
      lastFeaturedOn: "2026-09-06",
    });
    expect(renderDailyPickReasons(result.reasons, "en")).not.toMatch(/30 days/);
    const tooRecent = history([
      ["2026-09-21", a],
      ["2026-09-24", b],
    ]);
    const empty = pick([a, b], "2026-09-26", tooRecent);
    expect(empty).toMatchObject({
      placeId: null,
      reason: "all_recently_featured",
    });
  });
  it("counts scheduled future picks toward the repeat gap", () => {
    const a = place(),
      b = place();
    const result = pick([a, b], "2026-09-26", history([["2026-09-30", a]]));
    expect(result.placeId).toBe(b.id);
  });
  it("prefers a category missing from the last seven picks and says so", () => {
    const tea = place({
      category: "Bubble Tea",
      hours: "Daily 11-9",
      website: "https://tea.example",
    });
    const bakery = place({ category: "Bakery", neighborhood: "Chinatown" });
    const past = history(
      Array.from({ length: 7 }, (_, i) => [
        `2026-09-${String(10 + i).padStart(2, "0")}`,
        place({ category: "Bubble Tea" }),
      ]),
    );
    const result = pick([tea, bakery], "2026-09-26", past);
    expect(result.placeId).toBe(bakery.id);
    if (result.placeId === null) throw new Error("expected a pick");
    expect(result.reasons[0]).toEqual({
      code: "category_rotation",
      category: "Bakery",
      recentPicks: 7,
    });
    expect(renderDailyPickReasons(result.reasons, "en")).toContain(
      "none of the last 7 picks were in this category",
    );
    expect(renderDailyPickReasons(result.reasons, "zh-TW")).toContain("麵包店");
  });
  it("does not claim a category rotation when every category appeared recently", () => {
    const tea = place({ category: "Bubble Tea" });
    const bakery = place({ category: "Bakery" });
    const past = history([
      ["2026-09-24", place({ category: "Bubble Tea" })],
      ["2026-09-23", place({ category: "Bubble Tea" })],
      ["2026-09-22", place({ category: "Bakery" })],
    ]);
    const result = pick([tea, bakery], "2026-09-26", past);
    expect(result.placeId).toBe(bakery.id);
    if (result.placeId === null) throw new Error("expected a pick");
    expect(codes(result.reasons)).not.toContain("category_rotation");
  });
  it("uses community recommendations with honest counts, and keeps new places eligible", () => {
    const loved = place({ positive: 8, responses: 10 });
    const unrated = place();
    const result = pick([loved, unrated]);
    expect(result.placeId).toBe(loved.id);
    if (result.placeId === null) throw new Error("expected a pick");
    expect(result.reasons).toContainEqual({
      code: "community_recommendations",
      positive: 8,
      responses: 10,
    });
    expect(renderDailyPickReasons(result.reasons, "en")).toContain(
      "8 of 10 community responses recommend it.",
    );
    // Too few responses or a negative majority earn nothing; the new place can still win.
    const few = place({ positive: 2, responses: 2 });
    const disliked = place({ positive: 1, responses: 9 });
    const fresh = place({ hours: "Daily 8-5" });
    const second = pick([few, disliked, fresh]);
    expect(second.placeId).toBe(fresh.id);
    if (second.placeId === null) throw new Error("expected a pick");
    expect(codes(second.reasons)).not.toContain("community_recommendations");
    expect(codes(second.reasons)).toContain("well_documented");
  });
  it("labels a deterministic tie-break as rotation, never popularity", () => {
    const result = pick([place(), place(), place()]);
    if (result.placeId === null) throw new Error("expected a pick");
    expect(result.reasons.at(-1)).toEqual({
      code: "rotation_tie_break",
      tied: 3,
    });
    expect(codes(result.reasons)).not.toContain("community_recommendations");
    expect(codes(result.reasons)).not.toContain("well_documented");
    const text = renderDailyPickReasons(result.reasons, "en");
    expect(text).toContain("fixed daily rotation, not by popularity");
    expect(text).not.toMatch(/hidden gem|locals love|perfect weather/i);
    for (const reason of result.reasons)
      expect(dailyPickReason.safeParse(reason).success).toBe(true);
  });
});
describe("Daily Pick copy", () => {
  it("summarizes the approved description in at most two sentences", () => {
    expect(
      summarizeDescription(
        "First sentence here. Second one! Third should go. Fourth too.",
      ),
    ).toBe("First sentence here. Second one!");
    expect(summarizeDescription("台灣茶飲店。提供烏龍茶。還有季節限定。")).toBe(
      "台灣茶飲店。提供烏龍茶。",
    );
    const long = summarizeDescription("word ".repeat(200), 50);
    expect(long.length).toBeLessThanOrEqual(50);
    expect(long.endsWith("…")).toBe(true);
    expect(summarizeDescription("No terminal punctuation")).toBe(
      "No terminal punctuation",
    );
  });
  it("renders editorial reasons bilingually with fallbacks", () => {
    const editorial: DailyPickReason[] = [
      { code: "editorial", note: "", noteChinese: "" },
    ];
    expect(renderDailyPickReasons(editorial, "en")).toBe(
      "Chosen by the TaiwanHub editors.",
    );
    expect(renderDailyPickReasons(editorial, "zh-TW")).toBe(
      "由 TaiwanHub 編輯挑選。",
    );
    const noted: DailyPickReason[] = [
      { code: "editorial", note: "Moon Festival week.", noteChinese: "" },
    ];
    expect(renderDailyPickReasons(noted, "zh-TW")).toBe("Moon Festival week.");
  });
  it("validates moderator scheduling input", () => {
    const base = {
      city: "houston",
      date: "2026-09-27",
      placeId: "00000000-0000-4000-8000-000000005000",
      reason: "Festival week",
    };
    expect(dailyPickScheduleInput.parse(base).expectedPickId).toBeNull();
    expect(
      dailyPickScheduleInput.safeParse({ ...base, note: "<b>hi</b>" }).success,
    ).toBe(false);
    expect(
      dailyPickScheduleInput.safeParse({ ...base, date: "tomorrow" }).success,
    ).toBe(false);
    expect(
      dailyPickScheduleInput.safeParse({ ...base, reason: "" }).success,
    ).toBe(false);
  });
  it("is an allowlisted system rule", () => {
    expect(systemRule.parse({ version: 1, kind: "daily_pick" }).kind).toBe(
      "daily_pick",
    );
  });
});
describe("Daily Pick dates", () => {
  it("uses each city's local day, so another city can already be on the next day", () => {
    const instant = new Date("2026-09-26T20:00:00Z");
    expect(localDate(instant, "America/Chicago")).toBe("2026-09-26");
    expect(localDate(instant, "Asia/Taipei")).toBe("2026-09-27");
  });
  it("changes date at local midnight across daylight-saving transitions", () => {
    const tz = "America/Chicago";
    // Spring forward (2026-03-08): midnight CST is 06:00Z; the next midnight is CDT 05:00Z.
    expect(localDate(new Date("2026-03-08T05:59:00Z"), tz)).toBe("2026-03-07");
    expect(localDate(new Date("2026-03-08T06:00:00Z"), tz)).toBe("2026-03-08");
    expect(localDate(new Date("2026-03-09T04:59:00Z"), tz)).toBe("2026-03-08");
    expect(localDate(new Date("2026-03-09T05:00:00Z"), tz)).toBe("2026-03-09");
    // Fall back (2026-11-01): the day is 25 hours long.
    expect(localDate(new Date("2026-11-01T05:00:00Z"), tz)).toBe("2026-11-01");
    expect(localDate(new Date("2026-11-02T05:59:00Z"), tz)).toBe("2026-11-01");
    expect(localDate(new Date("2026-11-02T06:00:00Z"), tz)).toBe("2026-11-02");
  });
  it("formats pick dates from fixed tables, identical on server and client", () => {
    // Intl's zh-TW output differs between Node and browsers ("9月26日 週六" vs "9月26日週六").
    expect(pickDateLabel("2026-09-26", "en")).toBe("Sat, September 26");
    expect(pickDateLabel("2026-09-26", "zh-TW")).toBe("9月26日（週六）");
    expect(pickDateLabel("2028-02-29", "en")).toBe("Tue, February 29");
    expect(pickDateLabel("2026-11-01", "zh-TW")).toBe("11月1日（週日）");
    const pick = {
      description: "English.",
      descriptionChinese: "",
      reasonText: "Reason.",
      reasonTextChinese: "原因。",
    };
    expect(pickText(pick, "zh-TW")).toEqual({
      description: "English.",
      reason: "原因。",
    });
  });
  it("accepts only real calendar dates at scheduling and CLI boundaries", () => {
    for (const valid of ["2026-09-26", "2028-02-29", "2026-12-31"])
      expect(isCalendarDate(valid)).toBe(true);
    for (const invalid of [
      "2026-02-30",
      "2027-02-29",
      "2026-13-01",
      "2026-00-10",
      "2026-04-31",
      "2026-9-26",
      "tomorrow",
      "",
    ])
      expect(isCalendarDate(invalid)).toBe(false);
    const base = {
      city: "houston",
      placeId: "00000000-0000-4000-8000-000000005000",
      reason: "Test",
    };
    expect(
      dailyPickScheduleInput.safeParse({ ...base, date: "2026-02-30" }).success,
    ).toBe(false);
    expect(
      dailyPickScheduleInput.safeParse({ ...base, date: "2028-02-29" }).success,
    ).toBe(true);
    expect(parseDailyPickArgs(["houston", "--date", "2028-02-29"])).toEqual({
      citySlug: "houston",
      date: "2028-02-29",
    });
    expect(parseDailyPickArgs(["--date", "2026-10-01"])).toEqual({
      citySlug: undefined,
      date: "2026-10-01",
    });
    expect(parseDailyPickArgs([])).toEqual({
      citySlug: undefined,
      date: undefined,
    });
    expect(() => parseDailyPickArgs(["--date", "2027-02-29"])).toThrow();
    expect(() => parseDailyPickArgs(["--date"])).toThrow();
    expect(() => parseDailyPickArgs(["Houston!"])).toThrow();
    expect(() => parseDailyPickArgs(["houston", "--days", "3"])).toThrow();
  });
});
