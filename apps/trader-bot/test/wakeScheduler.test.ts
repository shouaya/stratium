import { describe, expect, it } from "vitest";
import { createMarketSignalStateMemory, selectNextWakeSchedule } from "../src/runtime/wakeScheduler.js";
import type { TraderBotPlannerContext, TraderBotWakeResult } from "../src/types.js";

const context = (overrides: Partial<TraderBotPlannerContext> = {}): TraderBotPlannerContext => ({
  config: {
    botId: "test-bot",
    mode: "paper_execute",
    planner: "codex",
    runtimeTarget: "stratium_native",
    activeSymbol: "BTC-USD",
    wakeIntervalMs: 300_000,
    wakePolicy: {
      heartbeatIntervalMs: 300_000,
      positionReviewIntervalMs: 60_000,
      openOrderReviewIntervalMs: 120_000,
      postExecutionReviewIntervalMs: 15_000,
      riskRetryIntervalMs: 30_000,
      signalReviewIntervalMs: 30_000
    },
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
    timestamp: "2026-05-20T00:00:00.000Z"
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
  memories: [
    {
      key: "state/open_orders",
      value: "[]"
    }
  ],
  now: "2026-05-20T00:00:00.000Z",
  ...overrides
});

const result = (overrides: Partial<TraderBotWakeResult> = {}): TraderBotWakeResult => ({
  wakeId: "wake-1",
  botId: "test-bot",
  mode: "paper_execute",
  status: "completed",
  startedAt: "2026-05-20T00:00:00.000Z",
  finishedAt: "2026-05-20T00:00:01.000Z",
  prompt: "",
  executionResults: [],
  errors: [],
  ...overrides
});

describe("selectNextWakeSchedule", () => {
  it("uses heartbeat for flat accounts with no open orders", () => {
    expect(selectNextWakeSchedule(context(), result())).toMatchObject({
      intervalMs: 300_000,
      reasons: ["heartbeat_due"],
      label: "flat heartbeat"
    });
  });

  it("reviews open positions more frequently", () => {
    expect(selectNextWakeSchedule(context({
      account: {
        equity: 10_000,
        availableMargin: 9_000,
        currentPositionNotional: 100,
        position: {
          symbol: "BTC-USD",
          side: "long",
          quantity: 0.001,
          notional: 100
        }
      }
    }), result())).toMatchObject({
      intervalMs: 60_000,
      reasons: ["position_review_due"]
    });
  });

  it("reviews open orders faster than flat heartbeat", () => {
    expect(selectNextWakeSchedule(context({
      memories: [{
        key: "state/open_orders",
        value: JSON.stringify([{ oid: 123 }])
      }]
    }), result())).toMatchObject({
      intervalMs: 120_000,
      reasons: ["order_review_due"]
    });
  });

  it("reviews quickly after execution", () => {
    expect(selectNextWakeSchedule(context(), result({
      executionResults: [{
        action: {
          type: "observe",
          reason: "done"
        },
        status: "executed",
        message: "executed"
      }]
    }))).toMatchObject({
      intervalMs: 15_000,
      reasons: ["position_changed"]
    });
  });

  it("detects RSI crosses from prior signal memory", () => {
    expect(selectNextWakeSchedule(context({
      market: {
        symbol: "BTC-USD",
        bid: 70_000,
        ask: 70_001,
        last: 70_000.5,
        timestamp: "2026-05-20T00:00:00.000Z",
        indicators: {
          rsi: 72
        }
      },
      memories: [
        {
          key: "state/open_orders",
          value: "[]"
        },
        {
          key: "runtime/market_signal_state",
          value: JSON.stringify({ last: 69_900, rsi: 68 })
        }
      ]
    }), result())).toMatchObject({
      intervalMs: 30_000,
      reasons: ["rsi_cross_up"],
      source: "market_trigger"
    });
  });

  it("creates market signal state memory", () => {
    expect(createMarketSignalStateMemory(context({
      market: {
        symbol: "BTC-USD",
        bid: 70_000,
        ask: 70_001,
        last: 70_000.5,
        timestamp: "2026-05-20T00:00:00.000Z",
        indicators: {
          rsi: 51,
          atr: 120,
          return5mPct: 0.2
        }
      }
    }))).toMatchObject({
      key: "runtime/market_signal_state",
      source: "runtime"
    });
  });
});
