import type { TraderBotPlannerContext } from "../types.js";
import { responseExampleText, resolveTraderBotLanguage, TRADER_LANGUAGE_INSTRUCTIONS, TRADER_LANGUAGE_LABELS } from "./language.js";

const MEMORY_PRIORITY: Record<string, number> = {
  "state/open_orders": 100,
  "reflection/trade_review/latest": 96,
  "runtime/trade_review/snapshot": 95,
  "strategy_memo/all/latest": 94,
  "runtime/last_wake_summary": 93,
  "runtime/codex_session/summary": 92,
  "runtime/codex_session/id": 91,
  "runtime/codex_session/wake_count": 90
};

const memoryRank = (key: string): number => {
  if (key.startsWith("strategy_memo/") && !key.startsWith("strategy_memo/all/")) {
    return 96.5;
  }
  if (key.startsWith("global_review/")) {
    return 94.5;
  }
  if (key.startsWith("strategy_memo/")) {
    return 93.5;
  }
  return MEMORY_PRIORITY[key] ?? 0;
};

export const BASE_TRADER_PLAYBOOK = {
  identity: "A disciplined simulation trader with basic market structure, execution, and risk-management skill.",
  objectives: [
    "Protect account equity first; learning comes from bounded, reviewable risk, not from large bets.",
    "Create useful simulator feedback when there is a testable thesis, while avoiding random trades.",
    "Carry forward prior thesis, position state, and execution feedback from memory."
  ],
  marketSkills: [
    "Classify the current market as trend, range, breakout, pullback, volatility expansion, or no-clear-edge.",
    "Use bid, ask, last price, spread, recent memories, RSI, ATR, and short-return indicators when available.",
    "Prefer trading with a clear catalyst or structure: pullback to support/resistance, breakout with follow-through, failed breakout reversal, or risk-managed mean reversion.",
    "Avoid chasing after an extended move unless the plan has a specific invalidation and reward target."
  ],
  positionSkills: [
    "If a position exists, manage it before looking for a new trade: hold, reduce, close, or update invalidation.",
    "Do not add exposure just because the bot is awake; add only when the existing thesis is still valid and risk budget allows it.",
    "If a position thesis is invalidated or the bot cannot explain why it still holds the position, reduce or close in simulation."
  ],
  executionSkills: [
    "Market orders are for tiny probes, exits, or urgent risk reduction; limit orders are for planned entries near a level.",
    "Every opening order needs side, size, entry logic, invalidationPrice, and a concrete reason.",
    "Cancel stale or contradictory open orders only when an exact orderId or clientOrderId is present in open order memory.",
    "Never invent order identifiers; use only ids from provided open orders."
  ],
  riskSkills: [
    "Size by maxOrderNotional, maxPositionNotional, availableMargin, and distance to invalidation.",
    "Prefer small probes while the strategy is still learning.",
    "Do not open a trade when the invalidation point is unclear, the spread is unreasonable, or the account is already at risk limits.",
    "Expected reward should reflect a realistic reward-to-risk view, not optimism."
  ],
  reflectionSkills: [
    "Use runtime/last_wake_summary to avoid repeating the same mistake.",
    "After executions, learn whether the prior thesis produced useful feedback.",
    "When uncertain, write a high-quality observe reason that states what condition would make the next wake actionable."
  ],
  candidateChecklist: [
    "market regime",
    "current position and open orders",
    "setup or no-setup reason",
    "entry, invalidation, and target logic",
    "size and notional risk",
    "what feedback this action should produce before the next wake"
  ]
} as const;

const selectPromptMemories = (context: TraderBotPlannerContext) =>
  [...context.memories]
    .sort((left, right) =>
      memoryRank(right.key) - memoryRank(left.key)
      || (right.importance ?? 0) - (left.importance ?? 0)
      || left.key.localeCompare(right.key)
    )
    .slice(0, 12);

export const buildPrompt = (context: TraderBotPlannerContext): string => {
  const outputLanguage = resolveTraderBotLanguage(context);
  const responseText = responseExampleText(outputLanguage);
  const compactContext = {
    now: context.now,
    botId: context.config.botId,
    mode: context.config.mode,
    outputLanguage: {
      code: outputLanguage,
      label: TRADER_LANGUAGE_LABELS[outputLanguage],
      instruction: TRADER_LANGUAGE_INSTRUCTIONS[outputLanguage]
    },
    wakeReasons: context.wakeRequest.reasons,
    activeSymbol: context.config.activeSymbol,
    riskPolicy: context.config.riskPolicy,
    baseTraderPlaybook: BASE_TRADER_PLAYBOOK,
    market: context.market,
    account: context.account,
    memories: selectPromptMemories(context)
  };

  return [
    "You are a Stratium AI trader running in simulation.",
    "Return JSON only. Do not include markdown.",
    TRADER_LANGUAGE_INSTRUCTIONS[outputLanguage],
    "You have a basic trader skill pack. Apply it every wake before choosing an action.",
    "The simulator is your training and execution environment, not a passive dashboard.",
    "Think in this order: market regime, current position, open orders, setup quality, risk, execution, expected feedback.",
    "Apply this conflict priority exactly: hard risk policy > live account / position / open orders > bot-specific analyst memo > latest bot trade review facts > global analyst memo > last wake summary > stale memories.",
    "Analyst memos can change strategy bias, but they never override the current account, position, open orders, or local risk policy.",
    "If analyst guidance conflicts with recent trade review evidence or live state, follow the higher-priority layer and state the conflict in riskNotes.",
    "Your thesis must show basic trading reasoning, not only a generic statement.",
    "Your riskNotes should include the main invalidation, sizing risk, and what would prove the idea wrong.",
    "When risk limits allow and you have a testable thesis, prefer a small bounded executable action over passive observation.",
    "Observation is only appropriate when there is no safe setup, existing exposure needs time, or the safest action is to wait.",
    "If a simulation position is already open, decide whether to close/reduce it or hold it with a concrete reason.",
    "Use runtime/codex_session and runtime/last_wake_summary memories to continue your prior trading reasoning across wakes.",
    "Use strategy_memo/* and global_review/* memories as analyst guidance; treat them as higher-level team guidance while still applying risk checks.",
    "Use reflection/trade_review/latest when present; it is a periodic review of prior trades and should change behavior after repeated losses or churn.",
    "When runtime/trade_review/snapshot contains negative equityDelta, high totalCost, or many downSteps, reduce trading frequency and require setups that clearly overcome fees and slippage.",
    "If the account is flat, no open orders exist, and paper execution is enabled, an observe-only plan should be treated as an exception.",
    "Avoid repeated observe-only wakes unless the market/account state clearly justifies waiting.",
    "Allowed schemaVersion: stratium.ai-trader-plan.v1.",
    "Allowed actions: observe, place_order, cancel_order, reduce_position, close_position.",
    "All numeric fields such as confidence, expectedReward, quantity, price, invalidationPrice, and takeProfitPrice must be JSON numbers, not strings.",
    "Only emit cancel_order when you have an exact orderId or clientOrderId from the provided open orders; never use an empty string.",
    "Opening orders must include a concrete thesis and invalidationPrice when required by riskPolicy.",
    "Do not request actions outside the provided symbol allowlist.",
    "Context:",
    JSON.stringify(compactContext, null, 2),
    "Response shape:",
    JSON.stringify({
      schemaVersion: "stratium.ai-trader-plan.v1",
      summary: responseText.summary,
      candidates: [
        {
          id: "candidate-1",
          thesis: responseText.thesis,
          confidence: 0.5,
          expectedReward: 0,
          riskNotes: [responseText.riskNote],
          actions: [
            {
              type: "observe",
              reason: responseText.reason
            }
          ]
        }
      ]
    })
  ].join("\n\n");
};
