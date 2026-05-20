import { describe, expect, it } from "vitest";
import type { AiTraderReviewSnapshot } from "@stratium/shared";
import {
  createTradeReviewMemories,
  normalizeTradeReviewSnapshot,
  shouldRefreshTradeReview,
  TRADE_REVIEW_MEMORY_KEY
} from "../src/runtime/tradeReview.js";
import type { TraderBotPlannerContext } from "../src/types.js";

const baseContext = (memories: TraderBotPlannerContext["memories"] = []): TraderBotPlannerContext => ({
  config: {
    botId: "bot-a",
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
    botId: "bot-a",
    symbol: "BTC-USD",
    priority: "manual",
    reasons: ["manual_admin"],
    requestedAt: "2026-05-20T00:00:00.000Z",
    source: "admin"
  },
  market: {
    symbol: "BTC-USD",
    bid: 99,
    ask: 101,
    last: 100,
    timestamp: "2026-05-20T00:00:00.000Z"
  },
  account: {
    equity: 10_000,
    availableMargin: 10_000,
    currentPositionNotional: 0
  },
  memories,
  now: "2026-05-20T00:30:00.000Z"
});

const review: AiTraderReviewSnapshot = {
  schemaVersion: "stratium.ai-trader-review.v1",
  botId: "bot-a",
  accountId: "paper-account-1",
  symbol: "BTC-USD",
  generatedAt: "2026-05-20T00:30:00.000Z",
  reportLimit: 200,
  wakeStats: {
    total: 50,
    completed: 50,
    failed: 0,
    approvedActions: 60,
    rejectedActions: 0
  },
  orderStats: {
    total: 20,
    open: 0,
    filled: 18,
    canceled: 2,
    rejected: 0,
    marketFilled: 12,
    limitFilled: 6,
    bySide: {
      buy: 10,
      sell: 10
    },
    byType: {
      market: 12,
      limit: 8
    },
    byStatus: {
      FILLED: 18,
      CANCELED: 2
    }
  },
  currentPosition: {
    symbol: "BTC-USD",
    side: "flat",
    quantity: 0,
    averageEntryPrice: 0,
    markPrice: 100,
    realizedPnl: -1.2,
    unrealizedPnl: 0
  },
  recentWakes: [],
  observations: ["Realized PnL is negative; reduce churn."]
};

describe("trade review memories", () => {
  it("normalizes review payloads from MCP raw wrappers", () => {
    expect(normalizeTradeReviewSnapshot({ raw: { review } })).toEqual(review);
  });

  it("refreshes when no review memory exists", () => {
    expect(shouldRefreshTradeReview(baseContext(), {
      tradeReviewIntervalMs: 1_800_000,
      tradeReviewMinWakes: 25
    })).toBe(true);
  });

  it("creates a reflection memory with review lessons", () => {
    const memories = createTradeReviewMemories(baseContext(), review);
    const reflection = memories.find((memory) => memory.key === TRADE_REVIEW_MEMORY_KEY);

    expect(reflection?.source).toBe("reflection");
    expect(reflection?.value).toContain("Realized PnL is negative");
    expect(reflection?.value).toContain("marketFilled=12");
  });
});
