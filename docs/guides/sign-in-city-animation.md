# Cinematic sign-in city

The sign-in illustration is a fictional architectural city, not live map data.
The dark emerald scene contains 108 district buildings and a separate twisting
landmark, with beveled facades, stepped and cylindrical towers, metallic crowns,
warm/mint window lights, parks, moving traffic, and an elevated transit ribbon.
A perspective camera eases inward before a slow orbit; pointer movement adds a
small amount of parallax. The previous floating brand marker and disassembling
layers are absent.

## Implementation

- `apps/web/src/components/map-layers-animation.tsx` renders the SVG placeholder
  and imports the Three.js scene only when visible on screens wider than 800px.
- `apps/web/src/components/sign-in-city/layout.ts` owns the deterministic district
  footprints and continuous camera path, with layout data shared by the fallback.
- `apps/web/src/components/sign-in-city/world.ts` builds the procedural model,
  lighting, environment reflections, shader-driven transit light, and traffic.
  Repeated geometry is batched with `InstancedMesh`. Glass-like materials use
  clearcoat without expensive screen-space transmission. All assets are local.
- `apps/web/src/components/sign-in-city/scene.ts` owns the renderer, perspective
  camera, resize, animation, bloom/output passes, and GPU lifetime. Environment
  capture happens once. One 1024px shadow map is cached for the static buildings;
  moving traffic and particles do not cast shadows.
- `apps/web/src/app/pages.css` and `responsive.css` own the editorial stage,
  independent light form, and mobile layout. Story copy lives in `dictionary.ts`
  in English and Traditional Chinese.

There are no React state updates in the frame loop and no external model,
texture, map, or geocoder requests. Pixel ratio starts at the device ratio capped
at 1.5. Sustained frame intervals over 24ms progressively lower it to 0.8, then
bypass bloom and the composer if needed. ACES tone mapping and sRGB output remain
in both rendering paths. Animation uses elapsed seconds, so quality changes do
not change its speed.

Reduced-motion users see one still composition. Rendering pauses when the page
is hidden, the illustration leaves the viewport, or focus is inside the form.
Leaving desktop width disposes the canvas; returning recreates a single scene.
Unmount disposes geometry, materials, instance buffers, generated textures,
environment/shadow maps, post-processing targets, renderer, observers, and event
listeners. Chunk/WebGL initialization failure or context loss restores the SVG
illustration while the form remains independent.

## Verification

Run `pnpm exec vitest run tests/unit/sign-in-city.test.ts` for the bounded,
continuous camera path and disjoint district footprints. After checking the
local disposable database configuration as described in `AGENTS.md`, run
`pnpm exec playwright test tests/e2e/sign-in-city.spec.ts` for rendering, form
focus, responsive disposal, reduced-motion preference changes, unavailable
WebGL, and context loss. These tests do not submit credentials or send email.

Use a production build and record at least 20 seconds with the form unfocused.
Verify the WebGL renderer uses hardware acceleration; headless Chromium may
otherwise select SwiftShader. Compare frame intervals, render resolution, and
dropped frames rather than only average FPS.

The cinematic version at a 1440x1000 viewport on NVIDIA RTX 5070 Ti / ANGLE D3D11
recorded 1,201 intervals over 20.0159 seconds: 60.0 FPS average, 16.7ms p95, and
zero intervals above 25ms, with a 1251x788 canvas. This is a local hardware result,
not a guarantee for all devices. Integrated GPU and Safari performance have not
been measured. Mobile currently does not load the scene. Desktop, narrow desktop,
mobile, English, and Traditional Chinese layouts were visually checked.

Keep additional geometry batched and bound environment capture, shadow maps,
transparency, post-processing, and pixel ratio when increasing visual density.
