import type {
  AiTraderAdminBotHealth,
  AiTraderAdminBotProfile,
  AiTraderAdminDashboardPayload,
  AiTraderMemorySnapshot,
  AiTraderPlan,
  AiTraderPlanAction,
  AiTraderPlanScore,
  AiTraderAdminRiskState,
  AiTraderExecutionStatus,
  AiTraderExecutionTarget,
  AiTraderMode,
  AiTraderRuntimeTarget,
  AiTraderStrategySnapshot,
  AiTraderWakeReason,
  AiTraderWakeReport,
  AiTraderWakeStatus
} from "@stratium/shared";
import type { FrontendUserView, PlatformSettingsView } from "../auth/auth.js";

const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const STALE_WAKE_MS = 15 * 60 * 1000;

const AI_TRADER_MODES = new Set<AiTraderMode>(["disabled", "observe", "shadow", "approval", "paper_execute", "reduce_only"]);
const WAKE_STATUSES = new Set<AiTraderWakeStatus>(["completed", "skipped_disabled", "failed", "running"]);
const EXECUTION_STATUSES = new Set<AiTraderExecutionStatus>(["skipped_shadow", "pending_approval", "executed", "rejected", "failed"]);
const RUNTIME_TARGETS = new Set<AiTraderRuntimeTarget>(["stratium_native", "external_live_runner"]);
const EXECUTION_TARGETS = new Set<AiTraderExecutionTarget>(["stratium_simulation", "external_broker"]);

type EngineStateLike = {
  account?: unknown;
  position?: unknown;
  orders?: unknown;
  latestTick?: unknown;
};

type DashboardInput = {
  users: FrontendUserView[];
  platform: PlatformSettingsView;
  reports: AiTraderWakeReport[];
  readEngineState: (accountId: string) => EngineStateLike;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0) : [];

const asOptionalRecord = (value: unknown): Record<string, unknown> | undefined => {
  const record = asRecord(value);
  return Object.keys(record).length === 0 ? undefined : record;
};

const asMode = (value: unknown): AiTraderMode =>
  typeof value === "string" && AI_TRADER_MODES.has(value as AiTraderMode) ? value as AiTraderMode : "shadow";

const asWakeStatus = (value: unknown): AiTraderWakeStatus =>
  typeof value === "string" && WAKE_STATUSES.has(value as AiTraderWakeStatus) ? value as AiTraderWakeStatus : "completed";

const asExecutionStatus = (value: unknown): AiTraderExecutionStatus =>
  typeof value === "string" && EXECUTION_STATUSES.has(value as AiTraderExecutionStatus) ? value as AiTraderExecutionStatus : "failed";

const asRuntimeTarget = (value: unknown): AiTraderRuntimeTarget =>
  typeof value === "string" && RUNTIME_TARGETS.has(value as AiTraderRuntimeTarget) ? value as AiTraderRuntimeTarget : "stratium_native";

const asExecutionTarget = (value: unknown): AiTraderExecutionTarget =>
  typeof value === "string" && EXECUTION_TARGETS.has(value as AiTraderExecutionTarget) ? value as AiTraderExecutionTarget : "stratium_simulation";

const normalizeStrategySnapshot = (
  value: unknown,
  fallback: { botId: string; symbol: string; mode: AiTraderMode; finishedAt: string; planSummary?: string }
): AiTraderStrategySnapshot | undefined => {
  const strategy = asOptionalRecord(value);

  if (!strategy) {
    return fallback.planSummary
      ? {
        name: `${fallback.symbol} AI trader`,
        status: fallback.mode === "disabled" ? "paused" : "active",
        symbol: fallback.symbol,
        mode: fallback.mode,
        summary: fallback.planSummary,
        updatedAt: fallback.finishedAt
      }
      : undefined;
  }

  const status = asString(strategy.status);
  return {
    id: asString(strategy.id),
    name: asString(strategy.name) ?? `${fallback.botId} strategy`,
    version: asString(strategy.version),
    status: status === "draft" || status === "paused" || status === "retired" ? status : "active",
    symbol: asString(strategy.symbol) ?? fallback.symbol,
    mode: asMode(strategy.mode),
    summary: asString(strategy.summary) ?? fallback.planSummary ?? "No strategy summary was reported.",
    thesis: asString(strategy.thesis),
    riskPolicy: asOptionalRecord(strategy.riskPolicy),
    updatedAt: toIsoOrFallback(strategy.updatedAt, fallback.finishedAt)
  };
};

const normalizePlan = (value: unknown): AiTraderPlan | undefined => {
  const plan = asOptionalRecord(value);
  if (!plan || plan.schemaVersion !== "stratium.ai-trader-plan.v1" || !asString(plan.summary) || !Array.isArray(plan.candidates)) {
    return undefined;
  }

  return {
    schemaVersion: "stratium.ai-trader-plan.v1",
    summary: asString(plan.summary) as string,
    candidates: plan.candidates.map((candidate) => {
      const item = asRecord(candidate);
      return {
        id: asString(item.id) ?? "candidate",
        thesis: asString(item.thesis) ?? "",
        confidence: asNumber(item.confidence) ?? 0,
        expectedReward: asNumber(item.expectedReward),
        riskNotes: asStringArray(item.riskNotes),
        actions: Array.isArray(item.actions) ? item.actions as AiTraderPlanAction[] : []
      };
    })
  };
};

const normalizeMemories = (value: unknown): AiTraderMemorySnapshot[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      const memory = asRecord(entry);
      const key = asString(memory.key);
      const text = asString(memory.value);
      const source = asString(memory.source);

      if (!key || !text) {
        return null;
      }

      const normalizedSource: AiTraderMemorySnapshot["source"] =
        source === "reflection" || source === "strategy_package" || source === "manual" ? source : "runtime";
      const normalized: AiTraderMemorySnapshot = {
        key,
        value: text,
        importance: asNumber(memory.importance),
        updatedAt: asString(memory.updatedAt),
        source: normalizedSource
      };
      return normalized;
    })
    .filter((entry): entry is AiTraderMemorySnapshot => entry !== null);
};

const normalizeScore = (
  value: unknown,
  fallback: { approvedActions: number; rejectedActions: number }
): AiTraderPlanScore | undefined => {
  const score = asOptionalRecord(value);
  if (!score) {
    return undefined;
  }

  return {
    confidence: asNumber(score.confidence),
    expectedReward: asNumber(score.expectedReward),
    rewardScore: asNumber(score.rewardScore),
    riskScore: asNumber(score.riskScore),
    executionScore: asNumber(score.executionScore),
    totalScore: asNumber(score.totalScore),
    approvedActions: asNumber(score.approvedActions) ?? fallback.approvedActions,
    rejectedActions: asNumber(score.rejectedActions) ?? fallback.rejectedActions
  };
};

const toIsoOrFallback = (value: unknown, fallback: string): string => {
  const candidate = asString(value);
  return candidate && !Number.isNaN(new Date(candidate).getTime()) ? candidate : fallback;
};

const getOrderCount = (orders: unknown): number => {
  if (!Array.isArray(orders)) {
    return 0;
  }

  return orders.filter((order) => {
    const status = asString(asRecord(order).status)?.toUpperCase();
    return !status || !["FILLED", "CANCELED", "CANCELLED", "REJECTED", "EXPIRED"].includes(status);
  }).length;
};

const resolvePosition = (
  rawPosition: unknown,
  fallbackSymbol: string,
  wakeReport?: AiTraderWakeReport
): AiTraderAdminBotProfile["position"] => {
  if (wakeReport?.accountSnapshot?.position) {
    return {
      symbol: wakeReport.accountSnapshot.position.symbol,
      side: wakeReport.accountSnapshot.position.side,
      quantity: wakeReport.accountSnapshot.position.quantity,
      notional: wakeReport.accountSnapshot.position.notional
    };
  }

  const position = asRecord(rawPosition);
  const quantity = asNumber(position.quantity) ?? 0;
  const side = asString(position.side);

  return {
    symbol: asString(position.symbol) ?? fallbackSymbol,
    side: side === "long" || side === "short" ? side : "flat",
    quantity,
    notional: asNumber(position.notional)
  };
};

const resolveHealth = (
  enabled: boolean,
  mode: AiTraderMode,
  wakeReport: AiTraderWakeReport | undefined,
  nowMs: number
): AiTraderAdminBotHealth => {
  if (!enabled || mode === "disabled") {
    return "disabled";
  }

  if (!wakeReport) {
    return "idle";
  }

  if (wakeReport.status === "running") {
    return "running";
  }

  if (wakeReport.status === "failed" || wakeReport.executionResults.some((entry) => entry.status === "failed")) {
    return "failed";
  }

  const finishedMs = new Date(wakeReport.finishedAt).getTime();
  return Number.isFinite(finishedMs) && nowMs - finishedMs > STALE_WAKE_MS ? "stale" : "idle";
};

const resolveRiskState = (
  mode: AiTraderMode,
  platform: PlatformSettingsView,
  account: Record<string, unknown>,
  wakeReport: AiTraderWakeReport | undefined
): AiTraderAdminRiskState => {
  if (mode === "disabled" || platform.maintenanceMode || !platform.allowFrontendTrading) {
    return "blocked";
  }

  if (mode === "reduce_only") {
    return "limited";
  }

  const riskRatio = asNumber(account.riskRatio) ?? 0;
  if (riskRatio >= 0.8) {
    return "blocked";
  }

  if (riskRatio >= 0.5 || (wakeReport?.rejectedActions ?? 0) > 0) {
    return "watch";
  }

  return "normal";
};

const sortReports = (reports: AiTraderWakeReport[]): AiTraderWakeReport[] =>
  [...reports].sort((left, right) => new Date(right.finishedAt).getTime() - new Date(left.finishedAt).getTime());

export const normalizeAiTraderWakeReport = (accountId: string, input: unknown): AiTraderWakeReport => {
  const payload = asRecord(input);
  const now = new Date().toISOString();
  const botId = asString(payload.botId) ?? `trader-bot-${accountId}`;
  const executionResults = Array.isArray(payload.executionResults)
    ? payload.executionResults.map((entry) => {
      const item = asRecord(entry);
      return {
        actionType: asString(item.actionType) ?? "unknown",
        status: asExecutionStatus(item.status),
        message: asString(item.message)
      };
    })
    : [];
  const marketSnapshot = asRecord(payload.marketSnapshot ?? payload.market);
  const accountSnapshot = asRecord(payload.accountSnapshot ?? payload.account);
  const positionSnapshot = asRecord(accountSnapshot.position);
  const startedAt = toIsoOrFallback(payload.startedAt, now);
  const finishedAt = toIsoOrFallback(payload.finishedAt, now);
  const mode = asMode(payload.mode);
  const symbol = asString(payload.symbol) ?? "BTC-USD";
  const plan = normalizePlan(payload.plan);
  const planSummary = asString(payload.planSummary) ?? plan?.summary;
  const approvedActions = asNumber(payload.approvedActions) ?? 0;
  const rejectedActions = asNumber(payload.rejectedActions) ?? 0;

  return {
    schemaVersion: "stratium.ai-trader-wake-report.v1",
    wakeId: asString(payload.wakeId) ?? asString(payload.id) ?? `wake-${Date.now()}`,
    botId,
    accountId,
    mode,
    runtimeTarget: asRuntimeTarget(payload.runtimeTarget),
    executionTarget: asExecutionTarget(payload.executionTarget),
    symbol,
    status: asWakeStatus(payload.status),
    requestedAt: asString(payload.requestedAt),
    startedAt,
    finishedAt,
    reasons: asStringArray(payload.reasons) as AiTraderWakeReason[],
    selectedCandidateId: asString(payload.selectedCandidateId),
    planSummary,
    strategySnapshot: normalizeStrategySnapshot(payload.strategySnapshot ?? payload.strategy, {
      botId,
      symbol,
      mode,
      finishedAt,
      planSummary
    }),
    plan,
    memories: normalizeMemories(payload.memories),
    score: normalizeScore(payload.score, { approvedActions, rejectedActions }),
    approvedActions,
    rejectedActions,
    executionResults,
    errors: asStringArray(payload.errors),
    marketSnapshot: Object.keys(marketSnapshot).length === 0
      ? undefined
      : {
        bid: asNumber(marketSnapshot.bid),
        ask: asNumber(marketSnapshot.ask),
        last: asNumber(marketSnapshot.last),
        timestamp: asString(marketSnapshot.timestamp),
        indicators: asRecord(marketSnapshot.indicators) as Record<string, number | undefined>
      },
    accountSnapshot: Object.keys(accountSnapshot).length === 0
      ? undefined
      : {
        equity: asNumber(accountSnapshot.equity),
        availableMargin: asNumber(accountSnapshot.availableMargin),
        currentPositionNotional: asNumber(accountSnapshot.currentPositionNotional),
        dailyPnl: asNumber(accountSnapshot.dailyPnl),
        drawdownPct: asNumber(accountSnapshot.drawdownPct),
        position: Object.keys(positionSnapshot).length === 0
          ? undefined
          : {
            symbol: asString(positionSnapshot.symbol) ?? "BTC-USD",
            side: asString(positionSnapshot.side) === "long" || asString(positionSnapshot.side) === "short" ? asString(positionSnapshot.side) as "long" | "short" : "flat",
            quantity: asNumber(positionSnapshot.quantity) ?? 0,
            notional: asNumber(positionSnapshot.notional) ?? 0
          }
      }
  };
};

export const createAiTraderAdminDashboardPayload = (input: DashboardInput): AiTraderAdminDashboardPayload => {
  const now = new Date();
  const nowMs = now.getTime();
  const usersByAccount = new Map(
    input.users
      .filter((user) => user.tradingAccountId)
      .map((user) => [user.tradingAccountId as string, user])
  );
  const reportsByBot = new Map<string, AiTraderWakeReport[]>();

  for (const report of input.reports) {
    reportsByBot.set(report.botId, sortReports([...(reportsByBot.get(report.botId) ?? []), report]));
  }

  const profiles: AiTraderAdminBotProfile[] = [];
  const accountsWithReportedProfiles = new Set<string>();

  const buildProfile = (
    botId: string,
    accountId: string,
    user: FrontendUserView | undefined,
    wakeReport: AiTraderWakeReport | undefined
  ): AiTraderAdminBotProfile => {
    let state: EngineStateLike = {};
    try {
      state = input.readEngineState(accountId);
    } catch {
      state = {};
    }

    const account = asRecord(state.account);
    const mode = wakeReport?.mode ?? "shadow";
    const symbol = wakeReport?.symbol ?? input.platform.activeSymbol;
    const enabled = user?.isActive ?? true;
    const equity = wakeReport?.accountSnapshot?.equity ?? asNumber(account.equity) ?? asNumber(account.walletBalance) ?? null;
    const dailyPnl = wakeReport?.accountSnapshot?.dailyPnl
      ?? ((asNumber(account.realizedPnl) ?? 0) + (asNumber(account.unrealizedPnl) ?? 0));
    const drawdownPct = wakeReport?.accountSnapshot?.drawdownPct ?? 0;

    return {
      botId,
      name: user?.displayName ? `${user.displayName} Bot` : botId,
      enabled,
      mode,
      runtimeTarget: wakeReport?.runtimeTarget ?? "stratium_native",
      executionTarget: wakeReport?.executionTarget ?? "stratium_simulation",
      accountId,
      username: user?.username,
      symbol,
      health: resolveHealth(enabled, mode, wakeReport, nowMs),
      riskState: resolveRiskState(mode, input.platform, account, wakeReport),
      lastWakeAt: wakeReport?.finishedAt ?? null,
      nextWakeAt: null,
      lastWakeStatus: wakeReport?.status ?? null,
      lastWakeReasons: wakeReport?.reasons ?? [],
      strategySummary: wakeReport?.strategySnapshot?.summary ?? null,
      planSummary: wakeReport?.planSummary ?? null,
      memoryCount: wakeReport?.memories.length ?? 0,
      lastScore: wakeReport?.score ?? null,
      equity,
      dailyPnl,
      drawdownPct,
      openOrders: getOrderCount(state.orders),
      position: resolvePosition(state.position, symbol, wakeReport)
    };
  };

  for (const [botId, reports] of reportsByBot) {
    const wakeReport = reports[0];
    if (!wakeReport) {
      continue;
    }

    accountsWithReportedProfiles.add(wakeReport.accountId);
    profiles.push(buildProfile(botId, wakeReport.accountId, usersByAccount.get(wakeReport.accountId), wakeReport));
  }

  for (const user of input.users) {
    if (!user.tradingAccountId || accountsWithReportedProfiles.has(user.tradingAccountId)) {
      continue;
    }

    profiles.push(buildProfile(`trader-bot-${user.username}`, user.tradingAccountId, user, undefined));
  }

  const recentReports = input.reports.filter((report) => {
    const finishedMs = new Date(report.finishedAt).getTime();
    return Number.isFinite(finishedMs) && nowMs - finishedMs <= RECENT_WINDOW_MS;
  });

  return {
    generatedAt: now.toISOString(),
    overview: {
      totalBots: profiles.length,
      enabledBots: profiles.filter((profile) => profile.enabled).length,
      shadowBots: profiles.filter((profile) => profile.mode === "shadow").length,
      paperExecuteBots: profiles.filter((profile) => profile.mode === "paper_execute").length,
      reduceOnlyBots: profiles.filter((profile) => profile.mode === "reduce_only").length,
      activeWakes: profiles.filter((profile) => profile.health === "running").length,
      failedWakes24h: recentReports.filter((report) => report.status === "failed" || report.executionResults.some((entry) => entry.status === "failed")).length,
      riskRejections24h: recentReports.reduce((sum, report) => sum + report.rejectedActions, 0),
      totalSimulatedPnl: profiles.reduce((sum, profile) => sum + (profile.dailyPnl ?? 0), 0),
      maxDrawdownPct: profiles.reduce((max, profile) => Math.max(max, profile.drawdownPct ?? 0), 0)
    },
    profiles: profiles.sort((left, right) => left.botId.localeCompare(right.botId))
  };
};
