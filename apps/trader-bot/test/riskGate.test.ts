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

    const decision = evaluateRisk({ mode: "reduce_only", policy, market, account, candidate });

    expect(decision.approved).toBe(false);
    expect(decision.rejectedActions[0].reasons.some((entry) => entry.rule.includes("mode_allows_opening"))).toBe(true);
  });
});
