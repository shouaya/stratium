import type { HandlePostFillArgs } from "./handler-types.js";

export const handlePostFill = ({
  context,
  orderId,
  orderSide,
  fillQuantity,
  fillPrice,
  fee,
  events,
  occurredAt
}: HandlePostFillArgs): void => {
  const { previousState, result } = context.computePostFillResult(
    orderSide,
    fillQuantity,
    fillPrice,
    fee
  );

  context.applyComputedPostFill(result);

  const positionPayload = context.buildPositionPayload(result);

  if (result.position.side === "flat") {
    context.emitAndApply(events, "PositionClosed", "system", result.position.symbol, positionPayload, occurredAt);
  } else if (previousState.position.quantity === 0 && result.realizedPnlDelta === 0) {
    context.emitAndApply(events, "PositionOpened", "system", result.position.symbol, positionPayload, occurredAt);
  } else {
    context.emitAndApply(events, "PositionUpdated", "system", result.position.symbol, positionPayload, occurredAt);
  }

  context.emitAndApply(events, "FeeCharged", "system", result.position.symbol, {
    ledgerEntryId: `ledger_${context.getCurrentFillId() - 1}`,
    orderId,
    fillId: `fill_${context.getCurrentFillId() - 1}`,
    amount: fee,
    asset: "USD",
    chargedAt: occurredAt
  }, occurredAt);

  context.refreshAccountSnapshot(events, occurredAt);
};
