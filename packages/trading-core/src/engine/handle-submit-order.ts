import type {
  AnyEventEnvelope,
  OrderAcceptedPayload,
  OrderRejectedPayload,
  OrderRequestedPayload
} from "@stratium/shared";
import { validateOrder } from "../rules/order-validation.js";
import type { TradingCommandHandler, HandleSubmitOrderArgs } from "./handler-types.js";

export const handleSubmitOrder: TradingCommandHandler<HandleSubmitOrderArgs> = ({
  context,
  input
}) => {
  const events: AnyEventEnvelope[] = [];
  const submittedAt = input.submittedAt ?? context.now();
  const currentState = context.getState();
  const orderId = `ord_${currentState.nextOrderId}`;

  context.emitAndApply(events, "OrderRequested", "user", input.symbol, {
    orderId,
    clientOrderId: input.clientOrderId,
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
    context.emitAndApply(events, "OrderRejected", "system", input.symbol, {
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

  context.emitAndApply(events, "OrderAccepted", "system", input.symbol, {
    orderId,
    acceptedAt: submittedAt
  }, submittedAt);

  context.tryFillOrder(orderId, events, submittedAt);

  return {
    state: context.getState(),
    events
  };
};
