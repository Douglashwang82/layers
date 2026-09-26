# Membership beta readiness: local verification

Verified September 25, 2026 (America/Chicago; September 26 UTC), against the working-tree changes based on `109a476`. No commit, push, deployment, live provider send, or workflow dispatch was performed.

## Implemented

- Returning-member email-code sign-in, bilingual UI, hashed rotating OTPs, shared PostgreSQL limits, and preserved password/Google options for existing members.
- Admission-aware authorization for cookie and bearer sessions; native OTP routes cannot admit an invitation-only or partially joined account. Join finalization checks terms and serializes competing invitation changes.
- Resend transport, bilingual mail, encrypted local capture, explicit production configuration checks, and a separate server-side mail import.
- Invitation worker with per-claim leases, a five-attempt budget, bounded runs, provider idempotency, stale-claim protection, and conservative handling of uncertain delivery after the provider window.
- ADMIN-only delivery visibility, guarded/audited retries, and an explicitly disabled-by-default environment-gated workflow.
- Additive migration `0012_shiny_rick_jones.sql`, its Drizzle snapshot, and journal entry. Only `mail_outbox.lease_owner`, `first_attempt_at`, and `sender` were added.

## Checks actually run

| Check                                   | Result                                                                                       |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| `pnpm lint`                             | Passed                                                                                       |
| `pnpm typecheck`                        | Passed                                                                                       |
| `pnpm test`                             | 67 tests passed across 6 files                                                               |
| `pnpm test:integration`                 | 126 tests passed across 15 files                                                             |
| `pnpm test:e2e` with `E2E_PORT=3015`    | All 14 Chromium tests passed                                                                 |
| `pnpm build`                            | Passed after the corrective review and final fixture fixes                                   |
| Migration generation/review/application | SQL, snapshot parent, changed-table scope, and journal checked; applied successfully locally |

The final integration and browser suites used a separately migrated and seeded disposable database, `taiwanhub_membership_verify_20260925`, on local PostgreSQL/PostGIS. Its connection was supplied only to the test commands; existing environment files were not replaced. Migration 0012 was also applied to the configured local development database before the separate verification database was created. No remote database was changed.

Browser checks used a fresh server on port 3015, matching auth/application origins, fake Google Places, and encrypted capture mail. The user's existing port-3000 process was not stopped or reconfigured. Production-provider behavior was tested with mocked fetch responses; capture success is not real inbox-delivery evidence.

The principal browser journey issued an invitation through the admin UI, dispatched it with the worker, joined with its captured OTP, saved a place, signed out, waited through the real resend cooldown, signed back in with a new OTP, and recovered the same save without creating a password. The mobile email-code form passed at 320px.

## Problems found and corrected during review

- Fixed conflicting UUID/text parameter types in a new integration fixture.
- Prevented a worker crash on attempt five from permitting a sixth provider call; stale completion now reports a lost claim.
- Matched test auth/application origins to the selected port and centralized guarded capture cleanup.
- Added closed-membership login, failed-finalization session cleanup, protected-action cookie/bearer authorization, alternate route spelling, and uniform verification-error regressions.
- Made invitation emails use the stored expiry rather than claiming a fresh fourteen-day lifetime.
- Isolated browser fixture IPs so unrelated test accounts do not exhaust one loopback password-login quota; production limits remain enabled.
- Added a test-owned current-weekend event so an existing discovery assertion does not depend on the first seed date. The fixture is deleted after the suite.

The initial integration and browser runs failed on the issues above. The final results in the table are the reruns after corrections, not the earlier failed runs. Formatting was limited to edited files, and `docs/dev-notes.md` was left unchanged.

## Remaining live acceptance

M6 remains open. Before inviting real users, complete the [deployment procedure](deployment.md) and [staging checklist](membership-beta-readiness-plan.md#7-staging-and-release-checklist): configure a verified sender and restricted provider key, reconcile legitimate legacy admissions, configure the trusted platform IP header, perform the hashed-code cutover, authorize the target environment, enable its worker gates, verify actual inbox delivery, and observe scheduled dispatch/failure recovery.

Public OTP responses are generic, but admitted addresses still take a different path and can differ in response time. This residual timing limitation is documented in [the API contract](api.md). Per-IP membership limits require `TRUSTED_CLIENT_IP_HEADER` to identify a platform-controlled header; with it unset, only the per-email limits apply. New-member Google onboarding remains outside this milestone.

## Implementation provenance

Implementation and one bounded corrective pass used the local `claude-implement` skill. Claude session: `a0b55ca8-674a-411e-8690-6ab3876a3053`.

Claude's first run could edit files but its shell attempts were denied. Codex generated/reviewed/applied the local migration, ran all verification commands, made the final browser-fixture corrections, formatted edited files, and reviewed the resulting diff. Claude's completion report alone was not treated as verification.
