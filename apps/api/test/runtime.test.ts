import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnyEventEnvelope, MarketTick } from "@stratium/shared";

const repositoryMocks = vi.hoisted(() => ({
  connect: vi.fn(),
  close: vi.fn(),
  ensureDefaultAccess: vi.fn(),
  getPlatformSettings: vi.fn(),
  listFrontendUsers: vi.fn(),
  createFrontendUser: vi.fn(),
  updateFrontendUser: vi.fn(),
  findUserByUsername: vi.fn(),
  loadSymbolConfig: vi.fn(),
  loadSymbolConfigMeta: vi.fn(),
  loadSimulationSnapshot: vi.fn(),
  loadEvents: vi.fn(),
  loadRecentMarketSnapshot: vi.fn(),
  persistState: vi.fn(),
  updateSymbolLeverage: vi.fn(),
  loadRecentVolumeRecords: vi.fn(),
  persistMarketSnapshot: vi.fn(),
  persistMinuteCandles: vi.fn(),
  persistClosedMinuteCandles: vi.fn()
}));

const hyperliquidClientState = vi.hoisted(() => ({
  instances: [] as Array<{
    connect: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    options: {
      coin: string;
      candleInterval?: string;
      onTick: (tick: MarketTick) => Promise<void> | void;
      onSnapshot: (snapshot: unknown) => void;
    };
  }>
}));

const tradingCoreState = vi.hoisted(() => ({
  replayResult: {
    simulationSessionId: "session-1",
    nextSequence: 2,
    nextOrderId: 1,
    nextFillId: 1,
    latestTick: {
      symbol: "BTC-USD",
      bid: 69999,
      ask: 70001,
      last: 70000,
      spread: 2,
      tickTime: "2026-01-01T00:00:00.000Z",
      volatilityTag: "normal"
    },
    account: {
      accountId: "paper-account-1",
      walletBalance: 10000,
      availableBalance: 10000,
      positionMargin: 0,
      orderMargin: 0,
      equity: 10000,
      realizedPnl: 0,
      unrealizedPnl: 0,
      riskRatio: 0
    },
    position: {
      symbol: "BTC-USD",
      side: "flat",
      quantity: 0,
      averageEntryPrice: 0,
      markPrice: 70000,
      realizedPnl: 0,
      unrealizedPnl: 0,
      initialMargin: 0,
      maintenanceMargin: 0,
      liquidationPrice: 0
    },
    orders: []
  }
}));

vi.mock("../src/persistence/repository", () => ({
  TradingRepository: class {
    connect = repositoryMocks.connect;
    close = repositoryMocks.close;
    ensureDefaultAccess = repositoryMocks.ensureDefaultAccess;
    getPlatformSettings = repositoryMocks.getPlatformSettings;
    listFrontendUsers = repositoryMocks.listFrontendUsers;
    createFrontendUser = repositoryMocks.createFrontendUser;
    updateFrontendUser = repositoryMocks.updateFrontendUser;
    findUserByUsername = repositoryMocks.findUserByUsername;
    loadSymbolConfig = repositoryMocks.loadSymbolConfig;
    loadSymbolConfigMeta = repositoryMocks.loadSymbolConfigMeta;
    loadSimulationSnapshot = repositoryMocks.loadSimulationSnapshot;
    loadEvents = repositoryMocks.loadEvents;
    loadRecentMarketSnapshot = repositoryMocks.loadRecentMarketSnapshot;
    persistState = repositoryMocks.persistState;
    updateSymbolLeverage = repositoryMocks.updateSymbolLeverage;
    loadRecentVolumeRecords = repositoryMocks.loadRecentVolumeRecords;
    persistMarketSnapshot = repositoryMocks.persistMarketSnapshot;
    persistMinuteCandles = repositoryMocks.persistMinuteCandles;
    persistClosedMinuteCandles = repositoryMocks.persistClosedMinuteCandles;
  }
}));

vi.mock("../src/market/hyperliquid-market", () => ({
  HyperliquidMarketClient: class {
    public readonly connect = vi.fn();

    public readonly close = vi.fn();

    constructor(
      public readonly options: {
        coin: string;
        candleInterval?: string;
        onTick: (tick: MarketTick) => Promise<void> | void;
        onSnapshot: (snapshot: unknown) => void;
      }
    ) {
      hyperliquidClientState.instances.push(this);
    }
  }
}));

const batchJobStateMocks = vi.hoisted(() => ({
  connect: vi.fn(),
  refreshState: vi.fn(),
  shutdown: vi.fn(),
  getRunningJobs: vi.fn(() => []),
  getLastExecution: vi.fn(() => null)
}));

const frontendSession = {
  token: "frontend-token",
  user: {
    id: "frontend-user-1",
    username: "demo",
    role: "frontend" as const,
    displayName: "Demo Trader",
    tradingAccountId: "paper-account-1",
    isActive: true
  }
};

vi.mock("@stratium/trading-core", () => {
  class TradingEngine {
    private state: {
      simulationSessionId: string;
      nextSequence: number;
      nextOrderId: number;
      nextFillId: number;
      latestTick: MarketTick | null;
      account: {
        accountId: string;
        walletBalance: number;
        availableBalance: number;
        positionMargin: number;
        orderMargin: number;
        equity: number;
        realizedPnl: number;
        unrealizedPnl: number;
        riskRatio: number;
      };
      position: {
        symbol: string;
        side: string;
        quantity: number;
        averageEntryPrice: number;
        markPrice: number;
        realizedPnl: number;
        unrealizedPnl: number;
        initialMargin: number;
        maintenanceMargin: number;
        liquidationPrice: number;
      };
      orders: Array<Record<string, unknown>>;
    };

    constructor(state?: typeof tradingCoreState.replayResult, options?: { sessionId?: string }) {
      this.state = state ?? {
        simulationSessionId: options?.sessionId ?? "session-1",
        nextSequence: 1,
        nextOrderId: 1,
        nextFillId: 1,
        latestTick: null,
        account: {
          accountId: "paper-account-1",
          walletBalance: 10000,
          availableBalance: 10000,
          positionMargin: 0,
          orderMargin: 0,
          equity: 10000,
          realizedPnl: 0,
          unrealizedPnl: 0,
          riskRatio: 0
        },
        position: {
          symbol: "BTC-USD",
          side: "flat",
          quantity: 0,
          averageEntryPrice: 0,
          markPrice: 0,
          realizedPnl: 0,
          unrealizedPnl: 0,
          initialMargin: 0,
          maintenanceMargin: 0,
          liquidationPrice: 0
        },
        orders: []
      };
    }

    getState() {
      return this.state;
    }

    ingestMarketTick(tick: MarketTick) {
      this.state = {
        ...this.state,
        latestTick: tick,
        position: {
          ...this.state.position,
          markPrice: tick.last
        },
        nextSequence: this.state.nextSequence + 1
      };

      return {
        events: [{
          eventId: `evt-${this.state.nextSequence - 1}`,
          eventType: "MarketTickReceived",
          occurredAt: tick.tickTime,
          sequence: this.state.nextSequence - 1,
          simulationSessionId: this.state.simulationSessionId,
          accountId: this.state.account.accountId,
          symbol: tick.symbol,
          source: "system",
          payload: tick
        }]
      };
    }

    submitOrder(input: {
      accountId: string;
      symbol: string;
      side: string;
      orderType: string;
      quantity: number;
    }) {
      const order = {
        id: `ord-${this.state.orders.length + 1}`,
        accountId: input.accountId,
        symbol: input.symbol,
        side: input.side,
        orderType: input.orderType,
        status: "accepted",
        quantity: input.quantity,
        filledQuantity: 0,
        remainingQuantity: input.quantity,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      };
      this.state = {
        ...this.state,
        orders: [...this.state.orders, order],
        nextSequence: this.state.nextSequence + 1
      };

      return {
        order,
        events: [{
          eventId: `evt-${this.state.nextSequence - 1}`,
          eventType: "OrderAccepted",
          occurredAt: "2026-01-01T00:00:00.000Z",
          sequence: this.state.nextSequence - 1,
          simulationSessionId: this.state.simulationSessionId,
          accountId: input.accountId,
          symbol: input.symbol,
          source: "system",
          payload: { orderId: order.id }
        }]
      };
    }

    cancelOrder(input: { accountId: string; orderId: string }) {
      this.state = {
        ...this.state,
        orders: this.state.orders.map((order) => order.id === input.orderId ? { ...order, status: "canceled" } : order),
        nextSequence: this.state.nextSequence + 1
      };

      return {
        events: [{
          eventId: `evt-${this.state.nextSequence - 1}`,
          eventType: "OrderCanceled",
          occurredAt: "2026-01-01T00:00:00.000Z",
          sequence: this.state.nextSequence - 1,
          simulationSessionId: this.state.simulationSessionId,
          accountId: input.accountId,
          symbol: this.state.position.symbol,
          source: "user",
          payload: { orderId: input.orderId }
        }]
      };
    }

    setLeverage(leverage: number) {
      this.state = {
        ...this.state,
        account: {
          ...this.state.account,
          riskRatio: leverage / 100
        }
      };
    }
  }

  return {
    TradingEngine,
    createInitialTradingState: (options?: { sessionId?: string; symbolConfig?: { symbol?: string } }) => ({
      simulationSessionId: options?.sessionId ?? "session-1",
      nextSequence: 1,
      nextOrderId: 1,
      nextFillId: 1,
      latestTick: null,
      account: {
        accountId: "paper-account-1",
        walletBalance: 10000,
        availableBalance: 10000,
        positionMargin: 0,
        orderMargin: 0,
        equity: 10000,
        realizedPnl: 0,
        unrealizedPnl: 0,
        riskRatio: 0
      },
      position: {
        symbol: options?.symbolConfig?.symbol ?? "BTC-USD",
        side: "flat",
        quantity: 0,
        averageEntryPrice: 0,
        markPrice: 0,
        realizedPnl: 0,
        unrealizedPnl: 0,
        initialMargin: 0,
        maintenanceMargin: 0,
        liquidationPrice: 0
      },
      orders: []
    }),
    replayEvents: vi.fn((_events: AnyEventEnvelope[]) => ({
      state: tradingCoreState.replayResult
    })),
    replayEventsFromState: vi.fn((_state: unknown, _events: AnyEventEnvelope[]) => ({
      state: tradingCoreState.replayResult
    }))
  };
});

vi.mock("../src/batch/batch-job-state", () => ({
  BatchJobStateFeed: class {
    connect = batchJobStateMocks.connect;
    refreshState = batchJobStateMocks.refreshState;
    shutdown = batchJobStateMocks.shutdown;
    getRunningJobs = batchJobStateMocks.getRunningJobs;
    getLastExecution = batchJobStateMocks.getLastExecution;
  }
}));

const { ApiRuntime } = await import("../src/runtime/runtime");
const { TradingRuntime } = await import("../src/runtime/trading-runtime");

describe("ApiRuntime", () => {
  const logger = {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    hyperliquidClientState.instances.length = 0;
    repositoryMocks.loadSymbolConfig.mockResolvedValue(null);
    repositoryMocks.loadSymbolConfigMeta.mockResolvedValue(null);
    repositoryMocks.loadSimulationSnapshot.mockResolvedValue(null);
    repositoryMocks.loadEvents.mockResolvedValue([]);
    repositoryMocks.loadRecentMarketSnapshot.mockResolvedValue(null);
    repositoryMocks.ensureDefaultAccess.mockResolvedValue(undefined);
    repositoryMocks.getPlatformSettings.mockResolvedValue({
      platformName: "Stratium Demo",
      platformAnnouncement: "",
      activeExchange: "hyperliquid",
      activeSymbol: "BTC-USD",
      maintenanceMode: false,
      allowFrontendTrading: true,
      allowManualTicks: true
    });
    repositoryMocks.listFrontendUsers.mockResolvedValue([{
      id: "frontend-user-1",
      username: "demo",
      passwordHash: "hash",
      role: "frontend",
      displayName: "Demo Trader",
      tradingAccountId: "paper-account-1",
      isActive: true
    }]);
    repositoryMocks.createFrontendUser.mockResolvedValue({
      id: "frontend-user-2",
      username: "demo-2",
      passwordHash: "hash",
      role: "frontend",
      displayName: "Demo 2",
      tradingAccountId: "paper-account-2",
      isActive: true
    });
    repositoryMocks.updateFrontendUser.mockResolvedValue({
      id: "frontend-user-1",
      username: "demo",
      passwordHash: "hash",
      role: "frontend",
      displayName: "Demo Trader",
      tradingAccountId: "paper-account-1",
      isActive: true
    });
    repositoryMocks.persistState.mockResolvedValue(undefined);
    repositoryMocks.updateSymbolLeverage.mockResolvedValue(undefined);
    repositoryMocks.loadRecentVolumeRecords.mockResolvedValue([{ id: "vol-1" }]);
    repositoryMocks.persistMarketSnapshot.mockResolvedValue(undefined);
    repositoryMocks.persistClosedMinuteCandles.mockResolvedValue(undefined);
    batchJobStateMocks.connect.mockResolvedValue(undefined);
    batchJobStateMocks.refreshState.mockResolvedValue(undefined);
    batchJobStateMocks.shutdown.mockResolvedValue(undefined);
    batchJobStateMocks.getRunningJobs.mockReturnValue([]);
    batchJobStateMocks.getLastExecution.mockReturnValue(null);
    process.env.MARKET_SOURCE = "hyperliquid";
    process.env.HYPERLIQUID_COIN = "BTC";
    process.env.HYPERLIQUID_CANDLE_INTERVAL = "1m";
    process.env.TRADING_SYMBOL = "BTC-USD";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("bootstraps from persisted events and market snapshot", async () => {
    const persistedEvents = [{
      eventId: "evt-1",
      eventType: "MarketTickReceived",
      occurredAt: "2026-01-01T00:00:00.000Z",
      sequence: 1,
      simulationSessionId: "session-1",
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      source: "system",
      payload: {
        symbol: "BTC-USD",
        bid: 69999,
        ask: 70001,
        last: 70000,
        spread: 2,
        tickTime: "2026-01-01T00:00:00.000Z",
        volatilityTag: "normal"
      }
    }] satisfies AnyEventEnvelope[];
    const marketSnapshot = {
      source: "hyperliquid" as const,
      coin: "BTC",
      connected: false,
      bestBid: 70100,
      bestAsk: 70102,
      markPrice: 70101,
      book: { bids: [], asks: [] },
      trades: [],
      candles: []
    };

    repositoryMocks.loadSymbolConfig.mockResolvedValue({
      symbol: "BTC-USD",
      leverage: 7,
      maintenanceMarginRate: 0.005,
      takerFeeRate: 0.0005,
      makerFeeRate: 0.0002,
      baseSlippageBps: 5,
      partialFillEnabled: false
    });
    repositoryMocks.loadSymbolConfigMeta.mockResolvedValue({
      source: "hyperliquid",
      symbol: "BTC-USD",
      coin: "BTC",
      marketSymbol: "BTC",
      leverage: 7,
      maxLeverage: 25,
      szDecimals: 5,
      quoteAsset: "USDC"
    });
    repositoryMocks.loadEvents.mockResolvedValue(persistedEvents);
    repositoryMocks.loadRecentMarketSnapshot.mockResolvedValue(marketSnapshot);

    const runtime = new ApiRuntime(logger as never);
    await runtime.bootstrap();

    expect(repositoryMocks.connect).toHaveBeenCalled();
    expect(runtime.getEventStore()).toEqual(persistedEvents);
    expect(runtime.getMarketData()).toEqual(marketSnapshot);
    expect(runtime.getSymbolConfigState()).toEqual({
      source: "hyperliquid",
      marketSymbol: "BTC",
      symbol: "BTC-USD",
      coin: "BTC",
      leverage: 7,
      maxLeverage: 25,
      szDecimals: 5,
      quoteAsset: "USDC"
    });
    expect(hyperliquidClientState.instances.at(-1)?.connect).toHaveBeenCalled();
    expect(repositoryMocks.persistState).not.toHaveBeenCalled();
  });

  it("bootstraps an empty session and persists the initial state", async () => {
    const runtime = new ApiRuntime(logger as never);

    await runtime.bootstrap();

    expect(repositoryMocks.persistState).toHaveBeenCalled();
    expect(hyperliquidClientState.instances.at(-1)?.connect).toHaveBeenCalled();
  });

  it("submits orders, cancels orders, updates leverage, and broadcasts socket payloads", async () => {
    const runtime = new ApiRuntime(logger as never);
    const socket = {
      send: vi.fn(),
      on: vi.fn()
    };

    await runtime.bootstrap();
    runtime.addSocket(socket, frontendSession);

    const submitResult = await runtime.submitOrder({
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      side: "buy",
      orderType: "market",
      quantity: 1
    });
    expect(submitResult.events.length).toBeGreaterThan(0);

    const cancelResult = await runtime.cancelOrder({
      accountId: "paper-account-1",
      orderId: submitResult.order.id
    });
    expect(cancelResult.events.length).toBeGreaterThan(0);

    await runtime.updateLeverage("BTC-USD", 4);

    expect(repositoryMocks.updateSymbolLeverage).toHaveBeenCalledWith("BTC-USD", 4, "hyperliquid");
    expect(repositoryMocks.persistState).toHaveBeenCalled();
    expect(socket.send).toHaveBeenCalled();
    expect(runtime.getSymbolConfigState().leverage).toBe(4);
  });

  it("validates manual ticks and accepts valid ticks", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:30.000Z"));
    const runtime = new ApiRuntime(logger as never);
    await runtime.bootstrap();

    const wrongSymbol = await runtime.ingestManualTick({
      symbol: "ETH-USD",
      bid: 100,
      ask: 101,
      last: 100.5,
      spread: 1,
      tickTime: "2026-01-01T00:00:00.000Z",
      volatilityTag: "normal"
    });
    expect(wrongSymbol).toEqual({
      ok: false,
      message: "Manual tick symbol does not match the active market symbol."
    });

    const badSpread = await runtime.ingestManualTick({
      symbol: "BTC-USD",
      bid: 100,
      ask: 101,
      last: 100.5,
      spread: 5,
      tickTime: "2026-01-01T00:00:00.000Z",
      volatilityTag: "normal"
    });
    expect(badSpread.ok).toBe(false);

    const nonPositive = await runtime.ingestManualTick({
      symbol: "BTC-USD",
      bid: 0,
      ask: 101,
      last: 100.5,
      spread: 1,
      tickTime: "2026-01-01T00:00:00.000Z",
      volatilityTag: "normal"
    });
    expect(nonPositive).toEqual({
      ok: false,
      message: "Manual tick requires positive bid, ask, last, and spread values."
    });

    const invertedBook = await runtime.ingestManualTick({
      symbol: "BTC-USD",
      bid: 101,
      ask: 101,
      last: 101,
      spread: 1,
      tickTime: "2026-01-01T00:00:00.000Z",
      volatilityTag: "normal"
    });
    expect(invertedBook).toEqual({
      ok: false,
      message: "Manual tick requires bid lower than ask."
    });

    const outOfRangeLast = await runtime.ingestManualTick({
      symbol: "BTC-USD",
      bid: 100,
      ask: 101,
      last: 102,
      spread: 1,
      tickTime: "2026-01-01T00:00:00.000Z",
      volatilityTag: "normal"
    });
    expect(outOfRangeLast).toEqual({
      ok: false,
      message: "Manual tick last price must stay between bid and ask."
    });

    const accepted = await runtime.ingestManualTick({
      symbol: "BTC-USD",
      bid: 70000,
      ask: 70002,
      last: 70001,
      spread: 2,
      tickTime: "2026-01-01T00:00:30.000Z",
      volatilityTag: "high"
    });
    expect(accepted.ok).toBe(true);
    expect(repositoryMocks.persistMinuteCandles).toHaveBeenCalledWith([
      expect.objectContaining({
        openTime: Date.parse("2026-01-01T00:00:00.000Z"),
        closeTime: Date.parse("2026-01-01T00:01:00.000Z"),
        open: 70001,
        high: 70001,
        low: 70001,
        close: 70001
      })
    ], "hyperliquid");
    const manualTickHistory = await runtime.getMarketHistory(20);
    expect(manualTickHistory.candles).toEqual([
      expect.objectContaining({
        openTime: Date.parse("2026-01-01T00:00:00.000Z"),
        closeTime: Date.parse("2026-01-01T00:01:00.000Z"),
        open: 70001,
        high: 70001,
        low: 70001,
        close: 70001
      })
    ]);

    const divergent = await runtime.ingestManualTick({
      symbol: "BTC-USD",
      bid: 80000,
      ask: 80002,
      last: 80001,
      spread: 2,
      tickTime: "2026-01-01T00:01:00.000Z",
      volatilityTag: "spike"
    });
    expect(divergent.ok).toBe(true);
  });

  it("merges live market data with persisted history and delegates volume queries", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-09T12:00:00.000Z"));
    const runtime = new ApiRuntime(logger as never);
    await runtime.bootstrap();

    repositoryMocks.loadRecentMarketSnapshot.mockResolvedValue({
      source: "hyperliquid",
      coin: "BTC",
      connected: false,
      bestBid: 70000,
      bestAsk: 70002,
      markPrice: 70001,
      book: {
        bids: [{ price: 70000, size: 1, orders: 2 }],
        asks: [{ price: 70002, size: 1.2, orders: 1 }]
      },
      trades: [
        { id: "trade-1", coin: "BTC", side: "buy", price: 70001, size: 0.1, time: 10 }
      ],
      candles: [
        {
          id: "candle-1",
          coin: "BTC",
          interval: "1m",
          openTime: Date.parse("2026-04-09T11:58:00.000Z"),
          closeTime: Date.parse("2026-04-09T11:59:00.000Z"),
          open: 10,
          high: 11,
          low: 9,
          close: 10.5,
          volume: 100,
          tradeCount: 5
        }
      ]
    });

    hyperliquidClientState.instances[0]?.options.onSnapshot({
      source: "hyperliquid",
      coin: "BTC",
      connected: true,
      bestBid: 70010,
      bestAsk: 70012,
      markPrice: 70011,
      book: {
        bids: [{ price: 70010, size: 2, orders: 3 }],
        asks: [{ price: 70012, size: 2.1, orders: 4 }],
        updatedAt: 100
      },
      trades: [
        { id: "trade-2", coin: "BTC", side: "sell", price: 70011, size: 0.2, time: 20 }
      ],
      candles: [
        {
          id: "candle-2",
          coin: "BTC",
          interval: "1m",
          openTime: Date.parse("2026-04-09T11:59:00.000Z"),
          closeTime: Date.parse("2026-04-09T12:00:00.000Z"),
          open: 11,
          high: 12,
          low: 10,
          close: 11.5,
          volume: 120,
          tradeCount: 6
        }
      ]
    });

    const history = await runtime.getMarketHistory(1);
    expect(history.trades).toHaveLength(2);
    expect(history.candles).toHaveLength(2);
    expect(history.book.bids[0]?.price).toBe(70010);

    const volume = await runtime.getMarketVolume(99, "5m", "ETH");
    expect(volume).toEqual({
      coin: "ETH",
      interval: "5m",
      records: [{ id: "vol-1" }]
    });
    expect(repositoryMocks.loadRecentVolumeRecords).toHaveBeenCalledWith("ETH", "5m", 99, "hyperliquid");
  });

  it("returns live market history when no persisted snapshot is available", async () => {
    const runtime = new ApiRuntime(logger as never);
    await runtime.bootstrap();
    const now = Date.now();

    hyperliquidClientState.instances[0]?.options.onSnapshot({
      source: "hyperliquid",
      coin: "BTC",
      connected: false,
      bestBid: 10,
      bestAsk: 12,
      markPrice: 11,
      book: { bids: [], asks: [], updatedAt: 1 },
      trades: [{ id: "trade-live", coin: "BTC", side: "buy", price: 11, size: 1, time: now }],
      candles: [{
        id: "candle-live",
        coin: "BTC",
        interval: "1m",
        openTime: now - 60_000,
        closeTime: now,
        open: 10,
        high: 12,
        low: 9,
        close: 11,
        volume: 5,
        tradeCount: 1
      }]
    });

    repositoryMocks.loadRecentMarketSnapshot.mockResolvedValueOnce(null);
    const history = await runtime.getMarketHistory(999);

    expect(history).toEqual({
      coin: "BTC",
      interval: "1m",
      candles: expect.any(Array),
      trades: expect.any(Array),
      book: { bids: [], asks: [] },
      assetCtx: undefined
    });
    expect(history.candles).toHaveLength(1);
    expect(history.trades).toHaveLength(1);
  });

  it("handles hyperliquid tick ingestion locks and shutdown", async () => {
    const runtime = new ApiRuntime(logger as never);
    await runtime.bootstrap();

    const ingestSpy = vi.spyOn((runtime as never).engine, "ingestMarketTick");
    const clientOptions = hyperliquidClientState.instances[0]?.options;
    expect(clientOptions).toBeDefined();

    runtime.setMarketTickInFlight(true);
    await clientOptions?.onTick({
      symbol: "BTC-USD",
      bid: 1,
      ask: 2,
      last: 1.5,
      spread: 1,
      tickTime: "2026-01-01T00:00:00.000Z",
      volatilityTag: "normal"
    });
    expect(ingestSpy).not.toHaveBeenCalled();

    runtime.setMarketTickInFlight(false);
    await clientOptions?.onTick({
      symbol: "BTC-USD",
      bid: 70000,
      ask: 70002,
      last: 70001,
      spread: 2,
      tickTime: "2026-01-01T00:00:00.000Z",
      volatilityTag: "normal"
    });
    expect(ingestSpy).toHaveBeenCalledTimes(1);

    await runtime.shutdown();
    expect(hyperliquidClientState.instances[0]?.close).toHaveBeenCalled();
    expect(repositoryMocks.close).toHaveBeenCalled();
  });

  it("sorts fill history by sequence when timestamps match and preserves non-fill merge keys", async () => {
    const runtime = new ApiRuntime(logger as never);
    await runtime.bootstrap();
    const privateRuntime = runtime as never;

    repositoryMocks.loadEvents.mockResolvedValueOnce([{
      eventId: "persisted-no-fill",
      eventType: "OrderFilled",
      occurredAt: "2026-01-01T00:00:00.000Z",
      sequence: 3,
      simulationSessionId: "session-paper-account-1-btc-usd",
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      source: "system",
      payload: { orderId: "ord-1" }
    }]);
    privateRuntime.tradingRuntime.getFillHistoryEvents = vi.fn(() => [{
      eventId: "live-no-fill",
      eventType: "OrderPartiallyFilled",
      occurredAt: "2026-01-01T00:00:00.000Z",
      sequence: 2,
      simulationSessionId: "session-paper-account-1-btc-usd",
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      source: "system",
      payload: { orderId: "ord-2" }
    }, {
      eventId: "live-fill",
      eventType: "OrderFilled",
      occurredAt: "2026-01-01T00:00:00.000Z",
      sequence: 1,
      simulationSessionId: "session-paper-account-1-btc-usd",
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      source: "system",
      payload: { orderId: "ord-3", fillId: "fill-3" }
    }]);

    const payload = await runtime.getFillHistoryPayload("paper-account-1");

    expect(payload.events.map((event) => event.eventId)).toEqual([
      "live-fill",
      "live-no-fill",
      "persisted-no-fill"
    ]);
  });

  it("logs persistence failures and skips writes before bootstrap is ready", async () => {
    const runtime = new ApiRuntime(logger as never);
    const events = [{
      eventId: "evt-1",
      eventType: "OrderRequested",
      occurredAt: "2026-01-01T00:00:00.000Z",
      sequence: 1,
      simulationSessionId: "session-1",
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      source: "user",
      payload: {
        accountId: "paper-account-1",
        symbol: "BTC-USD",
        side: "buy",
        orderType: "market",
        quantity: 1
      }
    }] satisfies AnyEventEnvelope[];

    await (runtime as never).persistEvents(events);
    expect(repositoryMocks.persistState).not.toHaveBeenCalled();

    await runtime.bootstrap();
    repositoryMocks.persistState.mockRejectedValueOnce(new Error("persist failed"));
    await (runtime as never).persistEvents(events);
    expect(logger.error).toHaveBeenCalled();
  });

  it("persists closed hyperliquid minute candles on a timer and logs persistence failures", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-09T12:01:05.000Z"));
    const runtime = new ApiRuntime(logger as never);
    await runtime.bootstrap();

    repositoryMocks.persistClosedMinuteCandles.mockRejectedValueOnce(new Error("market snapshot failed"));
    hyperliquidClientState.instances[0]?.options.onSnapshot({
      source: "hyperliquid",
      coin: "BTC",
      connected: true,
      bestBid: 101,
      bestAsk: 102,
      markPrice: 101.5,
      book: { bids: [{ price: 101, size: 1, orders: 1 }], asks: [{ price: 102, size: 1, orders: 1 }], updatedAt: 1 },
      trades: [{ id: "trade-1", coin: "BTC", side: "buy", price: 101.5, size: 1, time: 1 }],
      candles: [{
        id: "candle-1",
        coin: "BTC",
        interval: "1m",
        openTime: Date.parse("2026-04-09T12:00:00.000Z"),
        closeTime: Date.parse("2026-04-09T12:01:00.000Z"),
        open: 100,
        high: 102,
        low: 99,
        close: 101.5,
        volume: 12,
        tradeCount: 3
      }],
      assetCtx: { coin: "BTC", capturedAt: 1, markPrice: 101.5 }
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(logger.error).toHaveBeenCalled();

    repositoryMocks.persistClosedMinuteCandles.mockResolvedValue(undefined);
    hyperliquidClientState.instances[0]?.options.onSnapshot({
      source: "hyperliquid",
      coin: "BTC",
      connected: true,
      bestBid: 101,
      bestAsk: 102,
      markPrice: 101.5,
      book: { bids: [], asks: [], updatedAt: 1 },
      trades: [{ id: "trade-2", coin: "BTC", side: "buy", price: 101.5, size: 1, time: 2 }],
      candles: [{
        id: "candle-2",
        coin: "BTC",
        interval: "1m",
        openTime: Date.parse("2026-04-09T12:01:00.000Z"),
        closeTime: Date.parse("2026-04-09T12:02:00.000Z"),
        open: 101.5,
        high: 103,
        low: 101,
        close: 102.5,
        volume: 8,
        tradeCount: 2
      }],
      assetCtx: { coin: "BTC", capturedAt: 1, markPrice: 101.5 }
    });
    vi.setSystemTime(new Date("2026-04-09T12:02:05.000Z"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(repositoryMocks.persistClosedMinuteCandles).toHaveBeenCalledTimes(2);
  });

  it("forwards explicit socket helpers", async () => {
    const runtime = new ApiRuntime(logger as never);
    const socket = {
      send: vi.fn(),
      on: vi.fn()
    };

    await runtime.bootstrap();
    runtime.addSocket(socket, frontendSession);
    runtime.removeSocket(socket);
    runtime.setMarketTickInFlight(true);

    expect(socket.send).toHaveBeenCalledTimes(1);
  });

  it("supports admin bootstrap sockets and guards frontend sockets without trading accounts", async () => {
    const runtime = new ApiRuntime(logger as never);
    await runtime.bootstrap();

    const adminSocket = {
      send: vi.fn(),
      on: vi.fn()
    };
    runtime.addSocket(adminSocket, {
      token: "admin-token",
      user: {
        id: "admin-user-1",
        username: "admin",
        role: "admin",
        displayName: "Admin",
        tradingAccountId: null,
        isActive: true
      }
    });
    expect(adminSocket.send).toHaveBeenCalledOnce();

    const frontendSocket = {
      send: vi.fn(),
      on: vi.fn()
    };
    runtime.addSocket(frontendSocket, {
      token: "frontend-token",
      user: {
        id: "frontend-user-2",
        username: "broken",
        role: "frontend",
        displayName: "Broken",
        tradingAccountId: null,
        isActive: true
      }
    });
    expect(frontendSocket.send).not.toHaveBeenCalled();
    expect(frontendSocket.on).not.toHaveBeenCalled();
  });

  it("keeps trading events in recent event payloads even when market ticks exceed the window", async () => {
    const runtime = new ApiRuntime(logger as never);
    await runtime.bootstrap();

    for (let index = 0; index < 600; index += 1) {
      await runtime.ingestManualTick({
        symbol: "BTC-USD",
        bid: 70000 + index,
        ask: 70002 + index,
        last: 70001 + index,
        spread: 2,
        tickTime: new Date(Date.parse("2026-04-09T00:00:00.000Z") + (index * 1_000)).toISOString(),
        volatilityTag: "normal"
      });
    }

    const orderResult = await runtime.submitOrder({
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      side: "buy",
      orderType: "market",
      quantity: 1
    });

    const recentEvents = runtime.getStatePayload("paper-account-1").events;

    expect(recentEvents.some((event) => event.eventType === "OrderAccepted")).toBe(true);
    expect(orderResult.events.some((event) => event.eventType === "OrderAccepted")).toBe(true);
    expect(recentEvents.filter((event) => event.eventType === "MarketTickReceived").length).toBeLessThanOrEqual(240);
  });

  it("prunes in-memory market tick events to the recent window", async () => {
    const runtime = new ApiRuntime(logger as never);
    await runtime.bootstrap();

    for (let index = 0; index < 400; index += 1) {
      await runtime.ingestManualTick({
        symbol: "BTC-USD",
        bid: 70000 + index,
        ask: 70002 + index,
        last: 70001 + index,
        spread: 2,
        tickTime: new Date(Date.parse("2026-04-09T00:00:00.000Z") + (index * 1_000)).toISOString(),
        volatilityTag: "normal"
      });
    }

    const storedEvents = runtime.getEventStore("paper-account-1");
    const storedTickEvents = storedEvents.filter((event) => event.eventType === "MarketTickReceived");

    expect(storedTickEvents).toHaveLength(240);
    expect(storedTickEvents[0]?.sequence).toBe(161);
    expect(storedTickEvents[239]?.sequence).toBe(400);
  });

  it("covers wrapper methods and broadcast listeners", async () => {
    const runtime = new ApiRuntime(logger as never);
    await runtime.bootstrap();

    const privateRuntime = runtime as never;
    privateRuntime.repository = {
      getNextTriggerOrderOid: vi.fn(async () => 1000000001),
      upsertTriggerOrderHistory: vi.fn(async () => undefined),
      listTriggerOrderHistory: vi.fn(async () => [{ oid: 1000000001 }]),
      listPendingTriggerOrders: vi.fn(async () => [{ oid: 1000000002 }]),
      findTriggerOrder: vi.fn(async () => ({ oid: 1000000001 })),
      listFillHistoryEvents: vi.fn(async () => [{
        eventId: "persisted-fill-1",
        eventType: "OrderFilled",
        occurredAt: "2026-01-01T00:00:00.000Z",
        sequence: 1,
        simulationSessionId: "persisted-paper-account-1",
        accountId: "paper-account-1",
        symbol: "BTC-USD",
        source: "system",
        payload: { fillId: "fill_1", orderId: "ord_1" }
      }])
    };
    privateRuntime.tradingRuntime = {
      getEngineState: vi.fn(() => ({ simulationSessionId: "session-paper-a-btc-usdccount-1-btc-usd", account: { accountId: "paper-account-1" } })),
      getEventStore: vi.fn(() => [{ eventType: "OrderAccepted" }]),
      getFillHistoryEvents: vi.fn(() => [{
        eventId: "evt-fill-1",
        eventType: "OrderFilled",
        occurredAt: "2026-01-01T00:00:01.000Z",
        sequence: 2,
        simulationSessionId: "session-paper-a-btc-usdccount-1-btc-usd",
        accountId: "paper-account-1",
        symbol: "BTC-USD",
        source: "system",
        payload: { fillId: "fill_1", orderId: "ord_1" }
      }]),
      getAccountIds: vi.fn(() => ["paper-account-1"]),
      getOrders: vi.fn(() => [{ id: "ord_1" }]),
      getOrderByClientOrderId: vi.fn(() => ({ id: "ord_1", clientOrderId: "0xabc" })),
      cancelAllOpenOrders: vi.fn(async () => [{ orderId: "ord_1" }]),
      getSessionStartedAt: vi.fn(() => "2026-04-09T00:00:00.000Z"),
      getPrimaryAccountId: vi.fn(() => "paper-account-1"),
      getReplayState: vi.fn(() => ({ nextSequence: 2 })),
      getReplayData: vi.fn(async () => ({
        state: { simulationSessionId: "session-paper-a-btc-usdccount-1-btc-usd", nextSequence: 2 },
        events: [{ eventType: "OrderAccepted" }]
      })),
      getPositionReplayData: vi.fn(async () => ({
        sessionId: "session-paper-a-btc-usdccount-1-btc-usd",
        fills: [{ eventType: "OrderFilled" }],
        events: [{ eventType: "OrderFilled" }],
        marketEvents: [],
        state: { simulationSessionId: "session-paper-a-btc-usdccount-1-btc-usd", nextSequence: 2 }
      })),
      submitOrder: vi.fn(async () => ({ order: { id: "ord_1" }, events: [] })),
      cancelOrder: vi.fn(async () => ({ events: [] })),
      ensureFrontendAccount: vi.fn(async () => undefined),
      updateLeverage: vi.fn(async (state: unknown, leverage: number) => ({ ...(state as object), leverage })),
      setBootstrapReady: vi.fn(async () => undefined),
      flushPersistence: vi.fn(async () => undefined),
      persistExternalEvents: vi.fn(async () => undefined),
      getEngine: vi.fn(() => ({ ingestMarketTick: vi.fn() })),
      ingestManualTick: vi.fn(async () => ({ ok: true })),
      bootstrap: vi.fn(async () => undefined),
      getRecentEventStore: vi.fn(() => [{ eventType: "OrderAccepted" }])
    };
    privateRuntime.marketRuntime = {
      getMarketData: vi.fn(() => ({ markPrice: 70000 })),
      getHyperliquidCoin: vi.fn(() => "BTC"),
      getHyperliquidCandleInterval: vi.fn(() => "1m"),
      getMarketHistory: vi.fn(async () => ({ candles: [], trades: [], book: { bids: [], asks: [] } })),
      getMarketVolume: vi.fn(async () => ({ records: [] })),
      setMarketTickInFlight: vi.fn(),
      shutdown: vi.fn(async () => undefined)
    };
    privateRuntime.authRuntime = {
      login: vi.fn(async () => frontendSession),
      logout: vi.fn(),
      getSession: vi.fn(() => frontendSession),
      listFrontendUsers: vi.fn(async () => [frontendSession.user]),
      createFrontendUser: vi.fn(async () => frontendSession.user),
      updateFrontendUser: vi.fn(async () => frontendSession.user),
      updatePlatformSettings: vi.fn(async (input: unknown) => input),
      bootstrap: vi.fn(async () => runtime.getPlatformSettings())
    };
    privateRuntime.batchJobRunner = {
      listJobs: vi.fn(() => [{ id: "db-bootstrap" }]),
      run: vi.fn(async () => ({ executionId: "exec-1" })),
      listRunningJobs: vi.fn(async () => [{ executionId: "exec-1" }]),
      getExecution: vi.fn(async () => ({ executionId: "exec-1" }))
    };
    privateRuntime.webSocketHub = {
      addSocket: vi.fn(),
      removeSocket: vi.fn(),
      broadcast: vi.fn()
    };
    privateRuntime.repository = {
      loadEvents: vi.fn(async () => []),
      getNextTriggerOrderOid: vi.fn(async (base?: number) => (base ?? 1000000000) + 1),
      listAvailableSymbolConfigMeta: vi.fn(async () => []),
      upsertTriggerOrderHistory: vi.fn(async (input: unknown) => input),
      listTriggerOrderHistory: vi.fn(async () => [{ oid: 1000000001 }]),
      listPendingTriggerOrders: vi.fn(async () => [{ oid: 1000000002 }]),
      findTriggerOrder: vi.fn(async () => ({ oid: 1000000001 }))
    };

    expect(runtime.getEngineState("paper-account-1")).toEqual({
      simulationSessionId: "session-paper-a-btc-usdccount-1-btc-usd",
      account: { accountId: "paper-account-1" }
    });
    expect(runtime.getEventStore("paper-account-1")).toEqual([{ eventType: "OrderAccepted" }]);
    expect(runtime.getFillHistoryEvents("paper-account-1")).toMatchObject([{ eventType: "OrderFilled" }]);
    expect(await runtime.getFillHistoryPayload("paper-account-1")).toMatchObject({
      sessionId: "session-paper-a-btc-usdccount-1-btc-usd",
      events: [{ eventType: "OrderFilled" }]
    });
    expect(runtime.getMarketData()).toEqual({ markPrice: 70000 });
    expect(runtime.getActiveExchange()).toBe("hyperliquid");
    expect(runtime.getHyperliquidCoin()).toBe("BTC");
    expect(runtime.getHyperliquidCandleInterval()).toBe("1m");
    expect(runtime.getPlatformSettings()).toMatchObject({
      activeExchange: "hyperliquid",
      activeSymbol: "BTC-USD"
    });
    expect(runtime.getAdminStatePayload()).toMatchObject({
      latestTick: undefined,
      platform: expect.objectContaining({
        activeExchange: "hyperliquid"
      }),
      accountIds: ["paper-account-1"]
    });
    expect(runtime.getSessionStartedAt("paper-account-1")).toBe("2026-04-09T00:00:00.000Z");
    expect(runtime.getAccountIds()).toEqual(["paper-account-1"]);
    privateRuntime.marketRuntime.getActiveExchange = vi.fn(() => "okx");
    privateRuntime.marketRuntime.getActiveCoin = vi.fn(() => "SOL");
    privateRuntime.marketRuntime.getActiveCandleInterval = vi.fn(() => "5m");
    expect(runtime.getActiveExchange()).toBe("okx");
    expect(runtime.getActiveCoin()).toBe("SOL");
    expect(runtime.getHyperliquidCandleInterval()).toBe("5m");
    privateRuntime.marketRuntime.getActiveCoin = undefined;
    privateRuntime.marketRuntime.getHyperliquidCoin = undefined;
    privateRuntime.marketRuntime.getActiveCandleInterval = undefined;
    privateRuntime.marketRuntime.getHyperliquidCandleInterval = undefined;
    expect(runtime.getActiveCoin()).toBe("BTC");
    expect(runtime.getHyperliquidCandleInterval()).toBe("1m");
    expect(runtime.getOrders("paper-account-1")).toEqual([{ id: "ord_1" }]);
    expect(runtime.getOrderByClientOrderId("paper-account-1", "0xabc")).toEqual({ id: "ord_1", clientOrderId: "0xabc" });
    expect(await runtime.cancelAllOpenOrders("paper-account-1")).toEqual([{ orderId: "ord_1" }]);
    expect(await runtime.getNextTriggerOrderOid(1000000000)).toBe(1000000001);
    await runtime.upsertTriggerOrderHistory({
      oid: 1000000001,
      accountId: "paper-account-1",
      asset: 0,
      isBuy: false,
      triggerPx: 69950,
      isMarket: false,
      tpsl: "sl",
      size: 0.5,
      limitPx: 69900,
      reduceOnly: true,
      status: "triggerPending",
      createdAt: 1,
      updatedAt: 1
    });
    expect(await runtime.listTriggerOrderHistory("paper-account-1")).toEqual([{ oid: 1000000001 }]);
    expect(await runtime.listPendingTriggerOrders()).toEqual([{ oid: 1000000002 }]);
    expect(await runtime.findTriggerOrder("paper-account-1", 1000000001)).toEqual({ oid: 1000000001 });
    expect(await runtime.getMarketHistory(10)).toEqual({ candles: [], trades: [], book: { bids: [], asks: [] } });
    expect(await runtime.getMarketVolume(10, "1m", "BTC")).toEqual({ records: [] });
    runtime.setMarketTickInFlight(true);
    expect(await runtime.login("demo", "demo123456", "frontend")).toEqual(frontendSession);
    runtime.logout(frontendSession.token);
    expect(runtime.getSession(frontendSession.token)).toEqual(frontendSession);
    expect(await runtime.listFrontendUsers()).toEqual([frontendSession.user]);
    expect(await runtime.createFrontendUser({
      username: "demo",
      password: "demo123456",
      displayName: "Demo Trader"
    })).toEqual(frontendSession.user);
    expect(await runtime.updateFrontendUser("frontend-user-1", {
      displayName: "Demo Trader"
    })).toEqual(frontendSession.user);
    expect(await runtime.updatePlatformSettings({
      platformName: "Desk",
      platformAnnouncement: "",
      activeExchange: "hyperliquid",
      activeSymbol: "BTC-USD",
      maintenanceMode: false,
      allowFrontendTrading: true,
      allowManualTicks: true
    })).toMatchObject({ platformName: "Desk" });
    expect(runtime.listBatchJobs()).toEqual([{ id: "db-bootstrap" }]);
    expect(await runtime.runBatchJob("db-bootstrap")).toEqual({ executionId: "exec-1" });
    expect(await runtime.listRunningBatchJobs()).toEqual([{ executionId: "exec-1" }]);
    expect(await runtime.getBatchJobExecution("exec-1")).toEqual({ executionId: "exec-1" });
    expect(await runtime.listAvailableSymbolConfigMeta()).toEqual([]);
    expect(await runtime.getReplayPayload("paper-account-1", "session-paper-a-btc-usdccount-1-btc-usd")).toMatchObject({
      sessionId: "session-paper-a-btc-usdccount-1-btc-usd",
      state: { simulationSessionId: "session-paper-a-btc-usdccount-1-btc-usd", nextSequence: 2 },
      events: [{ eventType: "OrderAccepted" }]
    });
    expect(await runtime.getPositionReplayPayload("paper-account-1", "fill_1")).toMatchObject({
      sessionId: "session-paper-a-btc-usdccount-1-btc-usd",
      fillId: "fill_1",
      fills: [{ eventType: "OrderFilled" }],
      events: [{ eventType: "OrderFilled" }]
    });

    const listener = vi.fn();
    const unsubscribe = runtime.onBroadcast(listener);
    privateRuntime.broadcast("paper-account-1", [{ accountId: "paper-account-1", eventType: "OrderAccepted" }]);
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    privateRuntime.broadcast("paper-account-1", [{ accountId: "paper-account-1", eventType: "OrderAccepted" }]);
    expect(listener).toHaveBeenCalledTimes(1);

    const socket = { send: vi.fn(), on: vi.fn() };
    runtime.removeSocket(socket);
    expect(privateRuntime.webSocketHub.removeSocket).toHaveBeenCalledWith(socket);
  });

  it("switches active symbols through maintenance mode and rolls settings back on failure", async () => {
    const runtime = new ApiRuntime(logger as never);
    const privateRuntime = runtime as never;

    privateRuntime.platformSettings = {
      platformName: "Desk",
      platformAnnouncement: "",
      activeExchange: "hyperliquid",
      activeSymbol: "BTC-USD",
      maintenanceMode: false,
      allowFrontendTrading: true,
      allowManualTicks: true
    };
    privateRuntime.repository = {
      loadSymbolConfigMeta: vi.fn(async () => ({
        source: "okx",
        symbol: "ETH-USD",
        coin: "ETH",
        marketSymbol: "ETH-USDT-SWAP",
        leverage: 5,
        maxLeverage: 20,
        szDecimals: 2,
        quoteAsset: "USDT"
      })),
      listPendingTriggerOrders: vi.fn(async () => [])
    };
    privateRuntime.tradingRuntime = {
      getAccountIds: vi.fn(() => ["paper-account-1"]),
      getEngineState: vi.fn(() => ({
        position: { side: "flat", quantity: 0 },
        orders: []
      }))
    };
    privateRuntime.authRuntime = {
      updatePlatformSettings: vi.fn(async (input: unknown) => input)
    };
    privateRuntime.batchJobRunner = {
      run: vi.fn(async () => ({ executionId: "exec-2", jobId: "batch-switch-active-symbol" }))
    };
    privateRuntime.webSocketHub = { broadcast: vi.fn() };

    await expect(runtime.runBatchJob("batch-switch-active-symbol", {
      exchange: "OKX",
      symbol: "eth-usd"
    })).resolves.toEqual({ executionId: "exec-2", jobId: "batch-switch-active-symbol" });

    expect(privateRuntime.authRuntime.updatePlatformSettings).toHaveBeenCalledWith(expect.objectContaining({
      maintenanceMode: true,
      allowFrontendTrading: false,
      allowManualTicks: false
    }));
    expect(privateRuntime.batchJobRunner.run).toHaveBeenCalledWith("batch-switch-active-symbol", {
      exchange: "okx",
      symbol: "ETH-USD"
    });

    privateRuntime.batchJobRunner.run.mockRejectedValueOnce(new Error("runner exploded"));

    await expect(runtime.runBatchJob("batch-switch-active-symbol", {
      exchange: "okx",
      symbol: "eth-usd"
    })).rejects.toThrow("runner exploded");

    expect(privateRuntime.authRuntime.updatePlatformSettings).toHaveBeenLastCalledWith({
      platformName: "Desk",
      platformAnnouncement: "",
      activeExchange: "hyperliquid",
      activeSymbol: "BTC-USD",
      maintenanceMode: true,
      allowFrontendTrading: false,
      allowManualTicks: false
    });
  });

  it("covers TradingRuntime edge branches directly", async () => {
    const repository = {
      loadSimulationSnapshot: vi.fn(async () => null),
      loadEvents: vi.fn(async (sessionId: string) => sessionId === "session-paper-a-btc-usd"
        ? [{
          eventId: "evt-1",
          eventType: "MarketTickReceived",
          occurredAt: "2026-01-01T00:00:00.000Z",
          sequence: 1,
          simulationSessionId: "session-paper-a-btc-usd",
          accountId: "paper-a",
          symbol: "BTC-USD",
          source: "system",
          payload: {
            symbol: "BTC-USD",
            bid: 100,
            ask: 101,
            last: 100.5,
            spread: 1,
            tickTime: "2026-01-01T00:00:00.000Z",
            volatilityTag: "normal"
          }
        }]
        : []),
      persistState: vi.fn(async () => undefined),
      updateSymbolLeverage: vi.fn(async () => undefined)
    };
    const onEvents = vi.fn();
    const runtime = new TradingRuntime({
      logger: logger as never,
      repository: repository as never,
      onEvents
    });

    expect(() => runtime.getEngineState()).toThrow("No trading account runtime is available.");
    await runtime.bootstrap({
      frontendAccountIds: ["paper-a"],
      persistedSymbolConfig: null
    });
    await runtime.ensureFrontendAccount("paper-a");
    expect(repository.loadSimulationSnapshot).toHaveBeenCalledTimes(1);
    expect(repository.loadEvents).toHaveBeenCalledTimes(1);

    expect(runtime.getPrimaryAccountId()).toBe("paper-a");
    expect(runtime.getFillHistoryEvents("paper-a")).toEqual([]);
    expect(runtime.getOrderByClientOrderId("paper-a", "0xmissing")).toBeUndefined();
    expect(runtime.getRecentEventStore("paper-a", 0).length).toBe(1);
    expect(runtime.getRecentEventStore("paper-a", 5).length).toBe(1);
    expect(runtime.getReplayState("paper-a")).toMatchObject({
      simulationSessionId: "session-1"
    });
    await expect(runtime.getReplayData("paper-a", "session-paper-a-btc-usd")).resolves.toMatchObject({
      state: {
        simulationSessionId: "session-1"
      }
    });
    await expect(runtime.getReplayData("paper-a", "session-paper-b-btc-usd")).rejects.toThrow(
      "Replay session session-paper-b-btc-usd is not available for account paper-a."
    );

    await runtime.setBootstrapReady(false);
    expect(repository.persistState).not.toHaveBeenCalled();
    await runtime.persistExternalEvents("paper-a", []);
    expect(onEvents).not.toHaveBeenCalled();

    await runtime.submitOrder({
      accountId: "paper-a",
      symbol: "BTC-USD",
      side: "buy",
      orderType: "limit",
      quantity: 1
    });
    await runtime.submitOrder({
      accountId: "paper-a",
      symbol: "BTC-USD",
      side: "buy",
      orderType: "limit",
      quantity: 2
    });
    expect(await runtime.cancelAllOpenOrders("paper-a")).toEqual([]);
    runtime.getEngineState("paper-a").orders[0]!.status = "PARTIALLY_FILLED";
    runtime.getEngineState("paper-a").orders[1]!.status = "ACCEPTED";
    expect((await runtime.cancelAllOpenOrders("paper-a")).length).toBe(2);

    await runtime.updateLeverage({
      source: "hyperliquid",
      symbol: "BTC-USD",
      coin: "BTC",
      leverage: 10,
      maxLeverage: 20,
      szDecimals: 5
    }, 3);
    expect(repository.updateSymbolLeverage).toHaveBeenCalledWith("BTC-USD", 3, "hyperliquid");
    await runtime.updateLeverage({
      source: "hyperliquid",
      symbol: "BTC-USD",
      coin: "BTC",
      leverage: 3,
      maxLeverage: 20,
      szDecimals: 5
    }, 4);
    expect(repository.updateSymbolLeverage).toHaveBeenLastCalledWith("BTC-USD", 4, "hyperliquid");

    await runtime.flushPersistence();
    await runtime.setBootstrapReady(true);
    expect(repository.persistState).toHaveBeenCalled();
    const persistCallsBeforeNewAccount = repository.persistState.mock.calls.length;
    await runtime.ensureFrontendAccount("paper-b");
    expect(repository.persistState.mock.calls.length).toBeGreaterThan(persistCallsBeforeNewAccount);
    expect(repository.loadSimulationSnapshot).toHaveBeenCalledWith("session-paper-b-btc-usd");
    expect(() => runtime.getOrders("paper-missing")).toThrow("Trading account runtime paper-missing is not initialized.");
  });

  it("prunes runtime event stores while preserving active order context", async () => {
    const repository = {
      loadSimulationSnapshot: vi.fn(async () => null),
      loadEvents: vi.fn(async () => []),
      persistState: vi.fn(async () => undefined),
      updateSymbolLeverage: vi.fn(async () => undefined)
    };
    const runtime = new TradingRuntime({
      logger: logger as never,
      repository: repository as never,
      onEvents: vi.fn()
    });

    await runtime.bootstrap({
      frontendAccountIds: ["paper-a"],
      persistedSymbolConfig: null
    });

    const privateRuntime = runtime as never;
    const slot = privateRuntime.accountRuntimes.get("paper-a");
    slot.engine.getState().orders = [{
      id: "ord-active",
      status: "ACCEPTED"
    }];
    slot.eventStore = [
      {
        eventId: "ord-active-requested",
        eventType: "OrderRequested",
        occurredAt: "2026-01-01T00:00:00.000Z",
        sequence: 1,
        simulationSessionId: "session-paper-a-btc-usd",
        accountId: "paper-a",
        symbol: "BTC-USD",
        source: "user",
        payload: {
          orderId: "ord-active"
        }
      },
      ...Array.from({ length: 550 }, (_, index) => ({
        eventId: `order-${index + 2}`,
        eventType: "OrderAccepted",
        occurredAt: "2026-01-01T00:00:00.000Z",
        sequence: index + 2,
        simulationSessionId: "session-paper-a-btc-usd",
        accountId: "paper-a",
        symbol: "BTC-USD",
        source: "system",
        payload: {
          orderId: `ord-${index + 2}`
        }
      })),
      ...Array.from({ length: 300 }, (_, index) => ({
        eventId: `tick-${index + 1}`,
        eventType: "MarketTickReceived",
        occurredAt: "2026-01-01T00:00:00.000Z",
        sequence: index + 552,
        simulationSessionId: "session-paper-a-btc-usd",
        accountId: "paper-a",
        symbol: "BTC-USD",
        source: "system",
        payload: {
          symbol: "BTC-USD",
          bid: 100 + index,
          ask: 101 + index,
          last: 100.5 + index,
          spread: 1,
          tickTime: "2026-01-01T00:00:00.000Z",
          volatilityTag: "normal"
        }
      }))
    ];

    privateRuntime.pruneRuntimeEventStore(slot);

    expect(slot.eventStore.length).toBeLessThanOrEqual(741);
    expect(slot.eventStore.some((event: AnyEventEnvelope) => event.sequence === 1)).toBe(true);
    expect(slot.eventStore.some((event: AnyEventEnvelope) => event.sequence === 2)).toBe(false);
    expect(slot.eventStore.filter((event: AnyEventEnvelope) => event.eventType === "MarketTickReceived")).toHaveLength(240);
    expect(slot.eventStore[0]?.sequence).toBe(1);
    expect(slot.eventStore.at(-1)?.sequence).toBe(851);
  });

  it("applies a second pruning pass when protected events keep the retained window above the hard cap", async () => {
    const repository = {
      loadSimulationSnapshot: vi.fn(async () => null),
      loadEvents: vi.fn(async () => []),
      persistState: vi.fn(async () => undefined),
      updateSymbolLeverage: vi.fn(async () => undefined)
    };
    const runtime = new TradingRuntime({
      logger: logger as never,
      repository: repository as never,
      onEvents: vi.fn()
    });

    await runtime.bootstrap({
      frontendAccountIds: ["paper-a"],
      persistedSymbolConfig: null
    });

    const privateRuntime = runtime as never;
    const slot = privateRuntime.accountRuntimes.get("paper-a");
    slot.engine.getState().orders = Array.from({ length: 300 }, (_, index) => ({
      id: `ord-protected-${index + 1}`,
      status: "ACCEPTED"
    }));
    slot.eventStore = [
      ...Array.from({ length: 300 }, (_, index) => ({
        eventId: `protected-${index + 1}`,
        eventType: "OrderRequested",
        occurredAt: "2026-01-01T00:00:00.000Z",
        sequence: index + 1,
        simulationSessionId: "session-paper-a-btc-usd",
        accountId: "paper-a",
        symbol: "BTC-USD",
        source: "user",
        payload: {
          orderId: `ord-protected-${index + 1}`
        }
      })),
      ...Array.from({ length: 600 }, (_, index) => ({
        eventId: `non-market-${index + 1}`,
        eventType: "OrderAccepted",
        occurredAt: "2026-01-01T00:00:00.000Z",
        sequence: index + 301,
        simulationSessionId: "session-paper-a-btc-usd",
        accountId: "paper-a",
        symbol: "BTC-USD",
        source: "system",
        payload: {
          orderId: `ord-free-${index + 1}`
        }
      })),
      ...Array.from({ length: 400 }, (_, index) => ({
        eventId: `tick-${index + 1}`,
        eventType: "MarketTickReceived",
        occurredAt: "2026-01-01T00:00:00.000Z",
        sequence: index + 901,
        simulationSessionId: "session-paper-a-btc-usd",
        accountId: "paper-a",
        symbol: "BTC-USD",
        source: "system",
        payload: {
          symbol: "BTC-USD",
          bid: 100 + index,
          ask: 101 + index,
          last: 100.5 + index,
          spread: 1,
          tickTime: "2026-01-01T00:00:00.000Z",
          volatilityTag: "normal"
        }
      }))
    ];

    privateRuntime.pruneRuntimeEventStore(slot);

    expect(slot.eventStore).toHaveLength(1000);
    expect(slot.eventStore.some((event: AnyEventEnvelope) => event.eventId === "protected-1")).toBe(true);
    expect(slot.eventStore.some((event: AnyEventEnvelope) => event.eventId === "non-market-101")).toBe(false);
    expect(slot.eventStore.filter((event: AnyEventEnvelope) => event.eventType === "MarketTickReceived")).toHaveLength(240);
  });

  it("builds completed position replay data from fill history segments", async () => {
    const repository = {
      loadSimulationSnapshot: vi.fn(async () => null),
      loadEvents: vi.fn(async () => []),
      persistState: vi.fn(async () => undefined),
      updateSymbolLeverage: vi.fn(async () => undefined)
    };
    const runtime = new TradingRuntime({
      logger: logger as never,
      repository: repository as never,
      onEvents: vi.fn()
    });

    await runtime.bootstrap({
      frontendAccountIds: ["paper-a"],
      persistedSymbolConfig: null
    });

    const replayEvents: AnyEventEnvelope[] = [
      {
        eventId: "evt-1",
        eventType: "OrderRequested",
        occurredAt: "2026-01-01T00:00:00.000Z",
        sequence: 1,
        simulationSessionId: "session-paper-a-btc-usd",
        accountId: "paper-a",
        symbol: "BTC-USD",
        source: "user",
        payload: { orderId: "ord-open-1", side: "buy" }
      },
      {
        eventId: "evt-2",
        eventType: "MarketTickReceived",
        occurredAt: "2026-01-01T00:00:01.000Z",
        sequence: 2,
        simulationSessionId: "session-paper-a-btc-usd",
        accountId: "paper-a",
        symbol: "BTC-USD",
        source: "system",
        payload: {
          symbol: "BTC-USD",
          bid: 100,
          ask: 101,
          last: 100.5,
          spread: 1,
          tickTime: "2026-01-01T00:00:01.000Z",
          volatilityTag: "normal"
        }
      },
      {
        eventId: "evt-3",
        eventType: "OrderPartiallyFilled",
        occurredAt: "2026-01-01T00:00:02.000Z",
        sequence: 3,
        simulationSessionId: "session-paper-a-btc-usd",
        accountId: "paper-a",
        symbol: "BTC-USD",
        source: "system",
        payload: {
          orderId: "ord-open-1",
          fillId: "fill-open-1",
          fillPrice: 100,
          fillQuantity: 1
        }
      },
      {
        eventId: "evt-4",
        eventType: "OrderRequested",
        occurredAt: "2026-01-01T00:00:03.000Z",
        sequence: 4,
        simulationSessionId: "session-paper-a-btc-usd",
        accountId: "paper-a",
        symbol: "BTC-USD",
        source: "user",
        payload: { orderId: "ord-close-1", side: "sell" }
      },
      {
        eventId: "evt-5",
        eventType: "MarketTickReceived",
        occurredAt: "2026-01-01T00:00:04.000Z",
        sequence: 5,
        simulationSessionId: "session-paper-a-btc-usd",
        accountId: "paper-a",
        symbol: "BTC-USD",
        source: "system",
        payload: {
          symbol: "BTC-USD",
          bid: 101,
          ask: 102,
          last: 101.5,
          spread: 1,
          tickTime: "2026-01-01T00:00:04.000Z",
          volatilityTag: "normal"
        }
      },
      {
        eventId: "evt-6",
        eventType: "OrderFilled",
        occurredAt: "2026-01-01T00:00:05.000Z",
        sequence: 6,
        simulationSessionId: "session-paper-a-btc-usd",
        accountId: "paper-a",
        symbol: "BTC-USD",
        source: "system",
        payload: {
          orderId: "ord-close-1",
          fillId: "fill-close-1",
          fillPrice: 102,
          fillQuantity: 1
        }
      },
      {
        eventId: "evt-7",
        eventType: "OrderRequested",
        occurredAt: "2026-01-01T00:00:06.000Z",
        sequence: 7,
        simulationSessionId: "session-paper-a-btc-usd",
        accountId: "paper-a",
        symbol: "BTC-USD",
        source: "user",
        payload: { orderId: "ord-open-2", side: "sell" }
      },
      {
        eventId: "evt-8",
        eventType: "OrderFilled",
        occurredAt: "2026-01-01T00:00:07.000Z",
        sequence: 8,
        simulationSessionId: "session-paper-a-btc-usd",
        accountId: "paper-a",
        symbol: "BTC-USD",
        source: "system",
        payload: {
          orderId: "ord-open-2",
          fillId: "fill-open-2",
          fillPrice: 101,
          fillQuantity: 2
        }
      },
      {
        eventId: "evt-9",
        eventType: "OrderRequested",
        occurredAt: "2026-01-01T00:00:08.000Z",
        sequence: 9,
        simulationSessionId: "session-paper-a-btc-usd",
        accountId: "paper-a",
        symbol: "BTC-USD",
        source: "user",
        payload: { orderId: "ord-close-2", side: "buy" }
      },
      {
        eventId: "evt-10",
        eventType: "MarketTickReceived",
        occurredAt: "2026-01-01T00:00:09.000Z",
        sequence: 10,
        simulationSessionId: "session-paper-a-btc-usd",
        accountId: "paper-a",
        symbol: "BTC-USD",
        source: "system",
        payload: {
          symbol: "BTC-USD",
          bid: 99,
          ask: 100,
          last: 99.5,
          spread: 1,
          tickTime: "2026-01-01T00:00:09.000Z",
          volatilityTag: "normal"
        }
      },
      {
        eventId: "evt-11",
        eventType: "OrderFilled",
        occurredAt: "2026-01-01T00:00:10.000Z",
        sequence: 11,
        simulationSessionId: "session-paper-a-btc-usd",
        accountId: "paper-a",
        symbol: "BTC-USD",
        source: "system",
        payload: {
          orderId: "ord-close-2",
          fillId: "fill-close-2",
          fillPrice: 99,
          fillQuantity: 2
        }
      }
    ];

    const privateRuntime = runtime as never;
    privateRuntime.getReplayData = vi.fn(async () => ({
      initialState: {
        simulationSessionId: "session-paper-a-btc-usd",
        account: { accountId: "paper-a" },
        orders: [],
        position: { side: "flat", quantity: 0 }
      },
      state: {
        simulationSessionId: "session-paper-a-btc-usd",
        account: { accountId: "paper-a" },
        orders: [],
        position: { side: "short", quantity: 99 }
      },
      events: replayEvents
    }));

    const firstReplay = await runtime.getPositionReplayData("paper-a", "fill-close-1");
    expect(firstReplay.sessionId).toBe("session-paper-a-btc-usd");
    expect(firstReplay.fills.map((event) => (event.payload as { fillId: string }).fillId)).toEqual([
      "fill-open-1",
      "fill-close-1"
    ]);
    expect(firstReplay.events.map((event) => event.sequence)).toEqual([1, 3, 4, 6]);
    expect(firstReplay.marketEvents.map((event) => event.sequence)).toEqual([2, 5]);
    expect(firstReplay.state).toMatchObject({
      simulationSessionId: "session-1",
      position: {
        side: "flat",
        quantity: 0
      }
    });

    const secondReplay = await runtime.getPositionReplayData("paper-a", "fill-close-2");
    expect(secondReplay.fills.map((event) => (event.payload as { fillId: string }).fillId)).toEqual([
      "fill-open-2",
      "fill-close-2"
    ]);
    expect(secondReplay.events.map((event) => event.sequence)).toEqual([7, 8, 9, 11]);
    expect(secondReplay.marketEvents.map((event) => event.sequence)).toEqual([10]);
  });

  it("falls back to the live runtime event store for replayable fills pruned from persisted events", async () => {
    const repository = {
      loadSimulationSnapshot: vi.fn(async () => null),
      loadEvents: vi.fn(async () => []),
      persistState: vi.fn(async () => undefined),
      updateSymbolLeverage: vi.fn(async () => undefined)
    };
    const runtime = new TradingRuntime({
      logger: logger as never,
      repository: repository as never,
      onEvents: vi.fn()
    });

    await runtime.bootstrap({
      frontendAccountIds: ["paper-a"],
      persistedSymbolConfig: null
    });

    const liveEvents: AnyEventEnvelope[] = [
      {
        eventId: "evt-1",
        eventType: "OrderRequested",
        occurredAt: "2026-01-01T00:00:00.000Z",
        sequence: 1,
        simulationSessionId: "session-paper-a-btc-usd",
        accountId: "paper-a",
        symbol: "BTC-USD",
        source: "user",
        payload: {
          orderId: "ord-1",
          side: "buy",
          orderType: "market",
          quantity: 1,
          submittedAt: "2026-01-01T00:00:00.000Z"
        }
      },
      {
        eventId: "evt-2",
        eventType: "OrderFilled",
        occurredAt: "2026-01-01T00:00:01.000Z",
        sequence: 2,
        simulationSessionId: "session-paper-a-btc-usd",
        accountId: "paper-a",
        symbol: "BTC-USD",
        source: "system",
        payload: {
          orderId: "ord-1",
          fillId: "fill_1",
          fillPrice: 100,
          fillQuantity: 1,
          filledQuantityTotal: 1,
          remainingQuantity: 0,
          slippage: 0,
          fee: 0,
          feeRate: 0,
          liquidityRole: "taker",
          filledAt: "2026-01-01T00:00:01.000Z"
        }
      },
      {
        eventId: "evt-3",
        eventType: "OrderRequested",
        occurredAt: "2026-01-01T00:00:02.000Z",
        sequence: 3,
        simulationSessionId: "session-paper-a-btc-usd",
        accountId: "paper-a",
        symbol: "BTC-USD",
        source: "user",
        payload: {
          orderId: "ord-2",
          side: "sell",
          orderType: "market",
          quantity: 1,
          submittedAt: "2026-01-01T00:00:02.000Z"
        }
      },
      {
        eventId: "evt-4",
        eventType: "OrderFilled",
        occurredAt: "2026-01-01T00:00:03.000Z",
        sequence: 4,
        simulationSessionId: "session-paper-a-btc-usd",
        accountId: "paper-a",
        symbol: "BTC-USD",
        source: "system",
        payload: {
          orderId: "ord-2",
          fillId: "fill_2",
          fillPrice: 101,
          fillQuantity: 1,
          filledQuantityTotal: 1,
          remainingQuantity: 0,
          slippage: 0,
          fee: 0,
          feeRate: 0,
          liquidityRole: "taker",
          filledAt: "2026-01-01T00:00:03.000Z"
        }
      }
    ];

    const privateRuntime = runtime as never;
    privateRuntime.accountRuntimes.get("paper-a").eventStore = liveEvents;
    privateRuntime.getReplayData = vi.fn(async () => ({
      initialState: {
        simulationSessionId: "session-paper-a-btc-usd",
        account: { accountId: "paper-a" },
        orders: [],
        position: { side: "flat", quantity: 0 }
      },
      state: {
        simulationSessionId: "session-paper-a-btc-usd",
        account: { accountId: "paper-a" },
        orders: [],
        position: { side: "flat", quantity: 0 }
      },
      events: []
    }));

    const replay = await runtime.getPositionReplayData("paper-a", "fill_2");

    expect(replay.fills.map((event) => (event.payload as { fillId: string }).fillId)).toEqual(["fill_1", "fill_2"]);
    expect(replay.events.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
    expect(replay.state).toMatchObject({
      simulationSessionId: "session-1"
    });
    expect(privateRuntime.getReplayData).toHaveBeenCalledWith("paper-a", "session-paper-a-btc-usd");
  });

  it("falls back to persisted fill history when replay events no longer contain the requested fill", async () => {
    const repository = {
      loadSimulationSnapshot: vi.fn(async () => null),
      loadEvents: vi.fn(async () => []),
      persistState: vi.fn(async () => undefined),
      updateSymbolLeverage: vi.fn(async () => undefined),
      listFillHistoryEvents: vi.fn(async () => [
        {
          eventId: "persisted-fill-1",
          eventType: "OrderFilled",
          occurredAt: "2026-01-01T00:00:01.000Z",
          sequence: 1,
          simulationSessionId: "persisted-paper-a",
          accountId: "paper-a",
          symbol: "BTC-USD",
          source: "system",
          payload: {
            orderId: "ord-1",
            fillId: "fill_1",
            fillPrice: 100,
            fillQuantity: 1,
            filledQuantityTotal: 1,
            remainingQuantity: 0,
            slippage: 0,
            fee: 0,
            feeRate: 0,
            liquidityRole: "taker",
            filledAt: "2026-01-01T00:00:01.000Z"
          }
        },
        {
          eventId: "persisted-fill-2",
          eventType: "OrderFilled",
          occurredAt: "2026-01-01T00:00:03.000Z",
          sequence: 2,
          simulationSessionId: "persisted-paper-a",
          accountId: "paper-a",
          symbol: "BTC-USD",
          source: "system",
          payload: {
            orderId: "ord-2",
            fillId: "fill_2",
            fillPrice: 101,
            fillQuantity: 1,
            filledQuantityTotal: 1,
            remainingQuantity: 0,
            slippage: 0,
            fee: 0,
            feeRate: 0,
            liquidityRole: "taker",
            filledAt: "2026-01-01T00:00:03.000Z"
          }
        }
      ]),
      listOrderHistoryViews: vi.fn(async () => [
        {
          id: "ord-1",
          accountId: "paper-a",
          symbol: "BTC-USD",
          side: "buy",
          orderType: "market",
          status: "FILLED",
          quantity: 1,
          filledQuantity: 1,
          remainingQuantity: 0,
          averageFillPrice: 100,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:01.000Z"
        },
        {
          id: "ord-2",
          accountId: "paper-a",
          symbol: "BTC-USD",
          side: "sell",
          orderType: "market",
          status: "FILLED",
          quantity: 1,
          filledQuantity: 1,
          remainingQuantity: 0,
          averageFillPrice: 101,
          createdAt: "2026-01-01T00:00:02.000Z",
          updatedAt: "2026-01-01T00:00:03.000Z"
        }
      ]),
      listMarketTickEvents: vi.fn(async () => [{
        eventId: "persisted-market-1",
        eventType: "MarketTickReceived",
        occurredAt: "2026-01-01T00:00:02.500Z",
        sequence: 1,
        simulationSessionId: "persisted-market-BTC-USD",
        accountId: "",
        symbol: "BTC-USD",
        source: "market",
        payload: {
          bid: 100,
          ask: 101,
          last: 100.5,
          spread: 1,
          tickTime: "2026-01-01T00:00:02.500Z",
          volatilityTag: "normal"
        }
      }])
    };
    const runtime = new TradingRuntime({
      logger: logger as never,
      repository: repository as never,
      onEvents: vi.fn()
    });

    await runtime.bootstrap({
      frontendAccountIds: ["paper-a"],
      persistedSymbolConfig: null
    });

    const privateRuntime = runtime as never;
    privateRuntime.accountRuntimes.get("paper-a").eventStore = [];
    privateRuntime.getReplayData = vi.fn(async () => ({
      initialState: {
        simulationSessionId: "session-paper-a-btc-usd",
        account: { accountId: "paper-a" },
        orders: [],
        position: { side: "flat", quantity: 0 }
      },
      state: {
        simulationSessionId: "session-paper-a-btc-usd",
        account: { accountId: "paper-a" },
        orders: [],
        position: { side: "long", quantity: 9 }
      },
      events: []
    }));

    const replay = await runtime.getPositionReplayData("paper-a", "fill_2");

    expect(replay.fills.map((event) => (event.payload as { fillId: string }).fillId)).toEqual(["fill_1", "fill_2"]);
    expect(replay.events.map((event) => event.eventType)).toEqual([
      "OrderRequested",
      "OrderFilled",
      "OrderRequested",
      "OrderFilled"
    ]);
    expect(replay.marketEvents.map((event) => event.eventType)).toEqual(["MarketTickReceived"]);
    expect(replay.state).toMatchObject({
      position: {
        side: "flat",
        quantity: 0
      }
    });
  });

  it("throws when neither live replay data nor persisted fill history can resolve the requested fill", async () => {
    const repository = {
      loadSimulationSnapshot: vi.fn(async () => null),
      loadEvents: vi.fn(async () => []),
      persistState: vi.fn(async () => undefined),
      updateSymbolLeverage: vi.fn(async () => undefined),
      listFillHistoryEvents: vi.fn(async () => [{
        eventId: "persisted-fill-1",
        eventType: "OrderFilled",
        occurredAt: "2026-01-01T00:00:01.000Z",
        sequence: 1,
        simulationSessionId: "persisted-paper-a",
        accountId: "paper-a",
        symbol: "BTC-USD",
        source: "system",
        payload: {
          orderId: "ord-1",
          fillId: "fill_1",
          fillPrice: 100,
          fillQuantity: 1
        }
      }]),
      listOrderHistoryViews: vi.fn(async () => [{
        id: "ord-1",
        accountId: "paper-a",
        symbol: "BTC-USD",
        side: "buy",
        orderType: "market",
        status: "FILLED",
        quantity: 1,
        filledQuantity: 1,
        remainingQuantity: 0,
        averageFillPrice: 100,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:01.000Z"
      }]),
      listMarketTickEvents: vi.fn(async () => [])
    };
    const runtime = new TradingRuntime({
      logger: logger as never,
      repository: repository as never,
      onEvents: vi.fn()
    });

    await runtime.bootstrap({
      frontendAccountIds: ["paper-a"],
      persistedSymbolConfig: null
    });

    const privateRuntime = runtime as never;
    privateRuntime.accountRuntimes.get("paper-a").eventStore = [];
    privateRuntime.getReplayData = vi.fn(async () => ({
      initialState: {
        simulationSessionId: "session-paper-a-btc-usd",
        account: { accountId: "paper-a" },
        orders: [],
        position: { side: "flat", quantity: 0 }
      },
      state: {
        simulationSessionId: "session-paper-a-btc-usd",
        account: { accountId: "paper-a" },
        orders: [],
        position: { side: "flat", quantity: 0 }
      },
      events: []
    }));

    await expect(runtime.getPositionReplayData("paper-a", "fill_missing"))
      .rejects.toThrow("Completed position replay not found for fill fill_missing.");
  });

  it("keeps persisted replay ordering stable when synthetic and fill events share timestamps", async () => {
    const repository = {
      loadSimulationSnapshot: vi.fn(async () => null),
      loadEvents: vi.fn(async () => []),
      persistState: vi.fn(async () => undefined),
      updateSymbolLeverage: vi.fn(async () => undefined),
      listFillHistoryEvents: vi.fn(async () => [
        {
          eventId: "persisted-fill-1",
          eventType: "OrderFilled",
          occurredAt: "2026-01-01T00:00:01.000Z",
          sequence: 2,
          simulationSessionId: "persisted-paper-a",
          accountId: "paper-a",
          symbol: "BTC-USD",
          source: "system",
          payload: {
            orderId: "ord-1",
            fillId: "fill_1",
            fillPrice: 100,
            fillQuantity: 1
          }
        },
        {
          eventId: "persisted-fill-2",
          eventType: "OrderFilled",
          occurredAt: "2026-01-01T00:00:01.000Z",
          sequence: 1,
          simulationSessionId: "persisted-paper-a",
          accountId: "paper-a",
          symbol: "BTC-USD",
          source: "system",
          payload: {
            orderId: "ord-2",
            fillId: "fill_2",
            fillPrice: 101,
            fillQuantity: 1
          }
        }
      ]),
      listOrderHistoryViews: vi.fn(async () => [
        {
          id: "ord-1",
          accountId: "paper-a",
          symbol: "BTC-USD",
          side: "buy",
          orderType: "market",
          status: "FILLED",
          quantity: 1,
          filledQuantity: 1,
          remainingQuantity: 0,
          averageFillPrice: 100,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:01.000Z"
        },
        {
          id: "ord-2",
          accountId: "paper-a",
          symbol: "BTC-USD",
          side: "sell",
          orderType: "market",
          status: "FILLED",
          quantity: 1,
          filledQuantity: 1,
          remainingQuantity: 0,
          averageFillPrice: 101,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:01.000Z"
        }
      ]),
      listMarketTickEvents: vi.fn(async () => [])
    };
    const runtime = new TradingRuntime({
      logger: logger as never,
      repository: repository as never,
      onEvents: vi.fn()
    });

    await runtime.bootstrap({
      frontendAccountIds: ["paper-a"],
      persistedSymbolConfig: null
    });

    const privateRuntime = runtime as never;
    privateRuntime.accountRuntimes.get("paper-a").eventStore = [];
    privateRuntime.getReplayData = vi.fn(async () => ({
      initialState: {
        simulationSessionId: "session-paper-a-btc-usd",
        account: { accountId: "paper-a" },
        orders: [],
        position: { side: "flat", quantity: 0 }
      },
      state: {
        simulationSessionId: "session-paper-a-btc-usd",
        account: { accountId: "paper-a" },
        orders: [],
        position: { side: "flat", quantity: 0 }
      },
      events: []
    }));

    const replay = await runtime.getPositionReplayData("paper-a", "fill_2");

    expect(replay.events.map((event) => `${event.eventType}:${(event.payload as { orderId?: string }).orderId ?? ""}`)).toEqual([
      "OrderRequested:ord-1",
      "OrderRequested:ord-2",
      "OrderFilled:ord-2",
      "OrderFilled:ord-1"
    ]);
    expect(repository.listMarketTickEvents).toHaveBeenCalledWith(
      "BTC-USD",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:01.000Z"
    );
  });

  it("initializes from a persisted snapshot without replay events", async () => {
    const repository = {
      loadSimulationSnapshot: vi.fn(async () => ({
        lastSequence: 5,
        updatedAt: "2026-01-01T00:05:00.000Z",
        state: {
          simulationSessionId: "session-paper-b-btc-usd",
          nextSequence: 6,
          nextOrderId: 2,
          nextFillId: 1,
          latestTick: null,
          account: {
            accountId: "paper-b",
            walletBalance: 1000,
            availableBalance: 1000,
            positionMargin: 0,
            orderMargin: 0,
            equity: 1000,
            realizedPnl: 0,
            unrealizedPnl: 0,
            riskRatio: 0
          },
          position: {
            symbol: "BTC-USD",
            side: "flat",
            quantity: 0,
            averageEntryPrice: 0,
            markPrice: 0,
            realizedPnl: 0,
            unrealizedPnl: 0,
            initialMargin: 0,
            maintenanceMargin: 0,
            liquidationPrice: 0
          },
          orders: []
        }
      })),
      loadEvents: vi.fn(async () => []),
      persistState: vi.fn(async () => undefined),
      updateSymbolLeverage: vi.fn(async () => undefined)
    };
    const runtime = new TradingRuntime({
      logger: logger as never,
      repository: repository as never,
      onEvents: vi.fn()
    });

    await runtime.bootstrap({
      frontendAccountIds: ["paper-b"],
      persistedSymbolConfig: null
    });
    await runtime.setBootstrapReady(true);

    expect(runtime.getEngineState("paper-b").nextSequence).toBe(6);
    expect(repository.loadEvents).toHaveBeenCalledWith("session-paper-b-btc-usd", 5);
  });

  it("writes snapshots only once per minute while still persisting every event batch", async () => {
    const repository = {
      loadSimulationSnapshot: vi.fn(async () => null),
      loadEvents: vi.fn(async () => []),
      persistState: vi.fn(async () => undefined),
      updateSymbolLeverage: vi.fn(async () => undefined)
    };
    const runtime = new TradingRuntime({
      logger: logger as never,
      repository: repository as never,
      onEvents: vi.fn()
    });

    await runtime.bootstrap({
      frontendAccountIds: ["paper-a"],
      persistedSymbolConfig: null
    });
    await runtime.setBootstrapReady(true);

    await runtime.ingestManualTick({
      symbol: "BTC-USD",
      bid: 100,
      ask: 101,
      last: 100.5,
      spread: 1,
      tickTime: "2026-01-01T00:00:05.000Z",
      volatilityTag: "normal"
    }, "BTC-USD");
    await runtime.ingestManualTick({
      symbol: "BTC-USD",
      bid: 100.1,
      ask: 101.1,
      last: 100.6,
      spread: 1,
      tickTime: "2026-01-01T00:00:45.000Z",
      volatilityTag: "normal"
    }, "BTC-USD");
    await runtime.ingestManualTick({
      symbol: "BTC-USD",
      bid: 101,
      ask: 102,
      last: 101.5,
      spread: 1,
      tickTime: "2026-01-01T00:01:05.000Z",
      volatilityTag: "normal"
    }, "BTC-USD");

    expect(repository.persistState).toHaveBeenNthCalledWith(1, expect.anything(), [], true);
    expect(repository.persistState).toHaveBeenNthCalledWith(2, expect.anything(), expect.any(Array), true);
    expect(repository.persistState).toHaveBeenNthCalledWith(3, expect.anything(), expect.any(Array), false);
    expect(repository.persistState).toHaveBeenNthCalledWith(4, expect.anything(), expect.any(Array), true);
  });
});
