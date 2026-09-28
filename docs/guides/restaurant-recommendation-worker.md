# Restaurant recommendation worker

The restaurant pipeline is available under `/admin/restaurant-picks`. It uses a durable queue: HTTP actions curate candidates, review copy, and enqueue preparation/publication. The worker performs provider calls. Events and Taiwan keyword weighting are excluded.

## Local verification

Apply migrations with `pnpm db:migrate` only after checking that `DATABASE_URL` names the intended disposable database. Unit, integration, and browser tests inject fake providers and never use paid APIs. The browser regression `tests/e2e/restaurant-picks.spec.ts` covers queue preparation, report review, copy approval, publication, Discover, saves, withdrawal, and the Traditional Chinese mobile screen.

`pnpm daily-pick:restaurant:worker CITY --fixtures FILE.json --date YYYY-MM-DD` uses deterministic local fixtures and writes drafts/jobs to the configured **local development database**. It rejects production and remote database hosts. Fixture JSON maps provider IDs to `{ "rating": 4.6, "ratingCount": 120, "businessStatus": "OPERATIONAL", "hours": [{ "date": "2026-09-27", "periods": [{ "open": 600, "close": 1320 }] }] }`. This is database-backed testing, not a side-effect-free simulation.

## Live configuration (disabled by default)

The [pending provider ADR](../adr/daily-restaurant-recommendation-phase0.md) must be approved for the billing account and target environment before live activation. This code does not authorize paid calls, production migration, or deployment.

Set server-only `GOOGLE_PLACES_SERVER_API_KEY`, `ANTHROPIC_API_KEY`, and an explicitly approved `DAILY_PICK_LLM_MODEL`. Set `FEATURE_RESTAURANT_DISCOVERY_WORKER=true` and `RESTAURANT_PROVIDER_POLICY_APPROVED=true` only in the approved worker environment. The browser Places UI Kit key is separate.

Create the area's `restaurant_discovery_area` row initially disabled, with `city_slug='houston'`, `layer_slug='discover-houston'`, `timezone='America/Chicago'`, and a versioned configuration containing:

- `providerPolicyApproval`: reference to the approved account-specific decision.
- `areaRectangle`: approved `low`/`high` latitude and longitude bounds; no inferred boundary is enabled by this implementation.
- `queryGroups`: approved neighborhood/suburb search groups across Greater Houston.
- `discoveryBudgetPerRun`: 1–100 requests; runtime makes one search page per group and rotates groups by date. Google search is a bounded sample, never an exhaustive list.
- `qualificationBudgetPerRun`: 1–200 candidates. A deterministic daily rotation chooses the evaluated cohort when the pool exceeds this limit.
- Optional rule overrides: `minRating` (default 4.3), `minRatingCount` (30), `foodRotationDays` (6), `restaurantRepeatDays` (30), and the other validated shared rule fields.
- Optional auto mode (see ADR section 2a items 7-8): `autoApproveDiscovered: true` approves discovered restaurants whose Google primary type maps to a food type, confirming their city from the search rectangle. `requireEvidence: false` lets candidates without two approved facts qualify, with fixed template copy instead of model copy. Copy approval stays mandatory.

Enable the area only after its geography, candidate approval process, retention policy, model, and billing caps have been reviewed. Configure account-level daily/monthly quotas and billing alerts before rollout; application limits currently bound each run, not cumulative monthly spend. Bump `config_version` when changing configuration; pending runs then require new preparation.

`pnpm daily-pick:restaurant:worker houston` schedules today once, then drains up to ten queued jobs. The checked-in workflow runs at 06:15 and 12:15 UTC when explicitly enabled via `RESTAURANT_WORKER_ENVIRONMENTS` and `RESTAURANT_WORKER_ENABLED`. An operator can run the command to process approved publication immediately. Until a worker runs, admin requests remain queued; the UI does not promise immediate publication.

## Review and recovery

Discovery stores provider identities, not a Google business-content cache. Outside auto mode, newly found candidates require a reviewed city association, primary food type, and at least two approved independent facts. Use consistent taxonomy labels such as `tacos`, `pizza`, `sushi`, `ramen`, `barbecue`, and `burgers`. Google reviews and summaries must not be pasted into independent evidence.

Queue preparation, refresh the admin screen after the worker finishes, and inspect the top-ten report and both languages. The report covers only the evaluated cohort. Failed provider calls block selection; unknown ratings/hours fail eligibility. Review drafts survive repeated scheduler calls. Reject or discard a draft before preparing a replacement. Copy approval is mandatory in this pilot; `FEATURE_RESTAURANT_AUTO_PUBLISH` does not bypass review.

Queue publication after approval. The worker refreshes provider data, then checks candidate/evidence/provider identity, configuration, copy approval, and committed history under transaction locks. Stale data, concurrent same-food selection, and changed replacement IDs block publication. The previous published pick remains intact on failure. A successful transaction creates the pick, audit, and Discover membership together. Past winners remain in Discover; the Daily Pick layer and badge follow the city's local date. Withdrawal preserves independently curated items and other picks' memberships. Canceled future reservations do not consume historical rotation; actual past features still do.

Queued/running/succeeded/failed jobs and sanitized outcomes are visible in the admin screen. Expired jobs fail visibly; a moderator can queue a retry. Preparation leases may be reclaimed after expiry, with report writes fenced by the current lease. Missing food classification in recent legacy history blocks preparation until reviewed.

## Current limits

The delivered workflow is a human-reviewed pilot. Automatic copy approval, account-wide monthly spend accounting, per-field retention/deletion automation, automatic food classification, and production rollout remain separate work. Per the approved Phase 0 ADR, Google rating/hour data stays transient: the durable report stores rank, decision, and reason codes, and no score. The local tune script recomputes scores from its fixtures.

Provider normalization follows the official [Place opening-hours reference](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places#OpeningHours) and [Text Search documentation](https://developers.google.com/maps/documentation/places/web-service/text-search). Current hours cover the provider's seven-day window, including exceptions and truncated overnight periods; missing or out-of-window dates fail closed.
