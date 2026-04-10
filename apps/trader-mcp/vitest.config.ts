import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      include: ["src/client.ts"],
      exclude: ["src/index.ts"],
      thresholds: {
        branches: 90,
        statements: 90,
        lines: 90,
        functions: 90
      }
    }
  }
});
