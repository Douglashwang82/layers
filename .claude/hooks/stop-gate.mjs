// Stop: undo the E2E rewrite of next-env.d.ts, then typecheck if TypeScript changed.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const input = JSON.parse(readFileSync(0, "utf8") || "{}");
const git = (...args) =>
  spawnSync("git", args, { cwd: root, encoding: "utf8" }).stdout ?? "";

// Playwright's dev server points next-env.d.ts at .next/e2e; that must never be committed.
const nextEnv = path.join(root, "apps/web/next-env.d.ts");
if (
  existsSync(nextEnv) &&
  readFileSync(nextEnv, "utf8").includes(".next/e2e/")
) {
  git("checkout", "--", "apps/web/next-env.d.ts");
}

// A second stop after a failed gate is let through so Claude can never loop forever.
if (input.stop_hook_active) process.exit(0);

const changed = git("status", "--porcelain")
  .split("\n")
  .some(
    (line) =>
      /\.(ts|tsx)$/.test(line.trim()) && !line.includes("next-env.d.ts"),
  );
if (!changed) process.exit(0);

const tsc = spawnSync(
  process.execPath,
  [path.join(root, "node_modules/typescript/bin/tsc"), "--noEmit"],
  {
    cwd: root,
    encoding: "utf8",
  },
);
if (tsc.status !== 0) {
  process.stderr.write(
    `pnpm typecheck failed; fix these before finishing:\n${tsc.stdout.slice(-4000)}`,
  );
  process.exit(2);
}
