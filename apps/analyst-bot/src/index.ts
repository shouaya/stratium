import { assertAnalystBotConfig, loadAnalystBotConfig } from "./config/config.js";
import { parseCliFlags } from "./config/flags.js";
import { assertAnalystMcpTools, createAnalystMcpClient } from "./infra/analystMcpClient.js";
import { loginToStratiumAdmin } from "./infra/stratiumAuthClient.js";
import { createCodexAnalystPlanner } from "./planner/codexPlanner.js";
import { runAnalystCycle } from "./runtime/analystCycle.js";
import type { AnalystBotConfig } from "./types.js";

const REQUIRED_ANALYST_TOOLS = [
  "stratium_analyst_get_language",
  "stratium_analyst_list_bots",
  "stratium_analyst_get_all_bot_reviews",
  "stratium_analyst_get_bot_review",
  "stratium_analyst_get_bot_wakes",
  "stratium_analyst_get_bot_memories",
  "stratium_analyst_list_memos",
  "stratium_analyst_write_global_review",
  "stratium_analyst_write_strategy_memo"
];

const log = (message: string) => {
  console.log(`[analyst-bot] ${message}`);
};

const formatDuration = (ms: number) => ms >= 1000 ? `${Math.round(ms / 1000)}s` : `${ms}ms`;

const runOnce = async (config: AnalystBotConfig, cycle = 1) => {
  const startedAt = Date.now();
  log(`cycle #${cycle} started: bot=${config.botId}, api=${config.apiBaseUrl}, mcp=${config.analystMcpUrl}, maxBots=${config.maxBots}`);
  log(`auth: logging in admin=${config.account}`);
  const login = await loginToStratiumAdmin({
    apiBaseUrl: config.apiBaseUrl,
    account: config.account,
    password: config.password
  });
  log(`auth: ok user=${login.user.username}`);
  log(`mcp: connecting ${config.analystMcpUrl}`);
  const mcpClient = await createAnalystMcpClient({
    mcpUrl: config.analystMcpUrl,
    token: login.token,
    botId: config.botId
  });

  try {
    log("mcp: checking analyst tools");
    await assertAnalystMcpTools(mcpClient, REQUIRED_ANALYST_TOOLS);
    log(`mcp: tools ready (${REQUIRED_ANALYST_TOOLS.length})`);
    const result = await runAnalystCycle({
      config,
      mcpClient,
      planner: createCodexAnalystPlanner(config),
      log
    });
    log(`cycle #${cycle} completed: status=${result.status}, duration=${Date.now() - startedAt}ms, global=${result.globalReviewWritten}, strategyMemos=${result.strategyMemosWritten}`);
    console.log(JSON.stringify({
      ...result,
      account: login.user.username
    }, null, 2));

    if (result.status === "failed") {
      process.exitCode = 1;
    }

    return result.nextReviewAfterMs;
  } finally {
    await mcpClient.close();
  }
};

const sleep = async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const main = async () => {
  const config = loadAnalystBotConfig(parseCliFlags());
  assertAnalystBotConfig(config);
  log(`loop started: mode=${config.once ? "once" : "continuous"}, bot=${config.botId}, reviewInterval=${formatDuration(config.reviewIntervalMs)}`);

  if (config.once) {
    await runOnce(config, 1);
    return;
  }

  let cycle = 1;
  while (true) {
    const suggestedIntervalMs = await runOnce(config, cycle);
    cycle += 1;
    const intervalMs = suggestedIntervalMs ?? config.reviewIntervalMs;
    const nextReviewAt = new Date(Date.now() + intervalMs).toISOString();
    log(`waiting ${formatDuration(intervalMs)} before next review; nextReviewAt=${nextReviewAt}`);
    await sleep(intervalMs);
  }
};

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
