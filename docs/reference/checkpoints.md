# Implementation checkpoints

- [x] M0: empty repository inspected; workspace, TypeScript, lint/format, Tailwind, Docker, CI, test configuration.
- [x] M1: database, migrations, deterministic seeds, email/password auth, optional Google, bearer boundary, city selector.
- [x] M2: place list/detail, filters/search, raw Taiwanese Score, vote upsert, notes, saves, lazy Mapbox with missing-token fallback.
- [x] M3: event list/detail, local weekend filter, capacity-safe RSVP, saves, organizer profiles/follows.
- [x] M4: product list/detail, Chinese aliases, recent sightings, pending submission and optional image uploads.
- [x] M5: pending place/event submissions, role-protected moderation, audited approval/rejection/hiding/deletion, common-field edits, content reports.
- [x] M6: centralized EN/繁體中文 copy, responsive layouts, focus/labels, loading/empty/error states, metadata/canonicals/sitemap.
- [x] M7: complete check suite, production build/start and browser approval flow verified.

These are git-ready implementation boundaries in one initial repository creation. No existing code or history was replaced. No remote was configured or code pushed. See README for verification commands and deployment requirements.

## Verified locally — September 16, 2026

- Docker PostgreSQL/PostGIS healthy; migrations and repeatable seed completed.
- `pnpm lint`: passed without warnings.
- `pnpm typecheck`: passed.
- `pnpm test`: 5 tests passed.
- `pnpm test:integration`: 10 tests passed against real PostgreSQL.
- `pnpm test:e2e`: 3 tests passed against development and then the built production server. Covers guest discovery, Chinese search, 1440/768/375px layouts, account creation, saves, changed votes, RSVP/cancel, sighting submission, and event submission/approval/publication.
- `pnpm build`: passed; `pnpm start`: booted and served all browser flows.
- `pnpm audit --prod`: no known vulnerabilities after upgrading Vitest and overriding vulnerable transitive esbuild. Recheck periodically; this result is point-in-time.
- Local `.env` is ignored by Git. No cloud resources, remote repository or production deployment was created.

External integrations remain unverified without credentials: Google OAuth, live Mapbox tiles and S3/R2 uploads. The local filesystem upload path is implemented; the public-beta mail delivery/verification/recovery configuration is documented but intentionally not configured without a provider.

## Map-first layer migration — verified locally, September 22, 2026

Implements [the map-first, layer-led guide](map-first-layer-experience-guide.md) in four product phases plus rollout switches:

- [x] Phase 1: persistent map home with Discover/Today/This weekend/Food/Community system layers, mixed place/event pins with clustering, one query for pins, rows and counts, date/type/search/area controls, item preview with per-action pending state, URL restoration, full list fallback when the map provider is unavailable.
- [x] Phase 2: personal layers (create, curate, reorder, archive, delete), Add to layer, follow, My saves projection, reviewed publication and audience-labelled share links, returning-user layer restore.
- [x] Phase 3: groups with owner/editor/viewer roles, email-bound expiring invitations, restricted group layers, version-checked edits, revocation.
- [x] Phase 4: local content with explicit location status, moderation, content saves, city-wide/online results without fabricated pins.
- [x] Phase 5: `FEATURE_MAP_HOME`, `FEATURE_LAYER_WRITES`, `FEATURE_CONTENT` switches; legacy home retained; catalog routes keep a Map entry.

Checks run: `pnpm lint`, `pnpm typecheck`, `pnpm test` (20), `pnpm test:integration` (28, real PostgreSQL), `pnpm test:e2e` (8 browser flows at 1440/768/375/320 px), `pnpm build`. Not verified: the Mapbox canvas in a real browser (no `NEXT_PUBLIC_MAPBOX_TOKEN` configured locally or in production); Google OAuth and object storage remain unverified as before.
