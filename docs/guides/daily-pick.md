# Daily Pick: implementation and operations

Implements the first release of [the Daily Pick design](../plans/daily-pick-layer-design.md): one shared pick per city and city-local day. Personalization and AI-written copy are not part of this release.

The proposed [daily restaurant recommendation implementation plan](../plans/daily-restaurant-recommendation-implementation-plan.md) describes version 2: Greater Houston restaurant discovery, Google quality and hours checks, weekly food variety, a top-10 decision report, LLM-written recommendations, and publication into Discover Houston. It is a future engineering handoff; the behavior below remains the implemented version 1.

## Where it lives

| Concern                                       | Location                                                                                      |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Rules, reasons, bilingual reason templates    | `packages/shared/src/daily-pick.ts` (pure, deterministic, unit-tested)                        |
| Table and migration                           | `daily_pick` in `packages/database/src/schema.ts`; `migrations/0013_daily_morph.sql`          |
| Idempotent job and CLI                        | `packages/database/src/daily-pick.ts`, `daily-pick-cli.ts` (`pnpm daily-pick:generate`)       |
| Public reads (card, history, map integration) | `apps/web/src/features/daily-pick/repository.ts`, `features/map/query.ts`                     |
| Moderator scheduling, replacement, withdrawal | `apps/web/src/features/daily-pick/service.ts`, `/admin/daily-picks`                           |
| UI                                            | `components/daily-pick/daily-pick-card.tsx` (map panel/bottom sheet), `/daily-pick` (history) |

The system layer `daily-pick-{city}` (rule `{"version":1,"kind":"daily_pick"}`, schedule `rolling_today`) is created for existing cities by migration 0013 and for new cities by `ensureSystemLayers`. The existing `today` rule is unchanged.

## Selection (version 1)

Candidates are the city's `approved`, non-demo catalog places with a description of at least 40 characters, a source attribution label, an address and non-zero coordinates. External provider-only places are not candidates yet.

1. Exclude places published as a pick within 30 days of the date (past or already scheduled). If none remain, the window shrinks explicitly to 21, 14, then 7 days; the window used is stored and stated. If nothing qualifies at 7 days, no pick is published.
2. Keep the places whose category, then neighborhood, appeared least often in the previous seven picks.
3. Score documentation (detailed description, Chinese description, source link, hours, non-`UNVERIFIED` status; 10 points each) plus community points, which need at least 3 approved responses and a 60% positive share. Places without votes stay eligible.
4. Break remaining ties with a stable hash of city, date and place ID.

Recorded reasons are only the rules that changed the outcome: a category or neighborhood rotation is recorded only when no recent pick shared it; documentation or community signals only when they separated the winner from another finalist; a tie-break always says it was a fixed rotation, not popularity. The card shows at most two reasons (plus the tie-break when it decided the pick); the full list and evidence stay in `daily_pick.reasons`/`evidence`.

The card's description is the first two sentences of the approved catalog description (Chinese when present, English otherwise). Address, hours, price and the website/source link come from the canonical place and appear only when present. The card always notes that a feature does not mean the place is open today.

## Integrity rules

- A partial unique index allows one `published` row per city and `pick_date`. Every write first takes a transaction-scoped advisory lock on the slot, so concurrent job runs and moderators serialize; the insert also uses `ON CONFLICT DO NOTHING` as a backstop.
- Public reads (map, card, history, API) join the canonical place and require `approved`, non-demo and same city. A stored snapshot never keeps a hidden place visible; history drops it too.
- Re-running the job keeps a visible pick, including an editorial one. If the place became ineligible, the job withdraws the row (reason recorded, `withdrawn_by` null) and publishes a replacement that links to it via `replaces_id`. If nothing qualifies, the card says “Today's pick isn't ready yet.” and may show the previous pick with its own date.
- Moderators can schedule a pick for today or up to 90 days ahead, replace the published pick (the request must name the current pick ID, otherwise `409`), or withdraw a pick. Each action is recorded in `moderation_action` with `entity_type='daily_picks'`. Editorial picks are labeled “Editorial selection” and use the moderator's optional public note, or “Chosen by the TaiwanHub editors.” Past dates cannot be rescheduled.

## Running and scheduling generation

```sh
pnpm daily-pick:generate                 # every city, each for its own local today
pnpm daily-pick:generate houston         # one city
pnpm daily-pick:generate houston --date 2026-10-01   # a future date (never a past one)
```

`--date` must be a real calendar date (`2026-02-30` or `2027-02-29` are usage errors before any database access). When a moderator runs today's selection from `/admin/daily-picks`, any automatic withdrawal, the replacement pick and their `moderation_action` records commit in one transaction; if the audit fails, nothing changes.

The command prints one JSON line (`event: daily_pick_run`, per-city `results` with `created`/`unchanged`/`replaced`/`empty`, and `errors`) and exits non-zero if any city failed. It is safe to repeat and to run concurrently. It makes no network or paid-provider calls; it reads and writes only the configured database, so confirm `DATABASE_URL` points at the intended environment first.

Scheduling is not enabled in this repository. To schedule it, an operator with authorization for the target environment would run the command shortly after local midnight in every city and again later in the day (the second run is a no-op unless the pick became ineligible). For Houston (`America/Chicago`), for example, 06:15 UTC is just after local midnight year-round (00:15 CST, 01:15 CDT), and 12:15 UTC works as the follow-up run. One way is a GitHub Actions workflow modeled on `.github/workflows/mail-outbox.yml` (environment-scoped `DATABASE_URL` secret, `pnpm install --frozen-lockfile`, then `pnpm daily-pick:generate`); adding and enabling it is a separate, authorized change. Moderators can also run today's selection from `/admin/daily-picks`.

## Measurement

Client outcome events (city slug only): `daily_pick_shown` (context, not a success metric), `daily_pick_place_opened`, `daily_pick_saved`, `daily_pick_directions`, `daily_pick_show_on_map`, `daily_pick_history_opened`. Return visits to the layer appear as `layer_applied`/`map_opened` for `daily-pick-{city}`.

## Known limitations

- The catalog has no permanent-closure field. Closed places are excluded only when moderation has hidden, rejected or deleted them; the job does not infer closure from hours or missing data.
- The seeded demo catalog is entirely demo content, so a freshly seeded local database shows the empty state. Tests create their own non-demo fixtures.
- Selection weights are a first release and need tuning against real catalog coverage before launch.
- Category names inside the Chinese reason text use a fixed translation table for the known categories and fall back to the English name.
