export type EventSource = "market" | "user" | "system" | "replay";

export type DomainEventType =
  | "MarketTickReceived"
  | "OrderRequested"
  | "OrderAccepted"
  | "OrderRejected"
  | "OrderCancelRequested"
  | "OrderCanceled"
  | "OrderPartiallyFilled"
  | "OrderFilled"
  | "PositionOpened"
  | "PositionUpdated"
  | "PositionClosed"
  | "AccountBalanceUpdated"
  | "MarginUpdated"
  | "FeeCharged"
  | "LiquidationTriggered"
  | "LiquidationExecuted"
  | "ReplayRequested"
  | "ReplayCompleted";

export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit";
export type OrderStatus =
  | "NEW"
  | "ACCEPTED"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELED"
  | "REJECTED";

export type PositionSide = "long" | "short" | "flat";

export type RejectionCode =
  | "INVALID_SYMBOL"
  | "INVALID_QUANTITY"
  | "INVALID_PRICE"
  | "INSUFFICIENT_MARGIN"
  | "ACCOUNT_NOT_FOUND"
  | "ACCOUNT_DISABLED"
  | "INVALID_ORDER_STATE"
  | "MISSING_MARKET_TICK"
  | "ORDER_NOT_FOUND";

export interface EventEnvelope<TPayload = unknown> {
  eventId: string;
  eventType: DomainEventType;
  occurredAt: string;
  sequence: number;
  simulationSessionId: string;
  accountId: string;
  symbol: string;
  source: EventSource;
  payload: TPayload;
}

export interface MarketTick {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  spread: number;
  tickTime: string;
  volatilityTag?: string;
}

export interface CreateOrderInput {
  accountId: string;
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  quantity: number;
  limitPrice?: number;
  submittedAt?: string;
}

export interface CancelOrderInput {
  accountId: string;
  orderId: string;
  requestedAt?: string;
}

export interface OrderView {
  id: string;
  accountId: string;
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  status: OrderStatus;
  quantity: number;
  limitPrice?: number;
  filledQuantity: number;
  remainingQuantity: number;
  averageFillPrice?: number;
  rejectionCode?: RejectionCode;
  rejectionMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PositionView {
  symbol: string;
  side: PositionSide;
  quantity: number;
  averageEntryPrice: number;
  markPrice: number;
  realizedPnl: number;
  unrealizedPnl: number;
  initialMargin: number;
  maintenanceMargin: number;
  liquidationPrice: number;
}

export interface AccountView {
  accountId: string;
  walletBalance: number;
  availableBalance: number;
  positionMargin: number;
  orderMargin: number;
  equity: number;
  realizedPnl: number;
  unrealizedPnl: number;
  riskRatio: number;
}

export interface TradingSymbolConfig {
  symbol: string;
  leverage: number;
  maintenanceMarginRate: number;
  takerFeeRate: number;
  baseSlippageBps: number;
  partialFillEnabled: boolean;
}

export interface OrderRequestedPayload {
  orderId: string;
  side: OrderSide;
  orderType: OrderType;
  quantity: number;
  limitPrice?: number;
  submittedAt: string;
}

export interface OrderAcceptedPayload {
  orderId: string;
  acceptedAt: string;
}

export interface OrderRejectedPayload {
  orderId: string;
  rejectedAt: string;
  reasonCode: RejectionCode;
  reasonMessage: string;
}

export interface OrderCancelRequestedPayload {
  orderId: string;
  requestedAt: string;
}

export interface OrderCanceledPayload {
  orderId: string;
  canceledAt: string;
  remainingQuantity: number;
}

export interface FillPayload {
  orderId: string;
  fillId: string;
  fillPrice: number;
  fillQuantity: number;
  filledQuantityTotal: number;
  remainingQuantity: number;
  slippage: number;
  fee: number;
  filledAt: string;
}

export interface PositionPayload {
  positionId: string;
  side: PositionSide;
  quantity: number;
  averageEntryPrice: number;
  realizedPnl: number;
  unrealizedPnl: number;
  markPrice: number;
}

export interface AccountBalancePayload {
  walletBalance: number;
  availableBalance: number;
  positionMargin: number;
  orderMargin: number;
  equity: number;
}

export interface MarginPayload {
  initialMargin: number;
  maintenanceMargin: number;
  riskRatio: number;
  liquidationPrice: number;
}
