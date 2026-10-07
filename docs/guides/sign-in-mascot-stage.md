# Sign-in cube stage

The `/sign-in` page places a monochrome Three.js cube beside the sign-in form.
An orthographic camera at (6, 6, 6) keeps the reference's equal-angle view:
visible top, left and right faces, with vertical edges remaining vertical.
All six faces carry the same alternating 4×4 black-and-white diamond pattern.
The form remains first in reading and tab order.

## Entry layout

Sign-in has a dedicated minimal header: a monochrome brand link back home and
the existing English/Traditional Chinese switch. Global desktop/mobile navigation,
city selection, footer and demo banner are omitted on this route. Normal site
chrome returns when navigating away.

Desktop allocates 60% to the artwork and 40% to the form, with a thin vertical
split between the light artwork and black sign-in section. The
form is capped at 400 px and uses white primary buttons, light text and dark
input fields. On mobile the form area remains black beneath the minimal header. At 801–1099 px the
columns become equal; up to 800 px only the form is shown. Artwork size also
responds to viewport height. Short screens can scroll rather than clip form
content. These styles and color tokens are scoped to sign-in.

## Rendering and motion

The pattern is reconstructed analytically from the supplied geometric reference,
not enlarged from its low-resolution raster. The fragment shader uses derivative
antialiasing for the pattern edges; the renderer also enables MSAA. Subtle neutral
paper tones distinguish the faces while keeping the ink near black.

The drawing buffer's long edge targets 3840 pixels, capped by the GPU's texture
and renderbuffer limits. The square stage therefore renders at 3840×3840, rather
than exporting a 3840×2160 video. This is a live canvas, not a video asset.

The animation loop targets 30 rendered frames per second using elapsed time.
One tile on one visible face rotates 90 degrees and contracts by up to 22%,
then returns to the same diamond silhouette. A 900 ms quintic transition and
300 ms hold make a 1.2 second slot. A scattered deterministic order visits all
48 visible tiles before repeating. The cube and camera remain stationary.

Pause freezes the current state. Reduced motion renders a still cube, and the
loop stops when the tab or stage is hidden. On screens up to 800 px the existing
layout hides the stage and the WebGL scene is not created. Returning to desktop
recreates it. Context loss or renderer failure displays a static SVG patterned
cube; authentication never depends on the renderer. Cleanup disposes geometry,
materials, renderer, observers, listeners, and the animation frame.

## Files

- `apps/web/src/components/sign-in-pattern.tsx`: lazy-loaded scene, SVG fallback, pause toggle.
- `apps/web/src/components/sign-in-pattern.css`: stage size and pause control.
- `apps/web/src/components/sign-in-cube-model.ts`: six face shaders, tile sequencing, buffer sizing.
- `apps/web/src/components/sign-in-cube-scene.ts`: orthographic camera, 30 fps scheduling, lifecycle.
- `apps/web/src/app/sign-in/page.tsx`: server page and authentication form.

Implementation uses the installed Three.js 0.183.2 APIs; references:
[ShaderMaterial](https://threejs.org/docs/pages/ShaderMaterial.html) and
[WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html).

## Verification

`tests/unit/sign-in-cube.test.ts` checks tile coverage, isolated face animation,
settling and GPU-limited resolution. `tests/e2e/sign-in-pet.spec.ts` checks live
rendering, pause/resume, reduced motion, responsive teardown/recreation, WebGL
failure, context loss and form interaction without submitting authentication.

A local Chromium D3D11 measurement on an NVIDIA RTX 5070 Ti rendered the
3840×3840 stage at approximately 30.2 fps over four seconds. Chromium SwiftShader
software rendering measured approximately 13 fps. These are local observations,
not a guarantee across devices; the implementation does not silently reduce
resolution to reach the frame-rate target.
