import type {
  CancelOrderInput,
  CreateOrderInput,
  EventEnvelope,
  MarketTick,
  OrderSide,
  PositionPayload,
  TradingSymbolConfig
} from "@stratium/shared";
import type { TradingEngineResult } from "./trading-engine";
import type { TradingEngineState } from "../domain/state";
import type { PositionComputationResult } from "../rules/position-math";

export interface BaseHandlerContext {
  getState(): TradingEngineState;
  setState(state: TradingEngineState): void;
  getSymbolConfig(): TradingSymbolConfig;
  emitAndApply<TPayload>(
    events: EventEnvelope<unknown>[],
    eventType: EventEnvelope<TPayload>["eventType"],
    source: EventEnvelope<TPayload>["source"],
    symbol: string,
    payload: TPayload,
    occurredAt: string
  ): EventEnvelope<TPayload>;
}

export interface MarketTickHandlerContext extends BaseHandlerContext {
  refreshAccountSnapshot(events: EventEnvelope<unknown>[], occurredAt: string): void;
  tryFillActiveOrders(events: EventEnvelope<unknown>[], occurredAt: string): void;
}

export interface SubmitOrderHandlerContext extends BaseHandlerContext {
  now(): string;
  tryFillOrder(orderId: string, events: EventEnvelope<unknown>[], occurredAt: string): void;
}

export interface FillOrderHandlerContext extends BaseHandlerContext {
  incrementNextFillId(): number;
  applyPostFill(
    orderId: string,
    orderSide: OrderSide,
    fillQuantity: number,
    fillPrice: number,
    fee: number,
    events: EventEnvelope<unknown>[],
    occurredAt: string
  ): void;
}

export interface CancelOrderHandlerContext extends BaseHandlerContext {
  createEvent<TPayload>(
    eventType: EventEnvelope<TPayload>["eventType"],
    source: EventEnvelope<TPayload>["source"],
    symbol: string,
    payload: TPayload,
    occurredAt: string
  ): EventEnvelope<TPayload>;
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
  events: EventEnvelope<unknown>[];
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
  refreshAccountSnapshot(events: EventEnvelope<unknown>[], occurredAt: string): void;
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
  events: EventEnvelope<unknown>[];
  occurredAt: string;
}

export interface HandleRefreshAccountArgs {
  context: RefreshAccountHandlerContext;
  events: EventEnvelope<unknown>[];
  occurredAt: string;
}

export type TradingCommandHandler<TArgs> = (args: TArgs) => TradingEngineResult;
