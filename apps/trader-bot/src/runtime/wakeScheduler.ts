import type { AiTraderWakePriority, AiTraderWakeReason, AiTraderWakeRequest } from "@stratium/shared";
import type { TraderBotMemory, TraderBotPlannerContext, TraderBotWakePolicy, TraderBotWakeResult } from "../types.js";

export type TraderBotWakeIntent = Pick<AiTraderWakeRequest, "priority" | "reasons" | "source">;

export type TraderBotWakeScheduleDecision = TraderBotWakeIntent & {
  intervalMs: number;
  label: string;
};

type MarketSignalState = {
  last?: number;
  rsi?: number;
  atr?: number;
  return5mPct?: number;
  timestamp?: string;
};

const DEFAULT_WAKE_POLICY: TraderBotWakePolicy = {
  heartbeatIntervalMs: 300_000,
  positionReviewIntervalMs: 60_000,
  openOrderReviewIntervalMs: 120_000,
  postExecutionReviewIntervalMs: 15_000,
  riskRetryIntervalMs: 30_000,
  signalReviewIntervalMs: 30_000
};

const MARKET_SIGNAL_MEMORY_KEY = "runtime/market_signal_state";
const OPEN_ORDERS_MEMORY_KEY = "state/open_orders";

const wakePolicy = (context: TraderBotPlannerContext): TraderBotWakePolicy => ({
  ...DEFAULT_WAKE_POLICY,
  ...context.config.wakePolicy,
  heartbeatIntervalMs: context.config.wakePolicy?.heartbeatIntervalMs ?? context.config.wakeIntervalMs
});

const decision = (
  intervalMs: number,
  label: string,
  priority: AiTraderWakePriority,
  reasons: AiTraderWakeReason[],
  source: AiTraderWakeRequest["source"]
): TraderBotWakeScheduleDecision => ({
  intervalMs,
  label,
  priority,
  reasons,
  source
});

const memoryValue = (context: TraderBotPlannerContext, key: string): string => {
  for (let index = context.memories.length - 1; index >= 0; index -= 1) {
    const memory = context.memories[index];
    if (memory.key === key) {
      return memory.value;
    }
  }
  return "";
};

const openOrderCount = (context: TraderBotPlannerContext): number => {
  try {
    const parsed = JSON.parse(memoryValue(context, OPEN_ORDERS_MEMORY_KEY));
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
};

const hasPosition = (context: TraderBotPlannerContext): boolean => {
  const position = context.account.position;
  return Boolean(position && position.side !== "flat" && position.quantity > 0);
};

const hasExecutedAction = (result: TraderBotWakeResult): boolean =>
  result.executionResults.some((entry) => entry.status === "executed" && entry.action.type !== "observe");

const hasExecutionFailure = (result: TraderBotWakeResult): boolean =>
  result.status === "failed" || result.executionResults.some((entry) => entry.status === "failed");

const hasRiskRejection = (result: TraderBotWakeResult): boolean =>
  (result.riskDecision?.rejectedActions.length ?? 0) > 0;

const parseSignalState = (context: TraderBotPlannerContext): MarketSignalState => {
  try {
    const parsed = JSON.parse(memoryValue(context, MARKET_SIGNAL_MEMORY_KEY));
    return parsed && typeof parsed === "object" ? parsed as MarketSignalState : {};
  } catch {
    return {};
  }
};

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const detectMarketSignalReasons = (context: TraderBotPlannerContext): AiTraderWakeReason[] => {
  const previous = parseSignalState(context);
  const currentRsi = finiteNumber(context.market.indicators?.rsi);
  const previousRsi = finiteNumber(previous.rsi);
  const currentLast = finiteNumber(context.market.last);
  const previousLast = finiteNumber(previous.last);
  const reasons = new Set<AiTraderWakeReason>();

  if (currentRsi !== undefined && previousRsi !== undefined) {
    if (previousRsi <= 70 && currentRsi > 70) {
      reasons.add("rsi_cross_up");
    }
    if (previousRsi >= 30 && currentRsi < 30) {
      reasons.add("rsi_cross_down");
    }
    if ((previousRsi < 50 && currentRsi >= 50) || (previousRsi > 50 && currentRsi <= 50)) {
      reasons.add("rsi_reset");
    }
  }

  if (currentLast !== undefined && previousLast !== undefined && previousLast > 0) {
    const movePct = ((currentLast - previousLast) / previousLast) * 100;
    if (movePct >= 0.6) {
      reasons.add("price_breakout");
    }
    if (movePct <= -0.6) {
      reasons.add("price_breakdown");
    }
  }

  return [...reasons];
};

export const createMarketSignalStateMemory = (context: TraderBotPlannerContext): TraderBotMemory => ({
  key: MARKET_SIGNAL_MEMORY_KEY,
  value: JSON.stringify({
    last: context.market.last,
    rsi: context.market.indicators?.rsi,
    atr: context.market.indicators?.atr,
    return5mPct: context.market.indicators?.return5mPct,
    timestamp: context.market.timestamp
  }),
  importance: 0.75,
  updatedAt: context.now,
  source: "runtime"
});

export const selectNextWakeSchedule = (
  context: TraderBotPlannerContext,
  result: TraderBotWakeResult
): TraderBotWakeScheduleDecision => {
  const policy = wakePolicy(context);

  if (hasExecutionFailure(result)) {
    return decision(
      policy.riskRetryIntervalMs,
      "risk retry after execution/planner failure",
      "risk",
      ["execution_error"],
      "risk_monitor"
    );
  }

  if (hasExecutedAction(result)) {
    return decision(
      policy.postExecutionReviewIntervalMs,
      "post-execution position review",
      "position",
      ["position_changed"],
      "account_event"
    );
  }

  if (hasRiskRejection(result)) {
    return decision(
      policy.riskRetryIntervalMs,
      "risk rejection review",
      "risk",
      ["risk_limit_hit"],
      "risk_monitor"
    );
  }

  const signalReasons = detectMarketSignalReasons(context);
  if (signalReasons.length > 0) {
    return decision(
      policy.signalReviewIntervalMs,
      "market signal review",
      "signal",
      signalReasons,
      "market_trigger"
    );
  }

  if (hasPosition(context)) {
    return decision(
      policy.positionReviewIntervalMs,
      "open position review",
      "position",
      ["position_review_due"],
      "scheduler"
    );
  }

  if (openOrderCount(context) > 0) {
    return decision(
      policy.openOrderReviewIntervalMs,
      "open order review",
      "position",
      ["order_review_due"],
      "scheduler"
    );
  }

  return decision(
    policy.heartbeatIntervalMs,
    "flat heartbeat",
    "heartbeat",
    ["heartbeat_due"],
    "scheduler"
  );
};
