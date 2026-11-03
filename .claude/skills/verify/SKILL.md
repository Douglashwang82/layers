---
name: verify
description: Run the right LocalLink checks for the current changes (lint, typecheck, unit, integration, E2E, build). Use before committing or when the user says "verify", "check", or "run tests".
---

# Verify changes

Look at `git status --short` and `git diff --name-only master...HEAD` and pick checks by path:

| Changed paths                                                      | Run                                                                              |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| any `.ts`/`.tsx`                                                   | `pnpm lint` and `pnpm typecheck`                                                 |
| `packages/shared/src`, `apps/web/src/lib`, `apps/web/src/features` | `pnpm exec vitest run <matching tests/unit files>` (whole `pnpm test` if unsure) |
| repositories, services, `packages/database/src`, migrations        | `pnpm test:integration` (local DB must be migrated + seeded)                     |
| `apps/web/src/app`, `apps/web/src/components` user flows           | `pnpm exec playwright test tests/e2e/<relevant spec>`                            |
| `next.config.*`, dependencies, route/layout structure              | `pnpm build`                                                                     |
| docs only                                                          | `pnpm exec prettier --check <files>`                                             |

Notes:

- Run independent checks in parallel (lint + typecheck + unit).
- Reproduce CI's missing map token with `NEXT_PUBLIC_MAPBOX_TOKEN= E2E_PORT=3100 pnpm test:e2e`.
- E2E and `pnpm build` rewrite `apps/web/next-env.d.ts`; restore it with `git checkout -- apps/web/next-env.d.ts` (the Stop hook does this too).

Report each check as passed, failed (with the key error lines), or skipped (with the reason).
