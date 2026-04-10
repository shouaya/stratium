import type { MarketTick } from "./market";
import type { LiquidityRole, OrderSide, OrderType, RejectionCode } from "./orders";
import type { PositionSide } from "./views";

export type EventSource = "market" | "user" | "system" | "replay";

export interface OrderRequestedPayload {
  orderId: string;
  clientOrderId?: string;
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
  feeRate: number;
  liquidityRole: LiquidityRole;
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

export interface FeeChargedPayload {
  ledgerEntryId: string;
  orderId: string;
  fillId: string;
  amount: number;
  asset: string;
  chargedAt: string;
}

export interface LiquidationTriggeredPayload {
  positionId: string;
  triggerPrice: number;
  riskRatio: number;
  triggeredAt: string;
}

export interface LiquidationExecutedPayload {
  positionId: string;
  liquidationOrderId: string;
  executionPrice: number;
  executionQuantity: number;
  executedAt: string;
}

export interface ReplayRequestedPayload {
  requestedAt: string;
  fromSequence?: number;
  toSequence?: number;
}

export interface ReplayCompletedPayload {
  completedAt: string;
  finalSequence: number;
}

export interface DomainEventPayloadMap {
  MarketTickReceived: Omit<MarketTick, "symbol">;
  OrderRequested: OrderRequestedPayload;
  OrderAccepted: OrderAcceptedPayload;
  OrderRejected: OrderRejectedPayload;
  OrderCancelRequested: OrderCancelRequestedPayload;
  OrderCanceled: OrderCanceledPayload;
  OrderPartiallyFilled: FillPayload;
  OrderFilled: FillPayload;
  PositionOpened: PositionPayload;
  PositionUpdated: PositionPayload;
  PositionClosed: PositionPayload;
  AccountBalanceUpdated: AccountBalancePayload;
  MarginUpdated: MarginPayload;
  FeeCharged: FeeChargedPayload;
  LiquidationTriggered: LiquidationTriggeredPayload;
  LiquidationExecuted: LiquidationExecutedPayload;
  ReplayRequested: ReplayRequestedPayload;
  ReplayCompleted: ReplayCompletedPayload;
}

export type DomainEventType = keyof DomainEventPayloadMap;
export type DomainEventPayload<TType extends DomainEventType> = DomainEventPayloadMap[TType];

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

export type DomainEventEnvelope<TType extends DomainEventType = DomainEventType> = Omit<
  EventEnvelope<DomainEventPayload<TType>>,
  "eventType"
> & {
  eventType: TType;
};

export type AnyEventEnvelope = {
  [TType in DomainEventType]: DomainEventEnvelope<TType>;
}[DomainEventType];
