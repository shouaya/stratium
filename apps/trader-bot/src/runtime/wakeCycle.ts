import type { TraderBotExecutor, TraderBotPlanner, TraderBotPlannerContext, TraderBotProgressLogger, TraderBotWakeResult } from "../types.js";
import { buildPrompt } from "../planner/promptBuilder.js";
import { parsePlan } from "../planner/planParser.js";
import { selectPlanCandidate } from "./candidateSelector.js";
import { evaluateRisk } from "./riskGate.js";
import { createShadowExecutor } from "./shadowExecutor.js";

export const runWakeCycle = async (
  context: TraderBotPlannerContext,
  planner: TraderBotPlanner,
  executor: TraderBotExecutor = createShadowExecutor(),
  log: TraderBotProgressLogger = () => undefined
): Promise<TraderBotWakeResult> => {
  const startedAt = new Date().toISOString();
  const prompt = buildPrompt(context);
  log(`prompt: ready chars=${prompt.length}`);

  if (context.config.mode === "disabled") {
    log(`profile: bot=${context.config.botId} is disabled; skipping planner`);
    return {
      wakeId: context.wakeRequest.id,
      botId: context.config.botId,
      mode: context.config.mode,
      status: "skipped_disabled",
      startedAt,
      finishedAt: new Date().toISOString(),
      prompt,
      executionResults: [],
      errors: []
    };
  }

  try {
    const plannerStartedAt = Date.now();
    log(`planner: call started (${context.config.planner})`);
    const rawPlan = await planner.plan(context, log);
    log(`planner: returned (${Date.now() - plannerStartedAt}ms)`);
    const plan = parsePlan(rawPlan);
    log(`planner: parsed candidates=${plan.candidates.length}`);
    const selectedCandidate = selectPlanCandidate(plan);
    log(`planner: selected candidate=${selectedCandidate.id}, confidence=${selectedCandidate.confidence}`);
    const riskDecision = evaluateRisk({
      mode: context.config.mode,
      policy: context.config.riskPolicy,
      market: context.market,
      account: context.account,
      candidate: selectedCandidate
    });
    log(`risk: approved=${riskDecision.approvedActions.length}, rejected=${riskDecision.rejectedActions.length}`);
    const executorStartedAt = Date.now();
    log(`executor: mode=${context.config.mode}, actions=${riskDecision.approvedActions.length}`);
    const executionResults = await executor.execute(context.config.mode, riskDecision.approvedActions);
    log(`executor: completed (${Date.now() - executorStartedAt}ms), results=${executionResults.map((entry) => entry.status).join(",") || "none"}`);

    return {
      wakeId: context.wakeRequest.id,
      botId: context.config.botId,
      mode: context.config.mode,
      status: "completed",
      startedAt,
      finishedAt: new Date().toISOString(),
      prompt,
      plan,
      selectedCandidate,
      riskDecision,
      executionResults,
      errors: []
    };
  } catch (error) {
    return {
      wakeId: context.wakeRequest.id,
      botId: context.config.botId,
      mode: context.config.mode,
      status: "failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      prompt,
      executionResults: [],
      errors: [error instanceof Error ? error.message : String(error)]
    };
  }
};
