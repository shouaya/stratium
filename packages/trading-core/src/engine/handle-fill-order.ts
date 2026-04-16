import type { AnyEventEnvelope, FillPayload, OrderStatus } from "@stratium/shared";
import { round } from "../domain/state.js";
import { applyExecutionPricing, getExecutableReferencePrice, getLiquidityRole } from "../rules/pricing.js";
import type { HandleFillOrderArgs } from "./handler-types.js";

const resolveFillQuantity = (remainingQuantity: number, partialFillEnabled: boolean): number => {
  if (!partialFillEnabled || remainingQuantity <= 1) {
    return remainingQuantity;
  }

  const partialQuantity = round(remainingQuantity / 2);

  if (partialQuantity <= 0 || partialQuantity >= remainingQuantity) {
    return remainingQuantity;
  }

  return partialQuantity;
};

export const handleFillOrder = ({
  context,
  orderId,
  events,
  occurredAt
}: HandleFillOrderArgs): void => {
  const state = context.getState();
  const order = state.orders.find((entry) => entry.id === orderId);

  if (!order || (order.status !== "ACCEPTED" && order.status !== "PARTIALLY_FILLED")) {
    return;
  }

  if (!state.latestTick || state.latestTick.symbol !== order.symbol) {
    return;
  }

  const executable = getExecutableReferencePrice(state.latestTick, order);

  if (executable === null) {
    return;
  }

  const symbolConfig = context.getSymbolConfig();
  const fillQuantity = resolveFillQuantity(order.remainingQuantity, symbolConfig.partialFillEnabled);
  const liquidityRole = getLiquidityRole(order, occurredAt);
  const fillPrice = applyExecutionPricing(
    order.side,
    executable,
    liquidityRole,
    symbolConfig.baseSlippageBps
  );
  const fillNotional = fillQuantity * fillPrice;
  const feeRate = liquidityRole === "maker" ? symbolConfig.makerFeeRate : symbolConfig.takerFeeRate;
  const fee = round(fillNotional * feeRate);
  const fillId = `fill_${context.incrementNextFillId()}`;
  const nextFilledQuantity = round(order.filledQuantity + fillQuantity);
  const nextRemainingQuantity = round(order.remainingQuantity - fillQuantity);
  const nextStatus: OrderStatus = nextRemainingQuantity === 0 ? "FILLED" : "PARTIALLY_FILLED";
  const slippage = round(Math.abs(fillPrice - executable));
  const fillPayload: FillPayload = {
    orderId: order.id,
    fillId,
    fillPrice,
    fillQuantity,
    filledQuantityTotal: nextFilledQuantity,
    remainingQuantity: nextRemainingQuantity,
    slippage,
    fee,
    feeRate,
    liquidityRole,
    filledAt: occurredAt
  };

  context.emitAndApply(
    events,
    nextStatus === "FILLED" ? "OrderFilled" : "OrderPartiallyFilled",
    "system",
    order.symbol,
    fillPayload,
    occurredAt
  );

  context.applyPostFill(order.id, order.side, fillQuantity, fillPrice, fee, events, occurredAt);
};
