// PostToolUse(Edit|Write): format the touched file and surface leftover lint errors.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const input = JSON.parse(readFileSync(0, "utf8") || "{}");
const file = input.tool_input?.file_path;
if (!file || !existsSync(file)) process.exit(0);

const rel = path.relative(root, file);
if (rel.startsWith("..") || rel.includes("node_modules")) process.exit(0);

const ext = path.extname(file).toLowerCase();
const prettierExts = [
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".css",
  ".yml",
  ".yaml",
];
const eslintExts = [".ts", ".tsx", ".js", ".mjs", ".cjs"];

const bin = (p) => path.join(root, "node_modules", p);
const run = (script, args) =>
  spawnSync(process.execPath, [bin(script), ...args], {
    cwd: root,
    encoding: "utf8",
  });

if (
  prettierExts.includes(ext) &&
  existsSync(bin("prettier/bin/prettier.cjs"))
) {
  run("prettier/bin/prettier.cjs", ["--write", "--log-level", "warn", file]);
}

if (eslintExts.includes(ext) && existsSync(bin("eslint/bin/eslint.js"))) {
  const lint = run("eslint/bin/eslint.js", [
    "--fix",
    "--no-warn-ignored",
    file,
  ]);
  if (lint.status === 1) {
    process.stderr.write(
      `ESLint errors remain in ${rel}:\n${lint.stdout.slice(-3000)}`,
    );
    process.exit(2);
  }
}
