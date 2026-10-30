---
name: deploy-prod
description: Release LocalLink to production (Vercel deploys on push to master; Supabase Postgres). Use only when the user explicitly asks to deploy, release, or push to production.
disable-model-invocation: true
---

# Deploy to production

Details: `docs/guides/deployment.md`. Production is https://www.zongly.com.

1. **Preflight (local):** `git status --short` clean apart from known noise; `pnpm lint`, `pnpm typecheck`, `pnpm test` pass. List the commits going out: `git log --oneline origin/master..master`.
2. **Migrations:** list new files with `git diff --name-only origin/master..master -- packages/database/migrations`. If any exist, the **user** runs them against prod before the push. Give them this, in PowerShell:
   ```powershell
   $env:DATABASE_URL = "<prod url>"   # paste it yourself
   node -e "console.log(new URL(process.env.DATABASE_URL).hostname)"   # must show the Supabase host
   pnpm db:migrate
   ```
   `dotenv` never overrides a shell variable, so without `$env:DATABASE_URL` the command silently hits the local DB. Wait for the user to confirm.
3. **New env vars:** if the commits read new env vars, the user sets them in Vercel (and in the GitHub `Production` environment for workers) before pushing.
4. **Push:** confirm with the user, then `git push origin master`. Never force-push.
5. **Check:** `gh run list --limit 3` for CI. Check Vercel logs for runtime errors, not the HTTP status (Next error pages return 200). Spot-check the changed page on www.zongly.com.

Report what shipped, the migrations applied, and the CI/deploy status.
