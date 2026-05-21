export type AnalystLanguage = "zh" | "ja" | "en";

export type AnalystBotConfig = {
  apiBaseUrl: string;
  analystMcpUrl: string;
  account: string;
  password: string;
  botId: string;
  once: boolean;
  reviewIntervalMs: number;
  maxBots: number;
  codexBin: string;
  codexArgs: string[];
  codexPromptMode: "arg" | "stdin";
  codexTimeoutMs: number;
};

export type AnalystBotProfile = {
  botId: string;
  accountId?: string;
  symbol?: string;
  mode?: string;
  health?: string;
  riskState?: string;
  strategySummary?: string | null;
  planSummary?: string | null;
  equity?: number | null;
  dailyPnl?: number | null;
  drawdownPct?: number | null;
  openOrders?: number;
  position?: unknown;
};

export type AnalystContext = {
  now: string;
  analystBotId: string;
  language: AnalystLanguage;
  languageInstruction: string;
  dashboard: unknown;
  allBotReviews: unknown;
  existingMemos: unknown;
  botDetails: Array<{
    botId: string;
    accountId?: string;
    review: unknown;
    wakes: unknown;
    memories: unknown;
  }>;
};

export type AnalystMemoDraft = {
  targetBotId?: string;
  value: string;
  importance?: number;
};

export type AnalystPlan = {
  schemaVersion: "stratium.analyst-review.v1";
  language: AnalystLanguage;
  globalReview?: {
    value: string;
    importance?: number;
  };
  strategyMemos: AnalystMemoDraft[];
  observations?: string[];
  nextReviewAfterMs?: number;
};

export type AnalystProgressLogger = (message: string) => void;

export type AnalystPlanner = {
  plan: (context: AnalystContext, log?: AnalystProgressLogger) => Promise<AnalystPlan>;
};

export type AnalystCycleResult = {
  cycleId: string;
  analystBotId: string;
  status: "completed" | "failed";
  startedAt: string;
  finishedAt: string;
  language: AnalystLanguage;
  globalReviewWritten: boolean;
  strategyMemosWritten: number;
  nextReviewAfterMs?: number;
  errors: string[];
};
