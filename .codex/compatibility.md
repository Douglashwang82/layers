# Shared Claude workflows in Codex

Read the referenced `.claude` skill or agent every time you use its Codex entrypoint. Resolve project paths from the Git repository root. Explicit user instructions and applicable `AGENTS.md` rules take precedence.

- Claude frontmatter `model` and `tools` describe Claude configuration. Use the current Codex model, permissions, and available tools; do not interpret these fields as Codex configuration.
- Use Codex subagent tools for named roles, supplying the matching `.claude/agents/<name>.md` and this guide. If a role is not registered in the current session, read that file and pass its instructions to an available subagent. Delegate only when requested by the user or applicable workflow. Keep orchestration in the main agent.
- Use available browser tools or repository Playwright tests when Playwright MCP is unavailable. Confirm the test database before starting browser/database tests. Report unavailable tools rather than claiming verification.
- Adapt POSIX environment assignments to PowerShell on Windows. Preserve current permissions and existing user authorization; syncing a workflow does not authorize deployment or paid provider calls.
- Never blindly restore `apps/web/next-env.d.ts`: inspect the diff and preserve pre-existing edits. Repair only changes attributable to the current task. This overrides the shared verify workflow's blanket checkout instruction.
- Hooks require runtime support and trust. Do not assume a shared workflow's guard or Stop hook is active. Follow database and verification rules even when hooks are unavailable.

## Maintenance

Workflow bodies and hook implementations stay in `.claude`; edits there are read on the next invocation. Codex discovery metadata (names/descriptions) is in `.agents/skills` and `.codex/agents`. When adding, removing, renaming, or changing the description of a shared skill/agent, update its small Codex entrypoint too. There is no background synchronizer or two-way copying.

Keep `deploy-prod` explicit-only through its `agents/openai.yaml`. Do not import `.claude/settings.local.json` permissions or local state.

`.codex/hooks.json` registers the shell guard, file formatter, and Stop gate through `hooks/claude-adapter.mjs`. The adapter resolves the repository, translates Codex patch inputs, and calls the original scripts. If the Stop gate would restore an E2E-generated declaration file, it instead asks the agent to review that file without changing it. Claude's `Notification` hook is not mapped: Codex has no equivalent event in the documented lifecycle, and its script displays Claude-specific notifications.

After changing configuration, start a new Codex session if entries have not refreshed. In Codex CLI, review and trust hooks with `/hooks`; new or changed definitions are skipped until trusted. Trusting these hooks remains a user action. Config files alone do not prove desktop runtime activation.

References: [skills](https://learn.chatgpt.com/docs/build-skills), [subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents), [hooks](https://learn.chatgpt.com/docs/hooks).
