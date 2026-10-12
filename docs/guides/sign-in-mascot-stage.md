# Sign-in cube stage

The `/sign-in` page places plain white Three.js cubes beside the sign-in form.
Subtle neutral face shading gives each cube depth. The form remains first in
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

Five reusable cubes tumble diagonally from the upper right toward the lower left.
Their initial positions are staggered across different lanes. Each crossing takes
13–18 seconds; once a cube exits, it waits a random 0.6–4.2 seconds and receives a
new lane, size and duration. Independent timing varies the order on later passes.

Each cube leaves five short curved white strokes at past rolling positions.
Older strokes fade out. The curves use narrow tube geometry so their width
remains visible when the high-resolution canvas is scaled to its display size.
There are no patterned faces, ghost cubes or smoky trails.

An orthographic camera faces the scene along the Z axis. Travel is in screen X/Y;
the tumble axis is perpendicular to travel. The drawing buffer's long edge targets
3840 pixels, capped by GPU texture and renderbuffer limits. Rendering targets 30 fps.
The cubes share geometry and face materials; trail geometry is also shared.

Focusing a form control or pressing Pause freezes the current positions.
Leaving the form resumes from the held positions unless Pause is active.
Reduced motion renders a still composition. Hidden tabs and offscreen stages stop
scheduling frames. Screens up to 800 px hide the artwork and do not create WebGL;
returning to desktop recreates the scene.

Context loss or renderer failure displays static SVG white cubes with curved
trails. Authentication never depends on rendering. Cleanup releases geometry,
materials, renderer, observers, listeners and the animation frame.

## Files and verification

- `apps/web/src/components/sign-in-pattern.tsx`: lazy scene, static fallback and pause toggle.
- `apps/web/src/components/sign-in-cube-model.ts`: cubes, curved traces, randomized recycling and motion state.
- `apps/web/src/components/sign-in-cube-scene.ts`: camera, scheduling and lifecycle.
- `apps/web/src/components/sign-in-pattern.css` and `apps/web/src/app/pages.css`: stage and entry layout.
- `tests/unit/sign-in-cube.test.ts`: direction, focus freeze/resume, staggered cubes, trail fading, recycling and buffer limits.
- `tests/e2e/sign-in-pet.spec.ts`: live rendering, pause, reduced motion, responsive lifecycle, fallbacks and form interaction without submitting authentication.
