import type {
  CancelOrderInput,
  CreateOrderInput,
  AnyEventEnvelope,
  DomainEventEnvelope,
  DomainEventPayload,
  DomainEventType,
  MarketTick,
  OrderSide,
  PositionPayload,
  TradingSymbolConfig
} from "@stratium/shared";
import type { TradingEngineResult } from "./trading-engine.js";
import type { TradingEngineState } from "../domain/state.js";
import type { PositionComputationResult } from "../rules/position-math.js";

export interface BaseHandlerContext {
  getState(): TradingEngineState;
  setState(state: TradingEngineState): void;
  getSymbolConfig(): TradingSymbolConfig;
  emitAndApply<TType extends DomainEventType>(
    events: AnyEventEnvelope[],
    eventType: TType,
    source: AnyEventEnvelope["source"],
    symbol: string,
    payload: DomainEventPayload<TType>,
    occurredAt: string
  ): DomainEventEnvelope<TType>;
}

export interface MarketTickHandlerContext extends BaseHandlerContext {
  refreshAccountSnapshot(events: AnyEventEnvelope[], occurredAt: string): void;
  tryFillActiveOrders(events: AnyEventEnvelope[], occurredAt: string): void;
}

export interface SubmitOrderHandlerContext extends BaseHandlerContext {
  now(): string;
  tryFillOrder(orderId: string, events: AnyEventEnvelope[], occurredAt: string): void;
}

export interface FillOrderHandlerContext extends BaseHandlerContext {
  incrementNextFillId(): number;
  applyPostFill(
    orderId: string,
    orderSide: OrderSide,
    fillQuantity: number,
    fillPrice: number,
    fee: number,
    events: AnyEventEnvelope[],
    occurredAt: string
  ): void;
}

export interface CancelOrderHandlerContext extends BaseHandlerContext {
  createEvent<TType extends DomainEventType>(
    eventType: TType,
    source: AnyEventEnvelope["source"],
    symbol: string,
    payload: DomainEventPayload<TType>,
    occurredAt: string
  ): DomainEventEnvelope<TType>;
  now(): string;
}

export interface HandleMarketTickArgs {
  context: MarketTickHandlerContext;
  tick: MarketTick;
}

export interface HandleSubmitOrderArgs {
  context: SubmitOrderHandlerContext;
  input: CreateOrderInput;
}

export interface HandleCancelOrderArgs {
  context: CancelOrderHandlerContext;
  input: CancelOrderInput;
}

export interface HandleFillOrderArgs {
  context: FillOrderHandlerContext;
  orderId: string;
  events: AnyEventEnvelope[];
  occurredAt: string;
}

export interface PostFillHandlerContext extends BaseHandlerContext {
  computePostFillResult(
    orderSide: OrderSide,
    fillQuantity: number,
    fillPrice: number,
    fee: number
  ): {
    previousState: TradingEngineState;
    result: PositionComputationResult;
  };
  applyComputedPostFill(result: PositionComputationResult): void;
  buildPositionPayload(result: PositionComputationResult): PositionPayload;
  refreshAccountSnapshot(events: AnyEventEnvelope[], occurredAt: string): void;
  getCurrentFillId(): number;
}

export interface RefreshAccountHandlerContext extends BaseHandlerContext {
  refreshAccountState(): void;
  buildAccountBalancePayload(): {
    walletBalance: number;
    availableBalance: number;
    positionMargin: number;
    orderMargin: number;
    equity: number;
  };
  buildMarginPayload(): {
    initialMargin: number;
    maintenanceMargin: number;
    riskRatio: number;
    liquidationPrice: number;
  };
}

export interface HandlePostFillArgs {
  context: PostFillHandlerContext;
  orderId: string;
  orderSide: OrderSide;
  fillQuantity: number;
  fillPrice: number;
  fee: number;
  events: AnyEventEnvelope[];
  occurredAt: string;
}

export interface HandleRefreshAccountArgs {
  context: RefreshAccountHandlerContext;
  events: AnyEventEnvelope[];
  occurredAt: string;
}

export type TradingCommandHandler<TArgs> = (args: TArgs) => TradingEngineResult;
