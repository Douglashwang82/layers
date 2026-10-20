import { describe, expect, it } from "vitest";
import { markerKind, markerKinds, placeCategories } from "@taiwanhub/shared";

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
