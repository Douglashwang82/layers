import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
const port = Number(process.env.E2E_PORT ?? 3000);
const origin = `http://localhost:${port}`;
/*
 * Explicit membership/mail settings for browser tests, shared by the web
 * server and the Node-side test process (which runs the outbox worker and
 * reads captured mail). They override local .env values, so neither a
 * default port-3000 origin nor real mail settings leak into a run.
 *
 * The capture directory is created fresh by the runner for every run (never
 * taken from the environment) and removed by tests/e2e/global-teardown.ts.
 * Worker processes also evaluate this file; they inherit the runner's value.
 */
const isWorker = process.env.TEST_WORKER_INDEX !== undefined;
const captureDir =
  isWorker && process.env.E2E_MAIL_CAPTURE_DIR
    ? process.env.E2E_MAIL_CAPTURE_DIR
    : mkdtempSync(path.join(tmpdir(), "taiwanhub-e2e-mail-"));
process.env.E2E_MAIL_CAPTURE_DIR = captureDir;
const membershipEnv: Record<string, string> = {
  // One origin for Better Auth, the app's own origin checks and invitation links.
  BETTER_AUTH_URL: origin,
  NEXT_PUBLIC_APP_URL: origin,
  MEMBERSHIP_MODE: "invite_only",
  MEMBERSHIP_ISSUANCE_PAUSED: "false",
  MAIL_PROVIDER: "capture",
  MAIL_CAPTURE_DIR: captureDir,
  // Test-only key, never used outside browser tests.
  MAIL_OUTBOX_ENCRYPTION_KEY: "3HWCF7wU3kwiYI6i1Is5LdG9F6g/G40g4iBTgBVYS30=",
  RESEND_API_KEY: "",
  TRUSTED_CLIENT_IP_HEADER: "",
};
Object.assign(process.env, membershipEnv);
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: { baseURL: origin, trace: "retain-on-failure" },
  webServer: {
    command: `pnpm --filter @taiwanhub/web dev --port ${port}`,
    url: origin,
    // A reused server can't be shown to have the test database, origin and
    // capture mail settings below, so reuse is opt-in: set
    // E2E_REUSE_SERVER=true only for a server you started with exactly these
    // values (including this run's MAIL_CAPTURE_DIR).
    reuseExistingServer: process.env.E2E_REUSE_SERVER === "true",
    timeout: 120000,
    // Browser tests use the deterministic fake places provider: no live key,
    // no paid requests. A reused server must be started with the same values.
    env: {
      FEATURE_GOOGLE_PLACES_DISCOVERY: "true",
      FEATURE_PLACE_REVIEW_WRITES: "true",
      FEATURE_EXTERNAL_PLACE_COLLECTIONS: "true",
      FEATURE_LAYER_CUSTOM_PLACES: "true",
      NEXT_PUBLIC_GOOGLE_PLACES_UI_KIT_KEY: "fake",
      ...membershipEnv,
    },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
});
