import { defineConfig, devices } from "@playwright/test";
const port = Number(process.env.E2E_PORT ?? 3000);
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure" },
  webServer: {
    command: `pnpm --filter @taiwanhub/web dev --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    // Browser tests use the deterministic fake places provider: no live key,
    // no paid requests. A reused server must be started with the same values.
    env: {
      FEATURE_GOOGLE_PLACES_DISCOVERY: "true",
      FEATURE_PLACE_REVIEW_WRITES: "true",
      FEATURE_EXTERNAL_PLACE_COLLECTIONS: "true",
      NEXT_PUBLIC_GOOGLE_PLACES_UI_KIT_KEY: "fake",
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
