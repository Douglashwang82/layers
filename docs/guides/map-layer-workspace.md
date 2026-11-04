# Managing layers in the map

When `FEATURE_MAP_HOME` is enabled, layer browsing, details, creation, settings,
and content management use the map's existing floating panel (bottom sheet on
phones). The map instance survives panel navigation. The standalone pages remain
available when the map-home flag is disabled.

The panel is one shell (`components/map/map-sidebar.tsx`): a fixed header with the
way back, title and panel controls, then a single scrolling area. `resolvePanelView`
in `lib/map-panel.ts` picks the screen, in priority order: trip screen, layer
screen, route planner, place details, then results or Layers. Screens supply only their content,
and Google places load through `useExternalReferences` whichever screen is open.

The Layers control lists applied layers and visibility checkboxes. Layer names
open details without changing visibility. Find layers opens the library, including
Discover, Following, Mine, and Groups. Layer settings and Add items are separate
panel views. Custom places use the main map's center for pin placement; address,
current-location, and list-only options remain available.

Panel URLs use `layerPanel=library|detail|new|settings|contents`, `layer=<slug>`,
`layerTab`, and `layerQ`. Library search does not overwrite map search. Existing
`/layers`, `/layers/new`, `/layers/[slug]`, and `/layers/[slug]/edit` links redirect
into the workspace. Refresh and browser history restore the requested panel.
Create links preserve group, city, blank-layer, and add-item context.

Apply adds a layer to the existing visible set, respecting the existing limit.
Fit layer moves the camera to available coordinates without replacing that set.
Edits refresh map results, external references, and library data. Deleting a layer
removes it from the current map and returns to Mine. Unavailable or private links
retain the neutral access message. Server authorization, publication review,
revision checking, and feature flags are unchanged.

Dirty settings, place forms, link imports, and event drafts warn before leaving
through links or closing the panel. Browser unloading is guarded as well; browser
Back/Forward cancellation uses the Navigation API where supported.

## Trips in the map

With `FEATURE_TRIPS` on, the trip scheduler lives in this panel; there is no
`/trips` route. The URL names the screen: `tripPanel=list` (the member's private
and group trips), `tripPanel=new&tripLayer=<id>` or `tripFolder=<id>` (the
new-trip flow with that source), `trip=<id>` (one trip) and `tripDay=<dayId>`
(the focused day; absent means all days). Reload, Back/Forward and shared links
restore the screen; `page.tsx` resolves it on the server (`features/trips/screen.ts`)
and a guest sees a sign-in prompt that returns to the same URL. With the flag off the
params are ignored and no trip UI renders.

**Plan a trip** on layer details and the folder panel, and the **Trips** button in
the map header, open these screens (a trip screen replaces any layer screen in the
URL; opening a layer or folder screen drops the trip params). An open trip draws on
the main map (`trip` source in `map-canvas.tsx`): day-coloured numbered stops and
straight day paths, labelled as visiting order, not roads. Choosing a day focuses it;
a pin selects its row in the panel and a row reveals its pin. While a trip is drawn,
layer pins, Google places, selection and the route line step aside (their state is
kept and they return when the trip is left); the route bar is hidden and the fit
button frames the trip. Picking a place from search leaves the trip. Without a map
token the whole trip is the list in the panel. Changes save as they are made and the
panel announces saving, saved and failed (with Try again); a stale revision reloads
the latest trip.

## Verification

- `pnpm exec vitest run tests/unit/layer-workspace.test.ts tests/unit/layers.test.ts tests/unit/map-panel.test.ts tests/unit/trip-panel.test.ts`
- `pnpm exec playwright test tests/e2e/layer-workspace.spec.ts tests/e2e/map.spec.ts tests/e2e/groups.spec.ts tests/e2e/custom-places.spec.ts`

Playwright sets `E2E_ISOLATED_BUILD=true`, using `apps/web/.next/e2e` so it does
not contend with a developer server's `.next/dev` lock. Choose a free `E2E_PORT`.
This separates compilation only: verify the intended disposable database before
running tests. Next.js may regenerate `next-env.d.ts` with test-build type paths;
do not commit those generated path changes.
