# TaiwanHub

Life in North America, through Taiwanese eyes. A Houston-first discovery platform for places, weekend events, community groups, and Taiwanese product sightings.

## Run locally

Requirements: Node.js 22, pnpm 10.15+, Docker Desktop with Linux containers.

```sh
pnpm install
cp .env.example .env
# Windows PowerShell: Copy-Item .env.example .env
docker compose up -d
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open http://localhost:3000. Set `AUTH_SECRET` in `.env` to a random value before running a shared environment. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. `.env` is ignored by Git. Next loads the workspace `.env` through its config; database tools load it directly.

Create an account at `/sign-in`. Email/password works without external credentials. Seed users have no passwords and cannot log in. No default admin or backdoor login is installed. After creating your own account, grant admin locally:

```sh
pnpm admin:grant you@example.com
```

Visit `/admin` to approve pending events, places, sightings and notes; edit content; hide, reject or soft-delete content. Moderator roles can review and edit; only admins can soft-delete. Roles are never accepted from account creation or profile requests.

## Stack and layout

- `apps/web`: Next.js 16 App Router, React 19, strict TypeScript, Tailwind 4, responsive custom components, React Hook Form and Zod.
- `packages/database`: Drizzle schema, checked-in SQL migrations, PostgreSQL/PostGIS, repeatable demo seeds.
- `packages/shared`: domain types, Zod boundaries, authorization and transparent ranking functions. This is the starting point for a future Expo app.
- `src/features/catalog`: public data queries and home feed composition.
- `src/features/community`: transactional mutations and moderation, separate from HTTP routes.
- Better Auth: maintained email/password and optional Google authentication with bearer support for future mobile clients. Selected instead of Auth.js to avoid implementing password hashing, registration and credential account management ourselves.

Drizzle keeps PostgreSQL features explicit, including typed PostGIS geometry columns and GiST indexes. Complex capacity and ranking queries use parameterized SQL through its underlying `pg` pool. There is one database and one ORM, no microservice or second store.

## Demo content

The seed contains 20 places, 10 events, 5 organizations, 10 products, 20 sightings, 15 users and 50 recommendation votes. All catalog content is marked demo. Even real brand or store names in the seed have fictional reports and location details. Never use demo addresses or dates to plan visits. Product images are original local demo illustrations; food/event photos are generic Unsplash imagery, not photos of the named businesses.

Seeds insert deterministic UUIDs and do not erase user data. Running again refreshes the demo product artwork and grocery classifications. Event dates are relative to the first seed run; existing events retain their dates. Use a fresh development database when you want a fresh demo schedule. Never run demo seeds against the production database.

## Features

Map-first home with applied layers (system presets, personal and group collections, My saves projection), synchronized results/details and a full list fallback; layer library, creation, curation, follow and reviewed publication; groups with roles and email-bound invitations; local content with explicit location status; guest browsing; accounts; English/繁體中文; Houston city selection; place and event filtering; bilingual unified search; place recommendation voting and moderated short notes; capacity-safe RSVP/cancellation; saves; organization follows; product sightings; place/event submissions; role-protected moderation with audit history; optional Mapbox; image upload abstraction; persisted analytics; public metadata and sitemap excluding demo listings.

## Configuration

See `.env.example` for the complete list.

| Variable                                                           | Purpose                                                                                    |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                                                     | PostgreSQL connection, PostGIS required                                                    |
| `AUTH_SECRET`                                                      | Random secret, 32+ characters                                                              |
| `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL`                           | Exact public origin; localhost for development                                             |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                         | Optional Google OAuth; both required to enable                                             |
| `NEXT_PUBLIC_MAPBOX_TOKEN`                                         | Optional restricted public Mapbox token                                                    |
| `IMAGE_STORAGE_PROVIDER`                                           | `local` for dev or `s3` for AWS S3/R2/S3-compatible storage                                |
| `IMAGE_STORAGE_*`                                                  | Bucket, public base URL, endpoint, region and server-only credentials                      |
| `ANALYTICS_CONSOLE`                                                | Log event names/properties locally; DB events always persisted                             |
| `FEATURE_PRODUCTS`, `FEATURE_ORGANIZATIONS`, `FEATURE_SUBMISSIONS` | Set `false` to disable optional feature entry points                                       |
| `FEATURE_MAP_HOME`, `FEATURE_LAYER_WRITES`, `FEATURE_CONTENT`      | Map-first home (false restores the legacy entry screen), layer/group writes, local content |

Mapbox/Google/S3 are optional for local startup. Missing Mapbox displays a clear fallback with external directions. Local uploads support JPEG, PNG and WebP up to 5 MB. Production must configure object storage to upload files; HTTPS image URLs can also be submitted. Untrusted image URLs are rendered directly, not fetched by the server image proxy.

## Tests and builds

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration  # requires migrated and seeded Postgres
pnpm exec playwright install chromium
pnpm test:e2e          # starts dev server if needed
pnpm build
pnpm start
```

Use a dedicated database for integration/browser tests. Database tests clean up their own fixtures; browser tests intentionally leave contribution fixtures for inspection and may change scores. E2E captures desktop/mobile screenshots under ignored `test-results/`. CI provides a fresh PostGIS service, caches pnpm dependencies and runs every check above. Do not run `dev` and `start` on the same port. Stop dev before testing production startup.

## Deployment

Target Vercel plus Neon PostgreSQL with PostGIS enabled; any compatible PostgreSQL/PostGIS provider also works. Run migrations with an appropriately privileged direct database connection before deploying. Never migrate on every request. Set the Vercel project root to `apps/web`, enable access to workspace files outside that directory, use `pnpm install --frozen-lockfile` at workspace root and `pnpm --filter @taiwanhub/web build`. See [deployment instructions](docs/deployment.md).

## Documentation

- [Product scope and assumptions](docs/product.md)
- [Architecture and boundaries](docs/architecture.md)
- [Bright UI/UX modernization guide](docs/ui-ux-modernization-guide.md)
- [Map-first, layer-led UI/UX migration guide](docs/map-first-layer-experience-guide.md)
- [Database and integrity](docs/database.md)
- [HTTP API](docs/api.md)
- [Deployment and launch checklist](docs/deployment.md)
- [Future roadmap](docs/future-roadmap.md)
- [Daily content collection and source onboarding](docs/daily-content-ingestion.md)
- [Implementation checkpoints](docs/checkpoints.md)
