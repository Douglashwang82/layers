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
input fields. The black region extends through the header and to the viewport's
right edge, aligned with the grid even beyond its maximum width. On mobile the
entire entry, including the minimal header, is black. At 801–1099 px the
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
The cube is 85% of its previous size and floats directly on the page, without
a surrounding card. Four actual horizontal slices share continuous face UVs:
their outside surfaces reconstruct the original pattern exactly when assembled.
The newly exposed cut surfaces retain the black-and-white diamond pattern.
A separate top tile descends into a real pocket with interior walls and a floor.

Each eight-second loop uses quintic easing with zero endpoint velocity:

| Time      | Action                                                                              |
| --------- | ----------------------------------------------------------------------------------- |
| 0–1.1 s   | Complete cube, still                                                                |
| 1.1–2.5 s | One top tile sinks 0.2 units, then holds                                            |
| 2.5–3.6 s | Tile returns; slices separate vertically and one slides sideways with a slight turn |
| 3.6–4.4 s | Expanded pose holds                                                                 |
| 4.4–5.9 s | Layers return to their exact original transforms                                    |
| 5.9–8 s   | Complete cube rests before repeating                                                |

Two soft analytic contact shadows sit beneath the object. Their offset, size and
opacity follow the moving layer, establishing its height without an opaque floor
or background rectangle. The orthographic camera remains stationary.

Focusing any control inside the form interrupts the loop: the current pose
smoothly returns to the assembled state in 600 ms and then stops rendering.
Moving between form controls keeps it quiet. Leaving the form restarts at the
beginning after completing any return already in progress.

Pause freezes the current state; focusing the form still returns it to rest.
Reduced motion immediately assembles and renders a still cube, and the
loop stops when the tab or stage is hidden. On screens up to 800 px the existing
layout hides the stage and the WebGL scene is not created. Returning to desktop
recreates it. Context loss or renderer failure displays a static SVG patterned
cube; authentication never depends on the renderer. Cleanup disposes geometry,
materials, renderer, observers, listeners, and the animation frame.

## Files

- `apps/web/src/components/sign-in-pattern.tsx`: lazy-loaded scene, SVG fallback, pause toggle.
- `apps/web/src/components/sign-in-pattern.css`: stage size and pause control.
- `apps/web/src/components/sign-in-cube-model.ts`: slice geometry, pocket, face shaders, shadows, timeline and focus-return state.
- `apps/web/src/components/sign-in-cube-scene.ts`: orthographic camera, 30 fps scheduling, lifecycle.
- `apps/web/src/app/sign-in/page.tsx`: server page and authentication form.

Implementation uses the installed Three.js 0.183.2 APIs; references:
[ShaderMaterial](https://threejs.org/docs/pages/ShaderMaterial.html) and
[WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html).

## Verification

`tests/unit/sign-in-cube.test.ts` checks the eight-second timeline, exact reassembly,
UV continuity, recess depth, shadow motion, interrupted focus return and GPU-limited
resolution. `tests/e2e/sign-in-pet.spec.ts` checks live
rendering, pause/resume, reduced motion, responsive teardown/recreation, WebGL
failure, context loss, the full cycle and quiet form interaction without submitting
authentication.

A local Chromium D3D11 measurement on an NVIDIA RTX 5070 Ti rendered the
3840×3840 layered stage at approximately 30 fps over eight seconds. This is a local
observation, not a guarantee across devices; the implementation does not silently reduce
resolution to reach the frame-rate target.
