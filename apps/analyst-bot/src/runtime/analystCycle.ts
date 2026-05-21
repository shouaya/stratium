import type { AnalystBotConfig, AnalystCycleResult, AnalystPlanner, AnalystProgressLogger } from "../types.js";
import type { AnalystMcpClient } from "../infra/analystMcpClient.js";
import { createAnalystContext } from "./contextProvider.js";

const cycleId = () => `analyst-${Date.now()}`;

export const runAnalystCycle = async (input: {
  config: AnalystBotConfig;
  mcpClient: AnalystMcpClient;
  planner: AnalystPlanner;
  log?: AnalystProgressLogger;
}): Promise<AnalystCycleResult> => {
  const log = input.log ?? (() => undefined);
  const startedAt = new Date().toISOString();
  const id = cycleId();

  try {
    log(`context: loading dashboard, language, reviews, wakes, and memories`);
    const context = await createAnalystContext({
      config: input.config,
      mcpClient: input.mcpClient
    });
    log(`context: ready language=${context.language}, botDetails=${context.botDetails.length}`);

    const plannerStartedAt = Date.now();
    log("planner: call started (codex analyst)");
    const plan = await input.planner.plan(context, log);
    log(`planner: returned (${Date.now() - plannerStartedAt}ms), global=${plan.globalReview ? "yes" : "no"}, strategyMemos=${plan.strategyMemos.length}`);

    let globalReviewWritten = false;
    let strategyMemosWritten = 0;

    if (plan.globalReview?.value.trim()) {
      log("memory: writing global review");
      await input.mcpClient.callTool("stratium_analyst_write_global_review", {
        value: plan.globalReview.value,
        importance: plan.globalReview.importance ?? 0.9
      });
      globalReviewWritten = true;
    }

    for (const memo of plan.strategyMemos) {
      log(`memory: writing strategy memo target=${memo.targetBotId ?? "all"}`);
      await input.mcpClient.callTool("stratium_analyst_write_strategy_memo", {
        ...(memo.targetBotId ? { targetBotId: memo.targetBotId } : {}),
        value: memo.value,
        importance: memo.importance ?? 0.9
      });
      strategyMemosWritten += 1;
    }

    return {
      cycleId: id,
      analystBotId: input.config.botId,
      status: "completed",
      startedAt,
      finishedAt: new Date().toISOString(),
      language: plan.language,
      globalReviewWritten,
      strategyMemosWritten,
      nextReviewAfterMs: plan.nextReviewAfterMs,
      errors: []
    };
  } catch (error) {
    return {
      cycleId: id,
      analystBotId: input.config.botId,
      status: "failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      language: "en",
      globalReviewWritten: false,
      strategyMemosWritten: 0,
      errors: [error instanceof Error ? error.message : String(error)]
    };
  }
};
