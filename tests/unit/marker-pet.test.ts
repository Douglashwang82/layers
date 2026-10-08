import { describe, expect, it } from "vitest";
import { selectedPetTarget } from "@/lib/marker-pet";

const items = [
  { key: "place:one", longitude: -95.4, latitude: 29.7 },
  { key: "content:no-location", longitude: null, latitude: null },
];
const extras = [{ key: "search:one", lng: -95.3, lat: 29.8 }];

describe("selected map companion", () => {
  it("uses the selected catalog coordinates, including when a map cluster hides the pin", () => {
    expect(selectedPetTarget(items, extras, "place:one", null)).toEqual({
      key: "place:one",
      lng: -95.4,
      lat: 29.7,
    });
  });
  it("prioritizes the current external selection and does not fall back to stale catalog selection", () => {
    expect(selectedPetTarget(items, extras, "place:one", "search:one")).toEqual(
      extras[0],
    );
    expect(
      selectedPetTarget(items, extras, "place:one", "search:removed"),
    ).toBeNull();
  });
  it("removes the companion for cleared, inaccessible, filtered or unlocated items", () => {
    expect(selectedPetTarget(items, extras, null, null)).toBeNull();
    expect(selectedPetTarget([], extras, "place:one", null)).toBeNull();
    expect(
      selectedPetTarget(items, extras, "content:no-location", null),
    ).toBeNull();
  });
  it.each([
    [NaN, 20],
    [30, Infinity],
    [181, 20],
    [30, -91],
  ])("rejects invalid coordinates %s, %s", (lng, lat) => {
    expect(
      selectedPetTarget([], [{ key: "bad", lng, lat }], null, "bad"),
    ).toBeNull();
  });
  it("accepts zero coordinates without treating them as missing", () => {
    expect(
      selectedPetTarget([], [{ key: "zero", lng: 0, lat: 0 }], null, "zero"),
    ).toEqual({ key: "zero", lng: 0, lat: 0 });
  });
});
