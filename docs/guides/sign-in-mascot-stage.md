# Sign-in cube stage

The `/sign-in` page places white outline Three.js cubes beside the sign-in form.
Only the visible edges are drawn; depth-only faces hide rear edges and stamps. The form remains first in
reading and tab order.

## Entry layout

Sign-in has a dedicated minimal header: a monochrome brand link back home and
the existing English/Traditional Chinese switch. Global desktop/mobile navigation,
city selection, footer and demo banner are omitted on this route. Normal site
chrome returns when navigating away.

Desktop allocates 52% to the brand side and 48% to the form, on a uniform black background, including the header. The brand side contains small decorative rolling cubes, keeping the form as the primary focus. The form is capped at 420 px, is lifted about
48 px on screens at least 820 px tall, and uses white primary buttons, light
text, `#181818` inputs with `#3a3a3a` borders and a single jade focus/hover
accent. Secondary links point to `/join` and `/`. The form uses a short sign-in heading, labeled fields and actions, without introductory or promotional copy. The background remains black beyond the maximum content width. On mobile the
entire entry, including the minimal header, is black and shows only the form. Up to 800 px the artwork is hidden. Artwork size also
responds to viewport height. Short screens can scroll rather than clip form
content. These styles and color tokens are scoped to sign-in.

## Rendering and motion

The animation fills 100% of the decorative section's width and height, with no
square aspect-ratio constraint. An isometric orthographic camera preserves the
cube geometry at every viewport ratio. Exactly three parallel ground-plane lanes
carry two reusable cubes each, moving from upper right to lower left. The lane
spacing and offscreen entry/exit limits adapt to the section bounds on resize.

All cubes have equal side lengths and share one clock: each 90-degree turn takes
1.2 seconds at constant angular speed, with no easing or per-cube speed variation.
Whole-step offsets stagger arrivals while keeping every cube's angular phase and
instantaneous velocity equal. Each lane receives a random initial timing offset;
its cubes keep a fixed safe separation and recycle only outside the viewport.

The ground is Y=0. A cube pivots about its entire leading X edge, keeping both
endpoints on the ground as its center follows a circular arc. At each landing,
the next edge becomes the pivot. The geometrically symmetric cube has the same
visible pose across quarter-turn boundaries. It does not slide or spin in place.

Every face contact leaves a complete, face-sized square outline on the ground.
The five latest prints remain stationary and fade with age. A depth prepass hides
rear cube edges and any stamp lines occluded by the cube; faces have no color fill.
Thin tube geometry keeps outlines legible on the high-resolution canvas.

The drawing buffer's long edge targets 3840 pixels, capped by GPU texture and
renderbuffer limits. The rectangular buffer follows the section's aspect ratio.
Rendering targets 30 fps. Cube edges and stamp geometry are shared and disposed
when the scene is removed.
Focusing a form control or pressing Pause freezes the current positions.
Leaving the form resumes from the held positions unless Pause is active.
Reduced motion renders a still composition. Hidden tabs and offscreen stages stop
scheduling frames. Screens up to 800 px hide the artwork and do not create WebGL;
returning to desktop recreates the scene.

Context loss or renderer failure displays static SVG outline cubes with square
trails. Authentication never depends on rendering. Cleanup releases geometry,
materials, renderer, observers, listeners and the animation frame.

## Files and verification

- `apps/web/src/components/sign-in-pattern.tsx`: lazy scene, static fallback and pause toggle.
- `apps/web/src/components/sign-in-cube-model.ts`: edge-pivot geometry, square stamps, three lanes and shared motion clock.
- `apps/web/src/components/sign-in-cube-scene.ts`: camera, scheduling and lifecycle.
- `apps/web/src/components/sign-in-pattern.css` and `apps/web/src/app/pages.css`: stage and entry layout.
- `tests/unit/sign-in-cube.test.ts`: ground contact, equal motion, fixed lanes, stationary square stamps, reset and buffer limits.
- `tests/e2e/sign-in-pet.spec.ts`: live rendering, pause, reduced motion, full-section sizing, responsive lifecycle, fallbacks and form interaction without submitting authentication.
