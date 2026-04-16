import { defineConfig } from "vitest/config";

const isUnifiedCoverage = process.env.UNIFIED_VITEST_COVERAGE === "1";
const unifiedCoverageDir = process.env.UNIFIED_VITEST_COVERAGE_DIR;

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      include: ["src/**/*.ts"],
      ...(isUnifiedCoverage
        ? {
            all: true,
            reporter: ["json"],
            reportsDirectory: unifiedCoverageDir
          }
        : {})
    }
  }
});
