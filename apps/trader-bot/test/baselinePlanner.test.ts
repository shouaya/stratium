import { describe, expect, it } from "vitest";
import type { AiTraderPlan } from "@stratium/shared";
import { createBaselinePlanner } from "../src/planner/baselinePlanner.js";
import type { TraderBotPlannerContext } from "../src/types.js";

const createContext = (overrides: Partial<TraderBotPlannerContext> = {}): TraderBotPlannerContext => ({
  config: {
    botId: "test-bot",
    mode: "paper_execute",
    planner: "baseline",
    runtimeTarget: "stratium_native",
    activeSymbol: "BTC-USD",
    wakeIntervalMs: 300_000,
    riskPolicy: {
      allowedSymbols: ["BTC-USD"],
      maxActionsPerWake: 3,
      maxOrderNotional: 100,
      maxPositionNotional: 500,
      requireInvalidationPrice: true,
      allowOpeningOrders: true
    }
  },
  wakeRequest: {
    id: "wake-1",
    botId: "test-bot",
    symbol: "BTC-USD",
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
    currentPositionNotional: 0,
    position: {
      symbol: "BTC-USD",
      side: "flat",
      quantity: 0,
      notional: 0
    }
  },
  memories: [{
    key: "state/open_orders",
    value: "[]"
  }],
  now: "2026-05-19T00:00:00.000Z",
  ...overrides
});

describe("createBaselinePlanner", () => {
  it("creates a tiny executable probe order when flat", async () => {
    const plan = await createBaselinePlanner().plan(createContext()) as AiTraderPlan;

    expect(plan.candidates[0]?.id).toBe("baseline-market-probe");
    expect(plan.candidates[0]?.actions[0]).toMatchObject({
      type: "place_order",
      symbol: "BTC-USD",
      side: "buy",
      orderType: "market",
      invalidationPrice: expect.any(Number)
    });
  });

  it("closes an existing probe position before opening another one", async () => {
    const plan = await createBaselinePlanner().plan(createContext({
      account: {
        equity: 10_000,
        availableMargin: 9_000,
        currentPositionNotional: 50,
        position: {
          symbol: "BTC-USD",
          side: "long",
          quantity: 0.0005,
          notional: 50
        }
      }
    })) as AiTraderPlan;

    expect(plan.candidates[0]?.actions[0]).toMatchObject({
      type: "close_position",
      symbol: "BTC-USD"
    });
  });
});
