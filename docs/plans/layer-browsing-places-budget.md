# Layer browsing without automatic Places requests

## Accepted outcome

Opening, paging, revisiting, or hovering a layer uses local data only. Selecting
a place opens LocalLink actions and reviews without automatically loading Google
details. Users can open Google Maps directly or explicitly load one Google card.
Existing search and import actions remain explicit provider operations.

## Implementation

1. Make map location reads cache-only. Preserve the existing 30-day expiry and
   never refresh missing coordinates or types during browsing.
2. Replace per-row Google cards in map results and layer contents with locally
   supplied link names, notes, events, and direct Google Maps links. Missing names
   receive an honest fallback; missing coordinates stay in the list, without a
   fabricated pin or an indefinite loading state. Pagination must not depend on
   a provider card finishing.
3. Use local labels and community reviews in marker hover cards. Gate detail,
   saved-place, and Daily Pick Google cards behind an explicit bilingual button.
4. Test cache hits, missing/expired coordinates, pagination, layer editing,
   selection, provider failure, and explicit detail loading with fake providers.
5. Run lint, typecheck, unit tests, affected integration/browser tests, and build;
   review the diff, commit only task files, then merge into local master.

## Limits and references

No schema migration or paid API run is required. Existing valid cached pins keep
working. Missing/expired pins require explicit detail loading for an in-memory
location; this change does not add a background refresh job or permanently retain
Google data. New imported places also remain list-accessible until explicitly
located. Base-map requests are separate from Places requests.

- [Maps URLs](https://developers.google.com/maps/documentation/urls/get-started)
  support a direct search URL with `api=1`, `query`, and `query_place_id`.
- [Service terms](https://cloud.google.com/maps-platform/terms/maps-service-terms)
  describe the limited latitude/longitude cache period. This implementation does
  not broaden the existing storage policy.

Unrelated untracked files present at task start are preserved. Remote push and
deployment are outside this task.

## Verification completed

- `pnpm lint` and `pnpm typecheck`: passed.
- `pnpm test`: 32 files, 311 unit tests passed.
- Integration tests `map-mvp.test.ts` and `collections.test.ts`: 26 passed
  against the local Docker development database.
- `pnpm test:e2e:mvp`: 3 passed, including a 65-place mobile list, pagination,
  explicit detail loading, failure fallback, and reload without provider cards.
- Browser tests `places.spec.ts`, `layer-workspace.spec.ts`, and
  `daily-pick.spec.ts`: 7 passed. The Daily Pick save test was updated to navigate
  between the card and detail in the shared panel rather than click a hidden card.
- `pnpm build`: passed. File-scoped Prettier and `git diff --check`: passed.

Provider-dependent browser operations used the deterministic fake provider;
these tests establish application behavior, not live Google billing totals.
Windows sandbox restrictions blocked the initial Vitest/build runs; successful
runs used the approved external execution path. No live Places calls were used
for validation.
