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
import { runWakeCycle } from "./runtime/wakeCycle.js";
import type { TraderBotPlanner, TraderBotPlannerContext, TraderBotRunnerConfig, TraderBotWakeResult } from "./types.js";

const REQUIRED_MCP_TOOLS = [
  "stratium_get_all_mids",
  "stratium_get_l2_book",
  "stratium_get_clearinghouse_state",
  "stratium_get_open_orders",
  "stratium_place_order",
  "stratium_cancel_order",
  "stratium_cancel_order_by_cloid",
  "stratium_report_trader_bot_wake"
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

const createPlanner = (config: TraderBotRunnerConfig): TraderBotPlanner => {
  if (config.planner === "dry-run") {
    return createDryRunPlanner();
  }

  if (config.planner === "baseline") {
    return createBaselinePlanner();
  }

  return createCodexPlanner(config);
};

const createWakeRequest = (config: TraderBotRunnerConfig): AiTraderWakeRequest => {
  const now = new Date().toISOString();
  return {
    id: `wake-${Date.now()}`,
    botId: config.botId,
    symbol: config.activeSymbol,
    priority: "manual",
    reasons: ["manual_admin"],
    requestedAt: now,
    source: "admin"
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
    updatedAt: context.now,
    source: "runtime"
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

const runOnce = async (config: TraderBotRunnerConfig, cycle = 1) => {
  const wakeRequest = createWakeRequest(config);
  const wakeStartedAt = Date.now();
  log(`wake #${cycle} started: id=${wakeRequest.id}, bot=${config.botId}, mode=${config.mode}, planner=${config.planner}, symbol=${config.activeSymbol}`);
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
    log("context: fetching market/account through Trader MCP");
    const contextStartedAt = Date.now();
    const context = await createPlannerContextFromMcp({
      config,
      wakeRequest,
      mcpClient
    });
    log(`context: ready (${Date.now() - contextStartedAt}ms), market=${context.market.symbol} last=${context.market.last}, equity=${context.account.equity}, position=${positionSummary(context)}, memories=${context.memories.length}`);
    const result = await runWakeCycle(
      context,
      createPlanner(config),
      createMcpExecutor({
        mcpClient,
        market: context.market,
        account: context.account
      }),
      log
    );
    log(`wake: planner/executor finished status=${result.status}, selected=${result.selectedCandidate?.id ?? "none"}`);
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
  } finally {
    await mcpClient.close();
  }
};

const sleep = async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const main = async () => {
  const config = loadRunnerConfig(parseCliFlags());
  assertRunnerConfig(config);
  log(`loop started: mode=${config.once ? "once" : "continuous"}, bot=${config.botId}, planner=${config.planner}, interval=${formatDuration(config.wakeIntervalMs)}`);

  if (config.once) {
    await runOnce(config, 1);
    return;
  }

  let cycle = 1;
  while (true) {
    await runOnce(config, cycle);
    cycle += 1;
    const nextWakeAt = new Date(Date.now() + config.wakeIntervalMs).toISOString();
    log(`waiting ${formatDuration(config.wakeIntervalMs)} before next wake; nextWakeAt=${nextWakeAt}`);
    await sleep(config.wakeIntervalMs);
  }
};

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
