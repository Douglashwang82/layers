import "dotenv/config";
import path from "node:path";
import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "apps/web/src") } },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 20000,
    fileParallelism: false,
  },
});
