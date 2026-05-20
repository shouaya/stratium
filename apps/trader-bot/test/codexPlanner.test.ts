import { describe, expect, it } from "vitest";
import { codexPlannerInternals } from "../src/planner/codexPlanner.js";

const config = {
  apiBaseUrl: "http://localhost:6100",
  traderMcpUrl: "http://localhost:4600/mcp",
  botId: "test-bot",
  activeSymbol: "BTC-USD",
  codexBin: "codex",
  codexArgs: ["exec", "--sandbox", "read-only", "--ephemeral"],
  codexPromptMode: "stdin" as const,
  codexTimeoutMs: 180_000,
  codexSessionMode: "resume" as const,
  codexSessionMaxWakes: 40
};

describe("codexPlannerInternals", () => {
  it("builds a non-interactive Codex exec command with stdin prompt mode", () => {
    expect(codexPlannerInternals.codexArgs(config, "prompt-body", "", "/tmp/last-message.json")).toEqual([
      "exec",
      "--json",
      "--output-last-message",
      "/tmp/last-message.json",
      "--sandbox",
      "read-only",
      "--ephemeral",
      "-"
    ]);
    expect(codexPlannerInternals.codexStdin(config, "prompt-body")).toBe("prompt-body");
  });

  it("builds a Codex resume command when a prior session id is available", () => {
    expect(codexPlannerInternals.codexArgs(config, "prompt-body", "11111111-1111-1111-1111-111111111111", "/tmp/last-message.json")).toEqual([
      "exec",
      "--sandbox",
      "read-only",
      "--ephemeral",
      "resume",
      "--json",
      "--output-last-message",
      "/tmp/last-message.json",
      "11111111-1111-1111-1111-111111111111",
      "-"
    ]);
  });

  it("extracts the final plan text from Codex JSONL output if the final-message file is unavailable", () => {
    const plan = JSON.stringify({
      schemaVersion: "stratium.ai-trader-plan.v1",
      summary: "observe",
      candidates: [{
        id: "candidate-1",
        thesis: "wait",
        confidence: 0.5,
        actions: [{ type: "observe", reason: "no setup" }]
      }]
    });

    const jsonl = [
      JSON.stringify({ type: "turn_started" }),
      JSON.stringify({ type: "message", message: { content: [{ text: plan }] } })
    ].join("\n");

    expect(codexPlannerInternals.extractFinalMessageFromJsonl(jsonl)).toBe(plan);
  });

  it("falls back to an active simulation close when Codex emits an invalid executable plan", () => {
    const messages: string[] = [];
    const plan = codexPlannerInternals.parseCodexPlan({
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
        requestedAt: "2026-05-19T00:00:00.000Z",
        source: "admin"
      },
      market: {
        symbol: "BTC-USD",
        bid: 76_000,
        ask: 76_001,
        last: 76_000.5,
        timestamp: "2026-05-19T00:00:00.000Z",
        indicators: {
          rsi: 52,
          return5mPct: 0.02
        }
      },
      account: {
        equity: 10_000,
        availableMargin: 9_900,
        currentPositionNotional: 20,
        position: {
          symbol: "BTC-USD",
          side: "long",
          quantity: 0.0002,
          notional: 20
        }
      },
      memories: [],
      now: "2026-05-19T00:00:00.000Z"
    }, JSON.stringify({
      schemaVersion: "stratium.ai-trader-plan.v1",
      summary: "bad quantity",
      candidates: [{
        id: "bad",
        thesis: "bad quantity",
        confidence: 0.5,
        actions: [{
          type: "place_order",
          symbol: "BTC-USD",
          side: "buy",
          orderType: "market",
          quantity: "all-in",
          invalidationPrice: 75_000,
          reason: "invalid"
        }]
      }]
    }), (message) => messages.push(message));

    expect(plan.candidates[0]).toMatchObject({
      id: "codex-active-sim-close-position",
      actions: [{
        type: "close_position",
        symbol: "BTC-USD"
      }]
    });
    expect(messages.join("\n")).toContain("invalid plan");
  });

  it("replaces observe-only Codex plans with active simulation feedback in paper execution mode", () => {
    const plan = codexPlannerInternals.parseCodexPlan({
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
        requestedAt: "2026-05-19T00:00:00.000Z",
        source: "admin"
      },
      market: {
        symbol: "BTC-USD",
        bid: 76_000,
        ask: 76_001,
        last: 76_000.5,
        timestamp: "2026-05-19T00:00:00.000Z",
        indicators: {
          rsi: 52,
          return5mPct: 0.02
        }
      },
      account: {
        equity: 10_000,
        availableMargin: 9_900,
        currentPositionNotional: 0,
        position: {
          symbol: "BTC-USD",
          side: "flat",
          quantity: 0,
          notional: 0
        }
      },
      memories: [{ key: "state/open_orders", value: "[]" }],
      now: "2026-05-19T00:00:00.000Z"
    }, JSON.stringify({
      schemaVersion: "stratium.ai-trader-plan.v1",
      summary: "observe",
      candidates: [{
        id: "observe",
        thesis: "wait",
        confidence: 0.99,
        expectedReward: 10,
        actions: [{ type: "observe", reason: "wait" }]
      }]
    }), () => undefined);

    expect(plan.candidates).toHaveLength(1);
    expect(plan.candidates[0]).toMatchObject({
      id: "codex-active-sim-market-probe",
      actions: [{ type: "place_order" }]
    });
  });

  it("does not force an active simulation probe when the market is overextended", () => {
    const plan = codexPlannerInternals.parseCodexPlan({
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
        requestedAt: "2026-05-19T00:00:00.000Z",
        source: "admin"
      },
      market: {
        symbol: "BTC-USD",
        bid: 76_000,
        ask: 76_001,
        last: 76_000.5,
        timestamp: "2026-05-19T00:00:00.000Z",
        indicators: {
          rsi: 86,
          return5mPct: 0.2
        }
      },
      account: {
        equity: 10_000,
        availableMargin: 9_900,
        currentPositionNotional: 0,
        position: {
          symbol: "BTC-USD",
          side: "flat",
          quantity: 0,
          notional: 0
        }
      },
      memories: [{ key: "state/open_orders", value: "[]" }],
      now: "2026-05-19T00:00:00.000Z"
    }, JSON.stringify({
      schemaVersion: "stratium.ai-trader-plan.v1",
      summary: "overextended wait",
      candidates: [{
        id: "observe",
        thesis: "The market is too extended to chase.",
        confidence: 0.7,
        expectedReward: 0,
        actions: [{ type: "observe", reason: "Wait for a reset instead of forcing a probe." }]
      }]
    }), () => undefined);

    expect(plan.candidates[0]).toMatchObject({
      id: "observe",
      actions: [{ type: "observe" }]
    });
  });

  it("allows observe-only plans to hold an existing position instead of forcing a close", () => {
    const plan = codexPlannerInternals.parseCodexPlan({
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
        reasons: ["position_review_due"],
        requestedAt: "2026-05-19T00:00:00.000Z",
        source: "scheduler"
      },
      market: {
        symbol: "BTC-USD",
        bid: 76_000,
        ask: 76_001,
        last: 76_000.5,
        timestamp: "2026-05-19T00:00:00.000Z"
      },
      account: {
        equity: 10_000,
        availableMargin: 9_900,
        currentPositionNotional: 50,
        position: {
          symbol: "BTC-USD",
          side: "long",
          quantity: 0.00065,
          notional: 50
        }
      },
      memories: [{ key: "state/open_orders", value: "[]" }],
      now: "2026-05-19T00:00:00.000Z"
    }, JSON.stringify({
      schemaVersion: "stratium.ai-trader-plan.v1",
      summary: "hold the bounded long while invalidation still holds",
      candidates: [{
        id: "hold",
        thesis: "The position remains above invalidation and does not need churn.",
        confidence: 0.62,
        expectedReward: 0.01,
        actions: [{ type: "observe", reason: "Hold the existing long while price remains above invalidation." }]
      }]
    }), () => undefined);

    expect(plan.candidates).toHaveLength(1);
    expect(plan.candidates[0]).toMatchObject({
      id: "hold",
      actions: [{ type: "observe" }]
    });
  });

  it("converts cancel_order with blank ids into observe instead of validation fallback text", () => {
    const plan = codexPlannerInternals.parseCodexPlan({
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
        requestedAt: "2026-05-19T00:00:00.000Z",
        source: "admin"
      },
      market: {
        symbol: "BTC-USD",
        bid: 76_000,
        ask: 76_001,
        last: 76_000.5,
        timestamp: "2026-05-19T00:00:00.000Z"
      },
      account: {
        equity: 10_000,
        availableMargin: 9_900,
        currentPositionNotional: 0,
        position: {
          symbol: "BTC-USD",
          side: "flat",
          quantity: 0,
          notional: 0
        }
      },
      memories: [{ key: "state/open_orders", value: "[]" }],
      now: "2026-05-19T00:00:00.000Z"
    }, JSON.stringify({
      schemaVersion: "stratium.ai-trader-plan.v1",
      summary: "cancel stale order",
      candidates: [{
        id: "cancel",
        thesis: "cancel stale order",
        confidence: 0.7,
        actions: [{
          type: "cancel_order",
          symbol: "BTC-USD",
          orderId: "",
          clientOrderId: "",
          reason: "cancel stale order"
        }]
      }]
    }), () => undefined);

    expect(plan.summary).not.toContain("failed validation");
    expect(plan.candidates[0]).toMatchObject({
      id: "cancel",
      actions: [{ type: "observe" }]
    });
  });

  it("repairs missing symbols with the active symbol before validation fallback", () => {
    const plan = codexPlannerInternals.parseCodexPlan({
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
        requestedAt: "2026-05-19T00:00:00.000Z",
        source: "admin"
      },
      market: {
        symbol: "BTC-USD",
        bid: 76_000,
        ask: 76_001,
        last: 76_000.5,
        timestamp: "2026-05-19T00:00:00.000Z"
      },
      account: {
        equity: 10_000,
        availableMargin: 9_900,
        currentPositionNotional: 0,
        position: {
          symbol: "BTC-USD",
          side: "flat",
          quantity: 0,
          notional: 0
        }
      },
      memories: [{ key: "state/open_orders", value: "[{\"oid\":12345}]" }],
      now: "2026-05-19T00:00:00.000Z"
    }, JSON.stringify({
      schemaVersion: "stratium.ai-trader-plan.v1",
      summary: "cancel stale order",
      candidates: [{
        id: "cancel",
        thesis: "cancel stale order",
        confidence: 0.7,
        actions: [{
          type: "cancel_order",
          orderId: 12345,
          reason: "cancel stale order"
        }]
      }]
    }), () => undefined);

    expect(plan.summary).toBe("cancel stale order");
    expect(plan.candidates[0]).toMatchObject({
      id: "cancel",
      actions: [{
        type: "cancel_order",
        symbol: "BTC-USD",
        orderId: "12345"
      }]
    });
  });
});
