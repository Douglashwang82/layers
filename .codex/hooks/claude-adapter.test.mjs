import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const sourceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "locallink-codex-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of [".codex/hooks", ".claude/hooks", "apps/web", "docs"])
    mkdirSync(path.join(root, dir), { recursive: true });
  copyFileSync(
    path.join(sourceRoot, ".codex/hooks/claude-adapter.mjs"),
    path.join(root, ".codex/hooks/claude-adapter.mjs"),
  );
  const run = (mode, input = {}) =>
    spawnSync(
      process.execPath,
      [path.join(root, ".codex/hooks/claude-adapter.mjs"), mode],
      {
        cwd: path.join(root, "apps/web"),
        input: JSON.stringify({ cwd: root, ...input }),
        encoding: "utf8",
        env: {
          ...process.env,
          DATABASE_URL: "postgresql://example.invalid/test",
        },
      },
    );
  return { root, run };
}

test("Codex shell input reaches the existing remote database guard", (t) => {
  const { root, run } = fixture(t);
  copyFileSync(
    path.join(sourceRoot, ".claude/hooks/guard-shell.mjs"),
    path.join(root, ".claude/hooks/guard-shell.mjs"),
  );
  assert.equal(
    run("guard", { tool_input: { cmd: "pnpm db:migrate" } }).status,
    2,
  );
  assert.equal(
    run("guard", { tool_input: { command: "pnpm typecheck" } }).status,
    0,
  );
});

test("patch formatting targets changed files, excluding protected and outside paths", (t) => {
  const { root, run } = fixture(t);
  writeFileSync(
    path.join(root, ".claude/hooks/format.mjs"),
    `import { readFileSync, appendFileSync } from 'node:fs'; const data = JSON.parse(readFileSync(0, 'utf8')); appendFileSync(process.env.CLAUDE_PROJECT_DIR + '/calls.jsonl', JSON.stringify(data.tool_input) + '\\n');`,
  );
  for (const file of [
    "apps/web/new.md",
    "apps/web/moved.md",
    "docs/dev-notes.md",
  ])
    writeFileSync(path.join(root, file), "untouched");
  const result = run("format", {
    tool_name: "apply_patch",
    tool_input: {
      command:
        "*** Begin Patch\n*** Add File: apps/web/new.md\n+text\n*** Update File: apps/web/old.md\n*** Move to: apps/web/moved.md\n*** Update File: docs/dev-notes.md\n*** Update File: ../outside.md\n*** End Patch",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const files = readFileSync(path.join(root, "calls.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) =>
      path.relative(root, JSON.parse(line).file_path).replaceAll("\\", "/"),
    );
  assert.deepEqual(files, ["apps/web/new.md", "apps/web/moved.md"]);
});

test("Stop preserves existing E2E declaration edits and avoids continuation loops", (t) => {
  const { root, run } = fixture(t);
  const file = path.join(root, "apps/web/next-env.d.ts");
  const contents = '// user edit\nimport "./.next/e2e/types/routes.d.ts";\n';
  writeFileSync(file, contents);
  // The shared gate must not run in this case.
  writeFileSync(
    path.join(root, ".claude/hooks/stop-gate.mjs"),
    "process.exit(99);",
  );
  assert.equal(run("stop").status, 2);
  const repeated = run("stop", { stop_hook_active: true });
  assert.equal(repeated.status, 0);
  assert.deepEqual(JSON.parse(repeated.stdout), {});
  assert.equal(readFileSync(file, "utf8"), contents);
});

test("Stop delegates normal checks and preserves a blocking exit status", (t) => {
  const { root, run } = fixture(t);
  const script = path.join(root, ".claude/hooks/stop-gate.mjs");
  writeFileSync(
    script,
    'process.stderr.write("typecheck failed"); process.exit(2);',
  );
  assert.equal(run("stop").status, 2);
  writeFileSync(script, "process.exit(0);");
  const result = run("stop");
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), {});
});
