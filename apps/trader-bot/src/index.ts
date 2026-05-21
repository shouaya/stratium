import type { AiTraderWakeRequest } from "@stratium/shared";
import { assertRunnerConfig, loadRunnerConfig } from "./config/config.js";
import { parseCliFlags } from "./config/flags.js";
import { loginToStratium } from "./infra/stratiumAuthClient.js";
import { assertTraderMcpTools, createTraderMcpClient } from "./infra/traderMcpClient.js";
import { createBaselinePlanner } from "./planner/baselinePlanner.js";
import { createCodexPlanner } from "./planner/codexPlanner.js";
import { createDryRunPlanner } from "./planner/dryRunPlanner.js";
import { createPlannerContextFromMcp } from "./runtime/contextProvider.js";
import { createMcpExecutor } from "./runtime/mcpExecutor.js";
import { createTradeReviewMemories, normalizeTradeReviewSnapshot, shouldRefreshTradeReview } from "./runtime/tradeReview.js";
import { runWakeCycle } from "./runtime/wakeCycle.js";
import { createMarketSignalStateMemory, selectNextWakeSchedule, type TraderBotWakeIntent, type TraderBotWakeScheduleDecision } from "./runtime/wakeScheduler.js";
import type { TraderBotMemory, TraderBotPlanner, TraderBotPlannerContext, TraderBotRunnerConfig, TraderBotWakeResult } from "./types.js";

const REQUIRED_MCP_TOOLS = [
  "stratium_get_all_mids",
  "stratium_get_l2_book",
  "stratium_get_candles",
  "stratium_get_clearinghouse_state",
  "stratium_get_open_orders",
  "stratium_place_order",
  "stratium_cancel_order",
  "stratium_cancel_order_by_cloid",
  "stratium_report_trader_bot_wake",
  "stratium_list_trader_bot_memories",
  "stratium_get_trader_bot_review"
];

const log = (message: string) => {
  console.log(`[trader-bot] ${message}`);
};

const formatDuration = (ms: number) => ms >= 1000 ? `${Math.round(ms / 1000)}s` : `${ms}ms`;

const positionSummary = (context: TraderBotPlannerContext) => {
  const position = context.account.position;
  return position
    ? `${position.side} ${position.quantity} ${position.symbol}, notional=${position.notional}`
    : "flat";
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

const normalizeMemories = (value: unknown): TraderBotMemory[] => {
  const payload = asRecord(value);
  const entries = Array.isArray(value) ? value : Array.isArray(payload?.memories) ? payload.memories : [];

  return entries.flatMap((entry) => {
    const record = asRecord(entry);
    if (!record || typeof record.key !== "string" || typeof record.value !== "string") {
      return [];
    }
    return [{
      key: record.key,
      value: record.value,
      importance: typeof record.importance === "number" && Number.isFinite(record.importance)
        ? record.importance
        : undefined,
      updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined,
      source: record.source === "reflection" || record.source === "strategy_package" || record.source === "manual" || record.source === "runtime"
        ? record.source
        : undefined
    }];
  });
};

const loadPersistedMemories = async (
  mcpClient: Awaited<ReturnType<typeof createTraderMcpClient>>,
  botId: string
): Promise<TraderBotMemory[]> => {
  const result = await mcpClient.callTool("stratium_list_trader_bot_memories", { botId });
  return normalizeMemories(result.raw ?? result.summary ?? result);
};

const upsertMemory = (context: TraderBotPlannerContext, memory: TraderBotMemory): void => {
  const index = context.memories.findIndex((entry) => entry.key === memory.key);
  if (index >= 0) {
    context.memories[index] = memory;
    return;
  }
  context.memories.push(memory);
};

const maybeAppendTradeReviewMemories = async (
  input: {
    config: TraderBotRunnerConfig;
    context: TraderBotPlannerContext;
    mcpClient: Awaited<ReturnType<typeof createTraderMcpClient>>;
  }
): Promise<boolean> => {
  if (!shouldRefreshTradeReview(input.context, input.config)) {
    return false;
  }

  const result = await input.mcpClient.callTool("stratium_get_trader_bot_review", {
    botId: input.config.botId,
    limit: 200
  });
  const review = normalizeTradeReviewSnapshot(result.raw ?? result.summary ?? result);

  if (!review) {
    return false;
  }

  for (const memory of createTradeReviewMemories(input.context, review)) {
    upsertMemory(input.context, memory);
  }

  return true;
};

const appendLastWakeSummaryMemory = (
  context: TraderBotPlannerContext,
  result: TraderBotWakeResult
): void => {
  const selectedActionTypes = result.selectedCandidate?.actions.map((action) => action.type).join(", ") || "none";
  const executionSummary = result.executionResults.length === 0
    ? "no executions"
    : result.executionResults.map((entry) => `${entry.action.type}:${entry.status}`).join(", ");
  const value = JSON.stringify({
    wakeId: result.wakeId,
    finishedAt: result.finishedAt,
    status: result.status,
    symbol: context.market.symbol,
    marketLast: context.market.last,
    position: context.account.position ?? null,
    planSummary: result.plan?.summary ?? null,
    selectedCandidateId: result.selectedCandidate?.id ?? null,
    selectedActionTypes,
    approvedActions: result.riskDecision?.approvedActions.length ?? 0,
    rejectedActions: result.riskDecision?.rejectedActions.length ?? 0,
    executionSummary,
    errors: result.errors
  });

  upsertMemory(context, {
    key: "runtime/last_wake_summary",
    value: value.length > 4_000 ? `${value.slice(0, 4_000)}...` : value,
    importance: 0.99,
    updatedAt: result.finishedAt,
    source: "runtime"
  });
};

const createPlanner = (config: TraderBotRunnerConfig): TraderBotPlanner => {
  if (config.planner === "dry-run") {
    return createDryRunPlanner();
  }

  if (config.planner === "baseline") {
    return createBaselinePlanner();
  }

  return createCodexPlanner(config);
};

const createWakeRequest = (config: TraderBotRunnerConfig, intent?: TraderBotWakeIntent): AiTraderWakeRequest => {
  const now = new Date().toISOString();
  return {
    id: `wake-${Date.now()}`,
    botId: config.botId,
    symbol: config.activeSymbol,
    priority: intent?.priority ?? "manual",
    reasons: intent?.reasons ?? ["manual_admin"],
    requestedAt: now,
    source: intent?.source ?? "admin"
  };
};

const roundScore = (value: number | undefined): number | undefined =>
  value === undefined || !Number.isFinite(value) ? undefined : Number(value.toFixed(4));

const averageScore = (values: Array<number | undefined>): number | undefined => {
  const finiteValues = values.filter((value): value is number => value !== undefined && Number.isFinite(value));
  return finiteValues.length === 0
    ? undefined
    : roundScore(finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length);
};

const createWakeScore = (result: TraderBotWakeResult) => {
  const approvedActions = result.riskDecision?.approvedActions.length ?? 0;
  const rejectedActions = result.riskDecision?.rejectedActions.length ?? 0;
  const totalActions = approvedActions + rejectedActions;
  const failedExecutions = result.executionResults.filter((entry) => entry.status === "failed").length;
  const confidence = roundScore(result.selectedCandidate?.confidence);
  const expectedReward = roundScore(result.selectedCandidate?.expectedReward);
  const rewardScore = expectedReward ?? confidence;
  const riskScore = totalActions === 0 ? undefined : roundScore(approvedActions / totalActions);
  const executionScore = result.executionResults.length === 0
    ? undefined
    : roundScore((result.executionResults.length - failedExecutions) / result.executionResults.length);

  return {
    confidence,
    expectedReward,
    rewardScore,
    riskScore,
    executionScore,
    totalScore: averageScore([confidence, rewardScore, riskScore, executionScore]),
    approvedActions,
    rejectedActions
  };
};

const createWakeReport = (
  config: TraderBotRunnerConfig,
  wakeRequest: AiTraderWakeRequest,
  context: TraderBotPlannerContext,
  result: TraderBotWakeResult
) => ({
  wakeId: result.wakeId,
  botId: result.botId,
  mode: result.mode,
  runtimeTarget: config.runtimeTarget,
  executionTarget: "stratium_simulation",
  symbol: config.activeSymbol,
  status: result.status,
  requestedAt: wakeRequest.requestedAt,
  startedAt: result.startedAt,
  finishedAt: result.finishedAt,
  reasons: wakeRequest.reasons,
  selectedCandidateId: result.selectedCandidate?.id,
  planSummary: result.plan?.summary,
  strategySnapshot: {
    id: `${config.botId}:${config.activeSymbol}`,
    name: `${config.activeSymbol} ${config.planner} simulation strategy`,
    version: `${config.planner}.v1`,
    status: config.mode === "disabled" ? "paused" : "active",
    symbol: config.activeSymbol,
    mode: config.mode,
    summary: result.plan?.summary ?? "No validated plan was produced in this wake.",
    thesis: result.selectedCandidate?.thesis,
    riskPolicy: config.riskPolicy,
    updatedAt: result.finishedAt
  },
  plan: result.plan,
  memories: context.memories.map((memory) => ({
    key: memory.key,
    value: memory.value,
    importance: memory.importance,
    updatedAt: memory.updatedAt ?? context.now,
    source: memory.source ?? "runtime"
  })),
  score: createWakeScore(result),
  approvedActions: result.riskDecision?.approvedActions.length ?? 0,
  rejectedActions: result.riskDecision?.rejectedActions.length ?? 0,
  executionResults: result.executionResults.map((entry) => ({
    actionType: entry.action.type,
    status: entry.status,
    message: entry.message
  })),
  errors: result.errors,
  marketSnapshot: context.market,
  accountSnapshot: context.account
});

const runOnce = async (config: TraderBotRunnerConfig, cycle = 1, intent?: TraderBotWakeIntent): Promise<TraderBotWakeScheduleDecision | undefined> => {
  const wakeRequest = createWakeRequest(config, intent);
  const wakeStartedAt = Date.now();
  log(`wake #${cycle} started: id=${wakeRequest.id}, bot=${config.botId}, mode=${config.mode}, planner=${config.planner}, symbol=${config.activeSymbol}, reasons=${wakeRequest.reasons.join(",")}, source=${wakeRequest.source}`);
  log(`auth: logging in account=${config.account}, api=${config.apiBaseUrl}`);
  const login = await loginToStratium({
    apiBaseUrl: config.apiBaseUrl,
    account: config.account,
    password: config.password
  });
  log(`auth: ok user=${login.user.username}, tradingAccountId=${login.user.tradingAccountId ?? "none"}`);
  log(`mcp: connecting ${config.traderMcpUrl}`);
  const mcpClient = await createTraderMcpClient({
    mcpUrl: config.traderMcpUrl,
    token: login.token,
    botId: config.botId
  });

  try {
    log("mcp: checking required tools");
    await assertTraderMcpTools(mcpClient, REQUIRED_MCP_TOOLS);
    log(`mcp: tools ready (${REQUIRED_MCP_TOOLS.length})`);
    log("memory: loading persisted bot memories through Trader MCP");
    const persistedMemories = await loadPersistedMemories(mcpClient, config.botId);
    log(`memory: loaded ${persistedMemories.length} persisted entries`);
    log("context: fetching market/account through Trader MCP");
    const contextStartedAt = Date.now();
    const context = await createPlannerContextFromMcp({
      config,
      wakeRequest,
      mcpClient,
      memories: persistedMemories
    });
    log(`context: ready (${Date.now() - contextStartedAt}ms), market=${context.market.symbol} last=${context.market.last}, equity=${context.account.equity}, position=${positionSummary(context)}, memories=${context.memories.length}`);
    log(`review: checking periodic trade review interval=${formatDuration(config.tradeReviewIntervalMs)}, minWakes=${config.tradeReviewMinWakes}`);
    const reviewRecorded = await maybeAppendTradeReviewMemories({
      config,
      context,
      mcpClient
    });
    log(`review: ${reviewRecorded ? "updated reflection memory" : "not due"}`);
    const result = await runWakeCycle(
      context,
      createPlanner(config),
      createMcpExecutor({
        mcpClient,
        market: context.market,
        account: context.account,
        botId: config.botId,
        wakeId: wakeRequest.id
      }),
      log
    );
    appendLastWakeSummaryMemory(context, result);
    const nextWake = selectNextWakeSchedule(context, result);
    upsertMemory(context, createMarketSignalStateMemory(context));
    log(`wake: planner/executor finished status=${result.status}, selected=${result.selectedCandidate?.id ?? "none"}`);
    log(`scheduler: next=${nextWake.label}, interval=${formatDuration(nextWake.intervalMs)}, reasons=${nextWake.reasons.join(",")}`);
    log("telemetry: reporting wake to admin dashboard");
    const telemetry = await mcpClient.callTool(
      "stratium_report_trader_bot_wake",
      createWakeReport(config, wakeRequest, context, result)
    ).then(() => ({ status: "recorded" as const }))
      .catch((error) => ({
        status: "failed" as const,
        message: error instanceof Error ? error.message : String(error)
      }));
    log(`telemetry: ${telemetry.status}${telemetry.status === "failed" ? ` (${telemetry.message})` : ""}`);

    console.log(JSON.stringify({
      wakeId: result.wakeId,
      botId: result.botId,
      account: login.user.username,
      tradingAccountId: login.user.tradingAccountId,
      mode: result.mode,
      status: result.status,
      market: result.status === "completed" ? context.market : undefined,
      accountSnapshot: result.status === "completed" ? context.account : undefined,
      selectedCandidateId: result.selectedCandidate?.id,
      approvedActions: result.riskDecision?.approvedActions.length ?? 0,
      rejectedActions: result.riskDecision?.rejectedActions.length ?? 0,
      executionResults: result.executionResults.map((entry) => ({
        type: entry.action.type,
        status: entry.status,
        message: entry.message
      })),
      telemetry,
      errors: result.errors
    }, null, 2));
    log(`wake #${cycle} completed: status=${result.status}, duration=${Date.now() - wakeStartedAt}ms`);

    if (result.status === "failed" || result.executionResults.some((entry) => entry.status === "failed")) {
      process.exitCode = 1;
    }

    return nextWake;
  } finally {
    await mcpClient.close();
  }
};

const sleep = async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const main = async () => {
  const config = loadRunnerConfig(parseCliFlags());
  assertRunnerConfig(config);
  log(`loop started: mode=${config.once ? "once" : "continuous"}, bot=${config.botId}, planner=${config.planner}, heartbeat=${formatDuration(config.wakePolicy?.heartbeatIntervalMs ?? config.wakeIntervalMs)}, positionReview=${formatDuration(config.wakePolicy?.positionReviewIntervalMs ?? 60_000)}, openOrderReview=${formatDuration(config.wakePolicy?.openOrderReviewIntervalMs ?? 120_000)}`);

  if (config.once) {
    await runOnce(config, 1);
    return;
  }

  let cycle = 1;
  let wakeIntent: TraderBotWakeIntent | undefined;
  while (true) {
    const nextWake = await runOnce(config, cycle, wakeIntent);
    cycle += 1;
    const intervalMs = nextWake?.intervalMs ?? config.wakePolicy?.heartbeatIntervalMs ?? config.wakeIntervalMs;
    wakeIntent = nextWake
      ? {
          priority: nextWake.priority,
          reasons: nextWake.reasons,
          source: nextWake.source
        }
      : undefined;
    const nextWakeAt = new Date(Date.now() + intervalMs).toISOString();
    log(`waiting ${formatDuration(intervalMs)} before next wake; nextWakeAt=${nextWakeAt}; nextReasons=${wakeIntent?.reasons.join(",") ?? "manual_admin"}`);
    await sleep(intervalMs);
  }
};

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
