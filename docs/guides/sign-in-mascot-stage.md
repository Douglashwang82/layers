# Sign-in mascot stage

The `/sign-in` page shows the Warm Pin mascot in the pose of the large hero
render on the left of [reference-v2.jpg](../../apps/web/public/mascot/reference-v2.jpg),
standing on a warm paper stage beside the sign-in form. It replaced the 3D city
animation.

## Pieces

| File                                             | Role                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------- |
| `apps/web/src/app/sign-in/page.tsx`              | Server page: story text, `SignInPet` stage, `AuthForm` panel          |
| `apps/web/src/components/mascot/sign-in-pet.tsx` | Client stage: pose state, form observation, desktop-only WebGL        |
| `apps/web/src/components/mascot/sign-in-pet.css` | Size, entrance, V2 "noticing" strokes, contact shadow                 |
| `apps/web/src/components/mascot/pet-scene.ts`    | Shared Three.js pet; the `hero` pose is the 3/4 turn with part squish |
| `apps/web/src/app/pages.css`, `responsive.css`   | `.auth-stage` paper palette and layout; mobile hides the stage        |

## Behavior

| Moment                         | Pet                                                         |
| ------------------------------ | ----------------------------------------------------------- |
| Page load                      | Drops in (700 ms), strokes pop, one happy greeting at 0.9 s |
| Idle                           | `hero` pose with liquid motion, which stops after 10 s      |
| A form field has focus         | `curious`: squishes and turns toward the form               |
| Code sent (`.success-message`) | `happy` for 1.2 s, strokes pop again                        |
| Error shown (`.error-message`) | `front`, still                                              |
| Reduced motion                 | Poses switch instantly; no CSS or liquid motion             |

The stage only observes the form panel (focus events and a `MutationObserver`
for feedback messages). Auth never calls or waits for it, so a failed chunk,
WebGL error or context loss leaves sign-in unaffected; without WebGL the stage
shows the clipped V2 board artwork.

On screens up to 800 px the stage is hidden and WebGL is never loaded; the page
is the form only.

## Checks

`tests/e2e/sign-in-pet.spec.ts` covers the pose reactions (with the code request
stubbed), mobile without WebGL, reduced motion, and the WebGL-failure fallback.
