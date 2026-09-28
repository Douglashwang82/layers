# ADR: Daily restaurant recommendation — Phase 0 provider/retention decision

Status: **PENDING. Not approved.** This task has not enabled an area in a real environment. This document records what remains to be decided before one can be enabled; it does not itself authorize anything. See [daily-restaurant-recommendation-implementation-plan.md](../plans/daily-restaurant-recommendation-implementation-plan.md) section 3 for the full Phase 0 requirements this ADR must satisfy.

## 1. What is implemented and safe to exist regardless of this ADR

The offline software described below is real, tested, and does not depend on this decision:

- Pure eligibility/ranking/report rules (`packages/shared/src/daily-pick-restaurant.ts`).
- Additive schema for candidates, evidence, discovery runs, pick runs, reports, and Discover membership provenance (migrations 0016-0020).
- A worker (`packages/database/src/daily-pick-restaurant-run.ts`) that discovers, qualifies, ranks, and drafts a report and copy — but can only ever reach `ready_for_review`, `empty`, or `failed`. It has no code path to `published` without a separate, explicit human `approveRestaurantCopy` call followed by `publishRestaurantPickRun`.
- Adapter interfaces with deterministic fakes for all three provider integrations (discovery, qualification, copy), used by local fixture runs and automated tests.
- Real Google Places (qualification + Text Search discovery) and Anthropic copy adapters that exist as working, unit-tested code (`packages/database/src/restaurant-providers.ts`) but refuse to make any network call unless constructed with `legalAcknowledged: true` — the runtime supplies that only after worker and policy flags, approved area configuration, keys, and model configuration pass validation.

None of this requires the decisions below. Real provider wiring is implemented but remains disabled by default. No real provider or model request was made during this implementation.

## 2. Decisions this ADR must record before any area is enabled

Per the plan's Phase 0, each of the following needs an explicit answer, signed off by whoever holds the actual Google Cloud billing account and its Terms of Service relationship (not this engineering session):

1. **Discovery, evaluation, map/display, LLM-input, retention, and deletion policy**, field by field, for the actual billing account/region. In particular: which of `rating`, `userRatingCount`, `businessStatus`, `currentOpeningHours`, and the Place ID itself may be retained even transiently (in `daily_pick_run_candidate`, `restaurant_evidence`, logs, or model prompts), and for how long.
2. **Exact Greater Houston geography**: which of Houston, Katy, Sugar Land, Pearland, Missouri City, Stafford, Cypress, Spring, The Woodlands, Humble, and Baytown (or others) are approved, and the boundary source (never point-in-polygon on Google-supplied coordinates — durable area membership must come from independently licensed evidence and local review, which `restaurant_candidate`/`place_subject.city_review_status` already model).
3. **Approved search rectangles/query groups** and a bounded rotation across them (`restaurant_discovery_area.config.queryGroups`), sized to the account's actual budget.
4. **Daily/monthly request and spend limits**, and the specific `DAILY_PICK_LLM_MODEL` to use (validated by `requireConfiguredModel`; there is no hardcoded fallback to accidentally rely on).
5. **Which report facts may be persisted** (`daily_pick_run_candidate.score`/`reason_codes`, `restaurant_evidence`) versus which must remain transient-only per the account's Places API Terms interpretation. If historic rating/hours snapshots are not permitted, the report's "displayed rating, labeled with retrieval time" behavior needs to be revisited before enabling, not after.
6. **Places UI Kit vs. server Places API separation**: confirm the existing UI-Kit-only external-place rendering path remains the only place Google Places content reaches a non-Google map, and that the server-side qualification/evidence-review split this pipeline performs is compatible with the account's Maps Platform Terms (sections 3.2.3 and the service-specific terms 14-15 cited in the plan) — legal confirmation, not just architectural separation, since separation alone is not a contractual exemption.

## 3. What "enabling" means operationally, once the ADR above is approved

1. Set `restaurant_discovery_area.config` to the approved geography/query-groups/budgets (versioned; `configVersion` bump for any later change).
2. Configure the server-only credentials, explicit worker/policy flags, approved model, and validated area configuration documented in the [worker runbook](../guides/restaurant-recommendation-worker.md). The CLI is already wired to real adapters; no further implementation is required to connect them.
3. Set `restaurant_discovery_area.enabled = true` for that one area only.
4. Continue requiring human copy approval (`approveRestaurantCopy`) before every publish — this ADR does not lift that requirement; it is a separate, later decision ("automatic publication," see the plan's Phase 4/6) that needs its own pilot-accuracy evidence, not just legal approval.
5. Enable `.github/workflows/daily-pick-restaurant.yml` for exactly one GitHub environment via `RESTAURANT_WORKER_ENVIRONMENTS`/`RESTAURANT_WORKER_ENABLED` after the preceding configuration and rollout approvals.

## 4. Runbook (for when this ADR is approved)

- **Rotation**: `prepareRestaurantPickRun(area, date, { discovery, qualification, copy })` once per area/local-date. The scheduler leaves existing dates alone. Explicit admin retries may reclaim expired preparation work; review drafts are preserved until rejected or discarded.
- **Review**: a moderator inspects the `ready_for_review` run's report (`daily_pick_run_candidate`) and its `restaurant_copy` row, then calls `approveRestaurantCopy` or `rejectRestaurantCopy`.
- **Publish**: `publishRestaurantPickRun(runId, actorId, { qualification })` re-validates everything against fresh data before committing. Expected non-error outcomes to handle operationally: `copy_not_approved` (review still pending), `stale` (evidence/qualification changed since the report was written — discard the old draft and queue a new preparation), `revision_conflict` (a different pick already exists for that date — re-fetch and pass `expectedPickId` to confirm an intentional replace), `unchanged` (idempotent retry of an already-published run).
- **Withdraw**: `withdrawRestaurantPick(pickId, reason, actorId)`. Safe to call any time; it never deletes a Discover `layer_item` that another pick or independent curation still needs.
- **Recovery**: a run stuck in a non-terminal status past its `lease_expires_at` is safe to reclaim by calling `prepareRestaurantPickRun` again for the same area/date — `claimRestaurantRun` detects the expired lease and resets the run to start of evaluation rather than trusting a half-written report.
- **Retention**: until section 2 above is resolved, treat every persisted `daily_pick_run_candidate`/`restaurant_evidence` field as provisional; do not add new persisted provider-derived fields without updating this ADR first.

## 5. Non-goals of this ADR

- It does not approve a paid pilot, a production migration, or any workflow enablement — those are the separate rollout gates the plan's section 10 describes, each requiring its own explicit authorization.
- It does not claim the offline software above is feature-complete against the full plan (see the plan document and recent implementation commits for exact status); it only fixes the scope of what Phase 0 itself must decide.
