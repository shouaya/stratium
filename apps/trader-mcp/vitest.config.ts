import { defineConfig } from "vitest/config";

const isUnifiedCoverage = process.env.UNIFIED_VITEST_COVERAGE === "1";
const unifiedCoverageDir = process.env.UNIFIED_VITEST_COVERAGE_DIR;

export default defineConfig({
  test: {
    coverage: {
      ...(isUnifiedCoverage
        ? {
            all: true,
            reporter: ["json"],
            reportsDirectory: unifiedCoverageDir,
            include: ["src/**/*.ts"],
            exclude: ["src/index.ts"]
          }
        : {
            include: ["src/client.ts"],
            exclude: ["src/index.ts"]
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
