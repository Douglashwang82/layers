---
name: model-router
description: Takes a list of tasks, decides for each one whether it needs Opus (deep reasoning, high cost of error) or Sonnet (well-specified, fast, cheaper), then dispatches each task to a subagent running the matching model and reports the combined results. Use this skill whenever the user hands over several tasks at once (a numbered list, bullet list, TODO list, backlog, or "do these: ...") and wants them carried out, asks which model should handle which task, or mentions routing, delegating, or splitting work between Opus and Sonnet, even if they don't say "subagent" or "router". Also use it when a user writes the request in another language (e.g. 中文 "幫我分配這些任務給 opus 或 sonnet").
---

# Model router

You receive a batch of tasks. For each task you pick the cheapest model that will do it well, run it in a subagent on that model, and report back. You are the coordinator: you plan, dispatch, check results, and summarize. You do not do the tasks yourself.

The reason this matters: Opus costs roughly twice as much as Sonnet and is slower, but it is noticeably better when a task is ambiguous, subtle, or expensive to get wrong. Sending everything to Opus wastes money. Sending everything to Sonnet produces confident mistakes on the hard parts. The value of this skill comes from making that call per task.

## Step 1: Break the input into tasks

Turn the user's input into a numbered list of separate tasks. Input might arrive as a markdown list, a paragraph, a pasted issue list, or a file path. Read the file if you are given one.

- If one item actually contains two different jobs ("fix the login bug and update the README"), split it. The two parts may need different models.
- If items are fragments of one job, merge them.
- Look at the codebase quickly (file names, relevant docs) so you understand what each task involves. The routing decision depends on how hard the task really is, not on how it is worded. "Fix the typo in checkout" is trivial. "Fix the double-charge in checkout" is not.
- Record dependencies: task B depends on task A if B needs A's output, or if both will edit the same files. Tasks that edit the same files must not run in parallel.

If a task is so vague that you cannot tell what "done" means, ask the user about that task only. Keep going with the rest.

## Step 2: Route each task

Choose **Opus** when one or more of these apply:

- **Open-ended or ambiguous.** The task needs design decisions, tradeoffs, or interpreting what the user really wants.
- **Subtle correctness.** Concurrency, locking, transactions, auth/permissions, security, money, data migrations, time zones, or anything where a plausible-looking wrong answer is dangerous.
- **Unknown root cause.** Debugging a failure whose cause isn't known yet, or problems spread across several layers.
- **Wide scope.** Changes that touch many files, cross-module refactors, architecture work, long multi-step work that needs a coherent plan.
- **High cost of error.** Mistakes would be hard to notice, hard to undo, or would affect production, users, or data.
- **Heavy synthesis.** Research that requires weighing conflicting sources, or reviewing code for real bugs rather than style issues.

Choose **Sonnet** when the task is:

- **Well specified and local.** The inputs and the expected result are clear, and the change is limited to one area.
- **Pattern-following.** Adding a field, endpoint, or test that mirrors existing code, renames, boilerplate, config tweaks.
- **Mechanical.** Formatting, translating copy, updating docs to match code, fixing lint or type errors that have obvious fixes.
- **Search, extract, or summarize.** Finding where something is used, listing files, summarizing a document or a diff.
- **Easy to verify.** A test run, type check, or quick look will clearly show whether the result is correct.

**Tie-breakers.**
- If you are unsure and a mistake would be costly, choose Opus. If you are unsure and a mistake would be cheap and easy to catch, choose Sonnet.
- Length is not difficulty. A long mechanical task goes to Sonnet. A short but subtle task goes to Opus.
- The user can override you. If they say "use opus for #3" or "everything on sonnet", follow it and note the override in the plan.

Give every routing decision a one-line reason that names the specific signal. "Touches RSVP capacity locking" is a useful reason. "Complex task" is not.

## Step 3: Show the plan

Before you dispatch anything, show the routing plan in the user's language:

```
| # | Task | Model | Reason | Depends on |
|---|------|-------|--------|------------|
| 1 | Fix race in RSVP capacity check | Opus | Row locking + concurrency; subtle correctness | — |
| 2 | Add zh-TW strings for new filter labels | Sonnet | Mechanical copy in existing dictionary | — |
| 3 | Write tests for the RSVP fix | Sonnet | Follows existing test patterns | 1 |
```

Then continue to dispatch. Don't wait for approval unless one of these is true:

- The user asked for a plan only, a dry run, or a review before running. In that case stop after the table.
- A task involves an outward-facing or hard-to-reverse action: pushing, deploying, sending messages, deleting data, or touching production. Ask for confirmation of that task and dispatch the others.

## Step 4: Dispatch subagents

Call the `Agent` tool once per task:

- `model`: `"opus"` or `"sonnet"`, matching the plan.
- `subagent_type`: `"Explore"` for read-only search or research tasks, and `"general-purpose"` for anything that edits files or runs commands.
- `description`: a 3–5 word label, for example `"#2 zh-TW filter strings"`.
- `prompt`: a self-contained brief (see below).

**Run tasks in parallel when possible.** Put all independent tasks in a single message with several `Agent` calls, so they run at the same time. For a dependency chain, wait for the earlier task's result, then pass the relevant parts of it (files changed, decisions made, anything the next task needs) into the next task's prompt. Tasks that edit the same files run one after another, even if they don't otherwise depend on each other, because parallel edits to the same file overwrite each other.

**Write each subagent prompt so it stands alone.** A subagent starts with no knowledge of this conversation. Include:

1. The task itself, stated fully, with the user's own wording where it matters.
2. The context you already found: relevant file paths, conventions, and constraints from the user or from project instructions such as `AGENTS.md` or `CLAUDE.md`.
3. What done looks like, and which checks to run (tests, lint, typecheck) if the task changes code.
4. The limits: stay within this task, don't commit or push unless the user asked for it, and stop and report instead of guessing if something blocks the task.
5. What to report back: a short summary of what changed (files), the checks that ran and their results, and anything left open or uncertain.

Sonnet in particular does better with a concrete brief: exact files, the pattern to follow, and a clear stopping point. Opus can take a looser goal, but still give it the full context.

## Step 5: Check results and escalate if needed

When results come back, don't just pass them along:

- Check that each report actually answers its task. Spot-check claims that are cheap to verify, such as whether a file exists, whether a test was run, or what the diff looks like.
- If a **Sonnet** task failed, came back uncertain, or was clearly harder than it looked, rerun it **once on Opus**. Give Opus the original brief plus what Sonnet tried and where it got stuck. Record the escalation in your summary. This is how the router corrects its own mistakes.
- If an **Opus** task failed, don't retry blindly. Report the blocker to the user.
- Look for conflicts between tasks that ran in parallel, for example two tasks that changed the same config in different ways.

## Step 6: Final summary

Report back in the user's language:

```
| # | Task | Model | Status | Result |
|---|------|-------|--------|--------|
| 1 | Fix race in RSVP capacity check | Opus | ✅ Done | Added SELECT … FOR UPDATE in rsvp service; integration test passes |
| 2 | Add zh-TW strings | Sonnet | ✅ Done | 6 keys added to dictionary |
| 3 | Write tests for RSVP fix | Sonnet → Opus | ✅ Done | Sonnet's test didn't reproduce the race; Opus rewrote it with concurrent transactions |
```

After the table, list:

- Anything that still needs the user: blocked tasks, open questions, and actions you held back for confirmation.
- Checks that did not run or failed. Never report a check as passed if it was skipped.
- A one-line count, for example "3 tasks: 1 Opus, 2 Sonnet, 1 escalation". This lets the user see how the routing performed.
