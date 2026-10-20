import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
/*
 * Browser tests for the map MVP (docs/plans/layer-mvp-google-links-plan.md).
 * The flag changes the whole map, so these run against their own dev server
 * with FEATURE_MAP_MVP on, after (never alongside) the main suite: two
 * `next dev` instances cannot share the project. Google links resolve through
 * the deterministic fake resolver; no live key, no paid requests.
 */
const server = base.webServer as Exclude<
  NonNullable<typeof base.webServer>,
  unknown[]
>;
export default defineConfig({
  ...base,
  testDir: "./tests/e2e/mvp",
  testIgnore: undefined,
  webServer: {
    ...server,
    env: {
      ...server.env,
      FEATURE_MAP_MVP: "true",
      GOOGLE_MAPS_LINK_API_KEY: "fake",
    },
  },
});
