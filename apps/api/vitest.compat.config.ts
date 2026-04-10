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
    include: [
      "test/hyperliquid-private-ws.test.ts",
      "test/hyperliquid-bot-auth.test.ts"
    ],
    coverage: {
      include: [
        "src/hyperliquid-private-ws.ts",
        "src/hyperliquid-bot-auth.ts"
      ],
      thresholds: {
        branches: 90,
        statements: 90,
        lines: 90,
        functions: 90
      }
    }
  }
});
