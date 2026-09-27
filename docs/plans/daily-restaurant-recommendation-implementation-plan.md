# Daily restaurant recommendations: engineering implementation plan

Status: proposed implementation handoff; no application behavior changed. Updated September 27, 2026.

This plan extends the implemented [Daily Pick](../guides/daily-pick.md) into a daily restaurant recommendation for Greater Houston. It supersedes the older [Daily Pick design](daily-pick-layer-design.md) only for the version 2 restaurant pipeline described here. Existing version 1 history remains valid historical data.

## 1. Product contract

### Agreed requirements

- Build a restaurant candidate pool for Greater Houston, including Houston, Katy, Sugar Land, Pearland, and surrounding communities. Events are deferred.
- All cuisines can qualify. Do not require, prefer, or score the keyword Taiwan or Taiwanese identity.
- Target daily Google Places discovery. Treat search results as incomplete discovery, never an exhaustive inventory of all restaurants.
- Require a good Google rating before a restaurant can win.
- Do not repeat a food type within a week.
- Require available opening hours showing that the restaurant serves customers on the selected day.
- Produce strong, factual LLM-written recommendation sentences.
- Show the top 10 considered candidates, identifying the winner and explaining why every other candidate was not picked.
- Publishing the winner must also include it in the area's public discovery layer: `discover-houston` for Houston.

### Working defaults for implementation

These make the design executable; numeric thresholds and presentation choices were proposed during design, not individually specified by the product owner. Keep them versioned and configurable. Product should review them during fixture acceptance, without blocking development of the core pipeline.

| Decision          | Version 2 default                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Week              | Rolling seven calendar days in `America/Chicago`: compare target date D with D-6 through D-1. Monday tacos may next appear the following Monday. |
| Rating gate       | Google rating >= 4.3 and rating count >= 30; missing either fails qualification. No such filter at initial discovery.                            |
| Restaurant repeat | At least 30 calendar days between features of the same canonical restaurant; no shrinking to 21/14/7 days.                                       |
| Hours             | At least one service interval on the target date, and some service remains when publishing today. No minimum meal duration initially.            |
| Copy              | Two or three sentences, in English and Traditional Chinese, supported by approved evidence.                                                      |
| Top-10 audience   | Moderator/admin report initially; public visitors see the winner. A public shortlist is a later product decision.                                |
| Layer retention   | Earlier winners remain in Discover while publicly eligible; only the current local day's winner receives the Today's Pick badge.                 |
| Editorial picks   | Must pass the same hard gates; moderator preference may override ordering, not rating, hours, food-repeat, or visibility requirements.           |
| Empty outcome     | Publish no new pick and explain the failed gates. Never weaken requirements silently.                                                            |
| Ranking           | Deterministic rating-volume adjustment, then stable daily tie-break; no LLM ranking.                                                             |

The word "good" refers to meeting the configured evidence threshold, not a guarantee of dining quality. Google and TaiwanHub ratings remain distinct.

## 2. Current implementation and required changes

Verified against source on September 27, 2026.

| Existing implementation                                                                                                                                                | Required change                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/daily-pick.ts` ranks approved catalog places using documentation, community votes, category/neighborhood rotation, and a shrinking repeat window. | Add version 2 pure eligibility/ranking/report contracts; preserve version 1 rendering/history. Do not reuse documentation length as restaurant quality.         |
| `packages/database/src/daily-pick.ts` reads catalog places and publishes under a city/date advisory lock.                                                              | Add candidate discovery, run lifecycle, current provider qualification, subject identities, and region-wide publication serialization.                          |
| `daily_pick.place_id` is required and references `place`.                                                                                                              | Add subject-backed picks using an additive migration and explicit identity constraints.                                                                         |
| `place_subject` and `place_provider_reference` hold catalog/external identities, provider aliases, city review, and status.                                            | Reuse these identities; never construct fake catalog places from Google payloads.                                                                               |
| `apps/web/src/features/map/query.ts` implements Discover as a rule containing public catalog content.                                                                  | Preserve that behavior and union approved daily-winner memberships.                                                                                             |
| `apps/web/src/features/map/external.ts` skips system layers after the saves special case.                                                                              | Add narrowly scoped handling for Discover and Daily Pick; do not expose every system-layer external reference.                                                  |
| `apps/web/src/features/place-subjects/repository.ts` has a broad system-layer branch in visibility checks.                                                             | Require the appropriate public layer state, matching area, reviewed city, and active subject for new system memberships. Audit all subject/review access paths. |
| Public Daily Pick card/history/API/save helpers assume a catalog place.                                                                                                | Introduce catalog/external subject projections throughout the card, history, detail, save, directions, and map flows.                                           |
| Google UI Kit resolves external display data transiently and can be used with Mapbox.                                                                                  | Preserve that rendering route. A server Places API adapter does not grant permission to render its payload on Mapbox.                                           |
| `/admin/daily-picks` supports generation, editorial scheduling, replacement, and withdrawal.                                                                           | Extend it with candidate curation, run status, top-10 explanations, and safe publication controls.                                                              |
| Generation CLI exists; no daily-pick scheduler is checked in.                                                                                                          | Add an environment-gated worker/workflow after the provider and paid-pilot decisions.                                                                           |

Also read [architecture](../reference/architecture.md), [database contracts](../reference/database.md), [API contracts](../reference/api.md), and the [Google Places implementation plan](google-places-implementation-plan.md). Do not alter `docs/dev-notes.md`.

## 3. Phase 0: settle provider feasibility and configuration

Owner: backend/platform lead with product and the organization's provider-contract owner.

This is a real dependency, not an assumption that API access permits a citywide collector. Engineers can start migrations, deterministic rules, fake adapters, and UI fixtures while this phase is open. Production discovery, provider-derived scoring, persisted reports, and publication must wait for an approved usage design.

### Provider facts affecting the design

- Text Search is ranked, limited, and can vary between identical requests. It currently caps a query at 60 results across pages. Use geographic restrictions for categorical searches and explicit field masks; do not promise completeness. [Text Search documentation](https://developers.google.com/maps/documentation/places/web-service/text-search)
- Google terms restrict bulk downloading, prefetching, and retaining Places content. The Place ID exception does not, by itself, authorize the entire proposed background collection workflow. Confirm daily automated discovery and selection under the account's applicable terms. [Platform terms, section 3.2.3](https://cloud.google.com/maps-platform/terms)
- Place IDs can be retained; names, ratings, reviews, addresses, and full responses must not be treated as an unrestricted permanent catalog. Confirm whether derived scores, reason codes, historic pass/fail decisions, and query-to-place associations may be retained for this use. [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies)
- Ordinary Places API content cannot be used with a non-Google map under the cited service-specific terms. Places UI Kit has a separate permission covering non-Google maps. Keep the existing UI Kit path, and confirm that the proposed server qualification/display separation is permitted; separation alone is not a contractual exemption. [Service-specific terms, sections 14–15](https://cloud.google.com/maps-platform/terms/maps-service-terms)
- `rating`, `userRatingCount`, `businessStatus`, and `currentOpeningHours` support the proposed checks. Current hours cover seven days including today and special hours. [Place resource](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places)

### Required deliverables

1. Write a short ADR specifying allowed discovery, evaluation, map/display, LLM-input, retention, and deletion behavior for the actual Google billing region/account. Record field-by-field retention and attribution requirements. Resolve durable decision metadata explicitly; do not hide a provider-data archive inside JSON evidence, scores, logs, or model prompts.
2. Supply a versioned Greater Houston area configuration, with independently sourced geographic boundaries and included communities. Proposed review list: Houston, Katy, Sugar Land, Pearland, Missouri City, Stafford, Cypress, Spring, The Woodlands, Humble, and Baytown. Product must confirm the exact boundary; this list is not an assertion that all are already approved. Keep `city=houston`, timezone `America/Chicago`, and destination layer `discover-houston` for this rollout.
3. Define approved search rectangles/query groups covering the area and a bounded rotation across them. Do not split requests to defeat API limits or perform exhaustive harvesting. Do not run point-in-polygon analysis on Google coordinates; establish durable area membership from independently licensed evidence and local review.
4. Supply daily/monthly request and spend limits, provider quota settings, and an approved LLM model ID. Verify current provider documentation and installed SDK types before adapter implementation. Do not guess model names or reuse the browser key for server requests.
5. Specify which report facts can be retained. Prefer durable TaiwanHub decisions plus live attributed provider details. If exact historic rating/hours snapshots are not permitted, show that limitation explicitly and never label freshly fetched values as the values used at selection time.

If the proposed automated Google workflow cannot be approved, retain this product requirement as blocked and seek a permitted provider agreement or a product-approved sourcing change. Do not silently replace Google quality checks with another metric or call user-triggered discovery equivalent to daily discovery.

Exit: ADR and configuration approved for the pilot, with provider costs and operational limits documented. No live API run is part of writing this plan.

## 4. Phase 1: identities, discovery, and the candidate pool

Owner: backend/data engineer. Depends on Phase 0 for live integration; fake adapter work can start immediately.

### Identity and curation

- Upsert by `(provider, provider_place_id)` using existing subject/reference transactions. Superseded provider IDs must resolve to the same subject. Do not merge separate branches just because names match.
- A candidate is not automatically public. Discovery may create an unreviewed subject; publication requires existing city/area review and an active candidate with approved evidence.
- Maintain one reviewed primary food type per restaurant. Starter vocabulary: tacos, pizza, sushi, ramen, barbecue, burgers, hot pot, dim sum, pho, seafood, steakhouse, Indian meals, Mediterranean meals, and an expandable set of equally specific categories. Avoid a catch-all "Asian" category. Unknown/mixed cases remain pending review.
- Use official menus, owner submissions, or other permitted independent sources for classification. An LLM may suggest a category, but a reviewer approves it. Store vocabulary version and provenance. Lock classification for an in-progress run; historical selections retain their category snapshot so relabeling cannot erase a repeat conflict.
- Do not require Chinese descriptions, existing community votes, or Taiwan-related names. Food type, approved facts, and location evidence are curation inputs, not scraped Google content.

### Discovery worker

1. Claim a bounded area/day discovery run.
2. Execute the approved broad restaurant searches across configured area groups, without cuisine-specific or Taiwan-specific preference. Rotate area groups fairly when the approved budget cannot cover all in one day.
3. Follow permitted pagination within the request budget. Persist only fields/associations authorized in Phase 0.
4. Deduplicate results into the candidate pool, preserving exclusions, food classifications, and review decisions. A missing search result does not mean closed or deleted.
5. Record query-group success, truncation, failures, request count, and discovery counts without raw payloads or secrets.

Distinguish deliberate search-result truncation and rotating coverage from unexpected failures. A daily run can be successful for its configured scope without claiming coverage of Greater Houston. Transport/auth/quota failures mark it partial or failed. Default: unexpected partial discovery requires review before that run publishes a new pick; it never erases the last good pool.

Acceptance: reruns and concurrent upserts do not duplicate subjects; aliases converge; hidden/excluded subjects remain excluded; all cuisines have a discovery path; query budgets stop additional requests; failed discovery preserves prior candidates; candidate references remain private until publication eligibility is satisfied.

## 5. Phase 2: qualification, food rotation, and selection

Owner: shared-domain/backend engineer. Core is a pure deterministic function receiving normalized, validated inputs and an explicit clock/date.

### Qualification order

Evaluate every candidate in the declared run scope and record all applicable exclusion codes. The primary displayed reason uses this priority:

1. Visibility/area: active, non-demo, reviewed Greater Houston restaurant; linked catalog place must also be approved. Never surface hidden/private candidates in public outputs.
2. Google quality: current numeric rating >= configured minimum; numeric rating count >= configured minimum. Missing/unavailable data is `quality_unknown`, not zero stars.
3. Business status and date-specific hours: operational, known service interval on target date, with service remaining if publishing today.
4. Approved primary food type and sufficient approved independent facts for a recommendation.
5. Food rotation: no matching primary food type within six calendar days of another committed feature. For scheduled future picks, check D-6 through D+6, excluding the target slot being replaced, so publication order cannot introduce a later conflict.
6. Restaurant repeat: no same canonical subject within 30 days of another committed feature, checking scheduled dates in both directions. Preserve this rule across catalog links and provider ID changes.

No automatic relaxation of any hard gate. Keep discovery candidates that fail quality; their rating may later change. Ordinary closing time at night does not retroactively invalidate a restaurant that served customers that day.

### Hours normalization

- Use date-bearing intervals and IANA timezone calculations, not server timezone or weekday strings alone. Normalize overnight and 24-hour periods, split intervals, missing endpoints, special dates, and DST boundaries.
- Prefer `currentOpeningHours`; do not silently substitute regular weekly hours when date-specific data is missing. Missing/malformed hours fail closed for automatic selection.
- For today, require an interval intersecting `[max(now, startOfDay), endOfDay)`. A dinner restaurant qualifies at 06:00; a breakfast restaurant already finished for the day does not qualify for a late replacement.
- Refresh the finalist's rating/status/hours before committing. Proposed maximum age at publication: 30 minutes, or a stricter interval required by Phase 0. This is freshness for in-memory evaluation, not permission to cache the response for 30 minutes.
- Existing future editorial scheduling up to 90 days must change: dates outside reliable provider-hours coverage become drafts only. Validate and publish when current date-specific hours are available. Never guess holiday hours.

### Ranking eligible candidates

Initial configurable heuristic:

```text
qualityScore = (ratingCount * googleRating + 50 * 4.2) / (ratingCount + 50)
```

The 4.2 prior and weight 50 are tuning defaults, not measured Houston statistics or a formal confidence interval. This score reduces the influence of tiny samples. Compare at full precision, then break exact ties with the existing stable hash of area/date/canonical subject ID. Do not let raw review count independently overpower the adjusted score. Validate new-restaurant and established-restaurant behavior on fixtures before pilot.

No undocumented boosts for cuisine, Chinese copy, neighborhood, sponsorship, or LLM enthusiasm. Future fairness improvements require a new rule version and offline comparison.

The winning restaurant must also pass copy validation in Phase 4. If the highest-ranked candidate cannot produce grounded copy, record `insufficient_evidence` or `copy_failed`, then attempt the next eligible candidate, with at most three candidate copy attempts per run. Technical provider failures affecting qualification are not low scores.

### History and concurrency semantics

- A committed feature consumes its food-type/restaurant rotation window even if withdrawn later; withdrawal cannot be used to reset rotation. Unpublished drafts and canceled future reservations do not consume a historical window.
- Exclude the replaced row when evaluating its replacement. Re-evaluate conflicts for all retained future reservations. Snapshot food type and canonical subject at publication; identity reconciliation must still find the same restaurant.
- Serialize commit-time validation with an area-level advisory lock, not only the current city/date lock: two jobs for adjacent dates must not both publish the same food type. Keep the unique published city/date index as a second guard.
- Version 1 history participates in restaurant repeat checks. Backfill recent primary food types from approved local evidence before enabling version 2; if a relevant past feature cannot be classified, hold activation for review rather than assuming no conflict.

Acceptance: fixtures cover Monday-to-Sunday exclusions and next-Monday eligibility, year/DST boundaries, future reservations, reclassification, aliases, 30-day boundaries, rating threshold equality, missing data, overnight hours, and no eligible candidates. Identical input produces identical winner and reasons.

## 6. Phase 3: the top-10 decision report

Owner: backend + admin frontend engineers. The report explains this run's evaluated pool, not the ten best restaurants in Houston.

### Exact shortlist algorithm

1. Compute a base order across evaluated, admin-visible candidates using the rating-volume score where available, then deterministic tie-break. Candidates with unknown rating data sort after those with known scores. Hard daily exclusions do not remove candidates from this explanation pool.
2. Choose the winner from fully qualified candidates, including successful copy validation.
3. If there is a winner, put it in report position 1 and append the first nine other candidates in base order. If there is no winner, show the first ten in base order.
4. Show `baseRank`, `eligibleRank` where applicable, and report position separately. A higher-rated excluded restaurant may appear below the winner; explain this instead of implying it had a lower quality score.
5. Never pad with invented entries. Label fewer than ten honestly. Show pool size, evaluated count, pending count, excluded count, and coverage completeness.

Do not truncate evaluation to ten before choosing a winner: candidate 11 may be the first eligible one. If budgets require bounded evaluation, select a deterministic, documented rotating cohort, label the report's scope, and distinguish unevaluated candidates from rejected ones. Do not claim global optimality beyond that cohort.

### Report row contract

- Subject/provider reference, food type and taxonomy version; display name from permitted local data or a live attributed provider component.
- `decision`: `picked`, `eligible_not_picked`, or `excluded`; candidates not evaluated have a separate pool status, not a fake report decision.
- Structured reason codes and English/Traditional Chinese templates. Examples: `rating_below_minimum`, `rating_count_below_minimum`, `quality_unknown`, `not_operational`, `hours_unknown`, `closed_on_date`, `service_finished`, `food_type_unknown`, `food_type_recent`, `restaurant_recent`, `area_unreviewed`, `insufficient_evidence`, `copy_failed`, `lower_quality_score`, `rotation_tie_break`, `editorial_selection`.
- Supporting local decision metadata: conflicting feature date/type, configured thresholds, run date, rule version, evidence references, and comparison outcome, only as permitted by Phase 0.
- Display rating/count/hours when permitted, labeled with their source and retrieval time. A live value differing from selection-time evidence must not rewrite the saved decision or masquerade as historical evidence.

Generate all decision reasons from actual engine branches. The LLM does not decide rejection reasons. Save all gate failures, show a primary reason plus expandable details, and state the decisive comparison for eligible losers. Never claim a restaurant won "by quality" if a tie-break or editorial override selected it.

Acceptance: winner is always included, excellent-but-closed alternatives appear when they rank in the shortlist, each entry has a truthful explanation, no-result runs still have diagnostics, and the admin report cannot be read by anonymous/non-moderator users.

## 7. Phase 4: grounded bilingual recommendation copy

Owner: backend/LLM engineer with editorial review. Reuse the installed Anthropic SDK infrastructure where practical; implement a separate adapter, not a call to the live extraction CLI.

Input: approved independent facts, source references, reviewed food type, public editorial context, and allowed decision metadata. Do not send Google reviews, Google summaries, private/group reviews, credentials, or bulk provider responses to the LLM. Google rating/hours can remain separate attributed UI elements. Only public, approved, permission-compatible TaiwanHub contributions may be used.

Output schema: English text, Traditional Chinese text, sentence-level fact IDs, and a prompt/model version. Require two or three sentences per language, with a practical length cap (proposed 500 characters per language). Do not add HTML. Copy should identify a distinctive offering, a supported dish/specialty, and a supported reason to visit; it need not invent an occasion when none is documented.

Controls:

- Treat all source text as untrusted data, segregated from instructions. No tools or arbitrary URL fetching by the copy model.
- Validate unknown output with Zod, enforce fact-ID membership, lengths/languages, and reject unsupported superlatives, invented dishes/prices, personal tasting claims, and invented popularity. Schema validation alone is insufficient; use a factual-review rubric and human review in the initial pilot.
- Keep source fetching, if needed, in the existing approved-source workflow with public HTTPS checks, redirect/DNS validation, byte/time limits, and source permissions. New website scraping is not a prerequisite for the first mocked release.
- Bound calls, output tokens, concurrency, and retries. Allow one repair attempt for invalid output within the per-run copy budget. Cache only copy/evidence that TaiwanHub is entitled to retain, keyed by evidence revision, language, and prompt version.
- Initial pilot requires moderator copy approval. Once fixture and pilot accuracy are accepted, separately enable automatic publication of validated copy. This preserves the existing review requirement for model-generated new content.
- A failed LLM run leaves a draft/report and does not silently publish template copy labeled as AI-generated. An explicitly labeled editorial replacement may be used through the moderator flow. Preserve an already valid published pick.

Acceptance: mocked cases cover invented facts, mismatched evidence IDs, injected source instructions, HTML, unsupported Chinese additions, timeouts, malformed output, and exhausted budget. Review at least 20 representative permitted fixture descriptions against a rubric: factual accuracy, specificity, usefulness, bilingual consistency, and absence of unsupported praise.

## 8. Phase 5: atomic publication into Discover Houston

Owner: backend + map/frontend engineers.

### Durable identity and membership

Extend `daily_pick` with required canonical `subject_id` for version 2. Backfill subjects for existing catalog picks. Keep `place_id` for legacy compatibility, nullable for external picks. Enforce that every pick has a subject after backfill and that non-null catalog references agree with that subject through controlled writes and appropriate database integrity checks. Retain existing publication uniqueness and withdrawal history.

Use existing `layer_item` membership for external winners in the specific Discover system layer. Add an explicit daily-pick membership provenance relation linking pick, layer, and item; ordinary users cannot edit system memberships. For catalog-linked winners, keep the existing rule-derived Discover membership and attach feature metadata without adding a duplicate map/list row.

Do not introduce separate suburban city slots for this release. Reviewed Katy/Sugar Land/Pearland candidates belong to the Houston recommendation area and publish to `discover-houston`. Keep broader area membership separate from claims of being physically inside Houston city limits.

### Publication transaction

Perform provider requests and LLM work outside database locks. Use a lease/idempotency key to avoid duplicate expensive preparation. Then in a short transaction:

1. Acquire the area advisory lock and target slot lock in a documented consistent order. Recheck lease ownership, configuration version, evidence/classification revisions, current visibility, fresh qualification, and rotation history.
2. Revalidate expected current pick ID. If inputs changed, abort and recompute; return a revision conflict rather than publish stale results.
3. Withdraw the replaced pick when applicable, retaining its audit and report.
4. Insert the new pick, link the completed run/report and approved copy, and idempotently add the Discover membership/provenance.
5. Write moderation/operational audit and transactional analytics. Commit all together. A layer or audit failure must leave no newly published pick.

Rerunning a completed slot keeps the current valid winner and does not redo paid preparation unnecessarily. An explicit revalidation operation can check continued visibility/provider status; ordinary end-of-day closing does not trigger churn. A withdrawal/replacement requires a recorded reason.

### Public projection and cleanup

- Discover continues showing its existing approved content, plus valid daily-winner external memberships. The non-selected nine remain absent unless independently public for another reason.
- Show Today's Pick and the recommendation on the current winner in both map and list. Past dates receive dated feature metadata, never today's badge. The separate Daily Pick layer and history route remain supported.
- Future scheduled picks are reservations, not early public recommendations. Gate their membership provenance and public copy by the target day's local start; set external membership validity accordingly. Existing independently public listings remain visible, but future feature badges/copy do not. Requalify the reserved winner on its actual day before activating its feature; a reservation alone is not evidence of current hours.
- Use existing UI Kit components for live Google details and external coordinates; keep list fallback for unavailable/unresolved details. Do not fabricate coordinates or leak server Places payloads to Mapbox.
- Deduplicate catalog/subject aliases across Discover, Daily Pick, saves, and other applied layers. Preserve canonical save behavior and directions attribution.
- Recheck canonical visibility, subject city review/area, layer approval/lifecycle, and publication status on every public read. Extend subject-detail and review-scope authorization to recognize approved system membership without granting blanket access.
- Past winners remain in Discover while eligible. Withdrawal removes only the membership contribution from that pick; keep the item if another valid historical pick or independent curation still supports it. A hidden subject always disappears publicly. Do not delete saves, reviews, other layer memberships, or history as a side effect.
- Catalog linking/provider-ID replacement must reconcile pick references and membership provenance transactionally. Existing link logic that moves `layer_item.subject_id` to `place_id` needs regression coverage.

Acceptance: winner appears once in public Discover map/list and Daily Pick, older winners persist without today's badge, candidates stay private, hidden subjects disappear everywhere, an unresolved provider still allows an honest list fallback, and any transaction failure rolls back the complete publication.

## 9. Proposed persistence and API changes

These are proposed names/contracts, not existing tables or endpoints. Use Drizzle schema changes and generated additive migrations; review SQL, snapshot, and journal together.

| Entity                        | Responsibilities and constraints                                                                                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `restaurant_discovery_area`   | City/layer linkage, IANA timezone, configuration/boundary version, approved query groups, budgets, enablement. Immutable version snapshots for runs.                               |
| `restaurant_candidate`        | Unique `(area_id, subject_id)`, candidate state, discovery timestamps, reviewed food type/version, local evidence revision, exclusion notes. No Google business-content cache.     |
| `restaurant_evidence`         | Permission-compatible independent facts, source URL/label, checked time, approval/actor/revision, and use permissions. Do not store fabricated verification.                       |
| `restaurant_discovery_run`    | Area/day/attempt, lease, configured coverage, success/partial/failure, counts, sanitized errors.                                                                                   |
| `daily_pick_run`              | Area/date/attempt, rules/config versions, lifecycle, evaluated scope/counts, copy status, reviewer, final pick ID, retry links and safe error codes.                               |
| `daily_pick_run_candidate`    | Unique `(run_id, subject_id)`, ranks, decision, reason codes, permitted local evidence, report position. Retention depends on Phase 0. No raw provider response JSON.              |
| `daily_pick` additions        | Subject/run reference, food-type snapshot, evidence/copy/model versions, publication qualification timestamps, optional link to approved copy artifact. Preserve existing history. |
| `daily_pick_layer_membership` | Pick/layer/item provenance with unique keys and restrictive FKs so withdrawals and catalog links do not orphan membership.                                                         |

Provider data lives in validated transient evaluation objects by default. Never reuse `place.external_rating` or existing JSON evidence columns as an undeclared Google cache. If Phase 0 cannot authorize required historic decision fields, redesign the report before rollout and state the resulting audit limitation.

Proposed run lifecycle: `queued -> discovering -> evaluating -> writing -> ready_for_review -> ready_to_publish -> published`, with explicit `empty`, `partial`, `failed`, `superseded`, and `canceled` outcomes. Discovery can finish as a separate run before evaluation begins. Recovery requires an expiring lease and compare-and-swap ownership; attempts remain auditable. A recovered worker must not publish after losing its lease.

### HTTP and CLI contracts

- Preserve public `GET /api/v1/daily-pick` and history behavior; add a versioned/discriminated catalog-or-subject payload, attribution requirements, and `hoursAsOf` when allowed. Never return candidate reports publicly by accident.
- Extend moderator APIs under `/api/v1/admin/daily-picks` with proposed `runs`, `runs/:id`, `runs/:id/candidates`, `runs/:id/publish`, and candidate-review operations. Run creation returns `202` plus a run ID; avoid provider/LLM work inside a request timeout. The existing generate action queues the version 2 run when enabled.
- Keep moderator authorization inside services, Zod input validation, server-derived actor, CSRF/origin protection, rate limits, revision checks, and idempotency keys for mutations.
- Add a proposed `pnpm daily-pick:worker` command for leased work and scheduler orchestration. Retain `daily-pick:generate` compatibility: version 1 runs only for non-enabled areas; enabled version 2 areas queue/use the new pipeline. Never silently fall back to version 1 when version 2 fails.
- Provide an offline fixture/simulation mode with no network and no production writes. A mode that makes paid provider calls must not be advertised as offline or side-effect-free.

## 10. Phase 6: scheduling, operational controls, and rollout

Owner: platform engineer with QA/product.

Proposed new gates (default false; add to the existing `apps/web/src/lib/config.ts` pattern and `.env.example` during implementation): restaurant discovery worker enabled; daily restaurant version 2 enabled per area; automatic publication enabled. Coordinate with existing Google discovery/external-collection flags so disabling provider display has a usable fallback.

Proposed server-only variables: `GOOGLE_PLACES_SERVER_API_KEY`, `DAILY_PICK_LLM_MODEL`, and bounded provider/LLM budgets; reuse the existing server `ANTHROPIC_API_KEY` only where authorized. Never put server credentials in `NEXT_PUBLIC_*`. Keep run configuration in a validated versioned domain object rather than a scattered collection of magic constants.

Initial schedule proposal: prepare/select at 06:15 UTC (00:15 CST / 01:15 CDT), with a 12:15 UTC follow-up for retries, empty slots, and revalidation. Only one discovery pass per local date unless an explicit retry is needed. The second run must not blindly repeat discovery or regenerate valid copy. Determine local date at execution time; delayed previous-day jobs must not publish into the wrong day. GitHub schedules are best effort, not an exact-midnight SLA.

Use an environment-scoped GitHub Actions workflow modeled on `.github/workflows/mail-outbox.yml`: separate enablement gates and secrets, bounded runtime, least-privilege token permissions, and concurrency group by environment. Do not enable it in this documentation task.

Operational behavior:

- Track requests by provider operation/field mask, estimated cost, LLM tokens/latency, coverage, new candidates, eligible count, exclusion-code counts, copy failures, and publication success. Reconcile estimates with provider billing.
- Enforce worker request/token budgets before new calls, with bounded backoff for transient errors. Billing alerts are not spending caps. Treat auth errors as configuration failures; do not retry indefinitely.
- Logs contain run IDs, counts, safe codes, and timing; no raw Google content, source HTML, private text, prompts containing secrets, or credentials.
- Do not delete a valid published pick because discovery/LLM is unavailable. If no valid pick exists, keep the honest empty state and optional previous pick with its own date.
- Run retention/deletion jobs according to Phase 0. Operational audit retention must not override provider data limits.
- Migrations are additive. Rollback disables workers/automatic publication, preserves reports/history, and keeps readers compatible with subject-backed rows. Do not revert to binaries that require non-null `place_id` after external picks exist.

Rollout sequence: offline fixtures -> disposable local integration/E2E -> explicitly authorized paid staging pilot with moderator review -> product review of candidate/report/copy quality -> Houston production migration and worker enablement under environment-specific authorization -> separately enable automatic publication. Production actions, billing configuration, and paid calls are not authorized by this plan alone.

## 11. Work breakdown and dependencies

| Ticket | Owner                      | Deliverable                                                                      | Depends on                                     |
| ------ | -------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------- |
| R0     | Platform/backend + product | Provider/retention ADR, exact area, budgets, approved model                      | None; required for live rollout                |
| R1     | Backend/data               | Subject-backed schema, candidate/evidence/run/report migrations and backfill     | Contract review; use fixtures while R0 open    |
| R2     | Shared-domain              | Pure rules, hours normalization, food taxonomy, ranking, top-10 reasons          | R1 contracts                                   |
| R3     | Backend                    | Fake and real discovery/qualification adapters, quotas, run leases               | R1; R0 before real calls                       |
| R4     | Backend/LLM                | Evidence-grounded bilingual copy and review workflow                             | R1/R2; approved model and evidence permissions |
| R5     | Backend                    | Atomic publication, membership provenance, authorization and link reconciliation | R1/R2/R4                                       |
| R6     | Frontend                   | Candidate curation, top-10 admin report, run/review controls                     | R1/R2 API contracts; can use fixtures          |
| R7     | Map/frontend               | Subject-backed Daily Pick, Discover integration, bilingual card/history/fallback | R5 contracts and R0 display decision           |
| R8     | Platform                   | Disabled workflow, budgets, metrics, recovery/retention runbook                  | R3/R5                                          |
| R9     | QA/product                 | Full regression, quality fixtures, pilot evaluation and launch decision          | R0–R8                                          |

Suggested delivery slices: R0/R1/R2 foundation; R3/R4/R6 candidate-to-reviewed-draft; R5/R7 draft-to-public-Discover; R8/R9 controlled operations. Frontend can proceed against fixed fake contracts while provider permission is resolved.

## 12. Verification and release acceptance

Before touching Next.js application code, read the relevant installed documentation under `apps/web/node_modules/next/dist/docs/` and `apps/web/AGENTS.md`. Use Node 22 and pinned pnpm 10.15.0.

### Automated checks

- Unit: gates, rating formula and ties, rolling windows including future reservations, zero/unknown ratings, missing/classified foods, time zones/DST/overnight service, top-10 inclusion and reason fidelity, source/LLM validation, provider pagination and failure budgets.
- Integration: migration/backfill including demo and withdrawn version 1 rows; canonical identities; two concurrent same-day runs; adjacent-day same-food conflicts; duplicate provider IDs; slot revision conflicts; audit/layer failures; stale leases; moderator overrides; aliases/catalog linking; rollback on changed evidence; membership removal without deleting other provenance.
- Authorization integration: anonymous/non-moderator report denial, reviewed-city requirements, hidden linked catalog records, public system layer lifecycle, private/group review exclusion from prompts, and no cross-area leak through subject or review access.
- E2E with fake provider/model: candidate curation -> top-10 report -> copy approval -> publication -> public Discover map/list -> save/directions/history; next-day badge change; empty run; existing pick during outage; hidden winner; provider unavailable; mobile/keyboard/Traditional Chinese; public users cannot see rejected candidates.
- Run `pnpm lint`, `pnpm typecheck`, affected unit tests, `pnpm test:integration`, `pnpm test:e2e`, and `pnpm build` for the corresponding implementation slices. CI runs the full suite. Verify the effective disposable `DATABASE_URL` without printing credentials before database/browser commands; report unavailable checks honestly.

### Product acceptance scenarios

1. A well-rated, open restaurant in Katy can win Houston's slot without Taiwan-related text; it appears once in Discover Houston.
2. Monday tacos exclude tacos through Sunday, including a different taco restaurant. Following Monday is allowed if other rules pass. Never substitute an unknown food label to evade the rule.
3. A 4.2 restaurant fails the proposed 4.3 gate even with many ratings; a 4.9 restaurant with 12 ratings stays in the pool but fails the proposed count gate.
4. A restaurant listed closed for a holiday cannot win; a dinner restaurant can win at 06:00; an already-finished breakfast service cannot win a late replacement.
5. Every report has at most ten actual candidates, includes the winner, and explains actual exclusions/comparisons. A winner outside the initial top ten by base quality is still included.
6. Unsupported or failed LLM copy cannot publish automatically. A permitted independent fact such as a menu specialty supports the corresponding sentence in both languages.
7. Winner, approved recommendation, report linkage, audit, and Discover membership commit together. Retry creates no duplicate winner/item.
8. Past winners remain discoverable when public; today's badge moves by local date. Hidden or withdrawn-only memberships are not exposed through history or subject details.
9. Provider caps, partial coverage, missing hours, and empty eligible pools are visible operational outcomes, never fabricated success or silently relaxed rules.

Launch requires an approved Phase 0 design, passing required checks, product review of rule defaults and exact geography, and acceptable pilot factual accuracy/cost. Persisting forbidden data or skipping permission review is not an acceptable way to complete the feature.
