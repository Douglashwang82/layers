# Product scope review (2026-10)

The product-designer agent wrote this read-only review on 2026-10-31. The product owner's answers to its open questions are recorded under [Decisions](#decisions-product-owner-2026-10-31), and they override the suggestions where the two differ.

## Headline

LocalLink is currently two products sharing one codebase:

- **Layer MVP** (`FEATURE_MAP_MVP`): personal and group layers built from Google Maps links. All recent work has gone here.
- **Legacy Houston catalog**: places, events, products, organizations, ingestion and Daily Pick. This is still what production serves.

At the time of the review, production was at `902b06f`, local master was 28 commits ahead, and migrations 0023–0030 had not been applied in production. None of the new work had reached users.

## Current scope

The core loop the MVP intends: paste Google links → layer → load several layers on the map → attach events and reviews → share with a group → the group adds more.

| Area                                                                                                | Status                                                                                   | Evidence                                                                           |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Map, layer panel and list fallback                                                                  | Implemented                                                                              | `apps/web/src/app/page.tsx`, `apps/web/src/components/map/map-workspace.tsx`       |
| Layers from Google links                                                                            | Implemented, behind the flag; the live key check (P0) and rollout (P6) are still pending | `apps/web/src/features/google-links`, `docs/plans/layer-mvp-google-links-plan.md`  |
| Custom pins, My Maps KML import, layer collections                                                  | Implemented, behind `FEATURE_LAYER_CUSTOM_PLACES`                                        | `apps/web/src/app/map-import`, `apps/web/src/app/layer-collections`                |
| Instagram caption import                                                                            | Partial: local CLI only                                                                  | `docs/guides/instagram-caption-extraction.md`                                      |
| Layer item events                                                                                   | Implemented, no RSVP                                                                     | `layerItemEvent` table                                                             |
| Layer item reviews                                                                                  | Implemented                                                                              | `apps/web/src/components/layers/layer-item-reviews.tsx`                            |
| Route links to Google Maps                                                                          | Implemented                                                                              | `apps/web/src/components/map/route-planner.tsx`                                    |
| Groups with email-bound invites                                                                     | Implemented; invite links are copied by hand, not emailed                                | `docs/guides/user-guide.md` (U28)                                                  |
| Invite-only membership                                                                              | Implemented                                                                              | `apps/web/src/features/membership`                                                 |
| Catalog places, events, products, sightings, organizations, votes, notes, RSVP, submissions, search | Implemented, but with the MVP on none of it reaches the map                              | `apps/web/src/app/[section]`, `apps/web/src/app/search`, `apps/web/src/app/submit` |
| Daily Pick and restaurant worker                                                                    | Implemented and live; the MVP drops its system layer                                     | `apps/web/src/features/layers/repository.ts`                                       |
| Content ingestion and extraction agent                                                              | Implemented; it only feeds the catalog                                                   | `packages/database/src/feed-agent.ts`                                              |
| Public layer publication with review                                                                | Implemented but unreachable: MVP layer creation only accepts `private`/`group`           | `packages/shared/src/index.ts`                                                     |
| Focus cities, map effects and regions                                                               | Partial, behind flags                                                                    | `docs/plans/map-regions-focus-effects-plan.md`                                     |

## Disconnected, redundant or sprawling

- **Two content models that never meet.** There are two event models (`event` + `eventRSVP` vs `layerItemEvent`), two review systems, and several saved-item tables. The "My saves" projection is a system layer, and the MVP drops system layers, so catalog saves never appear on the map.
- **Five ways to add a place:** Google links, custom pins, My Maps import, the Instagram CLI, and catalog search (hidden in the MVP).
- **Paid pipelines feed nothing users see.** The restaurant worker, Daily Pick and feed extraction produce content that the MVP map doesn't show.
- **Orphaned entry points.** `/places`, `/events`, `/products`, `/organizations`, `/search`, `/submit/*` and `/saved` still render, but nothing in the navigation highlights them. The library's "Discover" tab lists public layers, which the MVP cannot create.
- **Map polish is running ahead of the loop.** Pet markers, mascot motion, themes, hover photo cards and Tabelog links improve a loop most people can't enter yet.

## Gaps that block the loop

1. **Signed-out visitors see an empty map,** and the only call to action is to sign in. Membership is invite-only, and a shared `/layers/<slug>` link shows nothing to a non-member, so the share step ends at a wall.
2. **Inviting a friend takes three hand-offs:** nominate them, wait for a reviewer to admit them, then copy a group invite link and send it yourself.
3. **No reason to come back.** There are no notifications (deferred in `docs/reference/future-roadmap.md`), and the MVP hides Daily Pick.
4. **The first run is "paste links"** with nothing pre-filled.
5. **Activation isn't measured.** Nothing tracks the funnel invited → admitted → first layer → first group share → second member contributes.

## Prioritized suggestions

| #   | Suggestion                                                                                                                                                                                                                                     | Effort |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | **Decide on the MVP and ship it.** Make the go/no-go call on `FEATURE_MAP_MVP`, run P0 (live key and pricing) and P6 (migrations 0023–0030, flag on). Pause new map polish until this is done.                                                 | S      |
| 2   | **Read-only shared layer view.** An opt-in "anyone with the link can view" audience per layer, with a revocable token checked on the server and a "shared by X" label. Keep it separate from reviewed public publication.                      | M      |
| 3   | **One-step "invite to group."** A group owner enters an email. If the person isn't a member, a nomination tied to that group is created. Admission accepts the group role automatically and the invite is emailed through the existing outbox. | M      |
| 4   | **Daily Pick as a followable MVP layer.** Allow this one system layer in the MVP picker and add "Add to my layer" from a pick. Drop the other system layers.                                                                                   | S–M    |
| 5   | **Weekly group activity digest.** An opt-in email of real activity only: new places, reviews and events in your groups. Defer push notifications.                                                                                              | M      |
| 6   | **One "Add places" sheet** with Google link, My Maps file and pin tabs. Fold `/map-import` and `/layer-collections` into the layer workspace. Keep Instagram import as an operator-only tool.                                                  | M      |
| 7   | **Declare the catalog legacy.** While the MVP is on, hide catalog routes from navigation and the sitemap and pause ingestion and feed-agent runs. Write an ADR on how to reconcile the two event models.                                       | S      |
| 8   | **Activation funnel and a first-run starter.** Track the funnel steps, and offer "Start from Daily Pick or your group's layer" next to "Paste links".                                                                                          | S      |

### Cut or defer

- **Cut from product scope:** Instagram caption import, products and sightings, organization follows, catalog votes and notes, and `/submit/*` for the MVP audience.
- **Defer:** map effects and regions, mascot and sign-in motion, theme variants, Tabelog expansion, and recurring events. Focus cities (Taipei, Tokyo, Houston) stay in scope; see Decisions.
- **Pause:** ingestion and feed-agent runs for as long as the catalog doesn't reach the map.

## Recommended focus (next 4 weeks)

- **Week 1:** suggestions 1 and 8.
- **Weeks 2–3:** suggestions 2 and 3, so that "make a layer, share it, a friend joins" works end to end.
- **Week 4:** suggestion 4, then measure.

Build nothing new for the catalog or map visuals until about 10 real groups each have had at least two contributors in the same week.

## Decisions (product owner, 2026-10-31)

1. **The layer MVP is the product. The catalog is legacy.** Suggestion 7 goes ahead: hide catalog routes, pause ingestion and feed-agent runs, and write an ADR on how to reconcile the event models.
2. **Group owners can admit people directly.** Suggestion 3 becomes simpler: inviting someone to a group by email also admits them as a member when they accept, with no separate reviewer step. Invitations stay bound to the email address. Membership review remains for nominations that don't come through a group.
3. **A revocable link-view audience is acceptable.** Suggestion 2 goes ahead as described.
4. **Launch with three cities: Taipei, Tokyo and Houston.** The "Houston only" deferral is withdrawn. The focus-cities work is in scope for launch, and first-run, empty-state and starter content need to work in all three cities.
