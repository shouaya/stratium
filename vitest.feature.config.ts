import { defineConfig } from "vitest/config";
import path from "node:path";

const isUnifiedCoverage = process.env.UNIFIED_VITEST_COVERAGE === "1";
const unifiedCoverageDir = process.env.UNIFIED_VITEST_COVERAGE_DIR;

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
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    setupFiles: ["./tests/feature/setup-env.ts"],
    globalSetup: ["./tests/feature/global-setup.ts"],
    sequence: {
      groupOrder: 1
    },
    ...(isUnifiedCoverage
      ? {
          coverage: {
            all: true,
            reporter: ["json"],
            reportsDirectory: unifiedCoverageDir,
            include: [
              "apps/api/src/**/*.ts",
              "apps/trader-mcp/src/**/*.ts",
              "packages/trading-core/src/**/*.ts",
              "packages/shared/src/**/*.ts"
            ],
            exclude: [
              "**/*.d.ts",
              "**/dist/**",
              "**/coverage/**",
              "apps/api/src/index.ts",
              "apps/trader-mcp/src/index.ts",
              "apps/trader-mcp/src/client.ts",
              "apps/trader-mcp/src/server.ts",
              "packages/shared/src/index.ts",
              "packages/trading-core/src/index.ts",
              "packages/trading-core/src/engine/handler-types.ts"
            ]
          }
        }
      : {})
  }
});
