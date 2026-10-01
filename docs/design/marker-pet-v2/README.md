# Marker Pet V2 integration

## Visual source and scope

The user-supplied **Photo 2.jpg / 吉祥物優化提案 V2** is the visual authority. Its unchanged bytes are served as [reference-v2.jpg](../../../apps/web/public/mascot/reference-v2.jpg) (1280 × 960, 141,116 bytes; SHA-256 `6f748c94c7c8914c1f8e77789e70d8d189abc5f1fe48d64b141ff997a0d8e3ee`).

The accompanying ZIP's [original handoff](supplied-handoff.zh-TW.md) describes an earlier 2D proposal and explicitly says its 3D models and animation files are not delivered. V2 overrides its earlier silhouette, colors, and SVG geometry. Do not substitute the ZIP's flat/soft SVG for the supplied V2 character.

`PetArtwork` uses SVG clipping windows over the **original photograph**, retaining its coral resin shading, cream face, dark glossy eyes, rounded tip, and absence of a mouth. The paths only isolate the three existing views; they do not redraw the character. The image is requested once and reused across states. No additional graphics dependency, image generation, external asset request, canvas loop, or WebGL context is needed for the pet.

This is a **2.5D image-based web animation**, not a rigged 3D model. The three reference views switch directly; rotation between arbitrary angles, interpolated eyelids, and high-resolution renders would require the corresponding source model or rendered frames. No such model is claimed in this delivery. The small reference views are about 220 source pixels tall; large hero use beyond the preview size needs higher-resolution supplied art.

## Implemented behavior

- `/mascot`: bilingual visual review with the original board alongside the interactive character, three expression controls, and a motion toggle.
- Map: one pet decorates the selected authorized catalog or external place with valid coordinates. The original type markers, clustering, selected halo, detail UI, demo labeling, and list fallback remain available.
- Clearing selection, changing filters, removing a point, provider failure, or unmounting removes the pet. Missing or invalid coordinates never create a placeholder location.
- Pointer hover or keyboard focus selects the 3/4 view with up to 4° of tilt. Activation selects the supplied happy closed-eye expression for 650 ms and opens the existing selected-place detail behavior. Timers are cancelled on unmount; repeated activation restarts one bounded response.
- Display-only idle: 3,200 ms, 1% vertical movement. Display hover: 240 ms, 2 px. Display greeting: one 650 ms rise and return.
- Map greeting: one 650 ms tilt around the tip. **No map floating, translation, or scaling.** At rest the map pet has no repeating animation.
- The existing `FEATURE_MAP_EFFECTS=true` enables map tilt and eased recentering; when disabled, expressions still switch but the body is stationary. `prefers-reduced-motion: reduce` disables all body animations/transitions. The display toggle is independent and also disables motion.

## Map anchor and accessibility

All views align the tip to `(120, 240)` in the shared `240 × 256` artwork viewport, normalized `[0.5, 0.9375]`. The map button is `120 × 128` CSS px, or `96 × 102.4` below the 800 px mobile breakpoint. Mapbox uses `anchor: "bottom"` with an offset of exactly 1/16 of the measured host height (`8` / `6.4` px). Only the **inner** body rotates around `50% 93.75%`; Mapbox owns the outer positioning transform. The reference artwork is scaled uniformly and the three views share one fixed-size box.

On a new selection or layout resize, a point outside the safe visible region is recentered without changing zoom. The camera position accounts for the pet's height above the tip and the mobile bottom sheet. Subsequent user pans are not overridden. The point still lives at its geographic coordinate when the camera moves. Resize listeners, markers, and activation timers are removed on cleanup.

The pet is a native labeled button with visible keyboard focus. Decorative SVGs are hidden from assistive technology. Mapbox's default `role="img"` is removed from the outer host so it cannot hide the button. Location, type, recommendation and selection information remain in the existing textual UI; expressions are not the only status indicator.

Mapbox integration follows the [Marker API](https://docs.mapbox.com/mapbox-gl-js/api/markers/#marker) and the installed 3.30.0 types.

## Verification

- Focused unit suite: 35 passed across marker target resolution, layers, and place subjects. New cases cover missing/filtered points, external selection precedence, invalid coordinates, and zero coordinates.
- Browser suite: `E2E_PORT=3002 pnpm exec playwright test tests/e2e/marker-pet.spec.ts` — 5 passed. Covers provider failure/list fallback, source artwork and expressions, keyboard activation and bounded motion, reduced motion/toggle behavior, Traditional Chinese and a 390 px viewport.
- Production `pnpm build`: passed in an isolated copy, preserving the existing port-3000 production preview and build. Only the copy's Turbopack root was adjusted to resolve linked workspace dependencies.
- Live Mapbox visual review uses the local development database and demo places; no migrations, seeds, account mutations, or deployment are part of this change.
- Lint (excluding the ignored isolated-build scratch directory), root TypeScript checks, and file-scoped Prettier checks passed. Live review additionally checked selection changes, removal on close, geographic placement while zooming, the 650 ms map greeting, and desktop/mobile layouts.

To preview with map motion enabled in PowerShell:

```powershell
$env:FEATURE_MAP_EFFECTS = 'true'
$env:BETTER_AUTH_URL = 'http://localhost:3001'
$env:NEXT_PUBLIC_APP_URL = 'http://localhost:3001'
pnpm --filter @taiwanhub/web dev --port 3001
```

Open `/mascot` for comparison, or select a mapped result on `/`. This uses the existing map-home and Mapbox configuration. It does not change saved `.env` files.
