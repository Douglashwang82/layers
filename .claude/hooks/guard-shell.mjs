// PreToolUse(Bash|PowerShell): the few guardrails kept in speed-first mode.
// 1. Block commits whose staged diff adds what looks like a real secret.
// 2. Block seeds/migrations/admin scripts when DATABASE_URL points at a non-local host.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const input = JSON.parse(readFileSync(0, "utf8") || "{}");
const command = String(input.tool_input?.command ?? "");

const block = (reason) => {
  process.stderr.write(`Blocked by .claude/hooks/guard-shell.mjs: ${reason}`);
  process.exit(2);
};

const LOCAL_HOSTS = [
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "postgres",
  "db",
  "host.docker.internal",
];
const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

if (/\bgit\b[^|;&]*\bcommit\b/.test(command)) {
  const diff =
    spawnSync("git", ["diff", "--cached", "-U0"], {
      cwd: root,
      encoding: "utf8",
    }).stdout ?? "";
  const added = diff
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"));
  const patterns = [
    /sk-ant-[A-Za-z0-9_-]{20,}/,
    /\bsk-[A-Za-z0-9]{32,}/,
    /\bre_[A-Za-z0-9]{20,}/, // Resend
    /AIza[0-9A-Za-z_-]{30,}/, // Google API key
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  ];
  for (const line of added) {
    if (patterns.some((p) => p.test(line)))
      block("staged changes add what looks like an API key or private key.");
    const url = line.match(/postgres(?:ql)?:\/\/[^\s"'`]+/)?.[0];
    if (
      url &&
      /:\/\/[^:/]+:[^@/]+@/.test(url) &&
      !LOCAL_HOSTS.includes(hostOf(url))
    ) {
      block(
        "staged changes add a database URL with a password for a remote host.",
      );
    }
  }
}

if (
  /\b(db:seed|db:migrate|db:sync-demo-flags|admin:grant|auth:set-password|membership:\w+)\b/.test(
    command,
  )
) {
  const inline = command.match(/DATABASE_URL\s*=\s*["']?([^"'\s;]+)/)?.[1];
  let url = inline ?? process.env.DATABASE_URL;
  if (!url) {
    const envFile = path.join(root, ".env");
    if (existsSync(envFile)) {
      url = readFileSync(envFile, "utf8").match(
        /^\s*DATABASE_URL\s*=\s*["']?([^"'\s]+)/m,
      )?.[1];
    }
  }
  const host = url ? hostOf(url) : "";
  if (host && !LOCAL_HOSTS.includes(host)) {
    block(
      `this script would run against non-local database host "${host}". Ask the user to run it themselves.`,
    );
  }
}
