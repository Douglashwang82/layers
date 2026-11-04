import { describe, expect, it } from "vitest";
import {
  readTripPanel,
  signInHref,
  tripPanelHref,
  withTripDay,
  withoutTripPanel,
} from "@/lib/trip-panel";
import {
  dayColor,
  dayColors,
  endpointLabel,
  tripGeoJSON,
  tripPoints,
} from "@/lib/trip-map";

const q = (s: string) => new URLSearchParams(s);

describe("trip panel URL state", () => {
  it("reads the trip screens and ignores anything else", () => {
    expect(readTripPanel(q(""))).toBeNull();
    expect(readTripPanel(q("tripPanel=other"))).toBeNull();
    expect(readTripPanel(q("tripPanel=list"))).toEqual({ panel: "list" });
    expect(readTripPanel(q("tripPanel=new&tripLayer=L1"))).toEqual({
      panel: "new",
      layer: "L1",
      folder: undefined,
    });
    expect(readTripPanel(q("trip=T1"))).toEqual({
      panel: "detail",
      id: "T1",
      day: "all",
    });
    expect(readTripPanel(q("trip=T1&tripDay=D2"))).toMatchObject({ day: "D2" });
  });

  it("opens a trip screen over the map state, replacing any trip screen", () => {
    expect(
      tripPanelHref("?layers=a&city=houston&trip=T0&tripDay=D1", {
        panel: "new",
        layer: "L1",
      }),
    ).toBe("/?layers=a&city=houston&tripPanel=new&tripLayer=L1");
    expect(
      tripPanelHref("?tripPanel=list", { panel: "detail", id: "T1" }),
    ).toBe("/?trip=T1");
    expect(tripPanelHref("", { panel: "detail", id: "T1", day: "D1" })).toBe(
      "/?trip=T1&tripDay=D1",
    );
  });

  it("leaves the trip and returns to the map state", () => {
    expect(withoutTripPanel("?layers=a&trip=T1&tripDay=D1&item=x")).toBe(
      "/?layers=a&item=x",
    );
    expect(withoutTripPanel("?tripPanel=list")).toBe("/");
  });

  it("focuses a day in place and sends guests back to the same state", () => {
    expect(withTripDay("?trip=T1", "D2")).toBe("/?trip=T1&tripDay=D2");
    expect(withTripDay("?trip=T1&tripDay=D2", "all")).toBe("/?trip=T1");
    expect(signInHref("?tripPanel=new&tripLayer=L1")).toBe(
      `/sign-in?next=${encodeURIComponent("/?tripPanel=new&tripLayer=L1")}`,
    );
  });
});

describe("trip map data", () => {
  const stop = (id: string, lat: number | null) => ({
    id,
    location: lat === null ? null : { lat, lng: -95 },
  });
  const days = [
    { id: "d1", stops: [stop("a", 29.1), stop("b", null), stop("c", 29.2)] },
    { id: "d2", stops: [stop("e", 29.3)] },
  ];

  it("draws numbered located stops and one straight line per day", () => {
    const data = tripGeoJSON(days, "d1", "c");
    const lines = data.features.filter((f) => f.geometry.type === "LineString");
    const pins = data.features.filter((f) => f.geometry.type === "Point");
    expect(lines).toHaveLength(1);
    expect(
      pins.map((p) => "label" in p.properties && p.properties.label),
    ).toEqual(["1", "2"]);
    expect(
      pins.map((p) => "selected" in p.properties && p.properties.selected),
    ).toEqual([0, 1]);
  });

  it("labels stops with day and number when every day is shown", () => {
    const pins = tripGeoJSON(days, "all", null).features.filter(
      (f) => f.geometry.type === "Point",
    );
    expect(
      pins.map((p) => "label" in p.properties && p.properties.label),
    ).toEqual(["1·1", "1·2", "2·1"]);
    // A one-stop day has a pin but no line.
    expect(
      tripGeoJSON(days, "d2", null).features.some(
        (f) => f.geometry.type === "LineString",
      ),
    ).toBe(false);
  });

  describe("with a base", () => {
    const base = { itemId: "hotel", location: { lat: 30, lng: -95 } };
    const away = { itemId: "cafe", location: { lat: 31, lng: -95 } };
    const planned = [
      { id: "d1", start: base, end: base, stops: [stop("a", 29.1)] },
      { id: "d2", start: base, end: away, stops: [stop("e", 29.3)] },
      { id: "d3", start: base, end: base, stops: [] },
    ];
    const houses = (data: ReturnType<typeof tripGeoJSON>) =>
      data.features.filter(
        (f) => "label" in f.properties && f.properties.label === endpointLabel,
      );

    it("runs the line from the start through the stops to the end", () => {
      const line = tripGeoJSON(planned, "d2", null).features.find(
        (f) => f.geometry.type === "LineString",
      );
      expect(line?.geometry.coordinates).toEqual([
        [-95, 30],
        [-95, 29.3],
        [-95, 31],
      ]);
    });

    it("draws a shared base once, as a house that selects no stop", () => {
      const pins = houses(tripGeoJSON(planned, "all", null));
      expect(pins).toHaveLength(2);
      for (const pin of pins)
        expect("stopId" in pin.properties && pin.properties.stopId).toBe("");
    });

    it("gives a one-stop day a line, and ignores the base on a free day", () => {
      expect(
        tripGeoJSON(planned, "d1", null).features.some(
          (f) => f.geometry.type === "LineString",
        ),
      ).toBe(true);
      expect(tripGeoJSON(planned, "d3", null).features).toEqual([]);
      expect(tripPoints(planned, "d3")).toEqual([]);
    });

    it("frames the base with the stops", () => {
      expect(tripPoints(planned, "d1")).toEqual([
        { lat: 29.1, lng: -95 },
        base.location,
        base.location,
      ]);
    });
  });

  it("frames only the focused day's located stops and reuses colors after seven days", () => {
    expect(tripPoints(days, "d1")).toHaveLength(2);
    expect(tripPoints(days, "all")).toHaveLength(3);
    expect(dayColor(dayColors.length)).toBe(dayColors[0]);
  });
});
