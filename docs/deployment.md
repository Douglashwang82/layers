# Deployment

## Vercel + PostgreSQL/PostGIS

1. Create a PostgreSQL database with PostGIS support (Neon or compatible). Use TLS and provider pooling for runtime; use a direct privileged URL for migrations. Test `CREATE EXTENSION IF NOT EXISTS postgis` with the migration role.
2. Run `pnpm install --frozen-lockfile` then `pnpm db:migrate` against the target database from a controlled release environment. Do not seed demo content into production.
3. Import the repository into Vercel. Root directory `apps/web`, Next.js preset, include source files outside the root directory. Install the pnpm workspace, build `pnpm --filter @taiwanhub/web build`. Node 22. The root pnpm lockfile is authoritative.
4. Configure `DATABASE_URL`, random `AUTH_SECRET`, `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` using the same HTTPS canonical origin. Never commit them. Redeploy when changing public build-time variables.
5. Optional Google callback: `https://YOUR-HOST/api/auth/callback/google`. Enable only after adding both credentials and testing the exact origin.
6. Optional Mapbox: public token scoped to production and preview domains, least privileges, with provider usage limits. No token is required for ordinary catalog browsing.
7. For uploads set `IMAGE_STORAGE_PROVIDER=s3`, bucket, region, HTTPS public asset URL, endpoint (R2/S3-compatible), and limited write credentials. The server writes randomized names. Serve public images from a separate asset domain; disallow executable content. Supabase Storage can be used through its S3-compatible endpoint or a new `ImageStorage` implementation.
8. Create your first account, grant admin with the documented CLI using database access, and sign in to verify `/admin`. There is no public role-management endpoint.
9. Verify auth, votes, RSVP capacity, content approval, public visibility and a file upload against this deployment before inviting beta users.

## Operational assumptions

The pool is limited to ten connections per runtime. Size your provider pool/connection budget for the number of Vercel instances. PostgreSQL backs rate limiting; monitor and periodically purge expired counters and expired auth sessions. Back up the database and object storage, and test restoring them. Set log retention and avoid copying full auth payloads into logs. Migration and admin-grant credentials are release/operator credentials, not browser configuration.

The local auth flow does not require email delivery. Before opening unrestricted public registration, configure Better Auth email verification and password-reset delivery using your chosen mail provider and abuse policy. The MVP currently supports password sign-in/account creation and optional Google; it does not pretend to deliver emails. A managed provider boundary is already available through Better Auth.

Demo restaurant/event photos are generic examples and must be replaced with verified, licensed local material. Product illustrations are explicitly demo artwork. Collect community/business permission as appropriate when importing real launch data; verify business addresses, hours and organization ownership. The app does not verify Taiwanese identity, and its score means recommendations by TaiwanHub users, not a demographic identity guarantee.

Live Mapbox, Google OAuth and S3/R2 verification require real credentials. Local fallback behavior is testable without them. No production deployment or cloud resource creation is performed by this repository's scripts.

## Rollback

Roll back the application deployment first when schema-compatible. Do not reverse destructive migrations without a reviewed data plan. Retain the prior deployment and database backups. Pending or abusive content can be hidden immediately through audited moderation without deployment.
