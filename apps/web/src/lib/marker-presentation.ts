import { markerKind, type MarkerKind } from "@taiwanhub/shared";
import type { Copy } from "./dictionary";
import type { AtlasTheme } from "./map-appearance";

export { markerKind, type MarkerKind };

/** Muted, distinguishable hues for pins; the basemap itself stays grayscale. */
export const markerColors: Record<MarkerKind, string> = {
  food: "#A66B4F",
  retail: "#5C7893",
  park: "#617D59",
  culture: "#867098",
  community: "#4F837D",
  event: "#B15F73",
  info: "#81796E",
};

/** Neon hues for the dark basemap; each keeps >= 4.5:1 with its dark glyph. */
export const markerColorsDark: Record<MarkerKind, string> = {
  food: "#FF8A4C",
  retail: "#4CC9FF",
  park: "#7CFF6B",
  culture: "#C77DFF",
  community: "#2DFFD0",
  event: "#FF5C9E",
  info: "#FFE94D",
};

export const markerPalettes: Record<AtlasTheme, Record<MarkerKind, string>> = {
  light: markerColors,
  dark: markerColorsDark,
};

/** Pin construction per theme. Dark pins glow: the under-ring takes the pin's own color. */
export const markerChrome = {
  light: {
    edge: "#111111",
    edgeOpacity: 0.55,
    edgeBlur: 0,
    edgeGrow: 2,
    stroke: "#ffffff",
    glyph: "#ffffff",
    outline: "#111111",
  },
  dark: {
    edge: null,
    edgeOpacity: 0.4,
    edgeBlur: 0.9,
    edgeGrow: 6,
    stroke: "#15161a",
    glyph: "#15161a",
    outline: "#f2f2f2",
  },
} as const;

/** CSS custom properties (`--marker-food`, ...) so swatches follow the map theme. */
export function markerCssVars(theme: AtlasTheme) {
  return Object.fromEntries(
    Object.entries(markerPalettes[theme]).map(([kind, color]) => [
      `--marker-${kind}`,
      color,
    ]),
  );
}

export const markerLabelKey = {
  food: "markerFood",
  retail: "markerRetail",
  park: "markerPark",
  culture: "markerCulture",
  community: "markerCommunity",
  event: "markerEvent",
  info: "markerInfo",
} as const satisfies Record<MarkerKind, keyof Copy>;

export const markerLabel = (kind: MarkerKind, t: Copy) =>
  t[markerLabelKey[kind]];

/** Mapbox `match` expression: a feature's `kind` property to its color. */
export const markerColorExpressionFor = (theme: AtlasTheme) =>
  [
    "match",
    ["get", "kind"],
    ...Object.entries(markerPalettes[theme]).flat(),
    markerPalettes[theme].info,
  ] as unknown as import("mapbox-gl").ExpressionSpecification;

const SIZE = 32;
/** Glyphs contrast with the dot (white on light pins, dark on dark-mode tints); drawn once with Canvas 2D, no external assets. */
const glyphs: Record<MarkerKind, (c: CanvasRenderingContext2D) => void> = {
  food(c) {
    c.beginPath();
    c.moveTo(11, 6);
    c.lineTo(11, 13);
    c.moveTo(8, 6);
    c.lineTo(8, 13);
    c.moveTo(14, 6);
    c.lineTo(14, 13);
    c.moveTo(11, 13);
    c.lineTo(11, 26);
    c.moveTo(22, 26);
    c.lineTo(22, 6);
    c.quadraticCurveTo(18, 11, 20, 17);
    c.lineTo(22, 17);
    c.stroke();
  },
  retail(c) {
    c.beginPath();
    c.rect(8, 11, 16, 14);
    c.moveTo(12, 11);
    c.quadraticCurveTo(12, 5, 16, 5);
    c.quadraticCurveTo(20, 5, 20, 11);
    c.stroke();
  },
  park(c) {
    c.beginPath();
    c.moveTo(8, 24);
    c.quadraticCurveTo(8, 8, 24, 7);
    c.quadraticCurveTo(25, 22, 10, 24);
    c.moveTo(8, 24);
    c.lineTo(17, 15);
    c.stroke();
  },
  culture(c) {
    c.beginPath();
    c.rect(7, 8, 18, 15);
    c.moveTo(7, 20);
    c.lineTo(13, 14);
    c.lineTo(18, 19);
    c.lineTo(21, 16);
    c.lineTo(25, 20);
    c.stroke();
  },
  community(c) {
    c.beginPath();
    c.arc(16, 11, 4, 0, Math.PI * 2);
    c.moveTo(7, 26);
    c.quadraticCurveTo(7, 17, 16, 17);
    c.quadraticCurveTo(25, 17, 25, 26);
    c.stroke();
  },
  event(c) {
    c.beginPath();
    c.rect(7, 9, 18, 16);
    c.moveTo(7, 15);
    c.lineTo(25, 15);
    c.moveTo(12, 6);
    c.lineTo(12, 11);
    c.moveTo(20, 6);
    c.lineTo(20, 11);
    c.stroke();
  },
  info(c) {
    c.beginPath();
    c.rect(9, 6, 14, 20);
    c.moveTo(12, 12);
    c.lineTo(20, 12);
    c.moveTo(12, 17);
    c.lineTo(20, 17);
    c.stroke();
  },
};

export const markerImageId = (kind: MarkerKind) => `marker-${kind}`;

/** Rasterize one glyph; returns null where Canvas 2D is unavailable (icons are optional). */
export function markerGlyphImage(
  kind: MarkerKind,
  theme: AtlasTheme = "light",
): ImageData | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const c = canvas.getContext("2d");
  if (!c) return null;
  c.strokeStyle = markerChrome[theme].glyph;
  c.lineWidth = 2.4;
  c.lineCap = "round";
  c.lineJoin = "round";
  glyphs[kind](c);
  return c.getImageData(0, 0, SIZE, SIZE);
}
