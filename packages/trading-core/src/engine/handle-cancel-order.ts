import type {
  AnyEventEnvelope,
  OrderCanceledPayload,
  OrderCancelRequestedPayload,
  OrderRejectedPayload
} from "@stratium/shared";
import type { TradingCommandHandler, HandleCancelOrderArgs } from "./handler-types.js";

export const handleCancelOrder: TradingCommandHandler<HandleCancelOrderArgs> = ({
  context,
  input
}) => {
  const events: AnyEventEnvelope[] = [];
  const requestedAt = input.requestedAt ?? context.now();
  const state = context.getState();
  const orderIndex = state.orders.findIndex((order) => order.id === input.orderId);

  if (orderIndex < 0) {
    events.push(
      context.createEvent("OrderRejected", "system", state.position.symbol, {
        orderId: input.orderId,
        rejectedAt: requestedAt,
        reasonCode: "ORDER_NOT_FOUND",
        reasonMessage: "Order does not exist."
      }, requestedAt)
    );

    return {
      state: context.getState(),
      events
    };
  }

  const order = state.orders[orderIndex];

  context.emitAndApply(events, "OrderCancelRequested", "user", order.symbol, {
    orderId: order.id,
    requestedAt
  }, requestedAt);

  if (order.status !== "ACCEPTED" && order.status !== "PARTIALLY_FILLED") {
    context.emitAndApply(events, "OrderRejected", "system", order.symbol, {
      orderId: order.id,
      rejectedAt: requestedAt,
      reasonCode: "INVALID_ORDER_STATE",
      reasonMessage: "Only active orders can be canceled."
    }, requestedAt);

    return {
      state: context.getState(),
      events
    };
  }

  context.emitAndApply(events, "OrderCanceled", "system", order.symbol, {
    orderId: order.id,
    canceledAt: requestedAt,
    remainingQuantity: order.remainingQuantity
  }, requestedAt);

  return {
    state: context.getState(),
    events
  };
};
