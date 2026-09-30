import type { CSSProperties } from "react";
/**
 * Decorative "layers on a map" scene for the sign-in page.
 *
 * Pure CSS 3D (see `.map-stack*` in pages.css): a base street map with three
 * translucent layer sheets floating above it. Each sheet carries its own
 * buildings, extruded in 3D: low-rise shops and homes on the bottom sheet,
 * mid-rise blocks in the middle, downtown towers on top. The footprints
 * interlock across sheets, so every layer alone looks like a sparse city and
 * the loop, which settles the sheets flat onto the map, assembles one
 * complete city before lifting the layers apart again. The brand mark stands
 * on the top sheet as the "here" marker. No client JavaScript: the animation
 * runs entirely in CSS and freezes at the resting, separated state under
 * reduced motion.
 *
 * Coordinates are in a 200 x 140 map; heights are in the same units and
 * scale with the scene through `--map-stack-unit`.
 */
type Building = {
  x: number;
  y: number;
  w: number;
  d: number;
  h: number;
  pin?: true;
};
/** Street blocks between the roads; the park and plaza stay unbuilt. */
const BLOCKS = [
  [8, 8, 38, 32],
  [54, 8, 42, 32],
  [104, 8, 42, 32],
  [8, 48, 38, 36],
  [104, 48, 42, 36],
  [154, 48, 38, 36],
  [8, 92, 38, 28],
  [54, 92, 42, 28],
  [104, 92, 42, 28],
  [154, 92, 38, 28],
] as const;
const LAYERS: {
  tone: "mint" | "sun" | "coral";
  buildings: Building[];
}[] = [
  {
    // Low-rise: shops and homes spread across the neighborhoods.
    tone: "mint",
    buildings: [
      { x: 10, y: 10, w: 16, d: 12, h: 8 },
      { x: 28, y: 10, w: 16, d: 12, h: 10 },
      { x: 10, y: 50, w: 14, d: 14, h: 8, pin: true },
      { x: 10, y: 68, w: 14, d: 14, h: 6 },
      { x: 10, y: 94, w: 16, d: 12, h: 8 },
      { x: 28, y: 108, w: 16, d: 10, h: 6 },
      { x: 56, y: 94, w: 18, d: 12, h: 10 },
      { x: 106, y: 28, w: 12, d: 10, h: 8 },
      { x: 128, y: 108, w: 16, d: 10, h: 8 },
      { x: 156, y: 50, w: 16, d: 14, h: 10, pin: true },
      { x: 176, y: 70, w: 14, d: 12, h: 8 },
      { x: 156, y: 94, w: 14, d: 12, h: 8 },
      { x: 174, y: 106, w: 16, d: 12, h: 6 },
    ],
  },
  {
    // Mid-rise: apartment and office blocks filling the gaps.
    tone: "sun",
    buildings: [
      { x: 10, y: 24, w: 34, d: 14, h: 16 },
      { x: 26, y: 50, w: 18, d: 32, h: 20 },
      { x: 28, y: 94, w: 16, d: 12, h: 18 },
      { x: 56, y: 10, w: 18, d: 28, h: 22 },
      { x: 76, y: 94, w: 18, d: 24, h: 24 },
      { x: 120, y: 28, w: 24, d: 10, h: 16 },
      { x: 106, y: 50, w: 18, d: 14, h: 18, pin: true },
      { x: 106, y: 94, w: 20, d: 12, h: 16, pin: true },
      { x: 174, y: 50, w: 16, d: 18, h: 22 },
      { x: 174, y: 94, w: 16, d: 10, h: 18 },
    ],
  },
  {
    // High-rise: the downtown towers around the plaza.
    tone: "coral",
    buildings: [
      { x: 76, y: 10, w: 18, d: 14, h: 40 },
      { x: 76, y: 26, w: 18, d: 12, h: 30 },
      { x: 106, y: 10, w: 16, d: 16, h: 52 },
      { x: 124, y: 10, w: 20, d: 16, h: 36 },
      { x: 126, y: 50, w: 18, d: 14, h: 56, pin: true },
      { x: 106, y: 66, w: 16, d: 16, h: 44 },
      { x: 126, y: 66, w: 18, d: 16, h: 34 },
      { x: 56, y: 108, w: 18, d: 10, h: 30 },
    ],
  },
];
const GRID = [25, 50, 75, 100, 125, 150, 175]
  .map((x) => `M${x} 0V140`)
  .concat([35, 70, 105].map((y) => `M0 ${y}H200`))
  .join(" ");
function pct(value: number, of: number) {
  return `${(value / of) * 100}%`;
}
function buildingStyle(b: Building) {
  return {
    left: pct(b.x, 200),
    top: pct(b.y, 140),
    width: pct(b.w, 200),
    height: pct(b.d, 140),
    "--map-stack-floors": b.h,
  } as CSSProperties;
}
export function MapLayersAnimation() {
  return (
    <div className="map-stack" aria-hidden="true">
      <div className="map-stack-scene">
        <div className="map-stack-tile map-stack-base">
          <svg
            viewBox="0 0 200 140"
            preserveAspectRatio="none"
            focusable="false"
          >
            <g className="map-stack-block">
              {BLOCKS.map(([x, y, w, d]) => (
                <rect
                  key={`${x}-${y}`}
                  x={x}
                  y={y}
                  width={w}
                  height={d}
                  rx="3"
                />
              ))}
            </g>
            <rect
              x="154"
              y="8"
              width="38"
              height="32"
              rx="3"
              className="map-stack-park"
            />
            <g className="map-stack-tree">
              <circle cx="162" cy="16" r="3" />
              <circle cx="172" cy="24" r="4" />
              <circle cx="184" cy="15" r="3" />
              <circle cx="164" cy="32" r="3.5" />
              <circle cx="184" cy="31" r="3" />
            </g>
            <rect
              x="54"
              y="48"
              width="42"
              height="36"
              rx="3"
              className="map-stack-plaza"
            />
            <circle cx="75" cy="66" r="9" className="map-stack-plaza-ring" />
            <path
              d="M0 132 C 40 124, 70 138, 110 130 S 170 122, 200 130"
              className="map-stack-bayou"
            />
            <path
              d="M100 0 V 124 M 0 44 H 200 M 0 88 H 200"
              className="map-stack-avenue"
            />
          </svg>
        </div>
        {LAYERS.map((layer, index) => (
          <div
            key={layer.tone}
            className="map-stack-tile map-stack-layer"
            data-tone={layer.tone}
          >
            {/* The sheet's fill, edge and tab live in the SVG so the tile itself
                paints nothing: a flat SVG child plus a painted tile sorted
                inconsistently against the other sheets in the 3D scene. */}
            <svg
              className="map-stack-sheet"
              viewBox="0 0 200 140"
              preserveAspectRatio="none"
              focusable="false"
            >
              <rect
                x="0.5"
                y="0.5"
                width="199"
                height="139"
                rx="10"
                className="map-stack-sheet-fill"
              />
              <path d={GRID} className="map-stack-sheet-grid" />
              <path
                d="M14 0.5 h30 v4 a3 3 0 0 1 -3 3 h-24 a3 3 0 0 1 -3 -3z"
                className="map-stack-sheet-tab"
              />
            </svg>
            {layer.buildings.map((b) => (
              <div
                key={`${b.x}-${b.y}`}
                className="map-stack-building"
                style={buildingStyle(b)}
              >
                <span className="map-stack-wall-west" />
                <span className="map-stack-wall-south" />
                <span className="map-stack-roof" />
                {b.pin && <span className="map-stack-pin" />}
              </div>
            ))}
            {index === LAYERS.length - 1 && (
              <span
                className="map-stack-here"
                style={{ left: "37.5%", top: "47.1%" }}
              >
                <span className="map-stack-ring" />
                <span className="brand-mark">台</span>
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
