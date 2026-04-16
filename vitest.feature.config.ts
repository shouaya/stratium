import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@stratium/shared": path.resolve(__dirname, "./packages/shared/src/index.ts"),
      "@stratium/trading-core": path.resolve(__dirname, "./packages/trading-core/src/index.ts")
    }
  },
  test: {
    include: ["tests/feature/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    setupFiles: ["./tests/feature/setup-env.ts"],
    globalSetup: ["./tests/feature/global-setup.ts"]
  }
});
