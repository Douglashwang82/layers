/**
 * Decorative "layers on a map" scene for the sign-in page.
 *
 * Pure CSS 3D (see `.map-stack*` in pages.css): a base map tile with three
 * translucent layer sheets floating above it. Each sheet carries the same
 * street grid as the base plus its own kind of detail, so the sheets read as
 * different layers of one map: places with footprints and a route, events
 * with catchment rings, groups with clusters and links. The loop settles the
 * sheets flat onto the map, so their pins read as one combined view, then
 * lifts them apart again. The brand mark stands on the top sheet as the
 * "here" marker. No client JavaScript: the animation runs entirely in CSS
 * and freezes at the resting, separated state under reduced motion.
 */
const GRID = [20, 40, 60, 80, 100, 120, 140, 160, 180]
  .map((x) => `M${x} 0V140`)
  .concat([20, 40, 60, 80, 100, 120].map((y) => `M0 ${y}H200`))
  .join(" ");
const LAYERS = [
  {
    tone: "mint",
    pins: [
      { x: 22, y: 30 },
      { x: 48, y: 68 },
      { x: 78, y: 40 },
    ],
    // Places: building footprints around each pin and a route between them.
    art: (
      <>
        <g className="map-stack-fill">
          <rect x="30" y="46" width="16" height="10" rx="2" />
          <rect x="50" y="30" width="10" height="8" rx="2" />
          <rect x="84" y="100" width="14" height="9" rx="2" />
          <rect x="102" y="84" width="9" height="12" rx="2" />
          <rect x="140" y="60" width="18" height="8" rx="2" />
          <rect x="160" y="42" width="10" height="10" rx="2" />
          <rect x="26" y="112" width="22" height="10" rx="2" />
          <rect x="150" y="112" width="14" height="10" rx="2" />
        </g>
        <path
          className="map-stack-dash"
          d="M44 42 C 60 70, 80 90, 96 95 S 140 72, 156 56"
        />
        <path className="map-stack-line" d="M112 22 H 176" />
        <path className="map-stack-line" d="M112 28 H 148" />
      </>
    ),
  },
  {
    tone: "sun",
    pins: [
      { x: 34, y: 54 },
      { x: 66, y: 76 },
    ],
    // Events: catchment rings around each pin, an arc route, and a few
    // scattered date markers.
    art: (
      <>
        <g className="map-stack-ring-art">
          <circle cx="68" cy="76" r="22" />
          <circle cx="68" cy="76" r="11" />
          <circle cx="132" cy="106" r="18" />
          <circle cx="132" cy="106" r="8" />
        </g>
        <path className="map-stack-dash" d="M24 118 Q 96 14 180 100" />
        <g className="map-stack-fill">
          <path d="M40 24 l5 5 -5 5 -5 -5z" />
          <path d="M168 62 l5 5 -5 5 -5 -5z" />
          <path d="M104 40 l4 4 -4 4 -4 -4z" />
          <path d="M150 128 l4 4 -4 4 -4 -4z" />
        </g>
        <g className="map-stack-line">
          <path d="M22 96 H 46" />
          <path d="M22 102 H 36" />
        </g>
      </>
    ),
  },
  {
    tone: "coral",
    pins: [
      { x: 18, y: 72 },
      { x: 84, y: 24 },
    ],
    // Groups: dotted clusters of members around each pin, linked to the
    // "here" marker.
    art: (
      <>
        <g className="map-stack-line">
          <path d="M36 101 L 116 67 L 168 34" />
          <path d="M36 101 L 60 124" />
          <path d="M168 34 L 150 20" />
        </g>
        <g className="map-stack-ring-art">
          <circle cx="36" cy="101" r="24" />
          <circle cx="168" cy="34" r="20" />
          <circle cx="116" cy="67" r="14" />
        </g>
        <g className="map-stack-fill">
          <circle cx="24" cy="92" r="2.5" />
          <circle cx="48" cy="90" r="2.5" />
          <circle cx="30" cy="114" r="2.5" />
          <circle cx="52" cy="110" r="2.5" />
          <circle cx="156" cy="26" r="2.5" />
          <circle cx="180" cy="28" r="2.5" />
          <circle cx="176" cy="46" r="2.5" />
          <circle cx="104" cy="60" r="2.5" />
          <circle cx="126" cy="78" r="2.5" />
          <circle cx="60" cy="124" r="2.5" />
          <circle cx="150" cy="20" r="2.5" />
        </g>
      </>
    ),
  },
] as const;
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
            <path d={GRID} className="map-stack-grid" />
            <rect
              x="112"
              y="18"
              width="46"
              height="34"
              rx="5"
              className="map-stack-park"
            />
            <rect
              x="24"
              y="92"
              width="34"
              height="28"
              rx="5"
              className="map-stack-park"
            />
            <path
              d="M 0 96 C 36 78, 58 126, 100 104 S 162 62, 200 80"
              className="map-stack-bayou"
            />
            <rect
              x="40"
              y="28"
              width="120"
              height="84"
              rx="20"
              className="map-stack-road"
            />
            <path d="M 100 0 V 140 M 0 70 H 200" className="map-stack-road" />
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
              {layer.art}
            </svg>
            {layer.pins.map((pin) => (
              <span
                key={`${pin.x}-${pin.y}`}
                className="map-stack-pin"
                style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
              />
            ))}
            {index === LAYERS.length - 1 && (
              <span
                className="map-stack-here"
                style={{ left: "58%", top: "48%" }}
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
