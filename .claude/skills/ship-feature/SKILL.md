---
name: ship-feature
description: Ship a LocalLink feature fast with parallel subagents. Use when the user asks to build a feature that touches more than a couple of files or both DB and UI.
---

# Ship a feature with the agent team

1. **Slice.** Read just enough code to split the feature into 2–4 independent slices with clear file ownership (e.g. schema, service+API, UI, tests). Slices must not edit the same files. Tell the user the slices in a few lines, then go — don't wait for approval unless the behavior is ambiguous.
2. **Schema first.** If a schema change is needed, run the `db-migrator` agent first and wait; other slices build on it.
3. **Build in parallel.** Spawn one `implementer` (or `ui-i18n` for front-end slices) per slice in a single message. Use `isolation: "worktree"` when slices run at the same time; each worktree needs `pnpm install --frozen-lockfile` and a copy of `.env` (copy it with a shell command; don't print it).
4. **Merge.** Cherry-pick or merge each slice's commit onto the working branch. Resolve conflicts yourself.
5. **Verify.** Run the `verify` skill. For user-facing changes, run `e2e-checker` against the dev server. Spawn `test-writer` if coverage is thin.
6. **Review.** Run `reviewer` on the combined diff. Fix real findings, ignore nits.
7. **Commit locally.** Never push without the user asking. If a migration was added, say: "prod needs migration NNNN before pushing".

Report: slices, commits, checks run with results, open issues.
