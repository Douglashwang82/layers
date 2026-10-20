# Map MVP: layers built from Google Maps links

Status: proposed (2026-10-20). Supersedes the search-first parts of [map-first-layer-experience-guide.md](../guides/map-first-layer-experience-guide.md) while `FEATURE_MAP_MVP` is on.

## Goal

The map stops being a discovery/search surface. It only shows POIs the user (or their group) has saved, and POIs live in layers:

1. A user creates a layer by pasting Google Maps share links for individual places.
2. The user loads one or more layers into a single map view (union of their POIs).
3. Events exist only on LocalLink: a layer editor attaches an event to a specific place in a layer.

Search is disabled, not deleted.

## Decisions (owner, 2026-10-20)

| #   | Decision                                                                                                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | Only **single-place** share links (`maps.app.goo.gl/…`, `goo.gl/maps/…`, `google.com/maps/place/…`, `maps.google.com/?cid=…`). Google Maps saved lists are out of scope: there is no official API and parsing them is fragile and ToS-risky. |
| M2  | Links are resolved **server-side with Places API (New)** to a Google `place_id`.                                                                                                                                                             |
| M3  | Events are LocalLink-only data, attached by editing a place inside a layer. Google links never produce events.                                                                                                                               |
| M4  | Search is hidden behind a feature flag (`FEATURE_MAP_MVP=true` hides it); the code stays.                                                                                                                                                    |

## What already exists (reuse, don't rebuild)

- **Multi-layer map view.** `MapState.layers` already accepts several slugs; `features/map/query.ts` unions items and `external.ts` unions Google subjects per layer, with per-item `layers[]` memberships.
- **Google places in layers.** `place_subject` + `place_provider_reference` hold a Google `place_id`; `layer_item.subject_id` puts it in a layer. Private/group layers already accept unreviewed subjects (layer-scoped places design, C5). `place-subjects/service.ts` `resolveProviderPlace()` finds-or-creates a subject by `place_id` idempotently.
- **ToS-compliant rendering.** The server stores only `place_id` (plus `display_name` since 0022); coordinates and details are resolved client-side through the Places UI Kit. The MVP keeps this — no Google coordinates are persisted.
- Layer create/edit pages, layer revision checks, private/group audiences, invitations.

## Gaps to build

### 1. `FEATURE_MAP_MVP` flag (M4)

`flags.mapMvp` in `apps/web/src/lib/config.ts`. When on:

- Hide the toolbar search input, "Search this area", city-scope search overlay, and Google discovery search results (`searchPoints`, `search:` keys) in `map-workspace.tsx` / `map-toolbar.tsx`.
- Server ignores `q` and `scope=city` in `parseMapQuery` (UI hiding is not enough; old URLs must not reach the city-wide path).
- Layer picker lists only layers the actor owns, edits, belongs to via a group, or follows. System catalog layers (today/weekend/food/Daily Pick/Discover) are hidden from the picker. _(Default proposed here — confirm, see Q1.)_
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
- Server key `GOOGLE_PLACES_SERVER_KEY` (server-only, IP/API-restricted, separate from `NEXT_PUBLIC_GOOGLE_PLACES_UI_KIT_KEY`). Document it in `.env.example`. Daily quota + budget alert set in Google Cloud by the owner.
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

- **Q1.** Hide system catalog layers (today/weekend/food/Daily Pick) from the MVP picker? Proposed: yes, while the flag is on.
- **Q2.** Must imported places be inside the layer's city (Greater Houston)? Proposed: accept any location for private/group layers; the camera fits the loaded POIs.
- **Q3.** Should catalog places and custom (hand-dropped) places still be addable in the MVP editor, or only Google links? Proposed: keep custom places as a fallback for places Google doesn't know; hide catalog search.
- **Q4.** Recurring events (weekly meetups) — out of scope for the MVP?
