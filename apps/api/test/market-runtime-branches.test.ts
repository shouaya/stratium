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
  const makeRuntime = () => {
    const repository = {
      loadRecentMarketSnapshot: vi.fn(),
      loadRecentVolumeRecords: vi.fn(),
      persistClosedMinuteCandles: vi.fn(async () => undefined)
    };
    const onLiveTick = vi.fn(async () => undefined);
    const onBroadcast = vi.fn();
    const logger = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
      trace: vi.fn(),
      child: vi.fn()
    };
    const runtime = new MarketRuntime({
      logger: logger as never,
      repository: repository as never,
      hyperliquidCoin: "BTC",
      hyperliquidCandleInterval: "1m",
      configuredTradingSymbol: "BTC-USD",
      onLiveTick,
      onBroadcast
    });

    return { runtime, repository, onBroadcast, logger };
  };

  beforeEach(() => {
    clientState.instances.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("connects the live source, reconfigures the active coin, and keeps null bootstrap state as-is", () => {
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const { runtime } = makeRuntime();

    runtime.setBootstrapState("BTC-USD", 70000, null);
    runtime.maybeStartConfiguredSource();
    runtime.maybeStartConfiguredSource();

    expect(clientState.instances[0]?.connect).toHaveBeenCalledTimes(2);
    expect(clearIntervalSpy).toHaveBeenCalled();

    runtime.configureActiveMarket("ETH-USD", "ETH");
    expect(clientState.instances[0]?.close).toHaveBeenCalledOnce();
    expect(runtime.getHyperliquidCoin()).toBe("ETH");
    expect(runtime.getMarketData()).toMatchObject({
      source: "hyperliquid",
      coin: "ETH",
      connected: false
    });
  });

  it("merges live snapshots, falls back to prior values, and persists only new closed candles", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-09T12:02:05.000Z"));
    const { runtime, repository, onBroadcast } = makeRuntime();
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

    expect(onBroadcast).toHaveBeenCalledTimes(2);
    expect(runtime.getMarketData()).toMatchObject({
      source: "hyperliquid",
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

    await runtimeAny.flushClosedMinuteCandles();
    expect(repository.persistClosedMinuteCandles).toHaveBeenCalledTimes(1);
  });

  it("loads persisted history, forwards volume queries, and flushes again during shutdown", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-09T12:02:05.000Z"));
    const { runtime, repository, logger } = makeRuntime();
    const runtimeAny = runtime as never;

    repository.loadRecentMarketSnapshot.mockResolvedValue({
      source: "hyperliquid",
      coin: "BTC",
      connected: false,
      bestBid: 90,
      bestAsk: 91,
      markPrice: 90.5,
      book: { bids: [{ price: 90, size: 2, orders: 2 }], asks: [{ price: 91, size: 2, orders: 1 }], updatedAt: 2 },
      trades: [{ id: "persisted-trade", coin: "BTC", side: "sell", price: 90.5, size: 2, time: 2 }],
      candles: [{
        id: "persisted-candle",
        coin: "BTC",
        interval: "1m",
        openTime: Date.parse("2026-04-09T12:01:00.000Z"),
        closeTime: Date.parse("2026-04-09T12:02:00.000Z"),
        open: 90,
        high: 92,
        low: 89,
        close: 90.5,
        volume: 20,
        tradeCount: 4
      }],
      assetCtx: { coin: "BTC", capturedAt: 2, markPrice: 90.5 }
    });
    repository.loadRecentVolumeRecords.mockResolvedValue([{ id: "vol-1" }]);
    repository.persistClosedMinuteCandles.mockRejectedValueOnce(new Error("persist failed"));

    runtimeAny.handleMarketSnapshot({
      source: "hyperliquid",
      coin: "BTC",
      connected: true,
      bestBid: 100,
      bestAsk: 101,
      markPrice: 100.5,
      book: { bids: [], asks: [], updatedAt: 1 },
      trades: [{ id: "live-trade", coin: "BTC", side: "buy", price: 100.5, size: 1, time: 3 }],
      candles: [{
        id: "live-candle",
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
      assetCtx: undefined
    });

    const history = await runtime.getMarketHistory(50);
    expect(history.trades.map((entry) => entry.id)).toEqual(["live-trade", "persisted-trade"]);
    expect(history.book.bids[0]?.price).toBe(90);
    expect((await runtime.getMarketVolume(10, "5m", "ETH")).records).toEqual([{ id: "vol-1" }]);

    await runtime.shutdown();
    expect(logger.error).toHaveBeenCalled();
    expect(clientState.instances[0]?.close).toHaveBeenCalled();
  });

  it("projects manual ticks into the live book and current candle", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-09T12:00:30.000Z"));
    const { runtime, onBroadcast } = makeRuntime();

    runtime.ingestManualTick({
      symbol: "BTC-USD",
      bid: 100,
      ask: 102,
      last: 101,
      spread: 2,
      tickTime: "2026-04-09T12:00:30.000Z",
      volatilityTag: "manual"
    });
    runtime.ingestManualTick({
      symbol: "BTC-USD",
      bid: 101,
      ask: 103,
      last: 102,
      spread: 2,
      tickTime: "2026-04-09T12:00:45.000Z",
      volatilityTag: "manual"
    });

    expect(onBroadcast).toHaveBeenCalledTimes(2);
    expect(runtime.getMarketData()).toMatchObject({
      bestBid: 101,
      bestAsk: 103,
      markPrice: 102,
      book: {
        bids: [{ price: 101, size: 0, orders: 1 }],
        asks: [{ price: 103, size: 0, orders: 1 }]
      }
    });
    expect(runtime.getMarketData().candles).toEqual([
      expect.objectContaining({
        openTime: Date.parse("2026-04-09T12:00:00.000Z"),
        closeTime: Date.parse("2026-04-09T12:01:00.000Z"),
        open: 101,
        high: 102,
        low: 101,
        close: 102,
        tradeCount: 2
      })
    ]);
  });
});
