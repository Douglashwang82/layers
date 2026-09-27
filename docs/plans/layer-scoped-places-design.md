# Layer-scoped places: add places freely to private and group layers

Status: implemented and live (FEATURE_LAYER_CUSTOM_PLACES enabled in production 2026-09-27). C0–C6 shipped: editor empty-search state, custom place schema/access/API (migration 0015), server geocoding, editor create/edit/delete with address lookup, current location and a drop-a-pin map, map/list/detail rendering, Google places in private/group layers without city review, and opt-in Suggest to TaiwanHub with catalog merge on approval. Open questions below remain. Decisions were made by the product owner on 2026-09-27.

## Problem

In production the layer editor can add only **approved catalog** items (`apps/web/src/components/layers/layer-editor.tsx`, search via `/api/v1/map?q=`). Production has no demo catalog by design, so every search is empty and the editor shows nothing — no "no results" message and no way forward. New places reach the catalog only through Suggest a place → moderator approval, and Google places need a moderator **city review** before joining any layer, private ones included (`apps/web/src/features/layers/service.ts`, `subjectTarget`).

Those gates protect the public catalog and public layers. They add nothing for a private list only its owner sees, or a group list only its members see.

## Principle

**Moderation guards what is public.** A place added to a private or group layer is visible only to that layer's audience, so it needs no review. Public layers keep today's review.

## Decisions

| #   | Decision                    | Choice                                                                                                                                                                     |
| --- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Place source                | **Both.** Search the catalog and Google Places (when enabled); if nothing fits, create a **custom place** from a geocoded address or a dropped pin.                        |
| 2   | Who adds in a group layer   | **Group owners and editors.** Viewers stay read-only (unchanged role model).                                                                                               |
| 3   | Private layer made public   | **Send to review.** The existing whole-layer publication review covers its custom and Google places; the public sees nothing from the layer until a moderator approves it. |
| 4   | Reaching the public catalog | **Opt-in suggest.** A custom place stays private; an explicit "Suggest to TaiwanHub" creates an ordinary catalog proposal in the moderation queue.                         |

## Rules by audience

| Layer audience | Catalog items | Google places (`subject`)        | Custom places               | Review                                  |
| -------------- | ------------- | -------------------------------- | --------------------------- | --------------------------------------- |
| private        | yes           | yes, **no city review required** | yes                         | none                                    |
| group          | yes           | yes, **no city review required** | yes                         | none (group layers cannot be published) |
| public         | yes           | only city-reviewed (unchanged)   | yes, re-queues layer review | existing publication review (unchanged) |

Existing behavior that already fits and stays: making a layer public sets `review_status='pending'` and files a `submission` (`publishLayer` path in `features/layers/service.ts`); adding an external item to an approved public layer re-queues review (`requirePublicationReview`); group layers cannot be published.

## Data model

New table `custom_place` (migration 0015+; additive):

| Column                                              | Notes                                                                                                                             |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `id` uuid                                           |                                                                                                                                   |
| `owner_user_id` / `owner_group_id`                  | exactly one (CHECK), mirroring `layer`'s ownership. Scope = the layer owner, so a place can be reused across that owner's layers. |
| `city_id`                                           | the layer's city at creation; must match any layer it joins                                                                       |
| `name`, `name_chinese`                              | `name` required, trimmed, ≤ 120                                                                                                   |
| `address`                                           | optional text as entered                                                                                                          |
| `location` geometry(Point, 4326), `location_status` | same conventions as `place` (`location()` helper); `approximate` for a dropped pin, `exact` for a geocoded address                |
| `category_id`                                       | optional, existing `place_category`                                                                                               |
| `website`, `note`                                   | optional; `website` must be https                                                                                                 |
| `catalog_place_id`                                  | set when a suggestion is approved and linked, for dedupe (see Promotion)                                                          |
| `status`                                            | `active` / `hidden` / `deleted` (soft delete; moderators can hide)                                                                |
| `created_by`, timestamps                            |                                                                                                                                   |

`layer_item` gains nullable `custom_place_id` (FK), a partial unique index `(layer_id, custom_place_id)`, and `layer_item_one_entity` is widened to five columns. Item key prefix: `custom:<uuid>`, added to `layerItemKeyPattern` / `parseLayerItemKey` in `packages/shared`.

## Access control (server-side)

- **Create / edit / delete a custom place:** actor can edit a layer owned by the same scope (private owner; group owner/editor). Delete is soft and removes it from that scope's layers.
- **Add to a layer:** `addLayerItem` accepts `custom:` keys when the place is `active`, in the layer's city, and owned by the same scope as the layer. A user-owned custom place never enters a group layer and vice versa (no cross-scope leaks).
- **Read:** a custom place is visible only to viewers of a layer that contains it and to its owner scope. It is never returned by catalog search, `/api/v1/map` city results, sitemaps, metadata or public place pages. Map/list include it only through the viewer's applied layers.
- **Public layers:** its custom places become publicly visible only while the layer is `audience='public'` and `review_status='approved'`, exactly like the layer itself. Adding one to an approved public layer calls `requirePublicationReview`.
- **Google places in private/group layers:** `subjectTarget` skips the `city_review_status='approved'` requirement when the layer audience is `private` or `group`; the subject still has to be actionable and visible to the actor (existing checks). Public layers keep the city-review gate.

## Geocoding

Coordinates come from a geocoder or the member's pin, never from free text. Reuse the keyless US Census one-line geocoder already used by `packages/database/src/feed-agent.ts`, moved behind a small server-side module with timeout, response validation and a bounded input length. Mapbox geocoding results cannot be stored without its permanent-geocoding terms, so it is used only for the pin map, not for stored coordinates. No match → the form asks for a pin; the place saves with `location_status='approximate'`. A place with neither saves as unmapped and appears in the list fallback only (existing location-status semantics).

## Editor experience

The "Add items" panel in `/layers/{slug}/edit`:

1. One search box. Results come in sections: **In TaiwanHub** (catalog), **From Google** (when `FEATURE_GOOGLE_PLACES_DISCOVERY` is on), and **Your places** (the scope's custom places).
2. Zero results always render a message: "No results for "{q}"." plus a primary **Add "{q}" as a new place** button (fixes today's silent empty state).
3. **New place** form: name (prefilled from the query), Chinese name, address → "Find on map" (geocode preview), or "Drop a pin" on a small map; optional category, website, note. Save adds it to the current layer in one step.
4. On `/layers/{slug}`, an editable empty layer shows **Add places** leading to the editor (existing link), and a non-empty one gets an **Add** action in the contents header for editors.
5. A custom place in a list shows a subtle **Private place** / **Group place** badge to editors, and a **Suggest to TaiwanHub** action in its menu.

All copy goes into both dictionaries in `apps/web/src/lib/dictionary.ts`; controls are labeled and keyboard-accessible; the pin map degrades to address-only when no Mapbox token is available.

## Promotion to the public catalog

"Suggest to TaiwanHub" copies name, address, coordinates, category and website into the existing place submission flow (`status='pending'`, `submission` row) with the custom place as its source. When a moderator approves it, `custom_place.catalog_place_id` is set. Layer items keep referencing the custom place, and map/list dedupe it against the catalog place by that link. Rejection changes nothing for the private copy. Suggesting is rate-limited like other submissions.

## Map and list

`features/map/query.ts` `loadCandidates` gains a custom-place source that is **only** loaded for applied layers the viewer can access (never for city-wide results). Items use `type: "custom"`, keep explicit `location_status`, and appear in the same list/map agreement and fallback rules. My saves is unchanged (custom places are saved by being in a layer).

## Analytics and audit

Record `custom_place_created`, `custom_place_added`, `custom_place_suggested` with ids only — no names, addresses or coordinates (existing personal-data restrictions). Moderation hide/delete of custom places goes through the existing audited moderation path.

## Rollout

Behind `FEATURE_LAYER_CUSTOM_PLACES` (default off; enabled per environment). Suggested phases, each with tests and its own commit:

| Phase | Scope                                                                                                                                                             |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C0    | Editor zero-results message and "add as new place" entry point (no schema); ships independently.                                                                  |
| C1    | `custom_place` schema, migration, shared key/schema types, service + repository with access rules; integration tests for scope isolation and public-layer review. |
| C2    | Server geocoder module + create/edit/delete API; mocked geocoder tests (match, no match, timeout, malformed response).                                            |
| C3    | Editor UI (search sections, new-place form, pin map), both locales; E2E for private and group layers.                                                             |
| C4    | Map/list rendering and dedupe; E2E for map/list agreement and no leaks to guests or non-members.                                                                  |
| C5    | Google places without city review in private/group layers.                                                                                                        |
| C6    | Suggest to TaiwanHub + moderator linking.                                                                                                                         |

Required regression tests: a guest or non-member never sees a custom place via map, list, search, layer page or API; a group viewer cannot create or add; a user-owned place cannot enter a group layer; publishing a private layer with custom places leaves them hidden until approval; adding one to an approved public layer re-queues review.

## Open questions

- Reports: should members be able to report a custom place in a group layer to moderators (reusing the report flow), or only to group owners?
- Limits: per-scope cap on custom places (suggest 1,000) and per-day creation rate.
- Photos: out of scope for v1; revisit once production image storage is confirmed.
