# Google place discovery and TaiwanHub reviews

Status: Mapbox + Google Places UI Kit is the selected direction as of September 25, 2026. No application changes or Google project configuration are included. The [engineering implementation plan](google-places-implementation-plan.md) is the authoritative handoff for contracts, phases, acceptance criteria, and rollout. Review visibility remains an open product decision: shared within TaiwanHub, private per user, or selectable private/group/public. The review flow below assumes shared TaiwanHub reviews; implementation must settle that decision first.

## Recommendation

Keep the existing Mapbox map for the first version. Add Google Places UI Kit for finding a business and displaying its current details. Store member-written reviews, star ratings, and collection membership in TaiwanHub's PostgreSQL database. Never send review text or stars to Google.

| Approach                                      | Fit                                                                                   | Tradeoff                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Mapbox + Places UI Kit                        | Selected path; preserves extensive map customization and the current layer experience | Google-provided components constrain presentation; validate required components and release channels in a prototype |
| Google Maps JavaScript API + Places API (New) | Deferred alternative if priorities change to Google basemap business discovery        | Requires a separate renderer migration decision; outside this implementation plan                                   |

The standard Places API prohibits use of its content with a non-Google map. Places UI Kit has an explicit exception allowing non-Google maps; that exception does not extend to arbitrary Places API calls. Both permit temporary coordinate caching for at most 30 consecutive days. See Google's [service-specific terms, sections 14–15](https://cloud.google.com/maps-platform/terms/maps-service-terms). This proposal assumes a non-EEA billing account; confirm the account's applicable terms before implementation.

Google documents [Basic Place Autocomplete](https://developers.google.com/maps/documentation/javascript/places-ui-kit/basic-autocomplete), [Place Search](https://developers.google.com/maps/documentation/javascript/places-ui-kit/place-search), and [Place Details](https://developers.google.com/maps/documentation/javascript/places-ui-kit/place-details). Use their supported events and properties; do not scrape component internals. Advanced components are marked preview in the [overview](https://developers.google.com/maps/documentation/javascript/places-ui-kit/overview). Do not assume every desired customization is available in a stable channel.

## Experience

1. The map offers two clear search scopes: **TaiwanHub layers** and **Find a business**. Existing layer search retains its current meaning. Selecting business search loads Google discovery on demand.
2. A user types a store or restaurant name. Bias suggestions toward the selected city or viewport. Support English and Traditional Chinese; do not require three Latin characters before accepting Chinese queries.
3. Selecting a result focuses a temporary pin and opens a desktop side panel or mobile bottom sheet. Show Google's business details in its attributed component and a separate **TaiwanHub community** section.
4. The user sees **Write a review**, **Save**, and **Add to layer**. If a corresponding approved TaiwanHub place already exists, use its existing identity and actions. Otherwise create only a minimal external reference when the user contributes or saves.
5. The proposed review editor accepts 1–5 stars, a comment, or both; it rejects an empty review. Label the action **Publish on TaiwanHub** and explain that it does not post to Google. A signed-in invited member can create, edit, or delete their review. Guest discovery remains possible with bounded Google usage.
6. Show **TaiwanHub rating: 4.6 · 12 ratings** only when supported by actual local reviews. New places show **No TaiwanHub ratings yet**. Any Google rating remains separately attributed and is never included in this average. Example numbers here are illustrative.

For broad queries such as “Taiwanese restaurant,” add a submitted text search and an explicit **Search this area** action. Do not fetch new businesses on every pan. Search results are temporary discovery results, not automatic additions to public layers. Mapbox basemap labels do not automatically become selectable Google businesses; users select our search pins or existing TaiwanHub pins.

Personal or group layer notes inherit that layer's audience. They are not public reviews. If selectable review visibility is chosen, private/group ratings need separate authorization and aggregates; they must never affect the public count or average.

## Existing implementation and required changes

The current code already provides:

- Mapbox rendering in `apps/web/src/components/map/map-canvas.tsx` and `map-view.tsx`, with map/list queries in `apps/web/src/features/map/query.ts`.
- `place_recommendation`: one yes/no recommendation per user and place.
- `place_note`: moderated free-text comments, currently submitted through the recommendation action.
- `layer_item.note`: a note attached to a place, event, or content item in a layer.
- Better Auth, invitation-based membership, contribution limits, moderation submissions, and audit records.

Introduce stars as a distinct metric. Keep existing yes/no recommendations and their API behavior intact; do not convert yes/no votes to fabricated star ratings or repurpose `external_rating`. The initial UI can show legacy recommendations separately while stars accumulate.

Google results cannot simply be inserted into today's `place` table: its name, address, coordinates, image, and category requirements assume a durable catalog record. Do not fabricate missing fields or permanently copy Google details to satisfy those requirements.

## Proposed data model

| Entity                     | Durable fields and constraints                                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `place_subject`            | Internal UUID; optional unique existing `place_id`; timestamps. Stable target for new reviews across catalog and external places                                               |
| `place_provider_reference` | Subject UUID, provider, provider place ID; unique `(provider, provider_place_id)`; supports audited replacement IDs without moving reviews                                     |
| `place_review`             | Subject UUID, server-derived user ID, nullable stars constrained to integers 1–5, body, moderation status, revision, timestamps, soft deletion; unique `(subject_id, user_id)` |
| `saved_place_subject`      | Unique user/subject association for external saves; merge its projection with existing saved catalog places                                                                    |

Create subject/reference records transactionally and idempotently on the first write. Browsing must not populate a persistent Google business directory. A provider ID is a lookup key, not proof of authenticity or verification. Validate boundaries and distinguish client-selected references from independently linked catalog records.

Extend layer membership with a subject reference for external places and preserve the exactly-one-target constraint. Extend shared item keys and map serializers additively; keep existing `place:uuid`, event, and content behavior. Explicitly resolve a subject linked to an existing catalog place to one visible item. Never auto-merge businesses using name similarity alone; different branches have different identities.

External references are not automatically approved catalog submissions. They can be saved privately immediately. Public layer membership follows existing publication review, and public reviews need their own moderation. Hidden/deleted catalog items cannot be resurfaced by saving their provider reference. Linking and merging require an audited service operation that preserves reviews, permissions, and saves.

## Google data lifecycle

Place IDs may be retained indefinitely, but that does not permit permanent storage of names, addresses, photos, hours, or reviews. Keep those details in the supported live UI; avoid persisting API payloads in logs, application caches, static pages, or search indexes. Preserve attribution and publish the required terms/privacy disclosures. See Google's [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies).

Persist TaiwanHub-authored content independently. Clicking “Save” or confirming a suggested business does not turn its Google-supplied fields into independently authored TaiwanHub data.

For MVP, resolve a bounded number of saved references on demand through supported UI Kit components. Retain unresolved items in the list with a details-unavailable state; never show expired coordinates as current pins. Map and list must agree about unresolved locations and counts. A later coordinate cache needs provenance, expiry, deletion including geometry/index copies, and refresh behavior within the applicable permission. Large saved collections and provider outages are explicit prototype cases, not an assumed free bulk-resolution capability.

## Application boundary and review rules

Proposed local endpoints, subject to final visibility design:

| Route                                            | Responsibility                                                                                                                                  |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/place-subjects/resolve`            | Authenticated, rate-limited resolution of a catalog ID or provider ID to a stable subject; no client-supplied publication or verification state |
| `GET /api/v1/place-subjects/{id}/reviews`        | Paginated approved reviews and local star aggregate, with authorized own pending state returned separately                                      |
| `PUT /api/v1/place-subjects/{id}/review`         | Upsert the actor's stars/comment using revision checks; create moderation submission in the same transaction                                    |
| `DELETE /api/v1/place-subjects/{id}/review`      | Soft-delete the actor's review and update aggregates consistently                                                                               |
| `POST / DELETE /api/v1/place-subjects/{id}/save` | Idempotent save/unsave; preserve the existing catalog save routes                                                                               |

Start with review and stars moderated together: pending reviews are visible to their author, and only approved reviews count publicly. Editing an approved review returns it to pending and temporarily removes it from the aggregate. Editing a hidden review cannot restore visibility. No stars means no contribution to the average; a place with no approved ratings displays no numerical score. Comment-only reviews are supported by the new editor; existing notes remain intact. The implementation plan adds immutable review history, revision-aware moderation, first-write selection grants, and reviewed city eligibility for layer membership.

Keep routes thin. Put authorization, deduplication, revision conflicts, submissions, and analytics in services with database transactions. Extend moderation types, reporting, and audit behavior for reviews. Add Zod input schemas and database constraints. Render text safely and bound comment length. Do not send user identity, comments, or rating values in Google discovery calls.

## Configuration, cost, and fallback

- Use a dedicated browser API key restricted to allowed website origins/referrers and required Google APIs. It is necessarily visible in the browser; it must not authorize privileged server operations. If a separate server adapter is later needed, keep its credential server-side. Follow [Google's key security guidance](https://developers.google.com/maps/api-security-best-practices).
- Prototype the exact UI Kit components, language behavior, supported release channel, Mapbox markers, and saved-place reopening before finalizing the component integration. Mapbox remains the selected renderer.
- Set API quotas and billing alerts, plus an application feature flag to disable discovery. Alerts are not a hard spending cap. Bound result counts and detail loads; avoid remounting Google components on unrelated React updates.
- Build the budget from actual search, selection, details, and saved-place reopening volumes. UI Kit and raw Places API have different billing models; do not assume autocomplete session pricing covers UI Kit. Verify the selected SKUs at implementation time.
- Keep existing local layers and authored reviews usable during a Google outage. Show provider details as unavailable and preserve the user's draft when requests fail. Do not silently retry paid requests without limits.

## Delivery and acceptance

1. **Discovery prototype:** autocomplete → selected pin → attributed details on the current map, tested on mobile and desktop. Validate keyboard navigation, Chinese input, component availability, billing, and reopening saved IDs. Google project setup and paid live testing require explicit authorization.
2. **Local reviews:** migrate subject/reference/review tables, add APIs and moderation, then connect stars/comments in the selected-place panel. Confirm the chosen audience policy before implementing it.
3. **Collections:** external saves and layer membership, deduplication with existing catalog places, and map/list handling of unresolved locations.
4. **Broader discovery:** explicit area search, quotas/usage monitoring, and gradual rollout behind a flag.

Implementation checks should cover duplicate concurrent creation, two users reviewing one place, ownership, pending/hidden/deleted visibility, correct aggregates, expired coordinates, provider failure, and private/group membership. Use mocked Google responses by default. Run lint, typecheck, affected unit tests, database integration tests, relevant browser flows, and a production build for the new client integration; verify the disposable database before database/browser checks.
