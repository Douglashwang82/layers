# Sign-in mascot stage

The `/sign-in` page is split two thirds / one third. The left is a lit stage
with the Warm Pin mascot in the pose of the large hero render on the left of
[reference-v2.jpg](../../apps/web/public/mascot/reference-v2.jpg); it has no
text. The right is a clean sign-in section with no background or card. It
replaced the 3D city animation.

## Light and finish

All colour and light live on the stage, lit like V2's hero: the key light
enters at the upper left (a bright pool and a soft beam in the CSS
background), the far side falls into warm shadow, and the pet casts a tight
contact shadow plus a long soft shadow to the lower right. The 3D pet uses the
matching `stage` lighting in `pet-scene.ts`: a high upper-left key and a round
softbox, so its highlight and eye catchlights sit at the upper left too.

The stage pet uses a glossier finish than the matte map marker (`stageShape`
in `sign-in-pet.tsx`: full clear coat, crisp highlight, warm inner glow) and a
small, calm idle flow. The face plate and eyes move as one rigid piece, so the
flow never changes the face's shape.

## Pieces

| File                                             | Role                                                                   |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| `apps/web/src/app/sign-in/page.tsx`              | Server page: `SignInPet` stage and `AuthForm` section                  |
| `apps/web/src/components/mascot/sign-in-pet.tsx` | Client stage: pose state, form observation, finish, desktop-only WebGL |
| `apps/web/src/components/mascot/sign-in-pet.css` | Size, entrance, V2 "noticing" strokes, directional shadow              |
| `apps/web/src/components/mascot/pet-scene.ts`    | Shared Three.js pet; `hero` pose and `stage` lighting preset           |
| `apps/web/src/app/pages.css`, `responsive.css`   | 2fr/1fr layout and lit stage background; mobile hides the stage        |

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
