import { describe, expect, it } from "vitest";
import {
  googleMarkerKind,
  googleMarkerKinds,
  markerKind,
  markerKinds,
  placeCategories,
} from "@taiwanhub/shared";

describe("marker kinds", () => {
  it("maps every place category deterministically", () => {
    const kinds = Object.fromEntries(
      placeCategories.map((category) => [
        category,
        markerKind({ type: "place", category }),
      ]),
    );
    expect(kinds.Restaurant).toBe("food");
    expect(kinds.Cafe).toBe("food");
    expect(kinds["Bubble Tea"]).toBe("food");
    expect(kinds.Grocery).toBe("retail");
    expect(kinds.Shop).toBe("retail");
    expect(kinds.Park).toBe("park");
    expect(kinds.Museum).toBe("culture");
    expect(kinds["Community Center"]).toBe("community");
    expect(kinds.Service).toBe("community");
    expect(kinds.Other).toBe("info");
    for (const kind of Object.values(kinds))
      expect(markerKinds).toContain(kind);
  });

  it("puts events and content first and falls back for unknowns", () => {
    expect(markerKind({ type: "event", category: "Restaurant" })).toBe("event");
    expect(markerKind({ type: "content", category: "Park" })).toBe("info");
    expect(markerKind({ type: "place", category: "Mystery" })).toBe("info");
    expect(markerKind({ type: "place", category: null })).toBe("info");
    expect(markerKind({ type: "place" })).toBe("info");
  });
});
describe("Google place marker kinds", () => {
  it("uses at most five kinds, all with colors", () => {
    expect(googleMarkerKinds.length).toBeLessThanOrEqual(5);
    for (const kind of googleMarkerKinds) expect(markerKinds).toContain(kind);
  });
  it.each([
    [["japanese_izakaya_restaurant", "restaurant", "food"], "food"],
    [["cafe", "store"], "food"],
    [["clothing_store", "store"], "retail"],
    [["grocery_store", "food", "store"], "retail"],
    [["shopping_mall"], "retail"],
    [["park", "tourist_attraction"], "park"],
    [["museum", "tourist_attraction"], "culture"],
    [["place_of_worship"], "culture"],
    [["lodging", "hotel"], "info"],
    [[], "info"],
    [null, "info"],
  ])("%j is %s", (types, kind) => {
    expect(googleMarkerKind(types)).toBe(kind);
  });
});
