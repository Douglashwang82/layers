import "dotenv/config";
import path from "node:path";
import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "apps/web/src") } },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 20000,
    fileParallelism: false,
    env: {
      MEMBERSHIP_MODE: "invite_only",
      // Test-only key so mail_outbox encryption has something to work with;
      // never used outside this test run.
      MAIL_OUTBOX_ENCRYPTION_KEY: "3HWCF7wU3kwiYI6i1Is5LdG9F6g/G40g4iBTgBVYS30=",
    },
  },
});
