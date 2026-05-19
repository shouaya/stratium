import type { AiTraderMode, AiTraderPlanAction } from "@stratium/shared";
import type { TraderBotExecutionResult, TraderBotExecutor } from "../types.js";

export const createShadowExecutionResults = (mode: AiTraderMode, actions: AiTraderPlanAction[]): TraderBotExecutionResult[] => {
  if (mode === "approval") {
    return actions.map((action) => ({
      action,
      status: "pending_approval",
      message: "action passed risk gate and is waiting for admin approval"
    }));
  }

  if (mode === "paper_execute") {
    return actions.map((action) => ({
      action,
      status: "skipped_shadow",
      message: "paper execution adapter is not connected in this scaffold"
    }));
  }

  return actions.map((action) => ({
    action,
    status: "skipped_shadow",
    message: "shadow mode records approved actions without executing them"
  }));
};

export const createShadowExecutor = (): TraderBotExecutor => ({
  execute: async (mode, actions) => createShadowExecutionResults(mode, actions)
});
