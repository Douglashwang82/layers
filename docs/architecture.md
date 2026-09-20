# Architecture

## Request path

Public App Router server pages query the catalog repository. Client forms call `/api/v1` JSON endpoints. Route handlers authenticate via Better Auth, validate boundaries with shared Zod schemas, and delegate mutations to community services. Service transactions own integrity, analytics and moderation submission records. React never decides authorization.

The simple pnpm workspace intentionally omits Turborepo, an empty UI package and an empty config package. Shared UI lives alongside its one consumer until a second app actually needs it. No TanStack Query is needed: server rendering plus `router.refresh()` supplies authoritative state after mutations.

## Identity

Better Auth manages credentials, hashed passwords, sessions, CSRF protections on auth endpoints and optional Google accounts. Session user IDs are always server-derived. Account metadata permits language/home-city/bio but not role assignment. The bearer plugin gives a future native client an HTTP authentication path without assuming browser cookies. Tokens must be stored in native secure storage; do not expose them in URLs or localStorage. No custom JWT system exists.

## Services and consistency

- Recommendation: unique `(user_id,place_id)`, upsert changes the vote. Only approved votes count. New binary votes are immediately approved; accompanying free text is pending. Hidden votes stay hidden when edited.
- RSVP: lock event row, verify visibility and end time, read capacity, then insert. All RSVP writers use this transaction; repeated POST is idempotent. Cancellation is a DELETE.
- Save/follow: unique composite keys and idempotent inserts/deletes.
- Contributions: record + pending submission + analytics in the same transaction.
- Moderation: role check inside the service, content visibility update + submission status + audit entry in one transaction. Delete is a reversible soft-delete retaining audit history.
- Rate limits: shared PostgreSQL counters, not per-process memory, so limits apply across serverless instances. Auth uses its own database-backed Better Auth rate limiter.

## Ranking, search and time

Place popularity uses `(positive+2)/(responses+4)*100 + ln(1+responses)*4`. The displayed score is always the unadjusted positive/total percentage. The scoring sort orders raw proportions then count. No sponsored signal exists. Events are chronologically ordered for a useful MVP; the replaceable `eventRank` helper documents how future featured/follow signals can be blended. Followed organization events are returned separately on Home.

PostgreSQL parameterized `ILIKE` searches English names, Chinese names, aliases and descriptions. Literal `%`, `_` and backslashes are escaped. Pagination is 12 records; no Elasticsearch. At larger scale add a trigram index after observing actual query plans. Weekend is Saturday/Sunday in the city's IANA time zone; event instants are stored as `timestamptz`. Submission date/time inputs use the browser's explicitly displayed local time zone. Event display currently optimizes Houston (America/Chicago); extend display metadata before launching another time zone.

## Images and analytics

The storage interface has local development and S3-compatible implementations. Production file writes never use the ephemeral Vercel filesystem. Image MIME signatures are checked; SVG user uploads are not accepted. Only curated Unsplash images go through Next's remote optimizer. Authenticated uploads and image references are separate from business logic.

`trackEvent` persists view/search/city events. Core transaction events are persisted atomically with actions. Signup, saves, follows, RSVPs, recommendations and submissions support seven-day activation. Authenticated view timestamps support D7/D30 cohort queries. Organization ownership and audit records leave room for partner metrics, without inventing a dashboard or letting users claim organizations today. Do not record emails, passwords or exact user coordinates in event properties.

## Frontend

English/Traditional Chinese dictionaries are centralized. Entity translation falls back to English. Server pages render meaningful HTML, detail metadata, canonical URLs and OpenGraph. Keyboard-visible focus, labeled forms, semantic regions, text alongside icons and mobile bottom navigation are included. Mapbox is loaded dynamically only for maps. Client-side failures have status messages; public errors have a retry boundary. Large client server-state libraries are unnecessary here.

## Upstream references

Implementation was checked against [Next.js installation](https://nextjs.org/docs/app/getting-started/installation), [Better Auth Next.js integration](https://better-auth.com/docs/integrations/next), and [Drizzle PostGIS geometry](https://orm.drizzle.team/docs/guides/postgis-geometry-point), plus the installed Next.js version-matched documentation.
