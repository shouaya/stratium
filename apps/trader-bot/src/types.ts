import type {
  AiTraderMode,
  AiTraderMemorySnapshot,
  AiTraderPlan,
  AiTraderPlanAction,
  AiTraderPlanCandidate,
  AiTraderRiskDecision,
  AiTraderRuntimeTarget,
  AiTraderWakeRequest
} from "@stratium/shared";

export type TraderBotPlannerKind = "dry-run" | "baseline" | "codex";
export type TraderBotCodexSessionMode = "resume" | "fresh";

export type TraderBotRiskPolicy = {
  allowedSymbols: string[];
  maxActionsPerWake: number;
  maxOrderNotional: number;
  maxPositionNotional: number;
  requireInvalidationPrice: boolean;
  allowOpeningOrders: boolean;
};

export type TraderBotWakePolicy = {
  heartbeatIntervalMs: number;
  positionReviewIntervalMs: number;
  openOrderReviewIntervalMs: number;
  postExecutionReviewIntervalMs: number;
  riskRetryIntervalMs: number;
  signalReviewIntervalMs: number;
};

export type TraderBotConfig = {
  botId: string;
  mode: AiTraderMode;
  planner: TraderBotPlannerKind;
  runtimeTarget: AiTraderRuntimeTarget;
  activeSymbol: string;
  wakeIntervalMs: number;
  wakePolicy?: TraderBotWakePolicy;
  riskPolicy: TraderBotRiskPolicy;
};

export type TraderBotRunnerConfig = TraderBotConfig & {
  apiBaseUrl: string;
  traderMcpUrl: string;
  account: string;
  password: string;
  once: boolean;
  codexBin: string;
  codexArgs: string[];
  codexPromptMode: "arg" | "stdin";
  codexTimeoutMs: number;
  codexSessionMode: TraderBotCodexSessionMode;
  codexSessionMaxWakes: number;
};

export type TraderBotMarketSnapshot = {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  timestamp: string;
  indicators?: {
    rsi?: number;
    atr?: number;
    return5mPct?: number;
  };
};

export type TraderBotAccountSnapshot = {
  equity: number;
  availableMargin: number;
  currentPositionNotional: number;
  dailyPnl?: number;
  drawdownPct?: number;
  position?: {
    symbol: string;
    side: "long" | "short" | "flat";
    quantity: number;
    notional: number;
  };
};

export type TraderBotMemory = Pick<AiTraderMemorySnapshot, "key" | "value" | "importance" | "updatedAt" | "source">;

export type TraderBotPlannerContext = {
  config: TraderBotConfig;
  wakeRequest: AiTraderWakeRequest;
  market: TraderBotMarketSnapshot;
  account: TraderBotAccountSnapshot;
  memories: TraderBotMemory[];
  now: string;
};

export type TraderBotProgressLogger = (message: string) => void;

export type TraderBotPlanner = {
  plan: (context: TraderBotPlannerContext, log?: TraderBotProgressLogger) => Promise<string | AiTraderPlan>;
};

export type TraderBotExecutionResult = {
  action: AiTraderPlanAction;
  status: "skipped_shadow" | "pending_approval" | "executed" | "rejected" | "failed";
  message: string;
  raw?: unknown;
};

export type TraderBotWakeResult = {
  wakeId: string;
  botId: string;
  mode: AiTraderMode;
  status: "completed" | "skipped_disabled" | "failed";
  startedAt: string;
  finishedAt: string;
  prompt: string;
  plan?: AiTraderPlan;
  selectedCandidate?: AiTraderPlanCandidate;
  riskDecision?: AiTraderRiskDecision;
  executionResults: TraderBotExecutionResult[];
  errors: string[];
};

export type TraderBotExecutor = {
  execute: (mode: AiTraderMode, actions: AiTraderPlanAction[]) => Promise<TraderBotExecutionResult[]>;
};
