import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const input = JSON.parse(readFileSync(0, "utf8") || "{}");
const mode = process.argv[2];
const scripts = {
  guard: "guard-shell.mjs",
  format: "format.mjs",
  stop: "stop-gate.mjs",
};
if (!Object.hasOwn(scripts, mode)) throw new Error("Unknown shared hook mode");

function run(payload) {
  const result = spawnSync(
    process.execPath,
    [path.join(root, ".claude/hooks", scripts[mode])],
    {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      input: JSON.stringify(payload),
      encoding: "utf8",
      timeout: 120000,
    },
  );
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) process.stderr.write(`${result.error.message}\n`);
  return result.status ?? 2;
}

let status = 0;
if (mode === "guard") {
  status = run({
    ...input,
    tool_input: {
      ...input.tool_input,
      command: input.tool_input?.command ?? input.tool_input?.cmd ?? "",
    },
  });
} else if (mode === "format") {
  const toolInput = input.tool_input ?? {};
  const files = new Set();
  if (toolInput.file_path) files.add(toolInput.file_path);
  if (input.tool_name === "apply_patch") {
    const patch =
      typeof toolInput === "string"
        ? toolInput
        : (toolInput.command ?? toolInput.input ?? "");
    for (const match of patch.matchAll(
      /^\*\*\* (?:Add File|Update File|Move to): (.+)$/gm,
    ))
      files.add(match[1].trim());
  }
  for (const file of files) {
    const absolute = path.resolve(input.cwd || root, file);
    if (!existsSync(absolute)) continue;
    const relative = path.relative(realpathSync(root), realpathSync(absolute));
    if (
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      relative.split(path.sep).includes("node_modules")
    )
      continue;
    // Human-maintained notes must never be rewritten by an agent hook.
    if (relative.replaceAll("\\", "/") === "docs/dev-notes.md") continue;
    status = Math.max(
      status,
      run({ ...input, tool_input: { file_path: absolute } }),
    );
  }
} else {
  const nextEnv = path.join(root, "apps/web/next-env.d.ts");
  if (
    existsSync(nextEnv) &&
    readFileSync(nextEnv, "utf8").includes(".next/e2e/")
  ) {
    if (!input.stop_hook_active) {
      process.stderr.write(
        "Review apps/web/next-env.d.ts for E2E-generated paths and repair only this task's changes; existing edits were preserved.\n",
      );
      status = 2;
    }
  } else {
    status = run(input);
  }
  if (status === 0) process.stdout.write("{}\n");
}
process.exit(status);
