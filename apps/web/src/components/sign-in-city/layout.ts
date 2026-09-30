/** A fictional, deterministic streetscape; never a live map or inventory. */
export const CITY_COLORS = ["#8ccbb5", "#ebc777", "#e89882"] as const;
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
      const h = 0.65 + seed * 1.25 + core * core * 5.8;
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
/** A held assembled city, staggered reveal, held layers, and gentle return. */
export function layerLift(seconds: number, layer: number) {
  const phase = ((seconds % 18) + 18) % 18;
  const delay = layer * 0.38;
  return (
    (smoothStep((phase - 3 - delay) / 3.6) -
      smoothStep((phase - 11.2 - delay) / 3.8)) *
    (1.3 + layer * 1.65)
  );
}
