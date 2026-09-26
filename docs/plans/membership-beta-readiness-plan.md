# Membership beta readiness: engineering implementation plan

Date: September 25, 2026. Status: M1–M5 implemented and verified locally; M6 live staging and rollout remain pending. See the [verification record](membership-beta-verification.md) for checks and limitations. The specifications below remain the implementation and rollout reference.

## 1. Outcome and scope

A real invited person can receive an invitation, join with an email code, save a place, sign out, and sign back in with a new email code. An operator can identify and recover failed invitation deliveries without exposing credentials or creating duplicate admissions.

This is the next release milestone. It completes the existing membership implementation rather than replacing it. Read the [original membership plan](invitation-membership-implementation-plan.md), [transaction-boundary ADR](adr/0001-membership-invitation-auth-transaction-boundary.md), and [deployment guide](deployment.md) first. This document governs the remaining work described here; historical implementation claims in those documents must be checked against source.

In scope: returning-member OTP sign-in, admission enforcement, production email transport, reliable invitation dispatch, operator visibility, automated journey coverage, and staging acceptance.

Out of scope: new-member Google onboarding, password setup/reset UI, provider delivery webhooks, new discovery features, collection-pipeline changes, and Google Places rollout. Preserve existing admitted users' password and Google login. Collection reliability and Places staging verification remain separate follow-up milestones.

## 2. Verified baseline

| Area             | Current implementation                                                                                   | Gap                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Join             | `features/membership/service.ts` calls Better Auth OTP, then commits admission before forwarding cookies | Preserve and regression-test this boundary                                |
| Sign-in          | `components/auth-form.tsx` supports password and optional Google                                         | No returning-member email-code UI                                         |
| Mail             | `packages/shared/src/mail.ts` provides an in-memory test transport                                       | Every real provider is rejected; production cannot send OTP               |
| Invitations      | Encrypted `mail_outbox`, retry delays, worker CLI                                                        | No deployed schedule; delivery visibility incomplete                      |
| Native OTP route | `app/api/auth/[...all]/route.ts` accepts an existing user **or a live invitation**                       | An invitation alone can reach native sign-in without completing admission |
| Actor boundary   | `lib/session.ts` maps any Better Auth session to an actor                                                | A session without admission can receive application privileges            |
| OTP storage      | Installed Better Auth defaults to plain storage; app does not override it                                | Set hashed storage before enabling real delivery                          |
| Browser fixtures | `tests/e2e/fixtures.ts` inserts password accounts with legacy admission                                  | Existing flows do not prove OTP-only members can join and return          |

Review baseline: lint, typecheck, and 43 unit tests passed on September 25. Integration tests, E2E, production build, and live services were not reverified during this review. These are baseline observations, not acceptance evidence for the proposed work.

## 3. Implementation decisions

| Decision              | Specification                                                                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Returning sign-in     | Email code is the default `/sign-in` method. Keep an explicit password option and existing Google button.                                                                               |
| Eligibility           | A returning member must have a `membership_admission` row. User existence or an issued invitation alone is insufficient.                                                                |
| New accounts          | Continue exclusively through the existing invitation `/join` flow. Do not enable public sign-up.                                                                                        |
| Auth engine           | Keep the installed Better Auth version and its supported OTP API. Do not implement custom OTP verification or depend on private adapter APIs.                                           |
| Provider              | Engineering default: Resend through its HTTPS email API behind the existing `Mailer` interface. No account creation, purchase, domain changes, or live send is authorized by this plan. |
| Invitation scheduling | Initial beta default: a separate GitHub Actions workflow every five minutes, enabled explicitly per environment. OTP sends remain immediate in the web request.                         |
| Delivery language     | English and Traditional Chinese UI; bilingual plain-text invitation and code email templates for this milestone.                                                                        |
| Delivery semantics    | `provider_accepted` means accepted by the provider, not delivered to an inbox.                                                                                                          |

The platform owner supplies the verified sender domain/address, Resend credential, target environment, Actions budget approval, and operator responsible for failures before live acceptance. Engineering can complete all local work with mocks before those inputs arrive. An existing organizational email-provider requirement can replace Resend at the adapter boundary without changing the auth or outbox contracts.

GitHub scheduling is best effort and can be delayed or skipped. The five-minute schedule is a dispatch target, not an inbox delivery SLA. If the beta needs guaranteed dispatch latency, the platform owner must select a managed worker scheduler before launch; the same CLI remains its execution boundary. See [GitHub schedule documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

## 4. Behavior and contracts

### 4.1 Returning-member sign-in

Use the existing native Better Auth routes, preserving their native response shapes. Add `emailOTPClient()` to the browser auth client and verify method signatures against the installed package.

| Operation    | Request                                                                    | Required behavior                                                                                                                                                                                                |
| ------------ | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request code | `POST /api/auth/email-otp/send-verification-otp`, `{email,type:"sign-in"}` | Normalize and validate email, enforce limits, send only for an admitted member. For a syntactically valid ineligible email, return the same generic `{success:true}` shape without sending or creating anything. |
| Verify code  | `POST /api/auth/sign-in/email-otp`, `{email,otp}`                          | Recheck admission before delegation; deny unknown, invitation-only, seed-only, and partial-join users. Return a generic invalid-code response without revealing eligibility.                                     |
| Join         | Existing `/api/v1/membership/join/*` routes                                | Continue using server-derived invitation email and the existing admission transaction. No public caller-provided role, user ID, or alternative email.                                                            |

Request-code UI copy: “If this email belongs to a member, you’ll receive a sign-in code. Check your inbox or try again shortly.” Do not claim inbox delivery. Suppress recipient-specific provider failures from the public response, record a redacted operational failure, and allow a rate-limited resend. A globally invalid mail configuration may return the same unavailable response for all addresses before looking up membership. An authenticated invitation context may receive an actionable mail failure without exposing an unrelated account.

Keep code length at six digits, expiry at five minutes, maximum verification attempts at three, and explicitly use hashed storage with rotation on resend. Keep the join-compatible OTP configuration: globally setting `disableSignUp:true` would break invited new-user creation. Enforce the public-route restriction separately. The [Better Auth OTP documentation](https://better-auth.com/docs/plugins/email-otp) describes these supported APIs and options; installed types/source are authoritative for this pinned version.

Implement shared PostgreSQL limits for both native sign-in and custom join calls: a 60-second resend cooldown per normalized email, at most five sends per email/hour, twenty sends per trusted client IP/hour, and thirty join-context exchanges per IP/ten minutes. Retain Better Auth's stricter applicable verification limits. Apply counters before eligibility branching, including ineligible requests. Hash email/IP limiter keys with a purpose-specific server HMAC; never persist raw values as counter keys. Trust only the deployment's documented proxy headers, not arbitrary forwarded headers. In-process `auth.api.*` calls must not be assumed to execute HTTP rate limiting.

No-store responses, validated same-origin browser writes, bounded request bodies, sanitized local `next` destinations, and no token/email/OTP analytics are required. Do not add a raw-OTP retrieval endpoint or enable unsupported OTP purposes that the mail callback currently ignores.

### 4.2 Admission boundary and join recovery

- Add an admission-aware actor lookup used consistently by protected pages, API routes, uploads, and cookie/bearer authentication. Audit direct session reads; raw session existence must not grant application privileges.
- Returning login works for admitted members even when `MEMBERSHIP_MODE=closed` or new issuance is paused. These switches control joining/issuance, not existing membership.
- Preserve genuine legacy members by completing the existing backfill before enforcing the new gate. Review its candidates: credential-row existence alone must not promote partial invitation accounts. Do not automatically admit seed users or every existing user.
- A partial join can resume only through a valid invitation context. Revalidate invitation version/status/expiry and accepted terms at finalization; serialize competing redemption/revocation/reissue operations with consistent row locks.
- Forward all required session cookie headers only after admission commits. On failure, do not forward a token or cookie; clean up the provisional session. After a lost success response, the now-admitted member can use returning OTP login; do not require replaying a consumed OTP.
- A session created by an alternate native/OAuth route cannot bypass the admission-aware actor check. New-member Google onboarding remains unsupported in this milestone.

### 4.3 Mail and dispatch

Implement server-only Resend configuration using `MAIL_PROVIDER=resend`, `MAIL_FROM`, and `RESEND_API_KEY`; retain `MAIL_OUTBOX_ENCRYPTION_KEY`. Add placeholders to `.env.example` only. A missing/unknown provider or test provider must fail closed for production delivery, while ordinary guest browsing remains available.

Use `POST https://api.resend.com/emails`, a fixed provider host, Bearer authorization, a ten-second timeout, and validated responses. Return the provider message ID; never log the raw provider request or response. Distinguish configuration/authentication, invalid-recipient, rate-limit, timeout, and transient provider errors. No automatic inner retry for OTP sends; the user can request a new code. Invitation retries belong to the worker. See [Resend Send Email](https://resend.com/docs/api-reference/emails/send-email).

Extend `Mailer.send` with an optional delivery idempotency key. Invitation attempts reuse their existing `dedupe_key`; reissuing a token creates a new logical delivery. Freeze the provider request payload, including sender, for retries. Resend retains idempotency keys for 24 hours: this reduces duplicate sends but is not an indefinite exactly-once guarantee. Track the first attempt and stop ambiguous automatic replay beyond that window; require operator reconciliation or invitation reissue. See [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).

Worker requirements:

- Validate configuration before claiming rows. Claim one due row at a time with `FOR UPDATE SKIP LOCKED`, a two-minute lease, and a unique lease owner. Do not lease 25 rows and send them serially while their leases expire.
- Persist attempt count and first-attempt time before the provider call. Final updates must match the lease owner and current queued state, so a late worker cannot overwrite reissue/revocation or a newer claim.
- Recheck invitation status, token version, and expiry immediately before sending. Mark stale jobs `superseded`. An already in-flight email may still arrive after revocation; redemption must reject it.
- Keep five total attempts and the existing 1/5/30/120-minute backoff, honoring provider rate-limit delay when longer. Permanent errors stop immediately. A provider-accepted send followed by a failed DB update retries with the same idempotency key.
- Bound each CLI run to 100 messages or three minutes; leave remaining work for the next invocation. Exported single-batch behavior remains usable by integration tests. Report counts, oldest due age, and redacted failures; nonzero exit for configuration failure or terminal delivery failures.
- Add schema fields for lease ownership and first-attempt tracking through Drizzle generation and a new additive migration. Keep existing encrypted payloads readable; define compatibility for older rows before the first real send.
- Retry controls must not clear an active lease or replay accepted/superseded mail. Restrict retry to eligible failed rows, audit it, and reset the retry budget only after checking token validity and delivery ambiguity. Past-window ambiguity requires reconciliation/reissue, not blind retry.

The new workflow uses Node 22, pnpm 10.15.0, frozen lockfile, `NODE_ENV=production`, a dedicated GitHub environment, environment-specific concurrency, `cancel-in-progress:false`, a job timeout, and least-privilege runtime secrets. Both schedule and manual dispatch require an explicit `MAIL_WORKER_ENABLED` environment variable. It executes only `pnpm mail:worker`; no migrations, seeds, or extraction commands. Never source production mail secrets into pull-request jobs.

## 5. Work packages and handoff order

### M1 — Admission-safe returning OTP login

Owner: backend/auth engineer. Dependencies: none. Estimated effort: 2–3 engineering days, including tests.

Files: `apps/web/src/lib/auth.ts`, `lib/session.ts`, `features/membership/repository.ts`, `service.ts`, `router.ts`, `app/api/auth/[...all]/route.ts`; a small membership rate-limit module; shared membership schemas where needed.

Deliver the native-route eligibility behavior, hashed OTP storage, shared limits, actor boundary, join finalization checks, and a reviewed legacy-backfill procedure. Add HTTP-level tests as well as service tests; a mocked actor does not prove the boundary. Verify installed Next.js docs before changing framework code.

Exit criteria: ineligible native requests cannot create an admitted user or access a protected action; real admitted legacy and OTP users can log in; joining still commits exactly one admission under concurrent/retried operations; all auth-path regression cases in section 6 pass.

### M2 — Email-code sign-in interface

Owner: frontend engineer. Dependency: M1 contracts. Estimated effort: 1–2 days.

Files: `apps/web/src/components/auth-form.tsx`, optional small OTP form component, `app/sign-in/page.tsx`, `lib/dictionary.ts`, and `components/membership/join-flow.tsx` only where shared copy/behavior is needed.

States: email entry, code requested, verifying, invalid/expired code, cooldown, resend available, unavailable, and success. Provide change-email and use-password actions. Use a single labeled code field with `inputMode="numeric"` and `autoComplete="one-time-code"`, retain leading zeroes, allow paste, announce errors, manage focus, and preserve safe `next` navigation. Show Google only when both server credentials are configured. Translate all new states into Traditional Chinese.

Exit criteria: a passwordless admitted member can sign out and return, keyboard-only use works, and the form fits a 320px viewport. Existing password login still works.

### M3 — Real provider adapter and deterministic test capture

Owner: backend engineer. Dependencies: none for adapter; coordinate error semantics with M1. Estimated effort: 1–2 days.

Files: `packages/shared/src/mail.ts` or adjacent server-only mail modules, `apps/web/src/lib/auth.ts`, `.env.example`, new focused mail unit tests, and test fixture support. Audit imports so provider secrets and Node crypto never enter browser bundles.

Implement the transport and templates specified above. Preserve in-memory capture for unit/integration tests. For browser tests running in another process, add an explicitly enabled nonproduction capture transport writing encrypted messages into a per-run temporary directory outside public/workspace artifacts; Node-side fixtures decrypt/read them. Production must reject this transport even if its flags are set. Do not expose capture over the application's HTTP API.

Exit criteria: mocked provider success, rejection, malformed response, timeout, throttling, and secret-redaction tests pass. No real recipient or provider request is used in automated tests.

### M4 — Reliable invitation worker and operator controls

Owner: backend/platform engineer. Dependency: M3. Estimated effort: 2–3 days.

Files: `packages/database/src/mail-worker.ts`, `schema.ts`, generated migration/metadata, membership service/router/repository, `components/membership/admin-panel.tsx`, `app/admin/[[...section]]/page.tsx`, dictionary, new `.github/workflows/mail-outbox.yml`, and `tests/integration/mail-worker.test.ts`.

Add an ADMIN-only `GET /api/v1/membership/admin/mail?status=failed&page=1` view, default 20/max 50 records, deterministic creation-time/ID ordering. Return job ID, masked recipient, kind, status, attempts, next-attempt time, provider message ID, and redacted error code; never return ciphertext/plaintext/token. Surface queued, provider-accepted, failed, and superseded states and the existing retry operation. Any retry action requires same-origin checks and an audit record. Choose an operator and enable workflow failure notifications before live dispatch.

Exit criteria: concurrent workers do not normally dispatch the same claim, stale completions cannot overwrite current state, crash/retry behavior is bounded and idempotent within the provider window, and failed jobs are visible and recoverable. Workflow is committed disabled; enabling it is a rollout action.

### M5 — Journey regression and documentation

Owner: implementing engineer with QA review. Dependencies: M1–M4. Estimated effort: 1–2 days.

Files: new `tests/e2e/membership.spec.ts`, `tests/e2e/fixtures.ts`, `playwright.config.ts`, focused integration suites, CI test configuration, `README.md`, `docs/api.md`, `docs/deployment.md`, and the original membership plan status section. Preserve existing user edits and leave `docs/dev-notes.md` untouched.

The principal E2E creates only the prerequisite admin/batch fixture, issues the invitation through the application, runs the worker against test capture, extracts its link, joins through the browser, saves a place, signs out, requests a new code at `/sign-in`, logs back in, and observes the same saved place. Do not substitute a password account for the invited member or read the OTP from the hashed verification table. Disable traces/screenshots during secret-bearing auth steps and clean up capture files and fixture data.

Explicitly provide isolated E2E membership/mail settings to the web server and worker. CI currently lacks those settings; inherited local `.env` values must not determine test success. Refuse to reuse a server whose database/test-mail configuration cannot be established.

Exit criteria: full checks pass, documentation describes actual behavior, and local acceptance evidence is recorded with commit ID and environment.

### M6 — Staging acceptance and authorized beta rollout

Owner: platform operator plus QA. Dependencies: M5 and supplied live configuration. Estimated effort: one engineering day plus external domain/provisioning lead time.

Complete section 7 in staging first. Code review and mock tests do not substitute for actual inbox delivery or deployed cookie behavior. Request environment-specific authorization only when the implementation, migration, configuration checklist, and rollback are reviewable. Deployment is not part of this planning task.

Suggested PR order: M1, M2, M3, M4, M5. M3 may be developed independently of M1/M2 by the assigned team. Total planning estimate: 8–13 engineering days before external provisioning and rollout; revise after the auth-boundary tests expose the actual remediation size.

## 6. Required verification matrix

| Area              | Cases                                                                                                                                                                                   | Level                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Admission         | Admitted OTP/legacy users accepted; unknown, seed-only, partial-join, live-invitation-only, expired/revoked invitation users denied by returning routes                                 | HTTP integration              |
| Protected actions | Session without admission denied for saves, submissions, uploads and membership actions; cookie and bearer paths both covered                                                           | HTTP integration              |
| Join transaction  | Concurrent redemption; revocation/reissue race; failure before admission commit; dropped response after commit; terms absent; provisional session cleanup; no duplicate admission/audit | Real DB integration           |
| OTP               | Wrong/expired/replayed code; three-attempt exhaustion; resend rotation; hashed storage; leading zeroes; closed membership still permits returning members                               | Integration + browser         |
| Abuse/privacy     | Shared resend/IP limits including custom join routes and ineligible emails; request size/origin; no eligibility-specific response; no secret logs                                       | Integration                   |
| Provider          | Success ID, timeout, 429, 5xx, permanent error, malformed response, production test-transport rejection                                                                                 | Mocked unit                   |
| Outbox            | Competing workers, lease expiry and late completion, provider success/DB failure, expired/revoked/reissued invitation, permanent failure, bounded retries, ambiguity after 24h          | Real DB + mocked provider     |
| Admin             | ADMIN only; no payload disclosure; active/accepted/superseded job retry rejected; failed eligible retry audited                                                                         | Integration + browser         |
| Main journey      | Delivered test invitation → join → save → sign out → email-code sign-in → same save                                                                                                     | Browser                       |
| Existing behavior | Password login; admitted Google login where configured; guest browse; map/layer flows; English/Traditional Chinese; keyboard and mobile                                                 | Existing regression + staging |

Run from repository root using Node 22 and pinned pnpm:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
```

Before migration/integration/E2E, confirm the effective database is disposable without printing credentials. Follow the repository migration process: schema change → `pnpm db:generate` → review SQL/snapshot/journal → apply with `pnpm db:migrate` to the disposable database. Never seed production. Record passed, failed, and blocked checks accurately.

## 7. Staging and release checklist

1. Record target commit, environment, migration, operator, sender domain, provider configuration, scheduler cost approval, and rollback build. Keep all secrets in their environment stores.
2. Verify sender/domain configuration with the provider and restrict provider credentials. Use separate staging credentials and an approved recipient list.
3. Reconcile legitimate legacy admissions before enforcing the application gate. Dry-run the backfill, inspect candidate provenance, and confirm seed/partial accounts are excluded.
4. Apply additive migration, deploy with worker disabled and new invitation issuance paused, and verify guest browsing and admitted-member login.
5. When switching existing OTP storage to hashes, allow the five-minute validity window to expire during the auth cutover or explicitly invalidate only outstanding sign-in OTP records. Do not delete unrelated verification/session data.
6. Resume staged issuance, create a small test batch, send to approved inboxes, and complete the full join/return journey on the deployed HTTPS origin. Check expiry, resend, cookie persistence, safe redirects, and EN/繁中 copy. Record actual inbox receipt separately from provider acceptance.
7. Enable the mail worker for staging. Observe at least two scheduled invocations plus an intentionally simulated transient failure. Confirm backlog age, failure notification, and operator retry behavior.
8. Perform a restore/rollback rehearsal compatible with the additive migration. Preserve admission enforcement, encrypted payload readability, and OTP storage compatibility. Do not roll back to the known incomplete membership flow.
9. For authorized production rollout, repeat the environment checks, begin with a small invitation batch, and monitor OTP failures, timeouts, oldest queued age, and terminal invitation failures. Initial investigation thresholds: any terminal failure, five consecutive provider errors, or a due queue older than fifteen minutes.
10. During an incident, pause issuance and disable the invitation worker as appropriate. Keep admitted-member OTP login available when the provider is healthy. If email itself is unavailable, show an actionable outage state; do not bypass membership or use the test transport.

## 8. Definition of done

- A real passwordless invited member completes the entire journey on staging and returns to the same account/data.
- No application privilege is granted solely because a Better Auth session or unredeemed invitation exists.
- Emails use the configured real provider, invitation retries are bounded, and an operator can diagnose failures without viewing credentials.
- Automated checks in section 6 pass; live-only checks have recorded evidence or remain explicit launch blockers.
- Deployment, legacy cutover, dispatch controls, and rollback instructions are current.
- Production remains disabled until authorization covers that environment and its live mail usage.
