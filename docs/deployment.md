# Deployment

## Vercel + PostgreSQL/PostGIS

1. Create a PostgreSQL database with PostGIS support (Neon or compatible). Use TLS and provider pooling for runtime; use a direct privileged URL for migrations. Test `CREATE EXTENSION IF NOT EXISTS postgis` with the migration role.
2. Run `pnpm install --frozen-lockfile` then `pnpm db:migrate` against the target database from a controlled release environment. Do not seed demo content into production.
3. Import the repository into Vercel. Root directory `apps/web`, Next.js preset, include source files outside the root directory. Install the pnpm workspace, build `pnpm --filter @taiwanhub/web build`. Node 22. The root pnpm lockfile is authoritative.
4. Configure `DATABASE_URL`, random `AUTH_SECRET`, `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` using the same HTTPS canonical origin. Never commit them. Redeploy when changing public build-time variables.
5. Optional Google callback: `https://YOUR-HOST/api/auth/callback/google`. Enable only after adding both credentials and testing the exact origin.
6. Optional Mapbox: public token scoped to production and preview domains, least privileges, with provider usage limits. No token is required for ordinary catalog browsing.
7. For uploads set `IMAGE_STORAGE_PROVIDER=s3`, bucket, region, HTTPS public asset URL, endpoint (R2/S3-compatible), and limited write credentials. The server writes randomized names. Serve public images from a separate asset domain; disallow executable content. Supabase Storage can be used through its S3-compatible endpoint or a new `ImageStorage` implementation.
8. Membership is invite-only; there is no public sign-up. In a brand-new environment with no ADMIN yet, run `pnpm membership:bootstrap <email>` to create the first invitation (CLI-only, refuses if an ADMIN already exists), redeem it through `/join`, then `pnpm admin:grant <email>` and sign in to verify `/admin`. There is no public role-management endpoint. Set `MEMBERSHIP_MODE=invite_only` (see below) before this will work end to end.
9. Verify auth (including the invitation `/join` flow), votes, RSVP capacity, content approval, public visibility and a file upload against this deployment before inviting beta users.

### Membership rollout

Membership is invitation-only end to end (see [the plan](invitation-membership-implementation-plan.md) section 13 for the full cutover sequence and [ADR 0001](adr/0001-membership-invitation-auth-transaction-boundary.md) for why). Configuration:

- `MEMBERSHIP_MODE=closed|invite_only` - fail-closed: unset or any other value behaves as `closed` (no new accounts at all; existing logins keep working). Set to `invite_only` to enable the flow.
- `MEMBERSHIP_ISSUANCE_PAUSED=true` pauses new approvals/direct invites without affecting an already-issued invitation's redemption.
- `MAIL_PROVIDER` - no provider is wired up yet (plan section 8/13); production refuses to start email delivery without one configured, and the local test transport never runs in production.
- `MAIL_OUTBOX_ENCRYPTION_KEY` - 32 random bytes, base64-encoded (`openssl rand -base64 32`); encrypts `mail_outbox` payloads at rest.
- A cutover on an existing deployment: briefly block new account creation, run `pnpm membership:backfill-legacy` (dry-run first) so existing accounts get a `source=legacy` admission row, assign initial reviewers and a membership batch through `/admin/membership`, then set `MEMBERSHIP_MODE=invite_only`. Do not roll back to a pre-invitation build; if you must revert, keep whatever gate exists in the rollback version and do not re-enable public sign-up.
- The `mail_outbox` worker (`pnpm mail:worker`) has no scheduler wired up yet - it needs a deployable, periodic invocation (cron, queue consumer, etc.) before invitation emails actually go out; this is a real open dependency, not a formality.

### Google Places and TaiwanHub reviews rollout

See [the implementation plan](google-places-implementation-plan.md) section 13. Everything ships with flags off. Apply migrations 0010–0011 (additive) first, then deploy.

- `NEXT_PUBLIC_GOOGLE_PLACES_UI_KIT_KEY`: a dedicated browser key. It is visible in the browser by design, so restrict it in Google Cloud to the site's referrers and to the Maps JavaScript API / Places UI Kit, with a separate key per environment. Never reuse `GOOGLE_CLIENT_*` (OAuth) or any server credential. The app hands the key to the browser only while `FEATURE_GOOGLE_PLACES_DISCOVERY=true`. The value `fake` selects a test provider that is refused in production builds.
- Enable in order: `FEATURE_GOOGLE_PLACES_DISCOVERY`, then `FEATURE_PLACE_REVIEW_WRITES`, then `FEATURE_EXTERNAL_PLACE_COLLECTIONS`. `FEATURE_MAP_EFFECTS` is presentation-only and independent. Turning a write flag off stops new writes; existing reads, unsaves and layer removals keep working.
- **Spend control:** set per-API quotas and billing alerts in Google Cloud before enabling discovery. Alerts are not a cap, and an app flag cannot stop requests from already-open tabs. To stop provider calls urgently, first set `FEATURE_GOOGLE_PLACES_DISCOVERY=false` and redeploy. Then lower the key's quota to zero, or disable or restrict the key. Client counters (`places_component_loaded`/`_failed`, `business_*`) are estimates; reconcile them with the Google billing report during the pilot.
- **Operators:** moderators curate external places at `GET /api/v1/admin/place-subjects` (city review, status, catalog linking, provider-ID replacement). Review decisions go through the existing admin queue, which now shows review snapshots and their revision.
- **Live check, 2026-09-25 (localhost, real key):** with the stable `weekly` channel, `gmp-basic-place-autocomplete` (including Traditional Chinese input), `gmp-place-search` text search, `gmp-place-details`, and `gmp-place-details-compact` all load. They show Google attribution, and their `place.location` feeds the Mapbox pins (search pins, the selected halo). The components follow the OS dark mode unless given `color-scheme: light`, and are wider than the panel unless constrained; the CSS handles both. The signed-in save/review flow was verified only with the fake provider. Still unverified: referrer restrictions on the deployed domain, SKU/billing attribution, and quota-exhaustion behavior. The key must be named `NEXT_PUBLIC_GOOGLE_PLACES_UI_KIT_KEY`.

## Operational assumptions

The pool is limited to ten connections per runtime. Size your provider pool/connection budget for the number of Vercel instances. PostgreSQL backs rate limiting; monitor and periodically purge expired counters and expired auth sessions. Back up the database and object storage, and test restoring them. Set log retention and avoid copying full auth payloads into logs. Migration and admin-grant credentials are release/operator credentials, not browser configuration.

There is no public registration path to open - membership is invitation-only by design, not a temporary MVP restriction. The local dev/test mail transport requires no email delivery; production requires a real `MAIL_PROVIDER` (see the membership rollout section above) before the OTP/invitation flow can send anything. Password sign-in remains for existing accounts, and Google is optional; a managed provider boundary is already available through Better Auth.

Demo restaurant/event photos are generic examples and must be replaced with verified, licensed local material. Product illustrations are explicitly demo artwork. Collect community/business permission as appropriate when importing real launch data; verify business addresses, hours and organization ownership. The app does not verify Taiwanese identity, and its score means recommendations by TaiwanHub users, not a demographic identity guarantee.

Live Mapbox, Google OAuth and S3/R2 verification require real credentials. Local fallback behavior is testable without them. No production deployment or cloud resource creation is performed by this repository's scripts.

## Rollback

Roll back the application deployment first when schema-compatible. Do not reverse destructive migrations without a reviewed data plan. Retain the prior deployment and database backups. Pending or abusive content can be hidden immediately through audited moderation without deployment.
