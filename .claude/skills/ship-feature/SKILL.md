---
name: ship-feature
description: Ship a LocalLink feature fast with parallel subagents. Use when the user asks to build a feature that touches the database, API, and UI together. For small or single-layer changes, implement directly and finish with the `reviewer` agent instead — it is cheaper and about as good.
---

# Ship a feature with the agent team

Run this from the main session: subagents cannot spawn subagents, so this orchestration cannot be delegated.

1. **Contract.** Read just enough code to write a short contract file in the scratchpad: the design, exact HTTP paths and request/response shapes, and file ownership per slice. Answer each of these in it:
   - How does the UI get every id the API needs? Name the existing endpoint or payload field.
   - What happens to the new rows when their parent is deleted, merged, re-linked, hidden, or blocked? Default to soft deletion that keeps audit history; never write `ON DELETE CASCADE` over user content without saying why.
   - What happens when two first writes race? Unique violations must become 409s, not 500s.
   - What are the size limits, in bytes as well as characters? 2000 Traditional Chinese characters is about 6 KB of UTF-8.
   - Which existing paths read or write the same table and must change with it, such as the moderation queue, admin tools, and workers?
2. **Review the contract.** Run the `reviewer` agent on the contract file before building anything. Fix the design problems it finds now; one bad decision here gets built into every slice.
3. **Slice.** Split the work into 2–4 slices that don't share files (e.g. schema, service+API+tests, UI+copy). Tell the user the slices in a few lines, then go. Wait for approval only if the behavior is ambiguous.
4. **Build.** Start every slice that doesn't depend on another one right away; UI built against the contract doesn't wait for the schema. Run `db-migrator` first only for slices that need the new columns. Parallel slices each need their own worktree (`git worktree add -b <branch> ../<dir> <base>`, then `pnpm install --frozen-lockfile --prefer-offline`, then copy `.env` with a shell command without printing it). Every slice that needs the database gets its own local database, or exactly one slice migrates.
5. **Merge.** Merge each slice branch onto the working branch and resolve conflicts yourself. Run lint and typecheck on the combined result.
6. **Verify.** Run the `verify` skill. Have `test-writer` add the E2E for the main user flow. Also run the existing E2E specs for every screen the feature touched, to catch regressions.
7. **Review and fix.** Run `reviewer` on the combined diff, then one `implementer` fix pass for real findings (skip nits). Most of the quality comes from this step, so budget for it.
8. **Commit locally.** Never push without the user asking. If a migration was added, say "prod needs migration NNNN before pushing".

Report: the slices, commits, checks run with results, and open issues.
