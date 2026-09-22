import { describe, it, expect } from "vitest";
import {
  resolveDateWindow,
  overlapsWindow,
  zonedMidnight,
  localDate,
  unionItems,
  parseMapQuery,
  serializeMapQuery,
  itemHref,
  parseItemKey,
  withinBounds,
  layerInput,
  dateFilter,
} from "../../packages/shared/src";
const tz = "America/Chicago";
describe("date windows at city-local boundaries", () => {
  it("resolves Today from local midnight to the next local midnight", () => {
    // 2026-09-21 20:30 Houston = 2026-09-22 01:30Z; the local day is still the 21st.
    const now = new Date("2026-09-22T01:30:00Z");
    const w = resolveDateWindow("today", tz, now);
    expect(localDate(now, tz)).toBe("2026-09-21");
    expect(w.start.toISOString()).toBe("2026-09-21T05:00:00.000Z");
    expect(w.end!.toISOString()).toBe("2026-09-22T05:00:00.000Z");
  });
  it("is DST-safe: the spring-forward day is 23 hours and fall-back is 25", () => {
    const spring = zonedMidnight("2026-03-08", tz);
    const afterSpring = zonedMidnight("2026-03-09", tz);
    expect((afterSpring.getTime() - spring.getTime()) / 3600000).toBe(23);
    const fall = zonedMidnight("2026-11-01", tz);
    const afterFall = zonedMidnight("2026-11-02", tz);
    expect((afterFall.getTime() - fall.getTime()) / 3600000).toBe(25);
    expect(zonedMidnight("2026-01-15", tz).toISOString()).toBe(
      "2026-01-15T06:00:00.000Z",
    );
  });
  it("This weekend is Saturday 00:00 to Monday 00:00 and stays on the ongoing weekend", () => {
    const wednesday = new Date("2026-09-23T15:00:00Z");
    const w = resolveDateWindow("weekend", tz, wednesday);
    expect(localDate(w.start, tz)).toBe("2026-09-26");
    expect(localDate(w.end!, tz)).toBe("2026-09-28");
    const sunday = new Date("2026-09-27T15:00:00Z");
    const ongoing = resolveDateWindow("weekend", tz, sunday);
    expect(localDate(ongoing.start, tz)).toBe("2026-09-26");
    const saturdayNight = new Date("2026-09-27T03:00:00Z"); // Sat 22:00 local
    expect(
      localDate(resolveDateWindow("weekend", tz, saturdayNight).start, tz),
    ).toBe("2026-09-26");
  });
  it("uses half-open overlap for events and inclusive calendar ranges", () => {
    const w = resolveDateWindow("2026-09-26..2026-09-27", tz);
    expect(w.end!.toISOString()).toBe("2026-09-28T05:00:00.000Z");
    // Ends exactly at the window start: excluded. Starts exactly at window end: excluded.
    expect(
      overlapsWindow("2026-09-26T03:00:00Z", "2026-09-26T05:00:00Z", w),
    ).toBe(false);
    expect(
      overlapsWindow("2026-09-28T05:00:00Z", "2026-09-28T07:00:00Z", w),
    ).toBe(false);
    expect(
      overlapsWindow("2026-09-26T04:00:00Z", "2026-09-26T06:00:00Z", w),
    ).toBe(true);
    const upcoming = resolveDateWindow(
      "upcoming",
      tz,
      new Date("2026-09-21T12:00:00Z"),
    );
    expect(
      overlapsWindow("2026-09-21T10:00:00Z", "2026-09-21T13:00:00Z", upcoming),
    ).toBe(true);
    expect(
      overlapsWindow("2026-09-21T10:00:00Z", "2026-09-21T11:00:00Z", upcoming),
    ).toBe(false);
  });
  it("rejects malformed or oversized date filters", () => {
    expect(dateFilter.safeParse("2026-13-40").success).toBe(true); // shape only; resolver clamps
    expect(dateFilter.safeParse("2026-09-30..2026-09-01").success).toBe(false);
    expect(dateFilter.safeParse("2026-01-01..2026-03-01").success).toBe(false);
    expect(dateFilter.safeParse("tomorrow").success).toBe(false);
  });
});
describe("union and identity", () => {
  it("renders an item in three layers once, with all memberships", () => {
    const a = { key: "place:1", layers: ["today"] };
    const b = { key: "place:1", layers: ["food"] };
    const c = { key: "place:1", layers: ["mine"] };
    const d = { key: "event:1", layers: ["today"] };
    const merged = unionItems([[a, d], [b], [c]]);
    expect(merged).toHaveLength(2);
    expect(merged[0].layers).toEqual(["today", "food", "mine"]);
    expect(a.layers).toEqual(["today"]); // inputs are not mutated
  });
  it("keeps distinct items at the same venue distinct", () => {
    const merged = unionItems([
      [
        { key: "place:1", layers: ["x"] },
        { key: "event:1", layers: ["x"] },
        { key: "event:2", layers: ["x"] },
      ],
    ]);
    expect(merged).toHaveLength(3);
  });
  it("resolves typed destinations and keys", () => {
    expect(itemHref("place", "a")).toBe("/places/a");
    expect(itemHref("event", "b")).toBe("/events/b");
    expect(itemHref("content", "c")).toBe("/content/c");
    expect(parseItemKey("event:00000000-0000-4000-8000-000000006001")).toEqual({
      type: "event",
      id: "00000000-0000-4000-8000-000000006001",
    });
    expect(parseItemKey("product:x")).toBeNull();
  });
  it("checks bounds inclusively", () => {
    expect(withinBounds(29.7, -95.4, [-95.5, 29.6, -95.3, 29.8])).toBe(true);
    expect(withinBounds(29.9, -95.4, [-95.5, 29.6, -95.3, 29.8])).toBe(false);
  });
});
describe("map URL state", () => {
  it("parses supported values, caps arrays and drops invalid fields individually", () => {
    const state = parseMapQuery({
      city: "houston",
      layers:
        "discover-houston,today-houston,discover-houston,BAD SLUG,a,b,c,d",
      date: "2026-09-26",
      types: "restaurant,event,place",
      item: "event:00000000-0000-4000-8000-000000006001",
      area: "-95.6,29.6,-95.3,29.9",
      view: "list",
    });
    expect(state.layers).toEqual([
      "discover-houston",
      "today-houston",
      "a",
      "b",
      "c",
    ]);
    expect(state.types).toEqual(["place", "event"]);
    expect(state.area).toEqual([-95.6, 29.6, -95.3, 29.9]);
    expect(state.view).toBe("list");
    const partial = parseMapQuery({ city: "houston", date: "nope", q: "tea" });
    expect(partial.date).toBe("upcoming");
    expect(partial.q).toBe("tea");
    expect(parseMapQuery({ layers: "none" }).layers).toBe("none");
    expect(parseMapQuery({ layers: "" }).layers).toBeUndefined();
  });
  it("serializes only non-default supported values and round-trips", () => {
    expect(serializeMapQuery({})).toBe("");
    const qs = serializeMapQuery({
      layers: ["discover-houston"],
      date: "today",
      types: ["place"],
      item: "place:00000000-0000-4000-8000-000000005000",
      area: [-95.61234567, 29.6, -95.3, 29.9],
      q: "tea",
      view: "list",
    });
    expect(qs).toContain("layers=discover-houston");
    expect(qs).toContain("types=place");
    expect(qs).toContain("area=-95.61235");
    expect(qs).not.toContain("scope=");
    const back = parseMapQuery(
      Object.fromEntries(new URLSearchParams(qs.slice(1))),
    );
    expect(back.layers).toEqual(["discover-houston"]);
    expect(back.date).toBe("today");
    expect(back.q).toBe("tea");
    expect(serializeMapQuery({ layers: "none" })).toBe("?layers=none");
    expect(serializeMapQuery({ types: ["place", "event", "content"] })).toBe(
      "",
    );
  });
});
describe("layer input", () => {
  it("requires only a title and validates schedules", () => {
    expect(
      layerInput.safeParse({ title: "Weekend with friends", city: "houston" })
        .success,
    ).toBe(true);
    expect(
      layerInput.safeParse({
        title: "Day out",
        city: "houston",
        schedule: "day",
      }).success,
    ).toBe(false);
    expect(
      layerInput.safeParse({
        title: "Trip",
        city: "houston",
        schedule: "range",
        startsOn: "2026-09-27",
        endsOn: "2026-09-26",
      }).success,
    ).toBe(false);
    expect(
      layerInput.safeParse({ title: "x", city: "houston", audience: "group" })
        .success,
    ).toBe(false);
  });
});
