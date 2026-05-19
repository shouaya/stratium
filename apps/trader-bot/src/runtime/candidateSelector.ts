import type { AiTraderPlan, AiTraderPlanCandidate } from "@stratium/shared";

const candidateScore = (candidate: AiTraderPlanCandidate): number => {
  const expectedReward = candidate.expectedReward ?? 0;
  const actionPenalty = Math.max(0, candidate.actions.length - 1) * 0.05;
  return expectedReward + candidate.confidence - actionPenalty;
};

export const selectPlanCandidate = (plan: AiTraderPlan): AiTraderPlanCandidate => {
  return plan.candidates.reduce((best, candidate) => {
    return candidateScore(candidate) > candidateScore(best) ? candidate : best;
  }, plan.candidates[0]);
};
