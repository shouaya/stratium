import type {
  EventEnvelope,
  OrderCanceledPayload,
  OrderCancelRequestedPayload,
  OrderRejectedPayload
} from "@stratium/shared";
import type { TradingCommandHandler, HandleCancelOrderArgs } from "./handler-types";

export const handleCancelOrder: TradingCommandHandler<HandleCancelOrderArgs> = ({
  context,
  input
}) => {
  const events: EventEnvelope<unknown>[] = [];
  const requestedAt = input.requestedAt ?? context.now();
  const state = context.getState();
  const orderIndex = state.orders.findIndex((order) => order.id === input.orderId);

  if (orderIndex < 0) {
    events.push(
      context.createEvent<OrderRejectedPayload>("OrderRejected", "system", state.position.symbol, {
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

  context.emitAndApply<OrderCancelRequestedPayload>(events, "OrderCancelRequested", "user", order.symbol, {
    orderId: order.id,
    requestedAt
  }, requestedAt);

  if (order.status !== "ACCEPTED" && order.status !== "PARTIALLY_FILLED") {
    context.emitAndApply<OrderRejectedPayload>(events, "OrderRejected", "system", order.symbol, {
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

  context.emitAndApply<OrderCanceledPayload>(events, "OrderCanceled", "system", order.symbol, {
    orderId: order.id,
    canceledAt: requestedAt,
    remainingQuantity: order.remainingQuantity
  }, requestedAt);

  return {
    state: context.getState(),
    events
  };
};
