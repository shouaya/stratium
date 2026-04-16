import type {
  AccountBalancePayload,
  AnyEventEnvelope,
  DomainEventEnvelope,
  DomainEventPayload,
  DomainEventType,
  MarginPayload,
  OrderRejectedPayload,
  OrderSide,
  PositionPayload,
  TradingSymbolConfig
} from "@stratium/shared";
import type { TradingEngineOptions, TradingEngineState } from "../domain/state.js";
import { createInitialTradingState, DEFAULT_SYMBOL_CONFIG, round } from "../domain/state.js";
import { applyExecutionPricing } from "../rules/pricing.js";
import { refreshAccountState } from "../rules/account-math.js";
import { computeNextPosition, type PositionComputationResult } from "../rules/position-math.js";
import { applyEvent } from "../replay/apply-event.js";
import { handleCancelOrder } from "./handle-cancel-order.js";
import { handleFillOrder } from "./handle-fill-order.js";
import { handleMarketTick } from "./handle-market-tick.js";
import { handlePostFill } from "./handle-post-fill.js";
import { handleRefreshAccount } from "./handle-refresh-account.js";
import { handleSubmitOrder } from "./handle-submit-order.js";
import type {
  CancelOrderHandlerContext,
  FillOrderHandlerContext,
  PostFillHandlerContext,
  RefreshAccountHandlerContext,
  MarketTickHandlerContext,
  SubmitOrderHandlerContext
} from "./handler-types.js";
import type { CancelOrderInput, CreateOrderInput, MarketTick } from "@stratium/shared";

export interface TradingEngineResult {
  readonly state: TradingEngineState;
  readonly events: AnyEventEnvelope[];
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

  private tryFillActiveOrders(events: AnyEventEnvelope[], occurredAt: string): void {
    const activeOrders = this.state.orders
      .filter((order) => order.status === "ACCEPTED" || order.status === "PARTIALLY_FILLED")
      .map((order) => order.id);

    for (const orderId of activeOrders) {
      this.tryFillOrder(orderId, events, occurredAt);
    }
  }

  private tryFillOrder(orderId: string, events: AnyEventEnvelope[], occurredAt: string): void {
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
    events: AnyEventEnvelope[],
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

  private refreshAccountSnapshot(events: AnyEventEnvelope[], occurredAt: string): void {
    handleRefreshAccount({
      context: this.createRefreshAccountHandlerContext(),
      events,
      occurredAt
    });
  }

  private buildPositionId(): string {
    return "position_1";
  }

  private shouldLiquidatePosition(): boolean {
    if (this.state.position.side === "flat" || this.state.position.quantity <= 0) {
      return false;
    }

    const markPrice = this.state.latestTick?.last ?? this.state.position.markPrice;
    const liquidationPrice = this.state.position.liquidationPrice;

    if (!Number.isFinite(markPrice) || markPrice <= 0 || liquidationPrice <= 0) {
      return false;
    }

    if (this.state.account.riskRatio >= 1) {
      return true;
    }

    return this.state.position.side === "long"
      ? markPrice <= liquidationPrice
      : markPrice >= liquidationPrice;
  }

  private cancelActiveOrdersForLiquidation(events: AnyEventEnvelope[], occurredAt: string): void {
    for (const order of this.state.orders.filter((entry) =>
      entry.status === "ACCEPTED" || entry.status === "PARTIALLY_FILLED"
    )) {
      this.emitAndApply(events, "OrderCanceled", "system", order.symbol, {
        orderId: order.id,
        canceledAt: occurredAt,
        remainingQuantity: order.remainingQuantity
      }, occurredAt);
    }
  }

  private liquidatePositionIfNeeded(events: AnyEventEnvelope[], occurredAt: string): boolean {
    if (!this.shouldLiquidatePosition() || !this.state.latestTick) {
      return false;
    }

    const orderSide: OrderSide = this.state.position.side === "long" ? "sell" : "buy";
    const executionReferencePrice = orderSide === "sell" ? this.state.latestTick.bid : this.state.latestTick.ask;

    if (!Number.isFinite(executionReferencePrice) || executionReferencePrice <= 0) {
      return false;
    }

    const positionId = this.buildPositionId();
    const symbol = this.state.position.symbol;
    const executionQuantity = this.state.position.quantity;

    this.emitAndApply(events, "LiquidationTriggered", "system", symbol, {
      positionId,
      triggerPrice: this.state.latestTick.last,
      riskRatio: this.state.account.riskRatio,
      triggeredAt: occurredAt
    }, occurredAt);

    const liquidationOrderId = `liq_${this.state.nextSequence}`;
    const executionPrice = applyExecutionPricing(
      orderSide,
      executionReferencePrice,
      "taker",
      this.symbolConfig.baseSlippageBps
    );
    const fee = round(executionQuantity * executionPrice * this.symbolConfig.takerFeeRate);

    this.emitAndApply(events, "LiquidationExecuted", "system", symbol, {
      positionId,
      liquidationOrderId,
      executionPrice,
      executionQuantity,
      executedAt: occurredAt
    }, occurredAt);

    const { result } = this.computePostFillResult(orderSide, executionQuantity, executionPrice, fee);
    this.applyComputedPostFill(result);

    this.emitAndApply(events, "PositionClosed", "system", symbol, this.buildPositionPayload(result), occurredAt);
    this.emitAndApply(events, "FeeCharged", "system", symbol, {
      ledgerEntryId: `ledger_${liquidationOrderId}`,
      orderId: liquidationOrderId,
      fillId: `${liquidationOrderId}_fill`,
      amount: fee,
      asset: "USD",
      chargedAt: occurredAt
    }, occurredAt);

    this.cancelActiveOrdersForLiquidation(events, occurredAt);
    this.refreshAccountSnapshot(events, occurredAt);

    return true;
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
    eventType: DomainEventType,
    source: AnyEventEnvelope["source"],
    symbol: string,
    payload: TPayload,
    occurredAt: string
  ): AnyEventEnvelope;
  private createEvent<TType extends DomainEventType>(
    eventType: TType,
    source: AnyEventEnvelope["source"],
    symbol: string,
    payload: DomainEventPayload<TType>,
    occurredAt: string
  ): DomainEventEnvelope<TType>;
  private createEvent<TPayload>(
    eventType: DomainEventType,
    source: AnyEventEnvelope["source"],
    symbol: string,
    payload: TPayload,
    occurredAt: string
  ): AnyEventEnvelope {
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

    return event as AnyEventEnvelope;
  }

  private emitAndApply<TPayload>(
    events: AnyEventEnvelope[],
    eventType: DomainEventType,
    source: AnyEventEnvelope["source"],
    symbol: string,
    payload: TPayload,
    occurredAt: string
  ): AnyEventEnvelope;
  private emitAndApply<TType extends DomainEventType>(
    events: AnyEventEnvelope[],
    eventType: TType,
    source: AnyEventEnvelope["source"],
    symbol: string,
    payload: DomainEventPayload<TType>,
    occurredAt: string
  ): DomainEventEnvelope<TType>;
  private emitAndApply<TPayload>(
    events: AnyEventEnvelope[],
    eventType: DomainEventType,
    source: AnyEventEnvelope["source"],
    symbol: string,
    payload: TPayload,
    occurredAt: string
  ): AnyEventEnvelope {
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
      positionId: this.buildPositionId(),
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
      emitAndApply: ((events, eventType, source, symbol, payload, occurredAt) =>
        this.emitAndApply(events, eventType, source, symbol, payload, occurredAt)) as MarketTickHandlerContext["emitAndApply"],
      refreshAccountSnapshot: (events, occurredAt) => this.refreshAccountSnapshot(events, occurredAt),
      liquidatePositionIfNeeded: (events, occurredAt) => this.liquidatePositionIfNeeded(events, occurredAt),
      tryFillActiveOrders: (events, occurredAt) => this.tryFillActiveOrders(events, occurredAt)
    };
  }

  private createSubmitOrderHandlerContext(): SubmitOrderHandlerContext {
    return {
      getState: () => this.state,
      setState: (state) => this.setState(state),
      getSymbolConfig: () => this.symbolConfig,
      emitAndApply: ((events, eventType, source, symbol, payload, occurredAt) =>
        this.emitAndApply(events, eventType, source, symbol, payload, occurredAt)) as SubmitOrderHandlerContext["emitAndApply"],
      now: () => this.now(),
      tryFillOrder: (orderId, events, occurredAt) => this.tryFillOrder(orderId, events, occurredAt)
    };
  }

  private createFillOrderHandlerContext(): FillOrderHandlerContext {
    return {
      getState: () => this.state,
      setState: (state) => this.setState(state),
      getSymbolConfig: () => this.symbolConfig,
      emitAndApply: ((events, eventType, source, symbol, payload, occurredAt) =>
        this.emitAndApply(events, eventType, source, symbol, payload, occurredAt)) as FillOrderHandlerContext["emitAndApply"],
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
      emitAndApply: ((events, eventType, source, symbol, payload, occurredAt) =>
        this.emitAndApply(events, eventType, source, symbol, payload, occurredAt)) as PostFillHandlerContext["emitAndApply"],
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
      emitAndApply: ((events, eventType, source, symbol, payload, occurredAt) =>
        this.emitAndApply(events, eventType, source, symbol, payload, occurredAt)) as RefreshAccountHandlerContext["emitAndApply"],
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
      emitAndApply: ((events, eventType, source, symbol, payload, occurredAt) =>
        this.emitAndApply(events, eventType, source, symbol, payload, occurredAt)) as CancelOrderHandlerContext["emitAndApply"],
      createEvent: ((eventType, source, symbol, payload, occurredAt) =>
        this.createEvent(eventType, source, symbol, payload, occurredAt)) as CancelOrderHandlerContext["createEvent"],
      now: () => this.now()
    };
  }
}
