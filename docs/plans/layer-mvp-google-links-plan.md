# Map MVP: layers built from Google Maps links

Status: P1–P5 implemented 2026-10-20 (migration `0023`, local only; see [Implementation notes](#implementation-notes-2026-10-20)). P0 (live key) and P6 (rollout) wait on the owner. Supersedes the search-first parts of [map-first-layer-experience-guide.md](../guides/map-first-layer-experience-guide.md) while `FEATURE_MAP_MVP` is on.

## Goal

The map stops being a discovery/search surface. It only shows POIs the user (or their group) has saved, and POIs live in layers:

1. A user creates a layer by pasting Google Maps share links for individual places.
2. The user loads one or more layers into a single map view (union of their POIs).
3. Events exist only on LocalLink: a layer editor attaches an event to a specific place in a layer.

Search is disabled, not deleted.

## Decisions (owner, 2026-10-20)

| #   | Decision                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M1  | Only **single-place** share links (`maps.app.goo.gl/…`, `goo.gl/maps/…`, `google.com/maps/place/…`, `maps.google.com/?q=…`). Google Maps saved lists are out of scope: there is no official API and parsing them is fragile and ToS-risky. |
| M2  | Links are resolved **server-side with Places API (New)** to a Google `place_id`.                                                                                                                                                           |
| M3  | Events are LocalLink-only data, attached by editing a place inside a layer. Google links never produce events.                                                                                                                             |
| M4  | Search is hidden behind a feature flag (`FEATURE_MAP_MVP=true` hides it); the code stays.                                                                                                                                                  |
| M5  | Built-in system layers (today/weekend/food/community/Daily Pick/Discover) are disabled while the flag is on: hidden from the picker and dropped by the server from map queries.                                                            |
| M6  | No geographic limit on imported places; the camera fits the loaded POIs.                                                                                                                                                                   |
| M7  | Custom (hand-dropped) places stay addable as a fallback for places Google doesn't know; catalog search in the editor is hidden.                                                                                                            |
| M8  | Recurring events are out of scope; each attached event is a single occurrence.                                                                                                                                                             |

## What already exists (reuse, don't rebuild)

- **Multi-layer map view.** `MapState.layers` already accepts several slugs; `features/map/query.ts` unions items and `external.ts` unions Google subjects per layer, with per-item `layers[]` memberships.
- **Google places in layers.** `place_subject` + `place_provider_reference` hold a Google `place_id`; `layer_item.subject_id` puts it in a layer. Private/group layers already accept unreviewed subjects (layer-scoped places design, C5). `place-subjects/service.ts` `resolveProviderPlace()` finds-or-creates a subject by `place_id` idempotently.
- **ToS-compliant rendering.** The server stores only `place_id` (plus `display_name` since 0022); coordinates and details are resolved client-side through the Places UI Kit. ~~The MVP keeps this — no Google coordinates are persisted.~~ Changed by owner decision 2026-10-21: the MVP caches coordinates for at most 30 days (see [Location cache](#location-cache-2026-10-21)).
- Layer create/edit pages, layer revision checks, private/group audiences, invitations.

## Gaps to build

### 1. `FEATURE_MAP_MVP` flag (M4)

`flags.mapMvp` in `apps/web/src/lib/config.ts`. When on:

- Hide the toolbar search input, "Search this area", city-scope search overlay, and Google discovery search results (`searchPoints`, `search:` keys) in `map-workspace.tsx` / `map-toolbar.tsx`.
- Server ignores `q` and `scope=city` in `parseMapQuery` (UI hiding is not enough; old URLs must not reach the city-wide path).
- Layer picker lists only layers the actor owns, edits, belongs to via a group, or follows. System layers are disabled (M5): hidden from the picker, and `resolveLayers` drops `ownerKind = 'system'` slugs so old URLs and saved preferences cannot load them. The default layer set becomes empty instead of the city's system defaults.
- Editor: Google links and custom places only; catalog search hidden (M7).
- Hide type filters for products/content; places (and attached events, §4) only.
- Empty state when no layer is loaded: "Create a layer from Google Maps links" CTA plus a list of the user's layers. Signed-out visitors see the sign-in prompt.

### 2. Google link resolver (M1, M2)

New server module `apps/web/src/features/google-links/` (service + resolver), reached through the existing `[...path]` router as `POST /api/v1/google-links/resolve` (authenticated, rate-limited).

Input: up to 50 URLs (Zod: strings, max length 2 048). Per URL:

1. **Parse locally first.** If the URL already carries a place identifier (`place_id:`/`query_place_id=`, `?cid=`, or a `!1s0x…:0x…` feature id in `data=`), skip the network fetch.
2. **Expand short links** (`maps.app.goo.gl`, `goo.gl/maps`) with `redirect: "manual"`, following at most 5 hops. Every hop must be HTTPS and its host must be on a fixed allowlist (`maps.app.goo.gl`, `goo.gl`, `www.google.com`, `google.com`, `maps.google.com`, regional `google.*` ccTLDs). Abort on any other host. Do not download the body (HEAD, or GET aborted after headers). 5 s timeout per hop. This keeps the fetch from becoming an SSRF vector.
3. **Extract** the place name (`/maps/place/<name>/`) and the `@lat,lng` viewport or `!3d…!4d…` pin from the expanded URL.
4. **Places API (New) Text Search** with `textQuery=<name>`, `locationBias` circle (500 m) around the extracted point, and field mask `places.id` only (the IDs-only SKU; verify current pricing in P0). Take the top result. For a `cid`, query by the CID-form URL text when no name is available.
5. Return `{ input, status: "resolved" | "unsupported" | "not_found" | "failed", providerPlaceId?, reason? }`. One bad link never fails the batch.

Rules:

- The model is never involved; no LLM, no free-form text is trusted. Coordinates from the URL are used only as a search bias and are **not stored**.
- Server key `GOOGLE_MAPS_LINK_API_KEY` (server-only, IP/API-restricted, separate from `NEXT_PUBLIC_GOOGLE_PLACES_UI_KIT_KEY`). Document it in `.env.example`. Daily quota + budget alert set in Google Cloud by the owner.
- Fixtures cover: each URL shape, list links (→ `unsupported`), redirect to a non-allowlisted host, redirect loop, timeout, API zero results, API error, partial batch failure.

### 3. Create-layer-from-links flow

New step on `/layers/new` (and "Add from Google Maps" in the layer editor):

1. Textarea: paste one link per line. Title field. Audience (private default, or a group the user edits).
2. "Check links" → resolver → preview list. Each resolved row renders through the Places UI Kit compact component (name/address shown to the user for confirmation, not stored); failed rows show the reason and can be removed or retried.
3. "Create layer" → one transaction in the layer service: create the layer, `resolveProviderPlace()` for each confirmed `place_id`, insert `layer_item(subject_id)` rows (unique per layer, so duplicates collapse), set positions in paste order. The existing layer revision/audit rules apply.
4. Redirect to the map with the new layer loaded (`/?layers=<slug>`), camera fitted to its POIs.

Public layers keep the existing review path; the MVP flow creates private/group layers only.

### 4. Events attached to a place in a layer (M3)

The current `event` table is a catalog entity (requires an organization, its own location, moderation), so it is the wrong shape. Add a layer-scoped table:

```
layer_item_event
  id, layer_item_id → layer_item (cascade), title, title_chinese,
  start_time, end_time (timestamptz, start <= end), note,
  status (active|deleted), created_by, timestamps
```

- Location comes from the parent layer item's place; the event has no coordinates of its own.
- Visibility = the layer's visibility. Editors (owner, group owner/editor) create/edit/delete; soft delete.
- Times stored as instants; date windows use the city time zone (existing `resolveDateWindow`).
- Map: a place with an upcoming event gets an event badge on its marker and the event in its detail sheet; the existing date filter (today/weekend) narrows to places with events in the window when an event filter is chosen.
- Migration via `pnpm db:generate`; applied to the local DB first.

### 5. Map loading of many Google places

`external.ts` pages subjects 12 at a time because the client resolves each through the UI Kit. In the MVP every POI is a subject, so a 40-place layer must still show all its pins. Raise the page size for loaded layers (bounded, e.g. 100 per request, with the existing `maxMapPoints` cap) and batch client-side resolution. Measure UI Kit request volume/cost in P0 before rollout.

## Phases

| Phase | Scope                                                                                                                                               | Verification                                                      |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| P0    | Owner: create server key, quotas, budget alert. Live check: each link shape resolves; confirm IDs-only Text Search pricing; UI Kit cost for N pins. | Manual, live key, recorded in this doc                            |
| P1    | `FEATURE_MAP_MVP` flag: hide search UI, server ignores `q`/`scope=city`, picker filtering, empty state.                                             | Unit (query parsing), E2E (no search controls, multi-layer union) |
| P2    | Link resolver module + endpoint with fake fetch/Places fixtures.                                                                                    | Unit tests for every fixture case                                 |
| P3    | Create-from-links UI + transactional layer creation; "Add from Google Maps" in the editor.                                                          | Integration (transaction, dedupe, authz), E2E with fake provider  |
| P4    | `layer_item_event` schema, service, editor UI, map badge/detail.                                                                                    | Migration on local DB, integration (authz/visibility), E2E        |
| P5    | External page size / batched resolution.                                                                                                            | E2E with a 40-place layer                                         |
| P6    | Rollout: prod migration, env vars, flag on. Needs owner authorization.                                                                              | Live smoke test on prod                                           |

## Open questions

None. Q1–Q4 were answered by the owner on 2026-10-20 and recorded as M5–M8.

## Implementation notes (2026-10-20)

Where the build differs from, or settles, the design above:

- **Flag and URLs.** `FEATURE_MAP_MVP` (default off). `resolveMapRequest` applies `mvpMapState` (no `q`, city scope, `area`, date filter; types `place` only), and the home page redirects any URL carrying those parameters or an explicit system layer to its canonical form, so the client never shows a state the server ignores. Without a remembered preference the MVP map starts empty (`layers=none` semantics) instead of on Discover.
- **System layers.** `resolveLayers` returns them as `disabled` (neither resolved nor "unavailable"); the library hides them; `runMapQuery` removes them from `state.layers`.
- **Picker.** The Layers tab lists the member's own layers (with My saves), group layers and followed layers (`listMapLibrary`) as checkboxes, plus "Create a layer from Google Maps". Signed-in members with nothing loaded land on that tab; signed-out visitors see the sign-in prompt.
- **Resolver.** `features/google-links/resolver.ts`. Links with only a `cid` and no name are reported as `unsupported` (`no_place_name`): Places API (New) cannot search by CID, and fetching the Maps page body to find a name is out of bounds. Consent interstitials (`consent.google.com?continue=`) are read, never fetched. Budget: 150 links per member per 10 minutes on top of the 30 writes/minute limit. `GOOGLE_MAPS_LINK_API_KEY=fake` (non-production) selects a deterministic test double that never expands short links.
- **Import.** `POST /api/v1/layers/from-google` creates an **active** private/group layer and its places in one transaction; `POST /api/v1/layers/{id}/google-places` adds to an existing layer. Placement reuses `subjectPlacement` with `anyCity` (M6): private/group layers take reviewed external places from any city; public layers still require a city review, and catalog-linked places keep the city match. Skipped places come back with a reason code.
- **Events.** `layer_item_event` as designed. Shown as the next event on result rows and Google place rows, and as an "Upcoming events" list above the selected place's details. Not built: a marker badge and date-filter narrowing (the MVP has no date filter). Viewers of a public layer only see events on city-reviewed external places, the same rule as for the places themselves. Writes need `FEATURE_MAP_MVP`.
- **Many Google places.** External references come 60 per page under the flag, every page loads automatically, and the rows stay mounted (hidden) while the panel shows layers or details, so pins never disappear. UI Kit cards only fetch while on screen, so a place without a cached location opens the Results tab once per query until its card locates it. The camera keeps framing all loaded places until the user moves the map.
- **Tests.** Unit: `tests/unit/google-links.test.ts`. Integration: `tests/integration/map-mvp.test.ts`. Browser: `tests/e2e/mvp/` via `pnpm test:e2e:mvp` (`playwright.mvp.config.ts`, its own dev server with the flag on; CI runs it after `pnpm test:e2e`).

Launch cities (2026-10-20): Taipei, Houston and Tokyo (migration 0024). Google-link layers work in all three. Under the flag a layer shows whichever city is selected (M6: its places can be anywhere, and a layer's city is only the one selected when it was made); choosing a city moves the camera. Catalog places still come from the selected city only. Layer and result counts include Google places. Custom places in Taipei and Tokyo can be pinned on the map, but address lookup ("Find on map") uses the US Census geocoder and only finds US addresses.

### Location cache (2026-10-21)

Owner decision, to move fast: Google place cards (UI Kit) only fetch while on screen and were the only source of pin coordinates, so every page view loaded each place's card, and the map had to open its list for pins to appear. Migration `0025` adds `latitude`, `longitude` and `location_fetched_at` to `place_provider_reference`. With the flag on, `GET /api/v1/map/external-references` returns each place's cached `location`. A place without fresh coordinates is looked up with the server key (Place Details (New), `location` field mask only; at most 60 per request, failed IDs retried after an hour). Values older than 30 days are cleared on each lookup pass, and the place is looked up again when it is next listed. Names, photos and other details still come only from the UI Kit card. Without a server key, locations stay `null` and the old client-side path applies.

**Open risk (owner accepted):** Google's 30-day caching allowance is documented, but whether showing those coordinates as pins on a non-Google (Mapbox) map, apart from the UI Kit card, is permitted has not been confirmed against the current Google Maps Platform terms. Confirm before or during P0.

Rollout (P6), once the owner authorizes it: apply migrations `0023`, `0024` and `0025` to production, create the restricted `GOOGLE_MAPS_LINK_API_KEY` with a daily quota and budget alert, confirm `NEXT_PUBLIC_GOOGLE_PLACES_UI_KIT_KEY` is set, set `FEATURE_MAP_MVP=true` in Vercel, then run the P0 live checks on production links.
