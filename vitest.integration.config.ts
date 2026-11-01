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
      MAIL_OUTBOX_ENCRYPTION_KEY:
        "3HWCF7wU3kwiYI6i1Is5LdG9F6g/G40g4iBTgBVYS30=",
      // Always the in-memory transport: a local .env pointing at a real
      // provider must never make integration tests send mail.
      MAIL_PROVIDER: "test",
      RESEND_API_KEY: "",
      MAIL_CAPTURE_DIR: "",
      TRUSTED_CLIENT_IP_HEADER: "",
    },
  },
});
