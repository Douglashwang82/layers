# Sign-in pattern stage

The `/sign-in` page places a monochrome 4×4 diamond pattern beside the sign-in
form. Alternating black and white tiles reproduce the reference checkerboard.
The form remains first in reading and tab order. The former mascot components
remain available separately; this page no longer loads their WebGL renderer.

`apps/web/src/components/sign-in-pattern.tsx` renders the decorative grid and
localized pause toggle. `sign-in-pattern.css` controls the motion: each tile
has an exclusive 800 ms slot in a 12.8 second cycle, in a scattered fixed order.
During its slot the diamond turns 90 degrees and shrinks to 72% before returning
to its original silhouette. Eight discrete steps give a frame-by-frame rhythm.
Only one tile changes at a time; backgrounds never flash or invert.

Pause freezes all tiles in place and resume continues from the same position.
Reduced motion removes animation and hides the pause button. At widths up to
800 px the existing responsive layout hides the stage and animation is disabled.
Authentication does not depend on the artwork or its state.

`tests/e2e/sign-in-pet.spec.ts` covers motion, pause/resume, reduced motion,
mobile layout, and continued form interaction.
