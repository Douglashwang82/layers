# Daily Pick layer

Status: proposed product design; not implemented. The working assumption is one shared pick per city. Per-person personalization remains an open product choice.

## Purpose

Help someone discover one worthwhile local place each day, understand what it offers, and understand why TaiwanHub selected it.

Suggested name: **Daily Pick / 每日精選**. Layer description: “One place to discover each day, with a little context on why it’s worth exploring.”

## Experience

The public system layer contributes one POI to the map and accessible results list. Applying it shows today's recommendation card; selecting the card highlights the same place on the map. A place that also belongs to another active layer remains one pin with multiple memberships.

| Card element | Content |
| --- | --- |
| Header | Daily Pick, city, local publication date |
| Place identity | Photo when available, name, category, neighborhood |
| About this place | Two short sentences describing what it is and its distinctive features, grounded in approved source information |
| Why we picked it | One or two concrete reasons that actually influenced selection |
| Practical details | Address; hours and price only where supported; link to the source or official website |
| Actions | View place as the primary action; Save and Directions as secondary actions |
| History | A compact “Previous picks” link beneath today's card |

On mobile, use the existing shared bottom sheet. The full card remains usable when the map is unavailable. English and Traditional Chinese copy use the existing translation system and fallbacks.

Illustrative copy only, using a fictional place:

> **Daily Pick · Houston · September 26**
>
> **Example Tea House** · Tea shop
>
> **About this place:** A neighborhood tea shop serving Taiwanese teas. Its published menu includes oolong and seasonal tea selections.
>
> **Why we picked it:** We're highlighting tea shops today after several food-focused picks. This place has not appeared in the last 30 days.
>
> View place · Save · Directions

The example assumes the source and selection history support those statements. Real copy must use the selected place's actual evidence.

## Selection

Start with approved, public, non-demo catalog places in the selected city. Require a usable description, source attribution, and a usable location. Provider-only references can be added later once their available evidence and publication rules support the same experience.

Proposed first-release rules:

1. Exclude hidden, rejected, deleted, known permanently closed, and insufficiently documented places.
2. Avoid repeating a place within 30 local calendar days. If the catalog is too small, shorten the repeat window explicitly, retaining at least a seven-day gap; if none qualify, publish an honest empty state.
3. Prefer categories and neighborhoods underrepresented in the previous seven picks.
4. Within that pool, prefer stronger documented information and existing community recommendation signals, accounting for response counts. New places remain eligible without votes.
5. Resolve remaining ties deterministically for the city and date, then persist the result.

These priorities require tuning against actual catalog coverage before launch. A moderator can schedule or replace a pick with a recorded reason. An editorial override must be identified as an editorial selection.

## Explanations

Keep the place description separate from the selection explanation. The description answers “What is it?”; the explanation answers “Why did this place win today's selection?”

Record the actual selection reasons and supporting evidence alongside the pick. Examples include category rotation, a long interval since its last feature, and community recommendations with an honest response count. Never describe a random tie-break as popularity, or invent claims such as “hidden gem,” “locals love it,” or “perfect weather today.”

The initial version can use reviewed descriptions and bilingual reason templates. AI-written prose is optional later: it should summarize supplied facts and recorded reasons, with validation and a template fallback. An LLM is not required to choose the place or produce the initial feature.

## Daily behavior and edge cases

- Publish once per city-local date, using the city's IANA time zone. Keep the pick stable across refreshes, users, language changes, and map movements.
- Select city-wide before applying the viewer's map bounds and filters. If today's pick is outside the view or excluded by filters, explain that and offer “Show today's pick”; do not silently select another place.
- A future or historical date filter does not change today's recommendation. Offer history separately and explain date-filter mismatches using the existing map/list behavior.
- Recheck visibility on every public read. If a selected place becomes ineligible, withdraw it and allow an audited replacement. Never keep serving a hidden place through a stored snapshot.
- If today's publication is unavailable, say “Today's pick isn't ready yet.” A previous pick may be shown separately with its actual date.
- A daily feature does not imply the business is open today. Do not infer opening status from missing or ambiguous hours.
- Retain dated history, subject to current visibility rules. Saved places continue to reference the canonical place after the featured day ends.

## Fit with the current implementation

The existing `today` system rule in `apps/web/src/features/map/query.ts` combines up to 12 ranked places with today's events and dated content. Daily Pick should be a separate system rule and layer, preserving that existing behavior.

Proposed implementation outline:

- Add an allowlisted `daily_pick` rule to the shared layer contract.
- Store one publication slot per city and local date, referencing a canonical place, with bilingual description/reason snapshots, structured evidence, selection-version metadata, publication status, and an audit trail for replacements.
- Generate selections through an idempotent server-side job. Enforce the city/date uniqueness in the database so concurrent runs cannot publish different picks.
- Resolve the stored pick into existing map/list items and carry its dated explanation into the recommendation card. Avoid selecting from an already truncated or viewport-filtered map result set.
- Retain existing Save, Directions, moderation, authorization, and canonical place-detail behavior.

## First-release acceptance

- Eligible data produces one shared pick for a city/date, stable across repeated requests.
- The next city's local day can produce a new pick; daylight-saving changes are handled correctly.
- Every displayed factual claim is supported, and the explanation matches the recorded selection decision.
- Repeat avoidance, category diversity, small-catalog behavior, and editorial replacement have deterministic coverage.
- Hidden and demo records never appear as real public recommendations, including through history or stale caches.
- Map, card, and list agree; filters, duplicate memberships, missing maps, and empty publication states remain understandable.
- English and Traditional Chinese layouts work on mobile and with keyboard navigation.

Measure useful actions from the card (place-detail visits, saves, directions) and return visits to the layer. Avoid treating impressions alone as success.

## Authorized implementation handoff

The user requested implementation of this design through Claude Code. Implement the first release end to end in the current checkout. Use one shared pick per city as the working product decision; personalization and live AI generation are outside this release. Resolve routine details from existing conventions. This section authorizes code and local verification, not production operations.

Read root `AGENTS.md`, applicable nested `AGENTS.md` files (especially `apps/web/AGENTS.md`), and normal `CLAUDE.md` guidance before editing. Read relevant installed Next.js documentation before framework changes. Leave human-owned `docs/dev-notes.md` unchanged.

Preserve pre-existing work: README guide links, `apps/web/next-env.d.ts` development route imports, `docs/engineering-onboarding.md`, `docs/user-guide.md`, and this design. Add focused documentation where needed without reverting existing edits. Do not commit, push, deploy, change production data, run extraction, or call paid external providers. No dependency upgrades or repository-wide formatting.

Deliver the persisted daily selection and audit model with generated migration metadata, deterministic selection and evidence-backed bilingual reasons, idempotent generation entry point, public layer/map integration, featured card, dated history, and authorized moderator scheduling/replacement. Document how operators run and schedule generation; do not dispatch or enable a live workflow. Preserve all current layer behavior and visibility rules. If the catalog lacks a reliable permanent-closure field, do not invent closure detection: use available explicit status information and document the limitation.

Verification uses Node 22 and pnpm 10.15.0. Run `pnpm lint`, `pnpm typecheck`, affected unit tests with `pnpm exec vitest run ...`, and `pnpm build`. Add meaningful regression tests covering the acceptance criteria above. For persistence and authorization changes, run relevant integration tests; for the new user flow, run relevant Playwright tests. Generate migrations with `pnpm db:generate` and review SQL, snapshot, and journal together. Use file-scoped Prettier only.

The launch preflight resolved the effective DATABASE_URL to localhost:5432, database taiwanhub, matching the repository's local Docker development service; credentials were not printed. Reconfirm this before any database mutation or database/browser test and use only this intended disposable local development database. Do not modify or replace environment files. If the local service or tooling is unavailable, finish independent implementation and clearly report the blocked checks. Do not use remote databases, weaken TLS, or silently broaden permissions to make tests pass.

The user requests no step-by-step supervision. Work autonomously until a finished result or a concrete need for further instructions. Do not stop at a plan or wait for routine product choices. Return changed files, commands actually run and results, permission denials, deviations from this design, and remaining work. Codex will review the submitted result.

### Review follow-up after first submission

Continue the existing implementation; do not rebuild it. Codex ran `E2E_PORT=3100 pnpm exec playwright test tests/e2e/daily-pick.spec.ts --reporter=line`: both assertions passed, but browser output exposed a hydration failure. Fix these concrete review findings in one bounded corrective pass:

1. `pickDateLabel` uses Intl with different Node/Chromium zh-TW spacing: server `9月26日 週六`, client `9月26日週六`. Make date labels deterministic across server/client without hiding warnings. Add browser page-error assertions so hydration failures fail tests.
2. `/daily-pick/page.tsx` imports and calls `pickDateLabel` and `pickText` from a `"use client"` module inside its server-rendered history loop. This path was untested because the browser fixture has no past pick. Move pure helpers into a shared non-client module and exercise a genuinely nonempty dated history page in E2E.
3. `generateTodayPick` commits generation before writing its moderator audit via `pool`. Make generation and all moderator audit effects atomic, including automatic withdrawal/replacement and empty-after-withdrawal outcomes. Add a meaningful rollback regression check. Retain the CLI's idempotent behavior and do not add production operations.
4. `DailyPickCard.toggleSave` changes local state only, leaving the same POI's result/detail controls stale. Follow the application's existing authoritative refresh pattern after successful save/unsave and verify consistent state.
5. Scheduling and CLI date validation accept impossible dates with a regex. Use strict calendar-date validation at these untrusted boundaries and cover invalid dates/leap days. Avoid database errors for invalid input.

Replace the E2E fixture's nonexistent remote Unsplash image with a suitable existing local fixture to avoid network-dependent 404 noise. Preserve the earlier implementation and baseline work. Run lint, typecheck, affected unit/integration tests and build after corrections. Use `pnpm exec playwright test tests/e2e/daily-pick.spec.ts --reporter=line` with E2E_PORT inherited as 3100 from the runner; no shell-prefix environment assignment is needed. Reconfirm the same local development DB before database/browser tests. Report exact results and any remaining blocked checks. Do not add unrelated improvements.
