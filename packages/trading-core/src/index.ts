import type {
  AccountBalancePayload,
  AccountView,
  CancelOrderInput,
  CreateOrderInput,
  EventEnvelope,
  FillPayload,
  LiquidityRole,
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
  PositionSide,
  PositionView,
  RejectionCode,
  TradingSymbolConfig
} from "@stratium/shared";

export interface TradingEngineState {
  readonly simulationSessionId: string;
  readonly account: AccountView;
  readonly position: PositionView;
  readonly latestTick?: MarketTick;
  readonly orders: OrderView[];
  readonly nextSequence: number;
  readonly nextOrderId: number;
  readonly nextFillId: number;
}

export interface TradingEngineResult {
  readonly state: TradingEngineState;
  readonly events: EventEnvelope<unknown>[];
}

export interface TradingEngineOptions {
  readonly sessionId?: string;
  readonly symbolConfig?: TradingSymbolConfig;
  readonly initialBalance?: number;
}

export interface ReplayResult {
  readonly state: TradingEngineState;
  readonly events: EventEnvelope<unknown>[];
}

const DEFAULT_SYMBOL_CONFIG: TradingSymbolConfig = {
  symbol: "BTC-USD",
  leverage: 10,
  maintenanceMarginRate: 0.05,
  takerFeeRate: 0.0005,
  makerFeeRate: 0.00015,
  baseSlippageBps: 5,
  partialFillEnabled: false
};

const round = (value: number): number => Number(value.toFixed(8));

const createBootstrapAccount = (accountId = "paper-account-1", initialBalance = 10000): AccountView => ({
  accountId,
  walletBalance: initialBalance,
  availableBalance: initialBalance,
  positionMargin: 0,
  orderMargin: 0,
  equity: initialBalance,
  realizedPnl: 0,
  unrealizedPnl: 0,
  riskRatio: 0
});

const createBootstrapPosition = (symbol = DEFAULT_SYMBOL_CONFIG.symbol): PositionView => ({
  symbol,
  side: "flat",
  quantity: 0,
  averageEntryPrice: 0,
  markPrice: 0,
  realizedPnl: 0,
  unrealizedPnl: 0,
  initialMargin: 0,
  maintenanceMargin: 0,
  liquidationPrice: 0
});

export const createInitialTradingState = (
  options: TradingEngineOptions = {}
): TradingEngineState => ({
  simulationSessionId: options.sessionId ?? "session-1",
  account: createBootstrapAccount("paper-account-1", options.initialBalance ?? 10000),
  position: createBootstrapPosition(options.symbolConfig?.symbol ?? DEFAULT_SYMBOL_CONFIG.symbol),
  orders: [],
  nextSequence: 1,
  nextOrderId: 1,
  nextFillId: 1
});

interface PositionComputationResult {
  position: PositionView;
  walletBalance: number;
  realizedPnlDelta: number;
  fee: number;
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

    this.state = {
      ...this.state,
      latestTick: tick,
      position: {
        ...this.state.position,
        symbol: tick.symbol,
        markPrice: tick.last
      }
    };

    events.push(
      this.createEvent("MarketTickReceived", "market", tick.symbol, {
        bid: tick.bid,
        ask: tick.ask,
        last: tick.last,
        spread: tick.spread,
        tickTime: tick.tickTime,
        volatilityTag: tick.volatilityTag
      }, occurredAt)
    );

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

    events.push(
      this.createEvent<OrderRequestedPayload>("OrderRequested", "user", input.symbol, {
        orderId,
        side: input.side,
        orderType: input.orderType,
        quantity: input.quantity,
        limitPrice: input.limitPrice,
        submittedAt
      }, submittedAt)
    );

    const validation = this.validateOrder(input);

    if (validation) {
      const rejectedOrder: OrderView = {
        id: orderId,
        accountId: input.accountId,
        symbol: input.symbol,
        side: input.side,
        orderType: input.orderType,
        status: "REJECTED",
        quantity: input.quantity,
        limitPrice: input.limitPrice,
        filledQuantity: 0,
        remainingQuantity: input.quantity,
        rejectionCode: validation.code,
        rejectionMessage: validation.message,
        createdAt: submittedAt,
        updatedAt: submittedAt
      };

      this.state = {
        ...this.state,
        nextOrderId: this.state.nextOrderId + 1,
        orders: [
          ...this.state.orders,
          rejectedOrder
        ]
      };

      events.push(
        this.createEvent<OrderRejectedPayload>("OrderRejected", "system", input.symbol, {
          orderId,
          rejectedAt: submittedAt,
          reasonCode: validation.code,
          reasonMessage: validation.message
        }, submittedAt)
      );

      return {
        state: this.state,
        events
      };
    }

    const acceptedOrder: OrderView = {
      id: orderId,
      accountId: input.accountId,
      symbol: input.symbol,
      side: input.side,
      orderType: input.orderType,
      status: "ACCEPTED",
      quantity: input.quantity,
      limitPrice: input.limitPrice,
      filledQuantity: 0,
      remainingQuantity: input.quantity,
      createdAt: submittedAt,
      updatedAt: submittedAt
    };

    this.state = {
      ...this.state,
      nextOrderId: this.state.nextOrderId + 1,
      orders: [
        ...this.state.orders,
        acceptedOrder
      ]
    };

    events.push(
      this.createEvent<OrderAcceptedPayload>("OrderAccepted", "system", input.symbol, {
        orderId,
        acceptedAt: submittedAt
      }, submittedAt)
    );

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

    events.push(
      this.createEvent<OrderCancelRequestedPayload>("OrderCancelRequested", "user", order.symbol, {
        orderId: order.id,
        requestedAt
      }, requestedAt)
    );

    if (order.status !== "ACCEPTED" && order.status !== "PARTIALLY_FILLED") {
      events.push(
        this.createEvent<OrderRejectedPayload>("OrderRejected", "system", order.symbol, {
          orderId: order.id,
          rejectedAt: requestedAt,
          reasonCode: "INVALID_ORDER_STATE",
          reasonMessage: "Only active orders can be canceled."
        }, requestedAt)
      );

      return {
        state: this.state,
        events
      };
    }

    const canceledOrder: OrderView = {
      ...order,
      status: "CANCELED",
      updatedAt: requestedAt
    };

    this.state = {
      ...this.state,
      orders: this.state.orders.map((entry, index) => index === orderIndex ? canceledOrder : entry)
    };

    events.push(
      this.createEvent<OrderCanceledPayload>("OrderCanceled", "system", order.symbol, {
        orderId: order.id,
        canceledAt: requestedAt,
        remainingQuantity: canceledOrder.remainingQuantity
      }, requestedAt)
    );

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

    const executable = this.getExecutableReferencePrice(order);

    if (executable === null) {
      return;
    }

    const fillQuantity = order.remainingQuantity;
    const liquidityRole = this.getLiquidityRole(order, occurredAt);
    const fillPrice = this.applyExecutionPricing(order.side, executable, liquidityRole);
    const fillNotional = fillQuantity * fillPrice;
    const feeRate = liquidityRole === "maker" ? this.symbolConfig.makerFeeRate : this.symbolConfig.takerFeeRate;
    const fee = round(fillNotional * feeRate);
    const fillId = `fill_${this.state.nextFillId}`;
    const nextFilledQuantity = round(order.filledQuantity + fillQuantity);
    const nextRemainingQuantity = round(order.remainingQuantity - fillQuantity);
    const nextStatus: OrderStatus = nextRemainingQuantity === 0 ? "FILLED" : "PARTIALLY_FILLED";

    const updatedOrder: OrderView = {
      ...order,
      status: nextStatus,
      averageFillPrice: fillPrice,
      filledQuantity: nextFilledQuantity,
      remainingQuantity: nextRemainingQuantity,
      updatedAt: occurredAt
    };

    this.state = {
      ...this.state,
      nextFillId: this.state.nextFillId + 1,
      orders: this.state.orders.map((entry) => entry.id === order.id ? updatedOrder : entry)
    };

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

    events.push(
      this.createEvent(nextStatus === "FILLED" ? "OrderFilled" : "OrderPartiallyFilled", "system", order.symbol, fillPayload, occurredAt)
    );

    this.applyFillToState(order.side, fillQuantity, fillPrice, fee, events, occurredAt);
  }

  private applyFillToState(
    orderSide: OrderSide,
    fillQuantity: number,
    fillPrice: number,
    fee: number,
    events: EventEnvelope<unknown>[],
    occurredAt: string
  ): void {
    const result = this.computeNextPosition(orderSide, fillQuantity, fillPrice, fee);

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
      events.push(
        this.createEvent<PositionPayload>("PositionClosed", "system", result.position.symbol, {
          positionId: "position_1",
          side: result.position.side,
          quantity: result.position.quantity,
          averageEntryPrice: result.position.averageEntryPrice,
          realizedPnl: result.position.realizedPnl,
          unrealizedPnl: result.position.unrealizedPnl,
          markPrice: result.position.markPrice
        }, occurredAt)
      );
    } else if (this.state.position.quantity === fillQuantity && result.realizedPnlDelta === 0) {
      events.push(
        this.createEvent<PositionPayload>("PositionOpened", "system", result.position.symbol, {
          positionId: "position_1",
          side: result.position.side,
          quantity: result.position.quantity,
          averageEntryPrice: result.position.averageEntryPrice,
          realizedPnl: result.position.realizedPnl,
          unrealizedPnl: result.position.unrealizedPnl,
          markPrice: result.position.markPrice
        }, occurredAt)
      );
    } else {
      events.push(
        this.createEvent<PositionPayload>("PositionUpdated", "system", result.position.symbol, {
          positionId: "position_1",
          side: result.position.side,
          quantity: result.position.quantity,
          averageEntryPrice: result.position.averageEntryPrice,
          realizedPnl: result.position.realizedPnl,
          unrealizedPnl: result.position.unrealizedPnl,
          markPrice: result.position.markPrice
        }, occurredAt)
      );
    }

    events.push(
      this.createEvent("FeeCharged", "system", result.position.symbol, {
        ledgerEntryId: `ledger_${this.state.nextFillId - 1}`,
        orderId: this.state.orders[this.state.orders.length - 1]?.id ?? "",
        fillId: `fill_${this.state.nextFillId - 1}`,
        amount: fee,
        asset: "USD",
        chargedAt: occurredAt
      }, occurredAt)
    );

    this.recalculateAccountFromPosition(events, occurredAt);
  }

  private computeNextPosition(
    orderSide: OrderSide,
    fillQuantity: number,
    fillPrice: number,
    fee: number
  ): PositionComputationResult {
    const previousPosition = this.state.position;
    const previousSignedQuantity = this.toSignedQuantity(previousPosition.side, previousPosition.quantity);
    const fillSignedQuantity = orderSide === "buy" ? fillQuantity : -fillQuantity;
    const nextSignedQuantity = round(previousSignedQuantity + fillSignedQuantity);
    const previousWalletBalance = this.state.account.walletBalance;

    let realizedPnl = previousPosition.realizedPnl;

    if (previousSignedQuantity !== 0 && Math.sign(previousSignedQuantity) !== Math.sign(fillSignedQuantity)) {
      const closingQuantity = Math.min(Math.abs(previousSignedQuantity), Math.abs(fillSignedQuantity));
      realizedPnl = round(realizedPnl + this.computeRealizedPnl(previousPosition, orderSide, closingQuantity, fillPrice));
    }

    let averageEntryPrice = previousPosition.averageEntryPrice;

    if (nextSignedQuantity === 0) {
      averageEntryPrice = 0;
    } else if (previousSignedQuantity === 0 || Math.sign(previousSignedQuantity) === Math.sign(fillSignedQuantity)) {
      averageEntryPrice = round(
        ((Math.abs(previousSignedQuantity) * previousPosition.averageEntryPrice) + (fillQuantity * fillPrice)) /
        Math.abs(nextSignedQuantity)
      );
    } else if (Math.abs(fillSignedQuantity) > Math.abs(previousSignedQuantity)) {
      averageEntryPrice = fillPrice;
    }

    const nextSide = this.toPositionSide(nextSignedQuantity);
    const markPrice = this.state.latestTick?.last ?? previousPosition.markPrice;
    const quantity = Math.abs(nextSignedQuantity);
    const unrealizedPnl = this.computeUnrealizedPnl(nextSide, quantity, averageEntryPrice, markPrice);
    const initialMargin = round(quantity * markPrice / this.symbolConfig.leverage);
    const maintenanceMargin = round(quantity * markPrice * this.symbolConfig.maintenanceMarginRate);
    const liquidationPrice = round(this.computeLiquidationPrice(nextSide, quantity, averageEntryPrice, previousWalletBalance - fee + realizedPnl));
    const walletBalance = round(previousWalletBalance + (realizedPnl - previousPosition.realizedPnl) - fee);

    return {
      position: {
        ...previousPosition,
        side: nextSide,
        quantity,
        averageEntryPrice,
        markPrice,
        realizedPnl,
        unrealizedPnl,
        initialMargin,
        maintenanceMargin,
        liquidationPrice
      },
      walletBalance,
      realizedPnlDelta: round(realizedPnl - previousPosition.realizedPnl),
      fee
    };
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

    events.push(
      this.createEvent("AccountBalanceUpdated", "system", this.state.position.symbol, balancePayload, occurredAt)
    );
    events.push(
      this.createEvent("MarginUpdated", "system", this.state.position.symbol, marginPayload, occurredAt)
    );
  }

  private refreshAccountState(): void {
    const position = {
      ...this.state.position,
      markPrice: this.state.latestTick?.last ?? this.state.position.markPrice
    };
    const unrealizedPnl = this.computeUnrealizedPnl(
      position.side,
      position.quantity,
      position.averageEntryPrice,
      position.markPrice
    );
    const positionMargin = round(position.quantity * position.markPrice / this.symbolConfig.leverage);
    const maintenanceMargin = round(position.quantity * position.markPrice * this.symbolConfig.maintenanceMarginRate);
    const equity = round(this.state.account.walletBalance + unrealizedPnl);
    const availableBalance = round(equity - positionMargin);
    const riskRatio = equity <= 0 ? 1 : round(maintenanceMargin / equity);
    const liquidationPrice = round(this.computeLiquidationPrice(
      position.side,
      position.quantity,
      position.averageEntryPrice,
      this.state.account.walletBalance
    ));

    this.state = {
      ...this.state,
      position: {
        ...position,
        unrealizedPnl,
        initialMargin: positionMargin,
        maintenanceMargin,
        liquidationPrice
      },
      account: {
        ...this.state.account,
        availableBalance,
        positionMargin,
        orderMargin: 0,
        equity,
        unrealizedPnl,
        riskRatio
      }
    };
  }

  private computeRealizedPnl(
    position: PositionView,
    orderSide: OrderSide,
    closedQuantity: number,
    exitPrice: number
  ): number {
    if (position.side === "long" && orderSide === "sell") {
      return round((exitPrice - position.averageEntryPrice) * closedQuantity);
    }

    if (position.side === "short" && orderSide === "buy") {
      return round((position.averageEntryPrice - exitPrice) * closedQuantity);
    }

    return 0;
  }

  private computeUnrealizedPnl(
    side: PositionSide,
    quantity: number,
    averageEntryPrice: number,
    markPrice: number
  ): number {
    if (side === "long") {
      return round((markPrice - averageEntryPrice) * quantity);
    }

    if (side === "short") {
      return round((averageEntryPrice - markPrice) * quantity);
    }

    return 0;
  }

  private computeLiquidationPrice(
    side: PositionSide,
    quantity: number,
    averageEntryPrice: number,
    walletBalance: number
  ): number {
    if (side === "flat" || quantity === 0) {
      return 0;
    }

    const rate = this.symbolConfig.maintenanceMarginRate;

    if (side === "long") {
      const denominator = quantity * (1 - rate);

      return denominator === 0 ? 0 : (quantity * averageEntryPrice - walletBalance) / denominator;
    }

    const denominator = quantity * (1 + rate);

    return denominator === 0 ? 0 : (walletBalance + quantity * averageEntryPrice) / denominator;
  }

  private validateOrder(input: CreateOrderInput): { code: RejectionCode; message: string } | null {
    if (input.accountId !== this.state.account.accountId) {
      return {
        code: "ACCOUNT_NOT_FOUND",
        message: "Account does not exist in the current engine context."
      };
    }

    if (input.symbol !== this.symbolConfig.symbol) {
      return {
        code: "INVALID_SYMBOL",
        message: "Symbol is not configured for PH1."
      };
    }

    if (input.quantity <= 0) {
      return {
        code: "INVALID_QUANTITY",
        message: "Quantity must be greater than zero."
      };
    }

    if (input.orderType === "limit" && (!input.limitPrice || input.limitPrice <= 0)) {
      return {
        code: "INVALID_PRICE",
        message: "Limit orders require a positive limit price."
      };
    }

    if (input.orderType === "market" && !this.state.latestTick) {
      return {
        code: "MISSING_MARKET_TICK",
        message: "Market orders require a current market tick."
      };
    }

    const referencePrice = input.orderType === "market"
      ? this.getMarketReferencePrice(input.side)
      : input.limitPrice ?? 0;
    const estimatedInitialMargin = round(
      (this.getIncrementalExposureQuantity(input.side, input.quantity) * referencePrice) / this.symbolConfig.leverage
    );

    if (estimatedInitialMargin > this.state.account.availableBalance) {
      return {
        code: "INSUFFICIENT_MARGIN",
        message: "Estimated required margin exceeds available balance."
      };
    }

    return null;
  }

  private getExecutableReferencePrice(order: OrderView): number | null {
    if (!this.state.latestTick) {
      return null;
    }

    if (order.orderType === "market") {
      return this.getMarketReferencePrice(order.side);
    }

    if (order.side === "buy") {
      return this.state.latestTick.ask <= (order.limitPrice ?? 0) ? this.state.latestTick.ask : null;
    }

    return this.state.latestTick.bid >= (order.limitPrice ?? 0) ? this.state.latestTick.bid : null;
  }

  private getMarketReferencePrice(side: OrderSide): number {
    if (!this.state.latestTick) {
      return 0;
    }

    return side === "buy" ? this.state.latestTick.ask : this.state.latestTick.bid;
  }

  private getIncrementalExposureQuantity(side: OrderSide, quantity: number): number {
    const currentSignedQuantity = this.toSignedQuantity(this.state.position.side, this.state.position.quantity);
    const incomingSignedQuantity = side === "buy" ? quantity : -quantity;

    if (currentSignedQuantity === 0 || Math.sign(currentSignedQuantity) === Math.sign(incomingSignedQuantity)) {
      return quantity;
    }

    const remainingExposure = Math.abs(incomingSignedQuantity) - Math.abs(currentSignedQuantity);

    return round(Math.max(remainingExposure, 0));
  }

  private getLiquidityRole(order: OrderView, occurredAt: string): LiquidityRole {
    if (order.orderType === "market") {
      return "taker";
    }

    return order.createdAt === occurredAt ? "taker" : "maker";
  }

  private applyExecutionPricing(side: OrderSide, referencePrice: number, liquidityRole: LiquidityRole): number {
    if (liquidityRole === "maker") {
      return round(referencePrice);
    }

    const slippage = round(referencePrice * (this.symbolConfig.baseSlippageBps / 10000));

    return side === "buy"
      ? round(referencePrice + slippage)
      : round(referencePrice - slippage);
  }

  private toSignedQuantity(side: PositionSide, quantity: number): number {
    if (side === "long") {
      return quantity;
    }

    if (side === "short") {
      return -quantity;
    }

    return 0;
  }

  private toPositionSide(quantity: number): PositionSide {
    if (quantity > 0) {
      return "long";
    }

    if (quantity < 0) {
      return "short";
    }

    return "flat";
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

  private now(): string {
    return new Date().toISOString();
  }
}

const derivePositionSide = (quantity: number, side: PositionSide): PositionSide => {
  if (quantity === 0) {
    return "flat";
  }

  return side;
};

const parseNumericSuffix = (value: string, prefix: string): number => {
  if (!value.startsWith(prefix)) {
    return 0;
  }

  const parsed = Number(value.slice(prefix.length));

  return Number.isFinite(parsed) ? parsed : 0;
};

const applyReplayEvent = (
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

    default:
      return {
        ...currentState,
        nextSequence: Math.max(currentState.nextSequence, event.sequence + 1)
      };
  }
};

export const replayEvents = (
  events: EventEnvelope<unknown>[],
  options: TradingEngineOptions = {}
): ReplayResult => {
  const sortedEvents = [...events].sort((left, right) => left.sequence - right.sequence);
  const initialState = createInitialTradingState({
    ...options,
    sessionId: sortedEvents[0]?.simulationSessionId ?? options.sessionId
  });

  const replayedState = sortedEvents.reduce(applyReplayEvent, initialState);
  const nextOrderId = replayedState.orders.reduce((maxValue, order) => Math.max(maxValue, parseNumericSuffix(order.id, "ord_")), 0) + 1;
  const nextFillId = sortedEvents.reduce((maxValue, event) => {
    if (event.eventType !== "OrderFilled" && event.eventType !== "OrderPartiallyFilled") {
      return maxValue;
    }

    const payload = event.payload as FillPayload;

    return Math.max(maxValue, parseNumericSuffix(payload.fillId, "fill_"));
  }, 0) + 1;
  const latestTick = replayedState.latestTick
    ? {
        ...replayedState.latestTick,
        symbol: replayedState.position.symbol
      }
    : undefined;
  const state: TradingEngineState = {
    ...replayedState,
    latestTick,
    nextOrderId,
    nextFillId
  };

  return {
    state,
    events: sortedEvents
  };
};
