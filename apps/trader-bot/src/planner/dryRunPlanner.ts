import type { AiTraderPlan } from "@stratium/shared";
import type { TraderBotPlanner, TraderBotPlannerContext } from "../types.js";

export const createDryRunPlanner = (): TraderBotPlanner => ({
  plan: async (context: TraderBotPlannerContext): Promise<AiTraderPlan> => ({
    schemaVersion: "stratium.ai-trader-plan.v1",
    summary: "Dry-run planner produced an observe-only plan.",
    candidates: [
      {
        id: "dry-run-observe",
        thesis: `Observe ${context.config.activeSymbol} until a real planner is connected.`,
        confidence: 0.5,
        expectedReward: 0,
        riskNotes: ["No execution adapter is connected."],
        actions: [
          {
            type: "observe",
            reason: "Scaffold planner keeps the bot safe while the runtime path is validated."
          }
        ]
      }
    ]
  })
});
