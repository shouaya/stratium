import type { AiTraderPlan, AiTraderPlanAction } from "@stratium/shared";
import type { TraderBotPlanner, TraderBotPlannerContext } from "../types.js";

const roundDown = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.floor(value * factor) / factor;
};

const tinyProbeQuantity = (context: TraderBotPlannerContext) => {
  const referencePrice = Math.max(context.market.last, context.market.ask, context.market.bid);
  const notional = Math.min(
    context.config.riskPolicy.maxOrderNotional * 0.25,
    context.config.riskPolicy.maxPositionNotional * 0.1,
    Math.max(0, context.account.availableMargin * 0.01)
  );

  if (!Number.isFinite(referencePrice) || referencePrice <= 0 || !Number.isFinite(notional) || notional <= 0) {
    return 0;
  }

  return roundDown(notional / referencePrice, 5);
};

const openOrdersMemory = (context: TraderBotPlannerContext) =>
  context.memories.find((memory) => memory.key === "state/open_orders")?.value ?? "[]";

const hasOpenOrders = (context: TraderBotPlannerContext) => {
  try {
    const parsed = JSON.parse(openOrdersMemory(context));
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
};

const observePlan = (context: TraderBotPlannerContext, reason: string): AiTraderPlan => ({
  schemaVersion: "stratium.ai-trader-plan.v1",
  summary: reason,
  candidates: [{
    id: "baseline-observe",
    thesis: reason,
    confidence: 0.5,
    expectedReward: 0,
    riskNotes: ["No trade action is safer for this wake."],
    actions: [{
      type: "observe",
      reason
    }]
  }]
});

const marketProbeAction = (context: TraderBotPlannerContext, quantity: number): AiTraderPlanAction => ({
  type: "place_order",
  symbol: context.config.activeSymbol,
  side: "buy",
  orderType: "market",
  quantity,
  reduceOnly: false,
  timeInForce: "IOC",
  invalidationPrice: Number((context.market.last * 0.995).toFixed(2)),
  takeProfitPrice: Number((context.market.last * 1.006).toFixed(2)),
  reason: "Baseline simulation probe opens a tiny long position so the full execution, risk, and scoring loop can be tested."
});

export const createBaselinePlanner = (): TraderBotPlanner => ({
  plan: async (context: TraderBotPlannerContext): Promise<AiTraderPlan> => {
    const position = context.account.position;

    if (position && position.side !== "flat" && position.quantity > 0) {
      return {
        schemaVersion: "stratium.ai-trader-plan.v1",
        summary: "Baseline planner found an open position and will close it to complete the simulation loop.",
        candidates: [{
          id: "baseline-close-position",
          thesis: `Close the existing ${position.side} ${position.symbol} probe position before opening another one.`,
          confidence: 0.62,
          expectedReward: 0.05,
          riskNotes: ["This is reduce-only position cleanup."],
          actions: [{
            type: "close_position",
            symbol: position.symbol,
            reason: "Baseline planner keeps the starter strategy single-position and closes existing exposure."
          }]
        }]
      };
    }

    if (hasOpenOrders(context)) {
      return observePlan(context, "Baseline planner detected existing open orders and will wait instead of stacking orders.");
    }

    const quantity = tinyProbeQuantity(context);
    if (quantity <= 0) {
      return observePlan(context, "Baseline planner could not size a safe probe order from the current risk policy.");
    }

    return {
      schemaVersion: "stratium.ai-trader-plan.v1",
      summary: "Baseline planner will submit a tiny market probe order in simulation.",
      candidates: [{
        id: "baseline-market-probe",
        thesis: `Use a tiny ${context.config.activeSymbol} market probe to verify that planning, risk, Trader MCP execution, scoring, memory, and admin telemetry all move end-to-end.`,
        confidence: 0.58,
        expectedReward: 0.05,
        riskNotes: [
          "This is not a production alpha strategy.",
          "Order notional is intentionally small and bounded by risk policy.",
          "The next wake should close any resulting position."
        ],
        actions: [marketProbeAction(context, quantity)]
      }]
    };
  }
});
