/** A fictional, deterministic streetscape; never a live map or inventory. */
export const CITY_COLORS = ["#397b72", "#87988d", "#ab7965"] as const;
export const PARK_BLOCKS = new Set([0, 17, 25]);
export type CityBuilding = {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  layer: number;
};
export const CITY_BUILDINGS: CityBuilding[] = Array.from(
  { length: 30 },
  (_, block) => {
    if (PARK_BLOCKS.has(block)) return [];
    const col = block % 6,
      row = Math.floor(block / 6);
    return Array.from({ length: 4 }, (_, slot) => {
      const seed = ((block * 37 + slot * 17) % 23) / 23;
      const core = Math.max(
        0,
        1 - Math.hypot((col - 2.7) / 3.4, (row - 1.8) / 2.8),
      );
      const h = 0.8 + seed * 2.4 + core * core * 12.5;
      return {
        x: col * 4 - 10 + (slot % 2 ? 0.86 : -0.86),
        z: row * 4 - 8 + (slot < 2 ? -0.86 : 0.86),
        w: 1.12 + seed * 0.28,
        d: 1.15 + (1 - seed) * 0.25,
        h,
        layer: h < 1.7 ? 0 : h < 2.8 ? 1 : 2,
      };
    });
  },
).flat();
export function smoothStep(value: number) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}
/** A finite entrance blends into a slow orbit, without a loop reset. */
export function cityCameraPose(seconds: number) {
  const entrance = 1 - smoothStep(seconds / 4.5);
  return {
    azimuth: 0.78 + Math.sin(seconds * 0.075) * 0.14 + entrance * 0.12,
    elevation: 0.55 + entrance * 0.07,
    distance: 43 + entrance * 7,
  };
}
