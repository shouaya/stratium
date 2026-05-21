import { describe, expect, it } from "vitest";
import { evaluateRisk } from "../src/runtime/riskGate.js";
import type { TraderBotAccountSnapshot, TraderBotMarketSnapshot, TraderBotRiskPolicy } from "../src/types.js";
import type { AiTraderPlanCandidate } from "@stratium/shared";

const policy: TraderBotRiskPolicy = {
  allowedSymbols: ["BTC-USD"],
  maxActionsPerWake: 3,
  maxOrderNotional: 100,
  maxPositionNotional: 200,
  requireInvalidationPrice: true,
  allowOpeningOrders: true
};

const market: TraderBotMarketSnapshot = {
  symbol: "BTC-USD",
  bid: 99_990,
  ask: 100_010,
  last: 100_000,
  timestamp: "2026-05-19T00:00:00.000Z"
};

const account: TraderBotAccountSnapshot = {
  equity: 10_000,
  availableMargin: 10_000,
  currentPositionNotional: 0
};

const longAccount: TraderBotAccountSnapshot = {
  equity: 10_000,
  availableMargin: 9_500,
  currentPositionNotional: 100,
  position: {
    symbol: "BTC-USD",
    side: "long",
    quantity: 0.001,
    notional: 100
  }
};

describe("evaluateRisk", () => {
  it("approves observe-only candidates", () => {
    const candidate: AiTraderPlanCandidate = {
      id: "observe",
      thesis: "wait",
      confidence: 0.6,
      actions: [
        {
          type: "observe",
          reason: "no setup"
        }
      ]
    };

    const decision = evaluateRisk({ mode: "shadow", policy, market, account, candidate });

    expect(decision.approved).toBe(true);
    expect(decision.approvedActions).toHaveLength(1);
    expect(decision.rejectedActions).toHaveLength(0);
  });

  it("rejects opening orders without invalidation price", () => {
    const candidate: AiTraderPlanCandidate = {
      id: "open",
      thesis: "breakout",
      confidence: 0.6,
      actions: [
        {
          type: "place_order",
          symbol: "BTC-USD",
          side: "buy",
          orderType: "limit",
          price: 100_000,
          quantity: 0.001,
          reason: "breakout continuation"
        }
      ]
    };

    const decision = evaluateRisk({ mode: "shadow", policy, market, account, candidate });

    expect(decision.approved).toBe(false);
    expect(decision.rejectedActions[0].reasons.some((entry) => entry.rule.includes("invalidation_required"))).toBe(true);
  });

  it("rejects orders above the notional limit", () => {
    const candidate: AiTraderPlanCandidate = {
      id: "too-large",
      thesis: "oversized",
      confidence: 0.6,
      actions: [
        {
          type: "place_order",
          symbol: "BTC-USD",
          side: "buy",
          orderType: "market",
          quantity: 1,
          invalidationPrice: 99_000,
          reason: "too large"
        }
      ]
    };

    const decision = evaluateRisk({ mode: "shadow", policy, market, account, candidate });

    expect(decision.approved).toBe(false);
    expect(decision.rejectedActions[0].reasons.some((entry) => entry.rule.includes("max_order_notional"))).toBe(true);
  });

  it("rejects opening orders in reduce-only mode", () => {
    const candidate: AiTraderPlanCandidate = {
      id: "open",
      thesis: "not allowed",
      confidence: 0.6,
      actions: [
        {
          type: "place_order",
          symbol: "BTC-USD",
          side: "buy",
          orderType: "market",
          quantity: 0.0005,
          invalidationPrice: 99_000,
          reason: "mode should reject"
        }
      ]
    };

    const decision = evaluateRisk({ mode: "reduce_only", policy, market, account: longAccount, candidate });

    expect(decision.approved).toBe(false);
    expect(decision.rejectedActions[0].reasons.some((entry) => entry.rule.includes("mode_allows_opening"))).toBe(true);
  });

  it("approves close_position actions in reduce-only mode", () => {
    const candidate: AiTraderPlanCandidate = {
      id: "close",
      thesis: "risk-off exit",
      confidence: 0.7,
      actions: [
        {
          type: "close_position",
          symbol: "BTC-USD",
          reason: "reduce risk"
        }
      ]
    };

    const decision = evaluateRisk({ mode: "reduce_only", policy, market, account: longAccount, candidate });

    expect(decision.approved).toBe(true);
    expect(decision.approvedActions).toHaveLength(1);
    expect(decision.rejectedActions).toHaveLength(0);
  });

  it("approves explicit reduce-only place orders in reduce-only mode", () => {
    const candidate: AiTraderPlanCandidate = {
      id: "reduce",
      thesis: "reduce partial exposure",
      confidence: 0.7,
      actions: [
        {
          type: "place_order",
          symbol: "BTC-USD",
          side: "sell",
          orderType: "market",
          quantity: 0.0005,
          reduceOnly: true,
          reason: "reduce partial exposure"
        }
      ]
    };

    const decision = evaluateRisk({ mode: "reduce_only", policy, market, account: longAccount, candidate });

    expect(decision.approved).toBe(true);
    expect(decision.approvedActions).toHaveLength(1);
    expect(decision.rejectedActions).toHaveLength(0);
  });

  it("rejects reduce-only place orders when no position exists", () => {
    const candidate: AiTraderPlanCandidate = {
      id: "reduce-flat",
      thesis: "cannot reduce flat account",
      confidence: 0.7,
      actions: [
        {
          type: "place_order",
          symbol: "BTC-USD",
          side: "sell",
          orderType: "market",
          quantity: 0.0005,
          reduceOnly: true,
          reason: "flat account"
        }
      ]
    };

    const decision = evaluateRisk({ mode: "reduce_only", policy, market, account, candidate });

    expect(decision.approved).toBe(false);
    expect(decision.rejectedActions[0].reasons.some((entry) => entry.rule.includes("reduce_only_position_exists"))).toBe(true);
  });

  it("rejects cancel orders without an order id or client order id", () => {
    const candidate: AiTraderPlanCandidate = {
      id: "cancel",
      thesis: "cancel stale order",
      confidence: 0.6,
      actions: [
        {
          type: "cancel_order",
          symbol: "BTC-USD",
          reason: "missing target"
        }
      ]
    };

    const decision = evaluateRisk({ mode: "paper_execute", policy, market, account, candidate });

    expect(decision.approved).toBe(false);
    expect(decision.rejectedActions[0].reasons.some((entry) => entry.rule.includes("cancel_target_required"))).toBe(true);
  });
});
