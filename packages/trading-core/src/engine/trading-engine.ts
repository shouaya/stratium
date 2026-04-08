import type {
  AccountBalancePayload,
  EventEnvelope,
  MarginPayload,
  OrderRejectedPayload,
  OrderSide,
  PositionPayload,
  TradingSymbolConfig
} from "@stratium/shared";
import type { TradingEngineOptions, TradingEngineState } from "../domain/state";
import { createInitialTradingState, DEFAULT_SYMBOL_CONFIG, round } from "../domain/state";
import { refreshAccountState } from "../rules/account-math";
import { computeNextPosition, type PositionComputationResult } from "../rules/position-math";
import { applyEvent } from "../replay/apply-event";
import { handleCancelOrder } from "./handle-cancel-order";
import { handleFillOrder } from "./handle-fill-order";
import { handleMarketTick } from "./handle-market-tick";
import { handlePostFill } from "./handle-post-fill";
import { handleRefreshAccount } from "./handle-refresh-account";
import { handleSubmitOrder } from "./handle-submit-order";
import type {
  CancelOrderHandlerContext,
  FillOrderHandlerContext,
  PostFillHandlerContext,
  RefreshAccountHandlerContext,
  MarketTickHandlerContext,
  SubmitOrderHandlerContext
} from "./handler-types";
import type { CancelOrderInput, CreateOrderInput, MarketTick } from "@stratium/shared";

export interface TradingEngineResult {
  readonly state: TradingEngineState;
  readonly events: EventEnvelope<unknown>[];
}

export class TradingEngine {
  private state: TradingEngineState;

  private symbolConfig: TradingSymbolConfig;

  constructor(
    initialState: TradingEngineState = createInitialTradingState(),
    options: TradingEngineOptions = {}
  ) {
    this.state = initialState;
    this.symbolConfig = options.symbolConfig ?? DEFAULT_SYMBOL_CONFIG;
  }

  getState(): TradingEngineState {
    return this.state;
  }

  getSymbolConfig(): TradingSymbolConfig {
    return this.symbolConfig;
  }

  setLeverage(leverage: number): TradingEngineState {
    this.symbolConfig = {
      ...this.symbolConfig,
      leverage
    };
    this.refreshAccountState();

    return this.state;
  }

  ingestMarketTick(tick: MarketTick): TradingEngineResult {
    return handleMarketTick({
      context: this.createMarketTickHandlerContext(),
      tick
    });
  }

  submitOrder(input: CreateOrderInput): TradingEngineResult {
    return handleSubmitOrder({
      context: this.createSubmitOrderHandlerContext(),
      input
    });
  }

  cancelOrder(input: CancelOrderInput): TradingEngineResult {
    return handleCancelOrder({
      context: this.createCancelOrderHandlerContext(),
      input
    });
  }

  private tryFillActiveOrders(events: EventEnvelope<unknown>[], occurredAt: string): void {
    const activeOrders = this.state.orders
      .filter((order) => order.status === "ACCEPTED" || order.status === "PARTIALLY_FILLED")
      .map((order) => order.id);

    for (const orderId of activeOrders) {
      this.tryFillOrder(orderId, events, occurredAt);
    }
  }

  private tryFillOrder(orderId: string, events: EventEnvelope<unknown>[], occurredAt: string): void {
    handleFillOrder({
      context: this.createFillOrderHandlerContext(),
      orderId,
      events,
      occurredAt
    });
  }

  private applyPostFill(
    orderId: string,
    orderSide: OrderSide,
    fillQuantity: number,
    fillPrice: number,
    fee: number,
    events: EventEnvelope<unknown>[],
    occurredAt: string
  ): void {
    handlePostFill({
      context: this.createPostFillHandlerContext(),
      orderId,
      orderSide,
      fillQuantity,
      fillPrice,
      fee,
      events,
      occurredAt
    });
  }

  private refreshAccountSnapshot(events: EventEnvelope<unknown>[], occurredAt: string): void {
    handleRefreshAccount({
      context: this.createRefreshAccountHandlerContext(),
      events,
      occurredAt
    });
  }

  private refreshAccountState(): void {
    const nextState = refreshAccountState(
      this.state.account,
      this.state.position,
      this.state.latestTick?.last,
      this.symbolConfig
    );

    this.state = {
      ...this.state,
      position: nextState.position,
      account: nextState.account
    };
  }

  private createEvent<TPayload>(
    eventType: EventEnvelope<TPayload>["eventType"],
    source: EventEnvelope<TPayload>["source"],
    symbol: string,
    payload: TPayload,
    occurredAt: string
  ): EventEnvelope<TPayload> {
    const event = {
      eventId: `evt_${this.state.nextSequence}`,
      eventType,
      occurredAt,
      sequence: this.state.nextSequence,
      simulationSessionId: this.state.simulationSessionId,
      accountId: this.state.account.accountId,
      symbol,
      source,
      payload
    };

    this.state = {
      ...this.state,
      nextSequence: this.state.nextSequence + 1
    };

    return event;
  }

  private emitAndApply<TPayload>(
    events: EventEnvelope<unknown>[],
    eventType: EventEnvelope<TPayload>["eventType"],
    source: EventEnvelope<TPayload>["source"],
    symbol: string,
    payload: TPayload,
    occurredAt: string
  ): EventEnvelope<TPayload> {
    const event = this.createEvent(eventType, source, symbol, payload, occurredAt);
    this.state = applyEvent(this.state, event);
    events.push(event);

    return event;
  }

  private now(): string {
    return new Date().toISOString();
  }

  private setState(state: TradingEngineState): void {
    this.state = state;
  }

  private incrementNextFillId(): number {
    const nextFillId = this.state.nextFillId;

    this.state = {
      ...this.state,
      nextFillId: nextFillId + 1
    };

    return nextFillId;
  }

  private computePostFillResult(
    orderSide: OrderSide,
    fillQuantity: number,
    fillPrice: number,
    fee: number
  ): {
    previousState: TradingEngineState;
    result: PositionComputationResult;
  } {
    const previousState = this.state;
    const result = computeNextPosition(
      previousState.position,
      previousState.account.walletBalance,
      previousState.latestTick?.last,
      this.symbolConfig,
      orderSide,
      fillQuantity,
      fillPrice,
      fee
    );

    return {
      previousState,
      result
    };
  }

  private applyComputedPostFill(result: PositionComputationResult): void {
    this.state = {
      ...this.state,
      position: result.position,
      account: {
        ...this.state.account,
        walletBalance: result.walletBalance,
        realizedPnl: result.position.realizedPnl
      }
    };
  }

  private buildPositionPayload(result: PositionComputationResult): PositionPayload {
    return {
      positionId: "position_1",
      side: result.position.side,
      quantity: result.position.quantity,
      averageEntryPrice: result.position.averageEntryPrice,
      realizedPnl: result.position.realizedPnl,
      unrealizedPnl: result.position.unrealizedPnl,
      markPrice: result.position.markPrice
    };
  }

  private buildAccountBalancePayload(): AccountBalancePayload {
    return {
      walletBalance: this.state.account.walletBalance,
      availableBalance: this.state.account.availableBalance,
      positionMargin: this.state.account.positionMargin,
      orderMargin: this.state.account.orderMargin,
      equity: this.state.account.equity
    };
  }

  private buildMarginPayload(): MarginPayload {
    return {
      initialMargin: this.state.position.initialMargin,
      maintenanceMargin: this.state.position.maintenanceMargin,
      riskRatio: this.state.account.riskRatio,
      liquidationPrice: this.state.position.liquidationPrice
    };
  }

  private createMarketTickHandlerContext(): MarketTickHandlerContext {
    return {
      getState: () => this.state,
      setState: (state) => this.setState(state),
      getSymbolConfig: () => this.symbolConfig,
      emitAndApply: (...args) => this.emitAndApply(...args),
      refreshAccountSnapshot: (events, occurredAt) => this.refreshAccountSnapshot(events, occurredAt),
      tryFillActiveOrders: (events, occurredAt) => this.tryFillActiveOrders(events, occurredAt)
    };
  }

  private createSubmitOrderHandlerContext(): SubmitOrderHandlerContext {
    return {
      getState: () => this.state,
      setState: (state) => this.setState(state),
      getSymbolConfig: () => this.symbolConfig,
      emitAndApply: (...args) => this.emitAndApply(...args),
      now: () => this.now(),
      tryFillOrder: (orderId, events, occurredAt) => this.tryFillOrder(orderId, events, occurredAt)
    };
  }

  private createFillOrderHandlerContext(): FillOrderHandlerContext {
    return {
      getState: () => this.state,
      setState: (state) => this.setState(state),
      getSymbolConfig: () => this.symbolConfig,
      emitAndApply: (...args) => this.emitAndApply(...args),
      incrementNextFillId: () => this.incrementNextFillId(),
      applyPostFill: (orderId, orderSide, fillQuantity, fillPrice, fee, events, occurredAt) =>
        this.applyPostFill(orderId, orderSide, fillQuantity, fillPrice, fee, events, occurredAt)
    };
  }

  private createPostFillHandlerContext(): PostFillHandlerContext {
    return {
      getState: () => this.state,
      setState: (state) => this.setState(state),
      getSymbolConfig: () => this.symbolConfig,
      emitAndApply: (...args) => this.emitAndApply(...args),
      computePostFillResult: (orderSide, fillQuantity, fillPrice, fee) =>
        this.computePostFillResult(orderSide, fillQuantity, fillPrice, fee),
      applyComputedPostFill: (result) => this.applyComputedPostFill(result),
      buildPositionPayload: (result) => this.buildPositionPayload(result),
      refreshAccountSnapshot: (events, occurredAt) => this.refreshAccountSnapshot(events, occurredAt),
      getCurrentFillId: () => this.state.nextFillId
    };
  }

  private createRefreshAccountHandlerContext(): RefreshAccountHandlerContext {
    return {
      getState: () => this.state,
      setState: (state) => this.setState(state),
      getSymbolConfig: () => this.symbolConfig,
      emitAndApply: (...args) => this.emitAndApply(...args),
      refreshAccountState: () => this.refreshAccountState(),
      buildAccountBalancePayload: () => this.buildAccountBalancePayload(),
      buildMarginPayload: () => this.buildMarginPayload()
    };
  }

  private createCancelOrderHandlerContext(): CancelOrderHandlerContext {
    return {
      getState: () => this.state,
      setState: (state) => this.setState(state),
      getSymbolConfig: () => this.symbolConfig,
      emitAndApply: (...args) => this.emitAndApply(...args),
      createEvent: (...args) => this.createEvent(...args),
      now: () => this.now()
    };
  }
}
