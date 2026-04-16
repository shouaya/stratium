import { defineConfig } from "vitest/config";
import path from "node:path";

const isUnifiedCoverage = process.env.UNIFIED_VITEST_COVERAGE === "1";
const unifiedCoverageDir = process.env.UNIFIED_VITEST_COVERAGE_DIR;

export default defineConfig({
  resolve: {
    alias: {
      "@stratium/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
      "@stratium/trading-core": path.resolve(__dirname, "../../packages/trading-core/src/index.ts")
    }
  },
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/feature/**/*.test.ts"],
    coverage: {
      ...(isUnifiedCoverage
        ? {
            all: true,
            reporter: ["json"],
            reportsDirectory: unifiedCoverageDir,
            include: ["src/**/*.ts"],
            exclude: [
              "src/index.ts",
              "src/platform/platform-bot-auth.ts",
              "src/platform/platform-exchange.ts",
              "src/platform/platform-private-ws.ts"
            ]
          }
        : {
            include: ["src/**/*.ts"],
            exclude: [
              "src/index.ts",
              "src/market-data.ts",
              "src/bootstrap.ts",
              "src/okx-market.ts",
              "src/runtime.ts",
              "src/routes.ts",
              "src/batch-job-runner.ts",
              "src/hyperliquid-exchange.ts",
              "src/locale.ts"
            ]
          }),
      ...(isUnifiedCoverage
        ? {}
        : {
            thresholds: {
              branches: 90,
              statements: 90,
              lines: 90,
              functions: 90
            }
          })
    }
  }
});
