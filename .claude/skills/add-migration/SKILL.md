---
name: add-migration
description: Add a Drizzle database migration for LocalLink safely and quickly. Use when a task needs a schema change (table, column, index, constraint, enum).
---

# Add a migration

1. Check the target: `node -e "console.log(new URL(process.env.DATABASE_URL||require('fs').readFileSync('.env','utf8').match(/^DATABASE_URL=(.*)$/m)[1].replace(/[\"']/g,'')).hostname)"` must print a local host (localhost / 127.0.0.1). If not, stop.
2. Edit `packages/database/src/schema.ts`. Follow existing PostGIS geometry columns, soft-delete columns, and naming.
3. `pnpm db:generate`. Review together: new `packages/database/migrations/NNNN_*.sql`, `meta/NNNN_snapshot.json`, `meta/_journal.json`. Add hand-written backfill SQL to the generated file if existing rows need values.
4. `pnpm db:migrate` (local). Then update repositories, seeds (`packages/database/src/seed.ts`), and shared Zod types.
5. `pnpm typecheck`, and `pnpm test:integration` if repositories changed.
6. Commit schema + SQL + meta together.

Production: the user runs prod migrations themselves, and the migration must land in prod **before** the code that reads the new column is pushed. Say this in the final report with the migration number.
