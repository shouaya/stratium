import { describe, expect, it } from "vitest";
import { BASE_TRADER_PLAYBOOK, buildPrompt } from "../src/planner/promptBuilder.js";
import type { TraderBotPlannerContext } from "../src/types.js";

const context: TraderBotPlannerContext = {
  config: {
    botId: "test-bot",
    mode: "paper_execute",
    planner: "codex",
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
    requestedAt: "2026-05-20T00:00:00.000Z",
    source: "admin"
  },
  market: {
    symbol: "BTC-USD",
    bid: 70_000,
    ask: 70_001,
    last: 70_000.5,
    timestamp: "2026-05-20T00:00:00.000Z",
    indicators: {
      rsi: 52,
      atr: 180,
      return5mPct: 0.1
    }
  },
  account: {
    equity: 10_000,
    availableMargin: 9_500,
    currentPositionNotional: 0,
    position: {
      symbol: "BTC-USD",
      side: "flat",
      quantity: 0,
      notional: 0
    }
  },
  memories: [
    {
      key: "runtime/last_wake_summary",
      value: "Prior wake waited for pullback confirmation.",
      importance: 0.99
    }
  ],
  now: "2026-05-20T00:00:00.000Z"
};

describe("buildPrompt", () => {
  it("includes the base trader skill playbook in every Codex prompt", () => {
    const prompt = buildPrompt(context);

    expect(prompt).toContain("You have a basic trader skill pack");
    expect(prompt).toContain("market regime");
    expect(prompt).toContain("invalidation");
    expect(prompt).toContain("baseTraderPlaybook");
    expect(prompt).toContain(BASE_TRADER_PLAYBOOK.identity);
  });
});
