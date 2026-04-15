import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketTick } from "@stratium/shared";

const clientState = vi.hoisted(() => ({
  instances: [] as Array<{
    connect: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    options: {
      coin: string;
      candleInterval: string;
      onTick: (tick: MarketTick) => Promise<void> | void;
      onSnapshot: (snapshot: unknown) => void;
    };
  }>
}));

vi.mock("../src/hyperliquid-market", () => ({
  HyperliquidMarketClient: class {
    public readonly connect = vi.fn();
    public readonly close = vi.fn();

    constructor(
      public readonly options: {
        coin: string;
        candleInterval: string;
        onTick: (tick: MarketTick) => Promise<void> | void;
        onSnapshot: (snapshot: unknown) => void;
      }
    ) {
      clientState.instances.push(this);
    }
  }
}));

const { MarketRuntime } = await import("../src/market-runtime");

describe("MarketRuntime branch coverage", () => {
  const makeRuntime = (marketSource = "simulator") => {
    const repository = {
      loadRecentMarketSnapshot: vi.fn(),
      loadRecentVolumeRecords: vi.fn(),
      persistClosedMinuteCandles: vi.fn(async () => undefined)
    };
    const onLiveTick = vi.fn(async () => undefined);
    const onBroadcast = vi.fn();
    const runtime = new MarketRuntime({
      logger: {
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
        fatal: vi.fn(),
        trace: vi.fn(),
        child: vi.fn()
      } as never,
      repository: repository as never,
      marketSource,
      hyperliquidCoin: "BTC",
      hyperliquidCandleInterval: "1m",
      configuredTradingSymbol: "BTC-USD",
      onLiveTick,
      onBroadcast
    });

    return { runtime, repository, onLiveTick, onBroadcast };
  };

  beforeEach(() => {
    clientState.instances.length = 0;
    process.env.ENABLE_MARKET_SIMULATOR = "true";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("covers bootstrap anchor price and configured source startup branches", () => {
    const { runtime: btcRuntime } = makeRuntime("hyperliquid");
    btcRuntime.setBootstrapState("BTC-USD", 500, null);
    expect(btcRuntime.getMarketSimulatorState().anchorPrice).toBe(69830);

    process.env.ENABLE_MARKET_SIMULATOR = "false";
    btcRuntime.maybeStartConfiguredSource();
    expect(clientState.instances[0]?.connect).not.toHaveBeenCalled();

    process.env.ENABLE_MARKET_SIMULATOR = "true";
    btcRuntime.maybeStartConfiguredSource();
    expect(clientState.instances[0]?.connect).toHaveBeenCalledOnce();

    const { runtime: ethRuntime } = makeRuntime();
    ethRuntime.setBootstrapState("ETH-USD", 500, null);
    expect(ethRuntime.getMarketSimulatorState().anchorPrice).toBe(500);
    ethRuntime.setBootstrapState("ETH-USD", undefined, null);
    expect(ethRuntime.getMarketSimulatorState().anchorPrice).toBe(69830);
  });

  it("covers simulator payload fallbacks and synthetic volatility tags", () => {
    const { runtime, onBroadcast } = makeRuntime();
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");

    runtime.startMarketSimulator({
      intervalMs: 50,
      driftBps: Number.NaN,
      volatilityBps: Number.POSITIVE_INFINITY,
      anchorPrice: 0
    }, {
      symbol: "BTC-USD",
      bid: 99,
      ask: 101,
      last: 100,
      spread: 2,
      tickTime: "2026-01-01T00:00:00.000Z",
      volatilityTag: "normal"
    });

    expect(runtime.getMarketSimulatorState().enabled).toBe(true);
    expect(runtime.getMarketSimulatorState().intervalMs).toBe(1200);
    expect(runtime.getMarketSimulatorState().lastPrice).toBeGreaterThan(0);

    runtime.startMarketSimulator({ intervalMs: 500 }, {
      symbol: "BTC-USD",
      bid: 69999,
      ask: 70001,
      last: 70000,
      spread: 2,
      tickTime: "2026-01-01T00:00:00.000Z",
      volatilityTag: "normal"
    });
    expect(clearIntervalSpy).toHaveBeenCalled();

    const runtimeAny = runtime as never;
    const randomSpy = vi.spyOn(Math, "random");
    runtimeAny.marketSimulatorState = {
      ...runtimeAny.marketSimulatorState,
      symbol: "ETH-USD",
      anchorPrice: 100,
      lastPrice: 100
    };

    runtimeAny.marketSimulatorState.volatilityBps = 1;
    randomSpy.mockReturnValueOnce(0.5).mockReturnValueOnce(0);
    expect(runtimeAny.buildSyntheticTick().volatilityTag).toBe("calm");

    runtimeAny.marketSimulatorState.volatilityBps = 10;
    randomSpy.mockReturnValueOnce(1).mockReturnValueOnce(0);
    expect(runtimeAny.buildSyntheticTick().volatilityTag).toBe("normal");

    runtimeAny.marketSimulatorState.volatilityBps = 20;
    randomSpy.mockReturnValueOnce(1).mockReturnValueOnce(0);
    expect(runtimeAny.buildSyntheticTick().volatilityTag).toBe("high");

    runtimeAny.marketSimulatorState.volatilityBps = 100;
    randomSpy.mockReturnValueOnce(1).mockReturnValueOnce(0);
    expect(runtimeAny.buildSyntheticTick().volatilityTag).toBe("spike");

    runtime.stopMarketSimulator();
    expect(onBroadcast).toHaveBeenCalled();
  });

  it("covers snapshot merge fallbacks and closed-candle flush branches", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-09T12:02:05.000Z"));
    const { runtime, repository } = makeRuntime("hyperliquid");
    const runtimeAny = runtime as never;

    runtimeAny.handleMarketSnapshot({
      source: "hyperliquid",
      coin: "BTC",
      connected: true,
      bestBid: 100,
      bestAsk: 101,
      markPrice: 100.5,
      book: {
        bids: [{ price: 100, size: 1, orders: 1 }],
        asks: [{ price: 101, size: 1, orders: 1 }],
        updatedAt: 1
      },
      trades: [{ id: "trade-1", coin: "BTC", side: "buy", price: 100.5, size: 1, time: 1 }],
      candles: [{
        id: "old",
        coin: "BTC",
        interval: "1m",
        openTime: Date.parse("2026-04-08T11:00:00.000Z"),
        closeTime: Date.parse("2026-04-08T11:01:00.000Z"),
        open: 1,
        high: 1,
        low: 1,
        close: 1,
        volume: 1,
        tradeCount: 1
      }, {
        id: "candle-1",
        coin: "BTC",
        interval: "1m",
        openTime: Date.parse("2026-04-09T12:00:00.000Z"),
        closeTime: Date.parse("2026-04-09T12:01:00.000Z"),
        open: 100,
        high: 101,
        low: 99,
        close: 100.5,
        volume: 10,
        tradeCount: 2
      }],
      assetCtx: { coin: "BTC", capturedAt: 1, markPrice: 100.5 }
    });

    runtimeAny.handleMarketSnapshot({
      source: "hyperliquid",
      coin: "BTC",
      connected: true,
      bestBid: undefined,
      bestAsk: undefined,
      markPrice: undefined,
      book: { bids: [], asks: [], updatedAt: 2 },
      trades: [{ id: "trade-1", coin: "BTC", side: "buy", price: 100.5, size: 1, time: 1 }],
      candles: [{
        id: "candle-2",
        coin: "BTC",
        interval: "1m",
        openTime: Date.parse("2026-04-09T12:01:00.000Z"),
        closeTime: Date.parse("2026-04-09T12:02:00.000Z"),
        open: 100.5,
        high: 102,
        low: 100,
        close: 101,
        volume: 8,
        tradeCount: 2
      }],
      assetCtx: undefined
    });

    expect(runtime.getMarketData()).toMatchObject({
      bestBid: 100,
      bestAsk: 101,
      markPrice: 100.5,
      book: {
        bids: [{ price: 100, size: 1, orders: 1 }],
        asks: [{ price: 101, size: 1, orders: 1 }]
      }
    });
    expect(runtime.getMarketData().candles.map((entry) => entry.id)).toEqual(["candle-1", "candle-2"]);

    await runtimeAny.flushClosedMinuteCandles();
    expect(repository.persistClosedMinuteCandles).toHaveBeenCalledOnce();
    expect(runtimeAny.lastFlushedClosedCandleOpenTime).toBe(Date.parse("2026-04-09T12:01:00.000Z"));

    runtimeAny.marketData = {
      source: "simulator",
      coin: "BTC",
      connected: false,
      book: { bids: [], asks: [] },
      trades: [],
      candles: []
    };
    await runtimeAny.flushClosedMinuteCandles();
    expect(repository.persistClosedMinuteCandles).toHaveBeenCalledTimes(1);

    runtimeAny.handleMarketSnapshot({
      source: "simulator",
      coin: "BTC",
      connected: false,
      book: { bids: [], asks: [] },
      trades: [],
      candles: []
    });
    expect(runtime.getMarketData().source).toBe("simulator");

    await runtime.shutdown();
    expect(clientState.instances[0]?.close).toHaveBeenCalled();
  });
});
