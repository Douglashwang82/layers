import { describe, expect, it } from "vitest";
import {
  CITY_BUILDINGS,
  cityCameraPose,
} from "../../apps/web/src/components/sign-in-city/layout";

describe("decorative city motion", () => {
  it("eases the entrance into a bounded, continuous camera orbit", () => {
    expect(cityCameraPose(0).distance).toBeGreaterThan(
      cityCameraPose(5).distance,
    );
    for (let time = 0; time < 180; time += 0.1) {
      const pose = cityCameraPose(time);
      const next = cityCameraPose(time + 1 / 60);
      expect(pose.distance).toBeGreaterThanOrEqual(43);
      expect(pose.distance).toBeLessThanOrEqual(50);
      expect(pose.elevation).toBeGreaterThan(0.5);
      expect(pose.elevation).toBeLessThan(0.65);
      expect(Math.abs(next.azimuth - pose.azimuth)).toBeLessThan(0.003);
      expect(Math.abs(next.distance - pose.distance)).toBeLessThan(0.06);
    }
  });
  it("keeps district building footprints disjoint and inside the island", () => {
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
