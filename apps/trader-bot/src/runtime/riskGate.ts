import type { AiTraderMode, AiTraderPlanAction, AiTraderPlanCandidate, AiTraderRiskDecision, AiTraderRiskRuleResult } from "@stratium/shared";
import type { TraderBotAccountSnapshot, TraderBotMarketSnapshot, TraderBotRiskPolicy } from "../types.js";

type RiskGateInput = {
  mode: AiTraderMode;
  policy: TraderBotRiskPolicy;
  market: TraderBotMarketSnapshot;
  account: TraderBotAccountSnapshot;
  candidate: AiTraderPlanCandidate;
};

const result = (rule: string, passed: boolean, message: string, severity: AiTraderRiskRuleResult["severity"]): AiTraderRiskRuleResult => ({
  rule,
  passed,
  message,
  severity
});

const actionSymbol = (action: AiTraderPlanAction): string | undefined => {
  return action.type === "observe" ? undefined : action.symbol;
};

const actionNotional = (action: AiTraderPlanAction, market: TraderBotMarketSnapshot): number => {
  if (action.type !== "place_order") {
    return 0;
  }
  return action.quantity * (action.price ?? market.last);
};

const evaluateAction = (
  input: RiskGateInput,
  action: AiTraderPlanAction,
  actionIndex: number
): AiTraderRiskRuleResult[] => {
  const rules: AiTraderRiskRuleResult[] = [];
  const symbol = actionSymbol(action);

  if (symbol != null) {
    rules.push(result(
      `action_${actionIndex}_symbol_allowlist`,
      input.policy.allowedSymbols.includes(symbol),
      input.policy.allowedSymbols.includes(symbol) ? `${symbol} is allowed` : `${symbol} is outside the symbol allowlist`,
      input.policy.allowedSymbols.includes(symbol) ? "info" : "reject"
    ));
  }

  if (action.type === "place_order") {
    const openingOrder = action.reduceOnly !== true;
    const notional = actionNotional(action, input.market);
    rules.push(result(
      `action_${actionIndex}_quantity_positive`,
      action.quantity > 0,
      action.quantity > 0 ? "quantity is positive" : "quantity must be positive",
      action.quantity > 0 ? "info" : "reject"
    ));
    rules.push(result(
      `action_${actionIndex}_limit_price_required`,
      action.orderType !== "limit" || action.price != null,
      action.orderType !== "limit" || action.price != null ? "limit price is valid" : "limit order requires price",
      action.orderType !== "limit" || action.price != null ? "info" : "reject"
    ));
    rules.push(result(
      `action_${actionIndex}_max_order_notional`,
      notional <= input.policy.maxOrderNotional,
      notional <= input.policy.maxOrderNotional
        ? `order notional ${notional.toFixed(2)} is within limit`
        : `order notional ${notional.toFixed(2)} exceeds limit ${input.policy.maxOrderNotional}`,
      notional <= input.policy.maxOrderNotional ? "info" : "reject"
    ));
    const projectedPositionNotional = openingOrder
      ? input.account.currentPositionNotional + notional
      : Math.max(0, input.account.currentPositionNotional - notional);
    rules.push(result(
      `action_${actionIndex}_max_position_notional`,
      projectedPositionNotional <= input.policy.maxPositionNotional,
      projectedPositionNotional <= input.policy.maxPositionNotional
        ? "projected position is within limit"
        : `projected position ${projectedPositionNotional.toFixed(2)} exceeds limit ${input.policy.maxPositionNotional}`,
      projectedPositionNotional <= input.policy.maxPositionNotional ? "info" : "reject"
    ));
    rules.push(result(
      `action_${actionIndex}_opening_orders_allowed`,
      !openingOrder || input.policy.allowOpeningOrders,
      !openingOrder || input.policy.allowOpeningOrders ? "opening order policy passed" : "opening orders are disabled",
      !openingOrder || input.policy.allowOpeningOrders ? "info" : "reject"
    ));
    rules.push(result(
      `action_${actionIndex}_mode_allows_opening`,
      !openingOrder || (input.mode !== "reduce_only" && input.mode !== "disabled"),
      !openingOrder || (input.mode !== "reduce_only" && input.mode !== "disabled")
        ? "mode allows this order"
        : `mode ${input.mode} does not allow opening orders`,
      !openingOrder || (input.mode !== "reduce_only" && input.mode !== "disabled") ? "info" : "reject"
    ));
    rules.push(result(
      `action_${actionIndex}_invalidation_required`,
      !openingOrder || !input.policy.requireInvalidationPrice || action.invalidationPrice != null,
      !openingOrder || !input.policy.requireInvalidationPrice || action.invalidationPrice != null
        ? "invalidation policy passed"
        : "opening order requires invalidationPrice",
      !openingOrder || !input.policy.requireInvalidationPrice || action.invalidationPrice != null ? "info" : "reject"
    ));
  }

  if (action.type === "cancel_order") {
    const hasCancelTarget = Boolean(action.orderId?.trim() || action.clientOrderId?.trim());
    rules.push(result(
      `action_${actionIndex}_cancel_target_required`,
      hasCancelTarget,
      hasCancelTarget ? "cancel target is present" : "cancel_order requires orderId or clientOrderId",
      hasCancelTarget ? "info" : "reject"
    ));
  }

  if ((action.type === "reduce_position" || action.type === "close_position") && input.mode === "disabled") {
    rules.push(result(`action_${actionIndex}_disabled_mode`, false, "disabled mode rejects all actions", "reject"));
  }

  return rules;
};

export const evaluateRisk = (input: RiskGateInput): AiTraderRiskDecision => {
  const ruleResults: AiTraderRiskRuleResult[] = [
    result(
      "max_actions_per_wake",
      input.candidate.actions.length <= input.policy.maxActionsPerWake,
      input.candidate.actions.length <= input.policy.maxActionsPerWake
        ? "candidate action count is within limit"
        : `candidate has ${input.candidate.actions.length} actions; limit is ${input.policy.maxActionsPerWake}`,
      input.candidate.actions.length <= input.policy.maxActionsPerWake ? "info" : "reject"
    )
  ];

  const approvedActions: AiTraderPlanAction[] = [];
  const rejectedActions: AiTraderRiskDecision["rejectedActions"] = [];
  const globalRejected = ruleResults.some((entry) => entry.severity === "reject" && !entry.passed);

  for (const [index, action] of input.candidate.actions.entries()) {
    const actionResults = evaluateAction(input, action, index);
    ruleResults.push(...actionResults);
    const rejected = globalRejected || actionResults.some((entry) => entry.severity === "reject" && !entry.passed);
    if (rejected) {
      rejectedActions.push({
        action,
        reasons: actionResults.filter((entry) => entry.severity === "reject" && !entry.passed)
      });
    } else {
      approvedActions.push(action);
    }
  }

  return {
    approved: approvedActions.length > 0 && rejectedActions.length === 0,
    approvedActions,
    rejectedActions,
    ruleResults
  };
};
