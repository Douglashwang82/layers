# Sign-in city animation

The sign-in illustration is a fictional architectural city, not live map data.
It contains 108 buildings on three independently moving layers, parks, trees,
window grids, rooftop equipment, shop awnings, and twelve cars. The former
floating brand marker is removed. The city has an introductory pull-back and
an 18-second assembled / expanded / assembled cycle with held poses.

## Implementation

- `apps/web/src/components/map-layers-animation.tsx` renders the SVG placeholder
  and imports the Three.js scene only when visible on screens wider than 800px.
- `apps/web/src/components/sign-in-city/layout.ts` owns the deterministic
  footprints and time-based animation envelope, shared with the SVG fallback.
- `apps/web/src/components/sign-in-city/scene.ts` owns WebGL resources, resize,
  pointer parallax, and animation. Repeated geometry uses `InstancedMesh` and
  matte Lambert materials; contact shading is geometry, not shadow-map passes.
- `apps/web/src/app/pages.css` owns the larger stage and form layout. The existing
  mobile rules in `responsive.css` keep the form without the scene.

There are no React state updates in the frame loop and no external model,
texture, map, or geocoder requests. Pixel ratio starts at the device ratio capped
at 1.5. Sustained frame intervals over 24ms progressively lower it to 0.8.
Animation time uses elapsed seconds, so quality changes do not change its speed.

Reduced-motion users see one assembled still. Rendering pauses when the page is
hidden, the illustration leaves the viewport, or focus is inside the form.
Leaving desktop width disposes the canvas; returning recreates a single scene.
Unmount disposes geometries, materials, instance buffers, renderer, observers,
and event listeners. Chunk/WebGL initialization failure or context loss restores
the SVG illustration while the form remains independent.

## Verification

Run `pnpm exec vitest run tests/unit/sign-in-city.test.ts` for loop continuity,
bounded travel, and disjoint building footprints. After checking the disposable
database configuration as described in `AGENTS.md`, run
`pnpm exec playwright test tests/e2e/sign-in-city.spec.ts` for rendering, form
focus, responsive disposal, reduced-motion preference changes, unavailable
WebGL, and context loss. These tests do not submit credentials or send email.

For performance, use a production build and record a full 18-second cycle with
the form unfocused. Verify the WebGL renderer actually uses hardware acceleration;
headless Chromium may otherwise select SwiftShader. Compare frame intervals,
render resolution, and dropped frames rather than relying only on average FPS.

The initial local production measurement at a 1440×1000 viewport on an NVIDIA
RTX 5070 Ti / ANGLE D3D11 recorded 1,081 intervals over 18.016 seconds: 60.0 FPS
average, 16.7ms p95, and zero intervals above 25ms. The canvas rendered at 916×660,
with at most 26 instanced draw submissions per frame. This is a local hardware
result, not a guarantee for all devices; integrated/mobile GPU and Safari
performance have not been measured. Mobile currently does not load the scene.

When increasing visual density, batch additional geometry by material and keep
expensive transparency, shadow maps, post-processing, and pixel ratio bounded.
