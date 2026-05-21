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
    },
    {
      key: "strategy_memo/all/latest",
      value: "Analyst says only trade setups that overcome fees.",
      importance: 0.9,
      source: "strategy_package"
    },
    {
      key: "platform/ai_language",
      value: "zh",
      importance: 1,
      source: "manual"
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
    expect(prompt).toContain("Simplified Chinese");
    expect(prompt).toContain("简短总结");
    expect(prompt).toContain("strategy_memo/* and global_review/*");
    expect(prompt).toContain("Analyst says only trade setups that overcome fees.");
  });

  it("includes the governance conflict priority in the prompt", () => {
    const prompt = buildPrompt(context);

    expect(prompt).toContain("hard risk policy > live account / position / open orders > bot-specific analyst memo > latest bot trade review facts > global analyst memo > last wake summary > stale memories");
    expect(prompt).toContain("Analyst memos can change strategy bias, but they never override the current account, position, open orders, or local risk policy.");
    expect(prompt).toContain("state the conflict in riskNotes");
  });

  it("orders selected memories by governance priority", () => {
    const prompt = buildPrompt({
      ...context,
      memories: [
        {
          key: "runtime/last_wake_summary",
          value: "last wake",
          importance: 1
        },
        {
          key: "strategy_memo/all/latest",
          value: "all bots memo",
          importance: 1
        },
        {
          key: "global_review/latest",
          value: "global review",
          importance: 1
        },
        {
          key: "reflection/trade_review/latest",
          value: "trade review",
          importance: 1
        },
        {
          key: "strategy_memo/test-bot/latest",
          value: "targeted memo",
          importance: 1
        },
        {
          key: "state/open_orders",
          value: "[]",
          importance: 1
        }
      ]
    });

    const openOrdersIndex = prompt.indexOf('"key": "state/open_orders"');
    const targetedMemoIndex = prompt.indexOf('"key": "strategy_memo/test-bot/latest"');
    const tradeReviewIndex = prompt.indexOf('"key": "reflection/trade_review/latest"');
    const globalReviewIndex = prompt.indexOf('"key": "global_review/latest"');
    const allMemoIndex = prompt.indexOf('"key": "strategy_memo/all/latest"');
    const lastWakeIndex = prompt.indexOf('"key": "runtime/last_wake_summary"');

    expect(openOrdersIndex).toBeGreaterThanOrEqual(0);
    expect(targetedMemoIndex).toBeGreaterThan(openOrdersIndex);
    expect(tradeReviewIndex).toBeGreaterThan(targetedMemoIndex);
    expect(globalReviewIndex).toBeGreaterThan(tradeReviewIndex);
    expect(allMemoIndex).toBeGreaterThan(globalReviewIndex);
    expect(lastWakeIndex).toBeGreaterThan(allMemoIndex);
  });
});
