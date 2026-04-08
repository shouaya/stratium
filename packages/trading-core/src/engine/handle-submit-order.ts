import type {
  EventEnvelope,
  OrderAcceptedPayload,
  OrderRejectedPayload,
  OrderRequestedPayload
} from "@stratium/shared";
import { validateOrder } from "../rules/order-validation";
import type { TradingCommandHandler, HandleSubmitOrderArgs } from "./handler-types";

export const handleSubmitOrder: TradingCommandHandler<HandleSubmitOrderArgs> = ({
  context,
  input
}) => {
  const events: EventEnvelope<unknown>[] = [];
  const submittedAt = input.submittedAt ?? context.now();
  const currentState = context.getState();
  const orderId = `ord_${currentState.nextOrderId}`;

  context.emitAndApply<OrderRequestedPayload>(events, "OrderRequested", "user", input.symbol, {
    orderId,
    side: input.side,
    orderType: input.orderType,
    quantity: input.quantity,
    limitPrice: input.limitPrice,
    submittedAt
  }, submittedAt);

  const validation = validateOrder(context.getState(), context.getSymbolConfig(), input);
  context.setState({
    ...context.getState(),
    nextOrderId: context.getState().nextOrderId + 1
  });

  if (validation) {
    context.emitAndApply<OrderRejectedPayload>(events, "OrderRejected", "system", input.symbol, {
      orderId,
      rejectedAt: submittedAt,
      reasonCode: validation.code,
      reasonMessage: validation.message
    }, submittedAt);

    return {
      state: context.getState(),
      events
    };
  }

  context.emitAndApply<OrderAcceptedPayload>(events, "OrderAccepted", "system", input.symbol, {
    orderId,
    acceptedAt: submittedAt
  }, submittedAt);

  context.tryFillOrder(orderId, events, submittedAt);

  return {
    state: context.getState(),
    events
  };
};
