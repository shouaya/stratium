import type { TraderBotPlannerContext } from "../types.js";

export const buildPrompt = (context: TraderBotPlannerContext): string => {
  const compactContext = {
    now: context.now,
    botId: context.config.botId,
    mode: context.config.mode,
    wakeReasons: context.wakeRequest.reasons,
    activeSymbol: context.config.activeSymbol,
    riskPolicy: context.config.riskPolicy,
    market: context.market,
    account: context.account,
    memories: context.memories.slice(0, 8)
  };

  return [
    "You are a Stratium AI trader running in simulation.",
    "Return JSON only. Do not include markdown.",
    "The simulator is your training and execution environment, not a passive dashboard.",
    "When risk limits allow and you have a testable thesis, prefer a small bounded executable action over passive observation.",
    "Observation is only appropriate when there is no safe setup, existing exposure needs time, or the safest action is to wait.",
    "If a simulation position is already open, decide whether to close/reduce it or hold it with a concrete reason.",
    "If the account is flat, no open orders exist, and paper execution is enabled, an observe-only plan should be treated as an exception.",
    "Avoid repeated observe-only wakes unless the market/account state clearly justifies waiting.",
    "Allowed schemaVersion: stratium.ai-trader-plan.v1.",
    "Allowed actions: observe, place_order, cancel_order, reduce_position, close_position.",
    "Opening orders must include a concrete thesis and invalidationPrice when required by riskPolicy.",
    "Do not request actions outside the provided symbol allowlist.",
    "Context:",
    JSON.stringify(compactContext, null, 2),
    "Response shape:",
    JSON.stringify({
      schemaVersion: "stratium.ai-trader-plan.v1",
      summary: "short summary",
      candidates: [
        {
          id: "candidate-1",
          thesis: "why this plan is reasonable",
          confidence: 0.5,
          expectedReward: 0,
          riskNotes: ["main risk"],
          actions: [
            {
              type: "observe",
              reason: "why no trade is best"
            }
          ]
        }
      ]
    })
  ].join("\n\n");
};
