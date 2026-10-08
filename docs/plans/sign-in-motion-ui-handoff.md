# Sign-in motion redesign — UI team handoff

Status: superseded. The sign-in page now uses the Warm Pin mascot; see
[the sign-in mascot stage guide](../guides/sign-in-mascot-stage.md).

## Brief and decision history

Redesign the sign-in illustration to feel modern, animated, distinctive, and
worth looking at while keeping sign-in immediate and easy to use. The user
explicitly requested removal of the floating “台” marker, greater visual scale,
richer detail, and a 60 FPS target, and is open to Three.js.

Both completed approaches were rejected visually: the pastel layered city
(`564d86f`) and the cinematic emerald city (`e2d8f13`). The latter remains the
implementation baseline, **not an approved visual reference**. More buildings,
a darker palette, additional glow, or another orbit around the same model do
not by themselves answer the feedback.

Working design diagnosis: the repeated architecture and distant model view
produce limited visual variety; the motion lacks a clear sequence of events.
This is a design hypothesis, not a further user requirement. Test it in the
prototype review.

The four directions below were proposed, but the user has not chosen one. This
handoff recommends a starting prototype and records the decision still needed.

## Direction selection

| Direction              | Visual idea                                                      | Motion idea                                                        | Main design risk                                                           |
| ---------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Liquid Layers          | Jade, pearl, and chrome ribbons; a few large sculptural forms    | Weave, bend, and briefly align into a map-like composition         | Could look like an abstract technology brand with little community meaning |
| Living Neighborhood    | A small café, bookstore, and market scene with tactile materials | Steam, signage, passing bicycles, and camera travel between scenes | Requires strong asset art direction; may repeat the miniature-city problem |
| Discovery Playground   | Floating map fragments, place cards, and a few miniature objects | Staggered arrivals, connection, assembly, and playful reactions    | Can become cluttered or resemble controls that do not work                 |
| Cinematic City Journey | Distinctive architecture and close-up compositions               | Street detail → pass between buildings → city reveal               | Highest production cost and closest to the rejected direction              |

**Recommended first prototype:** Discovery Playground with Liquid Layers'
material contrast and lighting. Use recognizable discovery objects to express
TaiwanHub's purpose, with sculptural composition and restrained spring motion.
This recommendation is not approval to lock in that direction.

The UI lead should present two short motion studies: this recommendation and
one materially different alternative selected from the table. These are rough
studies, not two complete production implementations. Review the actual motion
before investing in finished assets. The product owner/user selects a direction
or requests a specific revision; lack of feedback does not select a direction.

## Scope and boundaries

In scope: illustration, its desktop composition, asset design, motion,
decorative pointer response, fallback, localized supporting copy, and
performance/accessibility handling. Update the surrounding stage if needed to
support the chosen composition.

Preserve the email-code/password/Google flows, redirects, invitation links,
validation, focus management, and error states. Do not modify auth endpoints,
database behavior, navigation branding, or introduce a new state framework.
Removing the illustration's “台” marker does not remove the site header logo.

Use the current mobile behavior for the first release: the form is visible and
WebGL is not loaded at widths of 800px or less. Any mobile animated illustration
is a separate design decision, not implied by the desktop redesign.

## Recommended prototype specification

### Composition and assets

Build a composition around five to eight focal objects. Supporting shadows and
small accents do not count as focal objects. Start with:

1. One folded map fragment as the anchor.
2. One café miniature with a distinctive silhouette.
3. One editorial event card.
4. One saved-place symbol, without the “台” marker.
5. One sculptural connecting ribbon.
6. At most two small supporting objects chosen by the designer.

Test a warm, light environment and a restrained darker environment during the
rough studies; neither the current dark stage nor current headline is mandatory.
Use scale, silhouette, occlusion, and material contrast to create depth. Include
matte ceramic, brushed metal, and a limited translucent accent. Bloom is an
optional finishing effect, not the source of visual interest.

At 1440px, reserve roughly 60–65% of the stage for the illustration and 35–40%
for the form. At narrow desktop widths, reframe or remove supporting objects
before shrinking everything into a tiny model. Confirm layouts at 820, 1024,
1440, and 1920px, with both short and tall viewports.

Cards use generic localized category copy until content is explicitly chosen.
Do not depict invented live events, recommendations, inventory, attendance, or
other user activity. Any recognizable cultural details should be deliberate
and reviewed, rather than decorative stereotypes.

### Initial 12-second storyboard

These timings are starting values for the recommended direction, to be revised
with the motion study. Establish a useful static composition before animation.

| Time   | Main action                                      | Supporting action                                    |
| ------ | ------------------------------------------------ | ---------------------------------------------------- |
| 0–2s   | Map fragment unfolds into place                  | Ground shadow settles; camera makes a small approach |
| 2–4.5s | Café and card enter at different times           | Brief, damped response from neighboring objects      |
| 4.5–7s | Ribbon connects the objects                      | Saved-place symbol turns toward the composition      |
| 7–9s   | Composition settles into a complete neighborhood | Camera reaches its resting pose                      |
| 9–12s  | Hold the complete composition                    | One quiet ambient action, such as café steam         |

Play the entrance once per scene mount. Afterward use a gentle ambient loop;
do not continuously repeat the entire arrival sequence. The last frame must
join the ambient state without a reset or flash. Treat timing as elapsed seconds,
not frame counts, and reset the frame timestamp on resume to avoid large jumps.

Specify curves explicitly in the handoff: damped spring-like easing for object
arrival, smooth easing for the camera, and small-amplitude ambient motion. Avoid
having every object bob independently. Each shot needs one dominant action.

### Interaction and motion states

| State                         | Required behavior                                                 |
| ----------------------------- | ----------------------------------------------------------------- |
| Loading                       | Show the approved still illustration; form is already usable      |
| Entrance                      | Play the short sequence if motion is allowed and scene is visible |
| Ambient                       | Run the quiet loop; limited cursor parallax on fine pointers only |
| Form focused                  | Freeze decorative motion without moving the form or camera        |
| User paused                   | Keep the current frame until the user resumes                     |
| Reduced motion                | Render the approved still; no camera, spring, or hover animation  |
| Page hidden / scene offscreen | Stop rendering; resume without replaying the entrance             |
| WebGL or asset failure        | Display the approved fallback and retain normal form behavior     |
| Mobile                        | Render the form without downloading the 3D scene or its assets    |

Add a small, keyboard-accessible DOM pause/resume control outside the
`aria-hidden` illustration. Localize its label and expose its state. Remember
the choice for the current page session, including desktop/mobile resizing.
Changing system motion preferences must take effect while the page is open.
Leaving the form must not override a manual pause or reduced-motion preference.

Decorative hover reactions must not reveal essential information or suggest
that nonfunctional cards are buttons. Do not use a hand cursor or add tab stops
to decorative objects. If a card is intended to navigate, separately specify
its real DOM link, destination, keyboard behavior, and mobile equivalent.

## Engineering handoff

Read the root and web `AGENTS.md` files and the relevant installed Next.js docs
before changing the application. Use Node 22 and pinned pnpm 10.15.0.

| Existing location                                  | Reuse / replacement guidance                                                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/src/app/sign-in/page.tsx`                | Preserve auth props and server boundary; integrate the selected composition and copy                                           |
| `apps/web/src/components/auth-form.tsx`            | Preserve behavior; do not couple auth submission to animation state                                                            |
| `apps/web/src/components/map-layers-animation.tsx` | Reuse lazy import, visibility/media-query handling, and failure boundary; replace the city fallback and add manual pause state |
| `apps/web/src/components/sign-in-city/scene.ts`    | Reuse lifecycle concepts; adapt camera/timeline and rendering to the selected design                                           |
| `apps/web/src/components/sign-in-city/world.ts`    | Replace city-specific geometry and effects after direction selection                                                           |
| `apps/web/src/components/sign-in-city/layout.ts`   | Replace city coordinates and camera math with the new deterministic layout/timeline                                            |
| `apps/web/src/app/pages.css`, `responsive.css`     | Keep changes scoped to the sign-in stage and its breakpoints                                                                   |
| `apps/web/src/lib/dictionary.ts`                   | Own English and Traditional Chinese copy, including motion controls                                                            |
| `tests/e2e/sign-in-city.spec.ts`                   | Preserve lifecycle/form/fallback coverage and extend it for assets and manual pause                                            |
| `tests/unit/sign-in-city.test.ts`                  | Replace city-specific assertions with meaningful timeline/state regression tests                                               |

After selection, rename city-specific files/tests to match their responsibility
and update all imports. Keep one production illustration, with no unused engine
or rejected scene bundled alongside it. Prefer the already installed Three.js
unless a simpler CSS/SVG implementation meets the selected design equally well.
Do not add an animation framework just to change visual direction.

Separate the timeline from scene construction. Compose intro, ambient,
interaction, and pause behavior deliberately rather than assigning competing
animations to the same transform. Keep the frame loop outside React state.

For external design assets, supply locally served optimized files and a manifest
with source, license, dimensions, scale/origin, texture sizes, and ownership.
Compressed GLB assets are an option; procedural or SVG assets may be sufficient.
Account for decoder cost if compression adds a runtime dependency. Keep visible
card text in localized DOM/SVG rather than baked into textures.

Cancel or ignore late asset loads after unmount; dispose their GPU resources.
Release geometries, materials, textures, render targets, effects, and observers
on teardown and failure. The fallback must depict the new composition, not the
rejected city. No login action may wait for a model, font, or animation download.

## Proposed performance and accessibility acceptance criteria

These are release targets to agree at direction selection, not measurements of
an unbuilt scene.

- Test a production build at a 60Hz display setting on a named integrated-GPU
  laptop and the available discrete-GPU desktop. Record browser, GPU, viewport,
  DPR, quality tier, and whether hardware acceleration is active.
- Capture the entrance and at least 30 seconds of ambient animation. Target
  at least 58 FPS average, p95 frame interval at or below 20ms, and fewer than
  1% of intervals above 33.3ms. Include a recording while typing in the form.
- Start with review budgets of 60 draw calls, 75k visible triangles, 350KB gzip
  deferred scene code, and 750KB transferred scene assets. Measure actual build
  output; exceeding a budget requires an explicit tradeoff review.
- Cap DPR initially at 1.5. Provide a tested reduced-quality tier that reduces
  pixel work and effects before sacrificing form responsiveness. If acceptable
  motion cannot be sustained, show the still rather than a persistently janky loop.
- Deferred art must not block the form, create layout shifts, or introduce
  scene-related long tasks during typing. Compare form readiness against the
  same page with the illustration disabled under the same throttling conditions.
- Hidden, offscreen, paused, and reduced-motion states must not run a continuous
  render loop. Repeated navigation and breakpoint changes must not accumulate
  canvases, listeners, textures, or render targets.
- Preserve labeled controls, focus visibility, keyboard navigation, and usable
  layouts at 200% zoom. No flashing effects, required pointer gestures, or
  essential information available only in animation.
- Check current Chrome/Edge, Firefox, and Safari with the selected design.
  Record untested devices/browser combinations explicitly.

The rejected cinematic scene previously measured 60 FPS on an RTX 5070 Ti. That
is useful infrastructure evidence, not proof that a replacement meets these
criteria on integrated GPUs or other browsers.

## Delivery sequence and ownership

| Step / owner                     | Work package          | Required output / completion condition                                                                                                         |
| -------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — UI lead                      | Direction exploration | Two rough motion studies, representative still frames, and a comparison of identity, motion, and production cost                               |
| 2 — Product owner + UI lead      | Direction review      | Recorded choice, visual references, rejected traits, and agreed device/performance targets                                                     |
| 3 — UI / motion designer         | Detailed design       | Desktop and narrow-desktop layouts, mobile form layout, timed storyboard, materials, curves, hover response, pause control, and still fallback |
| 4 — Frontend engineer            | Graybox prototype     | New composition in the real sign-in page, placeholder assets, lifecycle states, and early integrated-GPU measurements                          |
| 5 — Designer + frontend engineer | Visual production     | Finished assets, lighting, localized copy, transitions, fallback, quality tiers, and a reviewable browser preview                              |
| 6 — QA + frontend engineer       | Verification          | Automated checks, browser/device matrix, screenshots, motion recording, asset/bundle report, and performance traces                            |
| 7 — UI lead + product owner      | Final visual review   | Evaluate the actual animation at normal speed in the real page; record acceptance or specific revisions                                        |

Steps 3–7 depend on the direction review. During that review, engineering can
audit existing lifecycle behavior, establish baseline metrics, and inventory
assets without committing to a particular visual direction. A successful
performance test does not substitute for visual acceptance.

## Checks and completion package

From the repository root, run `pnpm lint`, `pnpm typecheck`, affected Vitest
tests, relevant Playwright tests, and `pnpm build`. Existing focused commands are
`pnpm exec vitest run tests/unit/sign-in-city.test.ts` and
`pnpm exec playwright test tests/e2e/sign-in-city.spec.ts`; update paths if renamed.

Before browser tests, verify the effective `DATABASE_URL` is the intended
disposable local/test database without printing credentials. Do not run seeds,
live ingestion, model extraction, or send real sign-in messages to validate art.
Keep preview ports/build output separate from an existing development or
production server; do not overwrite local environment files.

Extend browser coverage to manual pause/resume, preference precedence, delayed
or failed asset loading, offscreen/background suspension, and repeated teardown.
The current draw-counter test watches instanced draws only: adapt it if the new
scene uses ordinary meshes or another renderer, so it cannot silently pass with
zero observed drawing.

Deliver the selected design files, asset manifest, source changes, matched static
fallback, English/Traditional Chinese screenshots, motion recording, QA results,
and measured performance report. Update the
[implementation guide](../guides/sign-in-city-animation.md) to describe the
shipped behavior. Preserve unrelated changes; commit the scoped implementation
after verification. Deployment and pushing remain separate authorized actions.

## First action for the receiving team

Assign the UI lead and frontend owner, then make the two rough motion studies.
Review whether each feels modern and alive, has a recognizable TaiwanHub idea,
contains a clear focal point, and leaves sign-in effortless. Select the visual
direction before producing another finished city or final asset set.
