import type { AiTraderPlan } from "@stratium/shared";
import type { TraderBotPlanner, TraderBotPlannerContext } from "../types.js";
import { resolveTraderBotLanguage } from "./language.js";

const dryRunText = (context: TraderBotPlannerContext) => {
  const language = resolveTraderBotLanguage(context);

  if (language === "zh") {
    return {
      summary: "Dry-run 规划器生成了只观察计划。",
      thesis: `观察 ${context.config.activeSymbol}，直到真实规划器接入。`,
      riskNote: "尚未接入执行适配器。",
      reason: "脚手架规划器在验证运行路径时保持 bot 安全。"
    };
  }

  if (language === "ja") {
    return {
      summary: "Dry-run プランナーは観察のみの計画を生成しました。",
      thesis: `実際のプランナーが接続されるまで ${context.config.activeSymbol} を観察します。`,
      riskNote: "実行アダプターはまだ接続されていません。",
      reason: "ランタイム経路の検証中は、スキャフォールドプランナーが bot を安全に保ちます。"
    };
  }

  return {
    summary: "Dry-run planner produced an observe-only plan.",
    thesis: `Observe ${context.config.activeSymbol} until a real planner is connected.`,
    riskNote: "No execution adapter is connected.",
    reason: "Scaffold planner keeps the bot safe while the runtime path is validated."
  };
};

export const createDryRunPlanner = (): TraderBotPlanner => ({
  plan: async (context: TraderBotPlannerContext): Promise<AiTraderPlan> => {
    const text = dryRunText(context);

    return {
      schemaVersion: "stratium.ai-trader-plan.v1",
      summary: text.summary,
      candidates: [
        {
          id: "dry-run-observe",
          thesis: text.thesis,
          confidence: 0.5,
          expectedReward: 0,
          riskNotes: [text.riskNote],
          actions: [
            {
              type: "observe",
              reason: text.reason
            }
          ]
        }
      ]
    };
  }
});
