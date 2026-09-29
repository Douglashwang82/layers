/**
 * Decorative "layers on a map" scene for the sign-in aside.
 *
 * Pure CSS 3D (see `.map-stack*` in pages.css): a base map tile with three
 * translucent layer sheets floating above it, each carrying pins. The loop
 * settles the sheets flat onto the map, so their pins read as one combined
 * view, then lifts them apart again. The brand mark stands on the top sheet
 * as the "here" marker. No client JavaScript: the animation runs entirely
 * in CSS and freezes at the resting, separated state under reduced motion.
 */
const LAYERS = [
  {
    tone: "mint",
    pins: [
      { x: 22, y: 30 },
      { x: 48, y: 68 },
      { x: 78, y: 40 },
    ],
  },
  {
    tone: "sun",
    pins: [
      { x: 34, y: 54 },
      { x: 66, y: 76 },
    ],
  },
  {
    tone: "coral",
    pins: [
      { x: 18, y: 72 },
      { x: 84, y: 24 },
    ],
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
            <defs>
              <pattern
                id="map-stack-grid"
                width="20"
                height="20"
                patternUnits="userSpaceOnUse"
              >
                <path d="M 20 0 L 0 0 0 20" className="map-stack-grid" />
              </pattern>
            </defs>
            <rect width="200" height="140" fill="url(#map-stack-grid)" />
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
