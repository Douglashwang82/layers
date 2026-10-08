# LocalLink: inclusive local discovery rebrand

## Goal and decisions

The product is renamed from TaiwanHub to **LocalLink** (proposed default; no other name preference was provided) and repositioned as local places, events, products and communities for everyone. English and Traditional Chinese stay supported. Houston remains the only launch city; nothing here claims worldwide coverage. Taiwanese restaurants, groceries, organizations, sources and product sightings remain valid content alongside everything else.

## What changed

- **Brand constants** (`packages/shared/src/brand.ts`): `brand.name` and layer-title constants. Used by metadata/OG, join and place-subject titles, invitation/reset/sign-in-code emails, membership default display name (`LocalLink Member`), system layer owner label, Daily Pick editorial copy, seed source labels and the mascot lab. Navigation, footer and both dictionaries use literal LocalLink text. The brand mark is “L” instead of 台.
- **Dictionaries**: ethnic positioning replaced with community/local language in both locales (headline, footer, score label “Community recommended / 社群推薦”, recommend prompt, search placeholder and hint). Internal keys made neutral: `inBrand`, `suggestToBrand`, `brandCommunity`, `publishOnBrand`. `TaiwaneseScore` is now `CommunityScore`.
- **Categories** (`packages/shared/src/categories.ts`): `placeCategories` is additive and generic-first (Restaurant, Cafe, Bakery, Dessert, Breakfast, Grocery, Shop, Park, Museum, Community Center, Service, then Taiwanese, Bubble Tea, Hot Pot, Asian Grocery, Japanese, Korean, Chinese, American, Mexican, Italian, Indian, Other). All previous values stay valid. `placeCategorySeedOrder` preserves the legacy order that fixed `place_category` seed ids (`uid(3, n)`) were derived from; new values are appended only. `placeCategoryChinese` is shared with Daily Pick copy.
- **Eligibility predicates**: `isFoodCategory` (allowlist of eating/drinking categories) now drives the map `food` layer, the “today” layer's place picks and the catalog's popular list; previously only Asian Grocery/Other (or only Asian Grocery) were excluded, so Parks or Services would have become food recommendations. `isRetailCategory` (Grocery, Asian Grocery, Shop) gates product sightings on the server (`features/community/service.ts`) and populates the sighting store picker (`app/submit/[kind]/page.tsx`). Unknown legacy free-text categories are no longer treated as food.
- **Restaurant pipeline audit**: the v2 restaurant pipeline derives food type from Google provider types, not `place.category`, so it needed no change. Daily Pick (place of the day) is category-agnostic by design and unchanged apart from copy.
- **System food layer**: new default is “Local food favorites / 在地美食愛店” (`system-layers.ts`). Already persisted system layers are handled by `normalizeSystemLayerTitles`, applied in the single layer read path (`features/layers/repository.ts` `record()`): only a system layer with the `food` rule whose title (or Chinese title) is exactly the legacy default is relabeled, each field independently. User, group, custom and edited titles are untouched. IDs, slugs and rules are unchanged. No migration and no data mutation; the stored row keeps the old text until an operator edits it.
- **Google Places**: example search copy updated; provider and licensing boundaries unchanged. Feed extraction derives its enum from `placeCategories`; prompt, model and provider unchanged.
- **Docs**: README, AGENTS.md identity, user/engineering/ingestion/daily-pick/deployment guides, architecture/API references and this plan. `docs/reference/product.md` (founding brief) and the earlier plans/ADRs are historical and keep their original wording; product.md and the two UI guides carry a naming note. `docs/dev-notes.md` was not touched.

## Legacy identifiers intentionally unchanged

`@taiwanhub/*` workspace names and imports, the repository directory, browser storage keys (`taiwanhub:map`, `taiwanhub:map-view`), HMAC/grant purpose strings (`taiwanhub:place-subject-selection-grant:v1`, `taiwanhub:membership-rate-limit:v1`), database/Docker/CI names and `DATABASE_URL` defaults, GitHub Actions concurrency groups, temp-dir prefixes, `.invalid` demo/test email domains and demo user emails, the `TaiwanHubContentCollector/1.0` crawler user-agent (kept so source operators' existing allow/deny entries still match), the root package name (`taiwanhub`), existing env vars, and public asset file names. Changing storage keys or purposes would reset sessions/grants or invalidate tokens. Deterministic seed ids and the demo flag are unchanged; existing persisted demo rows are not rewritten and the seed was not run.

## Known limitations

- Existing persisted demo rows, `source` labels such as “TaiwanHub demo seed”, user display names “TaiwanHub Member”, and persisted layer rows keep their old text; only new rows and display-normalized layer titles use LocalLink.
- The feed-extraction geocoder is the US Census geocoder (US street addresses only); other regions need a different geocoder and new data-licensing review before they can be claimed.
- Search keyword matching, Daily Pick history and `place.category` values stored before this change are not migrated.
- Demo fixtures and seed content are still Houston/Taiwanese-flavored sample data and remain labeled demo.

## Verification (run 2026-10-08)

- `pnpm typecheck`: pass. `pnpm lint`: pass. `pnpm test`: 16 files, 191 tests pass, including `tests/unit/locallink.test.ts` (category validation, seed-order stability, food/retail predicates, system title normalization, email and dictionary assertions).
- `pnpm build`: pass (the build rewrites `apps/web/next-env.d.ts`; that incidental change is not part of this work).
- Codex independently reran lint, typecheck and all 191 unit tests successfully. File-scoped formatting and diff checks passed after review.
- Integration: all 19 files / 198 tests passed against a newly created disposable PostGIS container on loopback port 55438. A subsequent focused run passed all 14 community tests, including four added service-level cases accepting Grocery/Shop and rejecting Park/Service. The container was stopped after validation; existing development data was not used.
- E2E: attempted the affected map, custom-place and Places specs, but the existing development server held the checkout lock. A temporary copy could not start with cross-drive dependency links; installing independent locked dependencies was then blocked by C-drive exhaustion (`ENOSPC`). No browser test is claimed as passed. The user's existing development server was left running.
- Claude session: `9c62d61a-2acd-46ec-ae91-dfc7c2530eb3`. Scoped shell permissions denied several auxiliary commands; Codex completed the remaining review and restored the incidental generated `next-env.d.ts` change.
