# Managing layers in the map

When `FEATURE_MAP_HOME` is enabled, layer browsing, details, creation, settings,
and content management use the map's existing floating panel (bottom sheet on
phones). The map instance survives panel navigation. The standalone pages remain
available when the map-home flag is disabled.

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

## Verification

- `pnpm exec vitest run tests/unit/layer-workspace.test.ts tests/unit/layers.test.ts tests/unit/map-panel.test.ts`
- `pnpm exec playwright test tests/e2e/layer-workspace.spec.ts tests/e2e/map.spec.ts tests/e2e/groups.spec.ts tests/e2e/custom-places.spec.ts`

Playwright sets `E2E_ISOLATED_BUILD=true`, using `apps/web/.next/e2e` so it does
not contend with a developer server's `.next/dev` lock. Choose a free `E2E_PORT`.
This separates compilation only: verify the intended disposable database before
running tests. Next.js may regenerate `next-env.d.ts` with test-build type paths;
do not commit those generated path changes.
