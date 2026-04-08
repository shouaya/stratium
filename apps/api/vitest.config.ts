import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@stratium/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
      "@stratium/trading-core": path.resolve(__dirname, "../../packages/trading-core/src/index.ts")
    }
  },
  test: {
    coverage: {
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
      thresholds: {
        statements: 90,
        lines: 90,
        functions: 90
      }
    }
  }
});
