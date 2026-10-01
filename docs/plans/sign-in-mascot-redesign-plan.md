# Sign-in redesign with the Warm Pin mascot

Status: proposal, awaiting decisions (see the last section). Nothing below is
implemented yet.

This replaces the [sign-in motion handoff](sign-in-motion-ui-handoff.md) and
its rough [motion studies](../design/sign-in-motion-studies/). The user asked
to remove every implemented part of the 3D sign-in animation and redesign the
page from scratch, with the new mascot as the main character.

## Constraints from the mascot

The mascot source is the supplied V2 board,
[reference-v2.jpg](../../apps/web/public/mascot/reference-v2.jpg), integrated
as described in [Marker Pet V2](../design/marker-pet-v2/README.md). These facts
shape the design:

- It is a **2.5D image-based character**. There is no rigged model, no turn
  between angles, and no blink or eyelid frames. The available views are front,
  3/4 (curious), and happy closed-eye, each about 220 source pixels tall, plus
  the large hero render on the left of the board (about 550 × 620 source px).
- The board must not be redrawn or replaced by generated substitutes. The
  existing `PetArtwork` clips windows from the original photograph; the sign-in
  page should do the same.
- Brand motion rules from the supplied handoff: easing
  `cubic-bezier(.22,1,.36,1)`; hover 240 ms / 2 px; one 650 ms success rise;
  display idle float 3,200 ms at about 1% height; at most ±4° tilt around the
  tip; uniform scaling only (no squash and stretch); no mouth, limbs, or props;
  never a crying, scolding, or startled expression; respect reduced motion.
- Display size guidance: 192–320 CSS px for hero use, without overpowering the
  main call to action. The large board view supports roughly 360 CSS px at a
  1.5 DPR before it softens; the small views top out near 150 CSS px.

## Concept: "Pin yourself in"

The mascot is a map pin. Signing in is the moment you put yourself on the map.
The page is a warm paper stage that matches the board's background, with one
character, one map, and the form.

**Composition (desktop, ≥ 801 px).** Left 58–62%: a soft paper street map
drawn in SVG (no labels, no invented places), the hero mascot standing on it
tip-down, and a dotted route leading from the mascot toward three generic place
glyphs (café cup, bookmark, calendar). Right: the existing form panel. The
headline sits above the map, short and mascot-led (copy is a decision below).

**Entrance (plays once per page load, about 2.4 s).**

| Time       | Action                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------- |
| 0–0.7 s    | Mascot descends onto the map and settles tip-first (translate only, brand easing, no squash) |
| 0.5–1.1 s  | A soft ring spreads under the tip, echoing the map's selected-place halo                     |
| 0.9–2.0 s  | The dotted route draws out; the three place glyphs fade in one after another                 |
| 2.0–2.4 s  | Mascot switches to the happy view for one 650 ms greeting rise, then returns to front        |
| afterwards | Display idle only: 3,200 ms float at about 1% height. Nothing else loops                     |

**Reacting to the form.** This is what makes the character feel present
rather than decorative. Reactions are one-shot pose changes, never loops, and
the text UI still carries every message.

| Form state                    | Mascot                                                         |
| ----------------------------- | -------------------------------------------------------------- |
| Page idle                     | Front view, idle float                                         |
| Any form field focused        | 3/4 curious view, tilted up to 4° toward the form; float stops |
| Code sent / sign-in succeeded | Happy view, one 650 ms rise                                    |
| Validation or server error    | Front view, still (no sad or alarmed face)                     |
| Reduced motion or paused      | Same poses switch instantly; no movement at all                |

The stage reads form state without coupling auth to animation: CSS
`:has(.form-panel :focus-within)` for focus, and a `data-auth-state` attribute
that `AuthForm` sets on its own wrapper (`idle | sent | error`). Submission,
redirects, and validation never wait for or call the mascot.

**Still frame and fallback.** The server-rendered HTML is the final composed
frame (mascot standing, route drawn, glyphs visible). With JavaScript off,
reduced motion, or a slow image, the page is complete and the form is usable
immediately.

**Mobile (≤ 800 px).** Recommended: a 96–120 px front-view mascot above the
form heading, static except for the focus and success poses. The current page
shows no illustration on mobile, so this is a decision below.

**Pause control.** A small labeled DOM button (localized, `aria-pressed`)
stops the idle float for the page session, as in the previous plan.

## Rendering approach

| Option                                    | What it is                                                                                       | Fit                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| **A. 2.5D image + SVG/CSS (recommended)** | Reuse `PetArtwork` clipping, add a `hero` frame from the large board view; CSS/WAAPI transforms  | Faithful to the approved art, no WebGL, no new dependency, works on mobile, smallest bundle |
| B. Commissioned rendered frames or GLB    | 3D designer supplies a turn sequence, blink frames, or a rigged model using the spec's materials | True rotation and blinking; blocked on new art and its license/ownership manifest           |
| C. Procedural Three.js rebuild            | Re-model the character in code                                                                   | Not recommended: it would redraw the mascot, which the V2 integration rules forbid          |

Option A ships now; option B can replace the artwork later inside the same
timeline and state table without redesigning the page. With A, `three` and
`@types/three` have no remaining users and are removed.

## Work plan

### Phase 0 — Remove the existing 3D sign-in implementation

Delete:

- `apps/web/src/components/map-layers-animation.tsx`
- `apps/web/src/components/sign-in-city/` (`layout.ts`, `scene.ts`, `world.ts`)
- `tests/e2e/sign-in-city.spec.ts`, `tests/unit/sign-in-city.test.ts`
- `docs/guides/sign-in-city-animation.md`
- `docs/design/sign-in-motion-studies/`
- `three` and `@types/three` from the root `package.json`, with the lockfile
  updated by `pnpm install`

Edit:

- `apps/web/src/app/sign-in/page.tsx`: remove the scene, story, and caption
  markup; keep `AuthForm` props, `next`, and the Google check unchanged.
- `apps/web/src/app/pages.css` (about lines 491–660) and `responsive.css`
  (about lines 111–130): remove `.auth-stage`, `.auth-scene*`, and
  `.sign-in-city*` rules; keep any `.form-panel` rules other pages share.
- `apps/web/src/lib/dictionary.ts`: remove the five `signInScene*` keys per
  locale (replaced in phase 2).
- `docs/plans/sign-in-motion-ui-handoff.md`: mark superseded by this plan.

Result: a plain, working sign-in page. Check with lint, typecheck, unit tests,
the existing auth E2E flows, and a build. One commit.

### Phase 1 — Hero artwork

- Add a `hero` frame to `PetArtwork` by clipping the large board view, tip
  aligned the same way as the other views. Exclude the decorative sparkle marks
  and the board title.
- Record the frame's source rectangle, display size limit, and anchor in the
  Marker Pet V2 README.
- Unit test: every frame's tip maps to the shared anchor.

### Phase 2 — Static composition

- New `sign-in-stage` component (server-rendered): paper map SVG, route, place
  glyphs, mascot in the final pose, headline.
- New bilingual copy in `dictionary.ts` (headline, supporting line, pause
  labels).
- Layouts checked at 820, 1024, 1440, 1920 px and a 390 px phone, including
  200% zoom.

### Phase 3 — Motion and form reactions

- Entrance timeline as CSS animations with explicit delays; idle float;
  `data-auth-state` set from `AuthForm`; `:focus-within` pose; pause button
  with session memory; live reduced-motion handling.
- Small client island only for the pause button and replay guard. No frame
  loop, no React state per frame.

### Phase 4 — Verification and docs

- Unit: auth-state to pose mapping, frame anchors.
- E2E (replacing the deleted spec): page usable with no JS; email-code and
  password flows unchanged; focus switches to curious; success shows happy;
  error keeps front; reduced motion has no running animations; pause persists
  across a resize; zh-Hant copy; 390 px layout; no canvas on the page.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, the sign-in E2E spec, `pnpm build`.
- New guide `docs/guides/sign-in-mascot-stage.md` describing shipped behavior.

## Decisions needed

1. **Where to implement.** The mascot itself is still uncommitted on `master`
   (`apps/web/src/components/mascot/`, `public/mascot/`, `marker-pet.ts`,
   dictionary and map-canvas edits). The sign-in work builds on it and edits
   the same `dictionary.ts`. Options:
   - commit the mascot work first, then do this on `master` locally;
   - commit the mascot work, then branch (`sign-in-mascot`) and open a PR;
   - use a separate git worktree (the mascot must be committed first, or it
     will not exist there).
2. **Rendering approach**: A (recommended), or wait for B's art.
3. **Mobile**: small static mascot above the form (recommended), or form only
   as today.
4. **Headline copy**: keep "Your city. Your people." / 「你的城市，你的歸屬。」,
   or a mascot-led line such as "Pin yourself in." / 「把自己放上地圖。」.
5. **Old handoff and studies**: delete them (as listed in phase 0) or keep
   them in history only as superseded documents.
