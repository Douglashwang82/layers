import { describe, expect, it } from "vitest";
import {
  CITY_BUILDINGS,
  layerLift,
} from "../../apps/web/src/components/sign-in-city/layout";

describe("decorative city motion", () => {
  it("keeps the city assembled during the entrance and across loop boundaries", () => {
    for (let layer = 0; layer < 3; layer++) {
      for (const time of [0, 1, 2.9, 17.99, 18, 19])
        expect(layerLift(time, layer)).toBe(0);
      expect(layerLift(9, layer)).toBeGreaterThan(1);
    }
  });
  it("bounds the layer travel and repeats without a jump", () => {
    for (let time = 0; time < 36; time += 0.05) {
      const heights = [0, 1, 2].map((layer) => layerLift(time, layer));
      expect(heights.every((height) => height >= 0 && height <= 4.6)).toBe(
        true,
      );
      expect(layerLift(time + 18, 1)).toBeCloseTo(heights[1], 8);
    }
  });
  it("keeps building footprints disjoint even when the layers collapse", () => {
    expect(CITY_BUILDINGS.length).toBeGreaterThanOrEqual(80);
    for (let i = 0; i < CITY_BUILDINGS.length; i++) {
      const a = CITY_BUILDINGS[i];
      expect(Math.abs(a.x) + a.w / 2).toBeLessThan(12.5);
      expect(Math.abs(a.z) + a.d / 2).toBeLessThan(10.5);
      for (const b of CITY_BUILDINGS.slice(i + 1)) {
        expect(
          Math.abs(a.x - b.x) >= (a.w + b.w) / 2 ||
            Math.abs(a.z - b.z) >= (a.d + b.d) / 2,
        ).toBe(true);
      }
    }
  });
});
