import type {
  AccountBalancePayload,
  CancelOrderInput,
  CreateOrderInput,
  EventEnvelope,
  FillPayload,
  MarginPayload,
  MarketTick,
  OrderAcceptedPayload,
  OrderCanceledPayload,
  OrderCancelRequestedPayload,
  OrderRejectedPayload,
  OrderRequestedPayload,
  OrderSide,
  OrderStatus,
  OrderView,
  PositionPayload,
  TradingSymbolConfig
} from "@stratium/shared";
import type { TradingEngineOptions, TradingEngineState } from "../domain/state";
import { createInitialTradingState, DEFAULT_SYMBOL_CONFIG, round } from "../domain/state";
import { refreshAccountState } from "../rules/account-math";
import { validateOrder } from "../rules/order-validation";
import { applyExecutionPricing, getExecutableReferencePrice, getLiquidityRole } from "../rules/pricing";
import { computeNextPosition } from "../rules/position-math";
import { applyEvent } from "../replay/apply-event";

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
    const events: EventEnvelope<unknown>[] = [];
    const occurredAt = tick.tickTime;

    this.emitAndApply(events, "MarketTickReceived", "market", tick.symbol, {
        bid: tick.bid,
        ask: tick.ask,
        last: tick.last,
        spread: tick.spread,
        tickTime: tick.tickTime,
        volatilityTag: tick.volatilityTag
      }, occurredAt);

    this.recalculateAccountFromPosition(events, occurredAt);
    this.tryFillActiveOrders(events, occurredAt);

    return {
      state: this.state,
      events
    };
  }

  submitOrder(input: CreateOrderInput): TradingEngineResult {
    const events: EventEnvelope<unknown>[] = [];
    const submittedAt = input.submittedAt ?? this.now();
    const orderId = `ord_${this.state.nextOrderId}`;

    this.emitAndApply<OrderRequestedPayload>(events, "OrderRequested", "user", input.symbol, {
        orderId,
        side: input.side,
        orderType: input.orderType,
        quantity: input.quantity,
        limitPrice: input.limitPrice,
        submittedAt
      }, submittedAt);

    const validation = validateOrder(this.state, this.symbolConfig, input);
    this.state = {
      ...this.state,
      nextOrderId: this.state.nextOrderId + 1
    };

    if (validation) {
      this.emitAndApply<OrderRejectedPayload>(events, "OrderRejected", "system", input.symbol, {
          orderId,
          rejectedAt: submittedAt,
          reasonCode: validation.code,
          reasonMessage: validation.message
        }, submittedAt);

      return {
        state: this.state,
        events
      };
    }

    this.emitAndApply<OrderAcceptedPayload>(events, "OrderAccepted", "system", input.symbol, {
        orderId,
        acceptedAt: submittedAt
      }, submittedAt);

    this.tryFillOrder(orderId, events, submittedAt);

    return {
      state: this.state,
      events
    };
  }

  cancelOrder(input: CancelOrderInput): TradingEngineResult {
    const events: EventEnvelope<unknown>[] = [];
    const requestedAt = input.requestedAt ?? this.now();
    const orderIndex = this.state.orders.findIndex((order) => order.id === input.orderId);

    if (orderIndex < 0) {
      events.push(
        this.createEvent<OrderRejectedPayload>("OrderRejected", "system", this.state.position.symbol, {
          orderId: input.orderId,
          rejectedAt: requestedAt,
          reasonCode: "ORDER_NOT_FOUND",
          reasonMessage: "Order does not exist."
        }, requestedAt)
      );

      return {
        state: this.state,
        events
      };
    }

    const order = this.state.orders[orderIndex];

    this.emitAndApply<OrderCancelRequestedPayload>(events, "OrderCancelRequested", "user", order.symbol, {
        orderId: order.id,
        requestedAt
      }, requestedAt);

    if (order.status !== "ACCEPTED" && order.status !== "PARTIALLY_FILLED") {
      this.emitAndApply<OrderRejectedPayload>(events, "OrderRejected", "system", order.symbol, {
          orderId: order.id,
          rejectedAt: requestedAt,
          reasonCode: "INVALID_ORDER_STATE",
          reasonMessage: "Only active orders can be canceled."
        }, requestedAt);

      return {
        state: this.state,
        events
      };
    }

    this.emitAndApply<OrderCanceledPayload>(events, "OrderCanceled", "system", order.symbol, {
        orderId: order.id,
        canceledAt: requestedAt,
        remainingQuantity: order.remainingQuantity
      }, requestedAt);

    return {
      state: this.state,
      events
    };
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
    const order = this.state.orders.find((entry) => entry.id === orderId);

    if (!order || (order.status !== "ACCEPTED" && order.status !== "PARTIALLY_FILLED")) {
      return;
    }

    if (!this.state.latestTick || this.state.latestTick.symbol !== order.symbol) {
      return;
    }

    const executable = getExecutableReferencePrice(this.state.latestTick, order);

    if (executable === null) {
      return;
    }

    const fillQuantity = order.remainingQuantity;
    const liquidityRole = getLiquidityRole(order, occurredAt);
    const fillPrice = applyExecutionPricing(
      order.side,
      executable,
      liquidityRole,
      this.symbolConfig.baseSlippageBps
    );
    const fillNotional = fillQuantity * fillPrice;
    const feeRate = liquidityRole === "maker" ? this.symbolConfig.makerFeeRate : this.symbolConfig.takerFeeRate;
    const fee = round(fillNotional * feeRate);
    const fillId = `fill_${this.state.nextFillId}`;
    const nextFilledQuantity = round(order.filledQuantity + fillQuantity);
    const nextRemainingQuantity = round(order.remainingQuantity - fillQuantity);
    const nextStatus: OrderStatus = nextRemainingQuantity === 0 ? "FILLED" : "PARTIALLY_FILLED";

    const slippage = round(Math.abs(fillPrice - executable));
    const fillPayload: FillPayload = {
      orderId: order.id,
      fillId,
      fillPrice,
      fillQuantity,
      filledQuantityTotal: nextFilledQuantity,
      remainingQuantity: nextRemainingQuantity,
      slippage,
      fee,
      feeRate,
      liquidityRole,
      filledAt: occurredAt
    };

    this.state = {
      ...this.state,
      nextFillId: this.state.nextFillId + 1
    };
    this.emitAndApply(
      events,
      nextStatus === "FILLED" ? "OrderFilled" : "OrderPartiallyFilled",
      "system",
      order.symbol,
      fillPayload,
      occurredAt
    );

    this.applyFillToState(order.id, order.side, fillQuantity, fillPrice, fee, events, occurredAt);
  }

  private applyFillToState(
    orderId: string,
    orderSide: OrderSide,
    fillQuantity: number,
    fillPrice: number,
    fee: number,
    events: EventEnvelope<unknown>[],
    occurredAt: string
  ): void {
    const previousPosition = this.state.position;
    const result = computeNextPosition(
      previousPosition,
      this.state.account.walletBalance,
      this.state.latestTick?.last,
      this.symbolConfig,
      orderSide,
      fillQuantity,
      fillPrice,
      fee
    );

    this.state = {
      ...this.state,
      position: result.position,
      account: {
        ...this.state.account,
        walletBalance: result.walletBalance,
        realizedPnl: result.position.realizedPnl
      }
    };

    if (result.position.side === "flat") {
      this.emitAndApply<PositionPayload>(events, "PositionClosed", "system", result.position.symbol, {
          positionId: "position_1",
          side: result.position.side,
          quantity: result.position.quantity,
          averageEntryPrice: result.position.averageEntryPrice,
          realizedPnl: result.position.realizedPnl,
          unrealizedPnl: result.position.unrealizedPnl,
          markPrice: result.position.markPrice
        }, occurredAt);
    } else if (previousPosition.quantity === 0 && result.realizedPnlDelta === 0) {
      this.emitAndApply<PositionPayload>(events, "PositionOpened", "system", result.position.symbol, {
          positionId: "position_1",
          side: result.position.side,
          quantity: result.position.quantity,
          averageEntryPrice: result.position.averageEntryPrice,
          realizedPnl: result.position.realizedPnl,
          unrealizedPnl: result.position.unrealizedPnl,
          markPrice: result.position.markPrice
        }, occurredAt);
    } else {
      this.emitAndApply<PositionPayload>(events, "PositionUpdated", "system", result.position.symbol, {
          positionId: "position_1",
          side: result.position.side,
          quantity: result.position.quantity,
          averageEntryPrice: result.position.averageEntryPrice,
          realizedPnl: result.position.realizedPnl,
          unrealizedPnl: result.position.unrealizedPnl,
          markPrice: result.position.markPrice
        }, occurredAt);
    }

    this.emitAndApply(events, "FeeCharged", "system", result.position.symbol, {
        ledgerEntryId: `ledger_${this.state.nextFillId - 1}`,
        orderId,
        fillId: `fill_${this.state.nextFillId - 1}`,
        amount: fee,
        asset: "USD",
        chargedAt: occurredAt
      }, occurredAt);

    this.recalculateAccountFromPosition(events, occurredAt);
  }

  private recalculateAccountFromPosition(events: EventEnvelope<unknown>[], occurredAt: string): void {
    this.refreshAccountState();

    const balancePayload: AccountBalancePayload = {
      walletBalance: this.state.account.walletBalance,
      availableBalance: this.state.account.availableBalance,
      positionMargin: this.state.account.positionMargin,
      orderMargin: this.state.account.orderMargin,
      equity: this.state.account.equity
    };

    const marginPayload: MarginPayload = {
      initialMargin: this.state.position.initialMargin,
      maintenanceMargin: this.state.position.maintenanceMargin,
      riskRatio: this.state.account.riskRatio,
      liquidationPrice: this.state.position.liquidationPrice
    };

    this.emitAndApply(events, "AccountBalanceUpdated", "system", this.state.position.symbol, balancePayload, occurredAt);
    this.emitAndApply(events, "MarginUpdated", "system", this.state.position.symbol, marginPayload, occurredAt);
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
}
