export type AiTraderMode = "disabled" | "observe" | "shadow" | "approval" | "paper_execute" | "reduce_only";

export type AiTraderRuntimeTarget = "stratium_native" | "external_live_runner";

export type AiTraderExecutionTarget = "stratium_simulation" | "external_broker";

export type AiTraderWakeReason =
  | "heartbeat_due"
  | "manual_admin"
  | "rsi_cross_up"
  | "rsi_cross_down"
  | "rsi_reset"
  | "price_breakout"
  | "price_breakdown"
  | "volatility_expansion"
  | "spread_normalized"
  | "order_filled"
  | "order_review_due"
  | "position_changed"
  | "position_review_due"
  | "risk_limit_hit"
  | "market_data_stale"
  | "execution_error"
  | "reflection_due";

export type AiTraderWakePriority = "risk" | "position" | "manual" | "signal" | "heartbeat" | "reflection";

export type AiTraderWakeRequest = {
  id: string;
  botId: string;
  symbol: string;
  priority: AiTraderWakePriority;
  reasons: AiTraderWakeReason[];
  requestedAt: string;
  notBefore?: string;
  expiresAt?: string;
  source: "scheduler" | "market_trigger" | "account_event" | "risk_monitor" | "admin" | "reflection_job";
  payload?: Record<string, unknown>;
};

export type AiTraderOrderSide = "buy" | "sell";

export type AiTraderOrderType = "market" | "limit";

export type AiTraderPlanAction =
  | {
      type: "observe";
      reason: string;
    }
  | {
      type: "place_order";
      symbol: string;
      side: AiTraderOrderSide;
      orderType: AiTraderOrderType;
      quantity: number;
      price?: number;
      reduceOnly?: boolean;
      timeInForce?: "GTC" | "IOC";
      invalidationPrice?: number;
      takeProfitPrice?: number;
      reason: string;
    }
  | {
      type: "cancel_order";
      symbol: string;
      orderId?: string;
      clientOrderId?: string;
      reason: string;
    }
  | {
      type: "reduce_position" | "close_position";
      symbol: string;
      quantity?: number;
      reason: string;
    };

export type AiTraderPlanCandidate = {
  id: string;
  thesis: string;
  confidence: number;
  expectedReward?: number;
  riskNotes?: string[];
  actions: AiTraderPlanAction[];
};

export type AiTraderPlan = {
  schemaVersion: "stratium.ai-trader-plan.v1";
  summary: string;
  candidates: AiTraderPlanCandidate[];
};

export type AiTraderRiskRuleResult = {
  rule: string;
  passed: boolean;
  message: string;
  severity: "info" | "warning" | "reject";
};

export type AiTraderRiskDecision = {
  approved: boolean;
  approvedActions: AiTraderPlanAction[];
  rejectedActions: Array<{
    action: AiTraderPlanAction;
    reasons: AiTraderRiskRuleResult[];
  }>;
  ruleResults: AiTraderRiskRuleResult[];
};

export type AiTraderWakeStatus = "completed" | "skipped_disabled" | "failed" | "running";

export type AiTraderExecutionStatus = "skipped_shadow" | "pending_approval" | "executed" | "rejected" | "failed";

export type AiTraderWakeExecutionReport = {
  actionType: AiTraderPlanAction["type"] | string;
  status: AiTraderExecutionStatus;
  message?: string;
};

export type AiTraderMemorySnapshot = {
  key: string;
  value: string;
  importance?: number;
  updatedAt?: string;
  source?: "runtime" | "reflection" | "strategy_package" | "manual";
};

export type AiTraderStrategySnapshot = {
  id?: string;
  name: string;
  version?: string;
  status: "draft" | "active" | "paused" | "retired";
  symbol: string;
  mode: AiTraderMode;
  summary: string;
  thesis?: string;
  riskPolicy?: Record<string, unknown>;
  updatedAt: string;
};

export type AiTraderPlanScore = {
  confidence?: number;
  expectedReward?: number;
  rewardScore?: number;
  riskScore?: number;
  executionScore?: number;
  totalScore?: number;
  approvedActions: number;
  rejectedActions: number;
};

export type AiTraderWakeReport = {
  schemaVersion: "stratium.ai-trader-wake-report.v1";
  wakeId: string;
  botId: string;
  accountId: string;
  mode: AiTraderMode;
  runtimeTarget: AiTraderRuntimeTarget;
  executionTarget: AiTraderExecutionTarget;
  symbol: string;
  status: AiTraderWakeStatus;
  requestedAt?: string;
  startedAt: string;
  finishedAt: string;
  reasons: AiTraderWakeReason[];
  selectedCandidateId?: string;
  planSummary?: string;
  strategySnapshot?: AiTraderStrategySnapshot;
  plan?: AiTraderPlan;
  memories: AiTraderMemorySnapshot[];
  score?: AiTraderPlanScore;
  approvedActions: number;
  rejectedActions: number;
  executionResults: AiTraderWakeExecutionReport[];
  errors: string[];
  marketSnapshot?: {
    bid?: number;
    ask?: number;
    last?: number;
    timestamp?: string;
    indicators?: Record<string, number | undefined>;
  };
  accountSnapshot?: {
    equity?: number;
    availableMargin?: number;
    currentPositionNotional?: number;
    dailyPnl?: number;
    drawdownPct?: number;
    position?: {
      symbol: string;
      side: "long" | "short" | "flat";
      quantity: number;
      notional: number;
    };
  };
};

export type AiTraderAdminBotHealth = "idle" | "running" | "failed" | "disabled" | "stale";

export type AiTraderAdminRiskState = "normal" | "watch" | "limited" | "blocked";

export type AiTraderAdminBotProfile = {
  botId: string;
  name: string;
  enabled: boolean;
  mode: AiTraderMode;
  runtimeTarget: AiTraderRuntimeTarget;
  executionTarget: AiTraderExecutionTarget;
  accountId: string;
  username?: string;
  symbol: string;
  health: AiTraderAdminBotHealth;
  riskState: AiTraderAdminRiskState;
  lastWakeAt?: string | null;
  nextWakeAt?: string | null;
  lastWakeStatus?: AiTraderWakeStatus | null;
  lastWakeReasons: AiTraderWakeReason[];
  strategySummary?: string | null;
  planSummary?: string | null;
  memoryCount?: number;
  lastScore?: AiTraderPlanScore | null;
  equity?: number | null;
  dailyPnl?: number | null;
  drawdownPct?: number | null;
  openOrders: number;
  position: {
    symbol: string;
    side: "long" | "short" | "flat";
    quantity: number;
    notional?: number | null;
  };
};

export type AiTraderAdminOverview = {
  totalBots: number;
  enabledBots: number;
  shadowBots: number;
  paperExecuteBots: number;
  reduceOnlyBots: number;
  activeWakes: number;
  failedWakes24h: number;
  riskRejections24h: number;
  totalSimulatedPnl: number;
  maxDrawdownPct: number;
};

export type AiTraderAdminDashboardPayload = {
  generatedAt: string;
  overview: AiTraderAdminOverview;
  profiles: AiTraderAdminBotProfile[];
};

export type AiTraderReviewSnapshot = {
  schemaVersion: "stratium.ai-trader-review.v1";
  botId: string;
  accountId: string;
  symbol: string;
  generatedAt: string;
  reportLimit: number;
  firstWakeAt?: string;
  lastWakeAt?: string;
  wakeStats: {
    total: number;
    completed: number;
    failed: number;
    approvedActions: number;
    rejectedActions: number;
  };
  orderStats: {
    total: number;
    open: number;
    filled: number;
    canceled: number;
    rejected: number;
    marketFilled: number;
    limitFilled: number;
    bySide: Record<AiTraderOrderSide, number>;
    byType: Record<AiTraderOrderType, number>;
    byStatus: Record<string, number>;
  };
  currentPosition?: {
    symbol: string;
    side: "long" | "short" | "flat";
    quantity: number;
    averageEntryPrice: number;
    markPrice: number;
    realizedPnl: number;
    unrealizedPnl: number;
  };
  account?: {
    equity?: number;
    availableBalance?: number;
    realizedPnl?: number;
    unrealizedPnl?: number;
  };
  latestMarket?: {
    last?: number;
    timestamp?: string;
  };
  recentWakes: Array<{
    wakeId: string;
    finishedAt: string;
    reasons: AiTraderWakeReason[];
    summary?: string;
    approvedActions: number;
    rejectedActions: number;
  }>;
  recentOrders: Array<{
    id: string;
    clientOrderId?: string;
    symbol: string;
    side: AiTraderOrderSide;
    orderType: AiTraderOrderType;
    status: string;
    quantity: number;
    limitPrice?: number;
    filledQuantity: number;
    remainingQuantity: number;
    averageFillPrice?: number;
    createdAt: string;
    updatedAt: string;
  }>;
  observations: string[];
};
