import type { HandleRefreshAccountArgs } from "./handler-types";

export const handleRefreshAccount = ({
  context,
  events,
  occurredAt
}: HandleRefreshAccountArgs): void => {
  context.refreshAccountState();

  context.emitAndApply(
    events,
    "AccountBalanceUpdated",
    "system",
    context.getState().position.symbol,
    context.buildAccountBalancePayload(),
    occurredAt
  );
  context.emitAndApply(
    events,
    "MarginUpdated",
    "system",
    context.getState().position.symbol,
    context.buildMarginPayload(),
    occurredAt
  );
};
