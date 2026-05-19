import { describe, expect, it } from "vitest";
import { createDryRunPlanner } from "../src/planner/dryRunPlanner.js";
import { runWakeCycle } from "../src/runtime/wakeCycle.js";
import type { TraderBotConfig, TraderBotPlannerContext } from "../src/types.js";

const config: TraderBotConfig = {
  botId: "test-bot",
  mode: "shadow",
  planner: "dry-run",
  runtimeTarget: "stratium_native",
  activeSymbol: "BTC-USD",
  wakeIntervalMs: 300_000,
  riskPolicy: {
    allowedSymbols: ["BTC-USD"],
    maxActionsPerWake: 3,
    maxOrderNotional: 100,
    maxPositionNotional: 200,
    requireInvalidationPrice: true,
    allowOpeningOrders: true
  }
};

const createContext = (overrides: Partial<TraderBotPlannerContext> = {}): TraderBotPlannerContext => ({
  config,
  now: "2026-05-19T00:00:00.000Z",
  wakeRequest: {
    id: "wake-1",
    botId: config.botId,
    symbol: config.activeSymbol,
    priority: "manual",
    reasons: ["manual_admin"],
    requestedAt: "2026-05-19T00:00:00.000Z",
    source: "admin"
  },
  market: {
    symbol: "BTC-USD",
    bid: 99_990,
    ask: 100_010,
    last: 100_000,
    timestamp: "2026-05-19T00:00:00.000Z"
  },
  account: {
    equity: 10_000,
    availableMargin: 10_000,
    currentPositionNotional: 0
  },
  memories: [],
  ...overrides
});

describe("runWakeCycle", () => {
  it("runs an observe-only shadow wake", async () => {
    const result = await runWakeCycle(createContext(), createDryRunPlanner());

    expect(result.status).toBe("completed");
    expect(result.selectedCandidate?.id).toBe("dry-run-observe");
    expect(result.riskDecision?.approved).toBe(true);
    expect(result.executionResults[0]).toMatchObject({
      status: "skipped_shadow"
    });
  });

  it("skips disabled bot profiles before planner execution", async () => {
    const result = await runWakeCycle(
      createContext({
        config: {
          ...config,
          mode: "disabled"
        }
      }),
      {
        plan: async () => {
          throw new Error("planner should not be called");
        }
      }
    );

    expect(result.status).toBe("skipped_disabled");
    expect(result.errors).toHaveLength(0);
  });

  it("returns failed status for invalid planner output", async () => {
    const result = await runWakeCycle(createContext(), {
      plan: async () => "not json"
    });

    expect(result.status).toBe("failed");
    expect(result.errors[0]).toContain("JSON");
  });
});
