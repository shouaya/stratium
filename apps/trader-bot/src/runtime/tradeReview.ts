import type { AiTraderReviewSnapshot } from "@stratium/shared";
import type { TraderBotMemory, TraderBotPlannerContext, TraderBotRunnerConfig } from "../types.js";

export const TRADE_REVIEW_MEMORY_KEY = "reflection/trade_review/latest";
export const TRADE_REVIEW_SNAPSHOT_MEMORY_KEY = "runtime/trade_review/snapshot";
export const TRADE_REVIEW_LAST_GENERATED_AT_MEMORY_KEY = "runtime/trade_review/last_generated_at";
export const TRADE_REVIEW_LAST_WAKE_COUNT_MEMORY_KEY = "runtime/trade_review/last_wake_count";

const CODEX_SESSION_WAKE_COUNT_MEMORY_KEY = "runtime/codex_session/wake_count";

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

const memoryValue = (memories: TraderBotMemory[], key: string): string => {
  for (let index = memories.length - 1; index >= 0; index -= 1) {
    const memory = memories[index];
    if (memory.key === key) {
      return memory.value;
    }
  }
  return "";
};

const parseFiniteNumber = (value: string): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const parseTime = (value: string): number | undefined => {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
};

const unwrapReview = (value: unknown): unknown => {
  const record = asRecord(value);
  if (!record) {
    return value;
  }

  const raw = asRecord(record.raw);
  if (raw?.review) {
    return raw.review;
  }

  const summary = asRecord(record.summary);
  if (summary?.review) {
    return summary.review;
  }

  if (record.review) {
    return record.review;
  }

  return value;
};

export const normalizeTradeReviewSnapshot = (value: unknown): AiTraderReviewSnapshot | undefined => {
  const review = asRecord(unwrapReview(value));
  if (!review || review.schemaVersion !== "stratium.ai-trader-review.v1") {
    return undefined;
  }
  return review as AiTraderReviewSnapshot;
};

export const shouldRefreshTradeReview = (
  context: TraderBotPlannerContext,
  config: Pick<TraderBotRunnerConfig, "tradeReviewIntervalMs" | "tradeReviewMinWakes">
): boolean => {
  const lastGeneratedAt = parseTime(memoryValue(context.memories, TRADE_REVIEW_LAST_GENERATED_AT_MEMORY_KEY));
  const currentWakeCount = parseFiniteNumber(memoryValue(context.memories, CODEX_SESSION_WAKE_COUNT_MEMORY_KEY));
  const lastReviewWakeCount = parseFiniteNumber(memoryValue(context.memories, TRADE_REVIEW_LAST_WAKE_COUNT_MEMORY_KEY));
  const now = parseTime(context.now) ?? Date.now();

  if (lastGeneratedAt === undefined) {
    return true;
  }

  if (now - lastGeneratedAt >= config.tradeReviewIntervalMs) {
    return true;
  }

  if (
    currentWakeCount !== undefined
    && lastReviewWakeCount !== undefined
    && currentWakeCount - lastReviewWakeCount >= config.tradeReviewMinWakes
  ) {
    return true;
  }

  return false;
};

const compactSnapshot = (review: AiTraderReviewSnapshot) => ({
  generatedAt: review.generatedAt,
  symbol: review.symbol,
  wakeStats: review.wakeStats,
  orderStats: review.orderStats,
  costStats: review.costStats,
  rewardStats: review.rewardStats,
  candidateStats: review.candidateStats?.slice(0, 8),
  currentPosition: review.currentPosition,
  account: review.account,
  latestMarket: review.latestMarket,
  observations: review.observations
});

const truncate = (value: string, maxLength: number): string =>
  value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;

export const createTradeReviewMemories = (
  context: TraderBotPlannerContext,
  review: AiTraderReviewSnapshot
): TraderBotMemory[] => {
  const wakeCount = memoryValue(context.memories, CODEX_SESSION_WAKE_COUNT_MEMORY_KEY);
  const reviewValue = [
    `Review generated at ${review.generatedAt} for ${review.symbol}.`,
    `Wakes sampled: ${review.wakeStats.total}, approved actions: ${review.wakeStats.approvedActions}, rejected actions: ${review.wakeStats.rejectedActions}.`,
    `Orders: filled=${review.orderStats.filled}, open=${review.orderStats.open}, canceled=${review.orderStats.canceled}, marketFilled=${review.orderStats.marketFilled}, limitFilled=${review.orderStats.limitFilled}.`,
    review.rewardStats
      ? `Reward: equityDelta=${review.rewardStats.equityDelta ?? "n/a"}, realizedPnl=${review.rewardStats.realizedPnl ?? "n/a"}, grossRealizedPnl=${review.rewardStats.grossRealizedPnl ?? "n/a"}, steps=${review.rewardStats.upSteps}up/${review.rewardStats.downSteps}down/${review.rewardStats.flatSteps}flat.`
      : "Reward: unavailable.",
    review.costStats
      ? `Costs: total=${review.costStats.totalCost}, fee=${review.costStats.totalFee}, estSlippage=${review.costStats.estimatedSlippageCost}, fills=${review.costStats.fillCount}, taker=${review.costStats.takerFills}.`
      : "Costs: unavailable.",
    review.currentPosition
      ? `Position: ${review.currentPosition.side} ${review.currentPosition.quantity} ${review.currentPosition.symbol}, realizedPnl=${review.currentPosition.realizedPnl}, unrealizedPnl=${review.currentPosition.unrealizedPnl}.`
      : "Position: unavailable.",
    ...review.observations.map((observation) => `Lesson: ${observation}`)
  ].join("\n");

  return [
    {
      key: TRADE_REVIEW_MEMORY_KEY,
      value: truncate(reviewValue, 4_000),
      importance: 0.985,
      updatedAt: context.now,
      source: "reflection"
    },
    {
      key: TRADE_REVIEW_SNAPSHOT_MEMORY_KEY,
      value: truncate(JSON.stringify(compactSnapshot(review)), 4_000),
      importance: 0.88,
      updatedAt: context.now,
      source: "runtime"
    },
    {
      key: TRADE_REVIEW_LAST_GENERATED_AT_MEMORY_KEY,
      value: context.now,
      importance: 0.72,
      updatedAt: context.now,
      source: "runtime"
    },
    {
      key: TRADE_REVIEW_LAST_WAKE_COUNT_MEMORY_KEY,
      value: wakeCount || "0",
      importance: 0.7,
      updatedAt: context.now,
      source: "runtime"
    }
  ];
};
