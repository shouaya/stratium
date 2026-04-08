import type {
  AccountBalancePayload,
  EventEnvelope,
  FillPayload,
  MarginPayload,
  MarketTick,
  OrderAcceptedPayload,
  OrderCanceledPayload,
  OrderRejectedPayload,
  OrderRequestedPayload,
  PositionPayload
} from "@stratium/shared";
import type { TradingEngineState } from "../domain/state";

const derivePositionSide = (quantity: number, side: PositionPayload["side"]): PositionPayload["side"] => {
  if (quantity === 0) {
    return "flat";
  }

  return side;
};

export const applyEvent = (
  currentState: TradingEngineState,
  event: EventEnvelope<unknown>
): TradingEngineState => {
  switch (event.eventType) {
    case "MarketTickReceived": {
      const payload = event.payload as Omit<MarketTick, "symbol">;
      const latestTick: MarketTick = {
        ...payload,
        symbol: event.symbol
      };

      return {
        ...currentState,
        latestTick,
        position: {
          ...currentState.position,
          symbol: event.symbol,
          markPrice: payload.last
        },
        nextSequence: Math.max(currentState.nextSequence, event.sequence + 1)
      };
    }

    case "OrderRequested": {
      const payload = event.payload as OrderRequestedPayload;

      return {
        ...currentState,
        orders: [
          ...currentState.orders,
          {
            id: payload.orderId,
            accountId: event.accountId,
            symbol: event.symbol,
            side: payload.side,
            orderType: payload.orderType,
            status: "NEW",
            quantity: payload.quantity,
            limitPrice: payload.limitPrice,
            filledQuantity: 0,
            remainingQuantity: payload.quantity,
            createdAt: payload.submittedAt,
            updatedAt: payload.submittedAt
          }
        ],
        nextSequence: Math.max(currentState.nextSequence, event.sequence + 1)
      };
    }

    case "OrderAccepted":
    case "OrderRejected":
    case "OrderCanceled":
    case "OrderPartiallyFilled":
    case "OrderFilled": {
      const updatedOrders = currentState.orders.map((order) => {
        if (order.id !== (event.payload as { orderId: string }).orderId) {
          return order;
        }

        switch (event.eventType) {
          case "OrderAccepted": {
            const payload = event.payload as OrderAcceptedPayload;

            return {
              ...order,
              status: "ACCEPTED" as const,
              updatedAt: payload.acceptedAt
            };
          }

          case "OrderRejected": {
            const payload = event.payload as OrderRejectedPayload;

            return {
              ...order,
              status: "REJECTED" as const,
              rejectionCode: payload.reasonCode,
              rejectionMessage: payload.reasonMessage,
              updatedAt: payload.rejectedAt
            };
          }

          case "OrderCanceled": {
            const payload = event.payload as OrderCanceledPayload;

            return {
              ...order,
              status: "CANCELED" as const,
              remainingQuantity: payload.remainingQuantity,
              updatedAt: payload.canceledAt
            };
          }

          default: {
            const payload = event.payload as FillPayload;

            return {
              ...order,
              status: event.eventType === "OrderFilled" ? "FILLED" as const : "PARTIALLY_FILLED" as const,
              averageFillPrice: payload.fillPrice,
              filledQuantity: payload.filledQuantityTotal,
              remainingQuantity: payload.remainingQuantity,
              updatedAt: payload.filledAt
            };
          }
        }
      });

      return {
        ...currentState,
        orders: updatedOrders,
        nextSequence: Math.max(currentState.nextSequence, event.sequence + 1)
      };
    }

    case "PositionOpened":
    case "PositionUpdated":
    case "PositionClosed": {
      const payload = event.payload as PositionPayload;

      return {
        ...currentState,
        account: {
          ...currentState.account,
          realizedPnl: payload.realizedPnl,
          unrealizedPnl: payload.unrealizedPnl
        },
        position: {
          ...currentState.position,
          symbol: event.symbol,
          side: derivePositionSide(payload.quantity, payload.side),
          quantity: payload.quantity,
          averageEntryPrice: payload.averageEntryPrice,
          realizedPnl: payload.realizedPnl,
          unrealizedPnl: payload.unrealizedPnl,
          markPrice: payload.markPrice
        },
        nextSequence: Math.max(currentState.nextSequence, event.sequence + 1)
      };
    }

    case "AccountBalanceUpdated": {
      const payload = event.payload as AccountBalancePayload;

      return {
        ...currentState,
        account: {
          ...currentState.account,
          walletBalance: payload.walletBalance,
          availableBalance: payload.availableBalance,
          positionMargin: payload.positionMargin,
          orderMargin: payload.orderMargin,
          equity: payload.equity
        },
        nextSequence: Math.max(currentState.nextSequence, event.sequence + 1)
      };
    }

    case "MarginUpdated": {
      const payload = event.payload as MarginPayload;

      return {
        ...currentState,
        account: {
          ...currentState.account,
          riskRatio: payload.riskRatio
        },
        position: {
          ...currentState.position,
          initialMargin: payload.initialMargin,
          maintenanceMargin: payload.maintenanceMargin,
          liquidationPrice: payload.liquidationPrice
        },
        nextSequence: Math.max(currentState.nextSequence, event.sequence + 1)
      };
    }

    case "OrderCancelRequested":
    case "FeeCharged":
    default:
      return {
        ...currentState,
        nextSequence: Math.max(currentState.nextSequence, event.sequence + 1)
      };
  }
};
