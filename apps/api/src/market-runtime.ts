import type { FastifyBaseLogger } from "fastify";
import type { MarketTick } from "@stratium/shared";
import type { HyperliquidMarketSnapshot } from "./hyperliquid-market";
import { HyperliquidMarketClient } from "./hyperliquid-market";
import { TradingRepository } from "./repository";

export interface MarketSimulatorState {
  enabled: boolean;
  symbol: string;
  intervalMs: number;
  driftBps: number;
  volatilityBps: number;
  anchorPrice: number;
  lastPrice: number;
  tickCount: number;
  lastGeneratedAt?: string;
}

export interface SymbolConfigState {
  symbol: string;
  coin: string;
  leverage: number;
  maxLeverage: number;
  szDecimals: number;
  quoteAsset: string;
}

export interface SocketLike {
  send(message: string): void;
  on?(event: "close", listener: () => void): void;
}

const mergeByKey = <T,>(items: T[], keyOf: (item: T) => string): T[] => {
  const map = new Map<string, T>();

  for (const item of items) {
    map.set(keyOf(item), item);
  }

  return [...map.values()];
};

const DEFAULT_MARKET_SIMULATOR_STATE: MarketSimulatorState = {
  enabled: false,
  symbol: "BTC-USD",
  intervalMs: Number(process.env.MARKET_SIMULATOR_INTERVAL_MS ?? 1200),
  driftBps: Number(process.env.MARKET_SIMULATOR_DRIFT_BPS ?? 0),
  volatilityBps: Number(process.env.MARKET_SIMULATOR_VOLATILITY_BPS ?? 22),
  anchorPrice: Number(process.env.MARKET_SIMULATOR_ANCHOR_PRICE ?? 69830),
  lastPrice: Number(process.env.MARKET_SIMULATOR_INITIAL_PRICE ?? 69830),
  tickCount: 0
};

const DEFAULT_MARKET_FLUSH_INTERVAL_MS = Number(process.env.MARKET_PERSIST_INTERVAL_MS ?? 60_000);
const DEFAULT_LIVE_TRADE_LIMIT = Number(process.env.MARKET_LIVE_TRADE_LIMIT ?? 200);
const MARKET_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LIVE_CANDLE_LIMIT = Number(process.env.MARKET_LIVE_CANDLE_LIMIT ?? 1_440);

export const filterRecentCandles = <T extends { openTime: number }>(candles: T[], now = Date.now()): T[] =>
  candles.filter((candle) => candle.openTime >= now - MARKET_WINDOW_MS);

const resolveBootstrapAnchorPrice = (symbol: string, latestPrice: number | undefined): number => {
  if (latestPrice && latestPrice > 0) {
    if (symbol === "BTC-USD" && latestPrice < 1000) {
      return DEFAULT_MARKET_SIMULATOR_STATE.anchorPrice;
    }

    return latestPrice;
  }

  return DEFAULT_MARKET_SIMULATOR_STATE.anchorPrice;
};

const nextVolatilityTag = (moveRatio: number): string => {
  if (moveRatio >= 0.0035) {
    return "spike";
  }

  if (moveRatio >= 0.0015) {
    return "high";
  }

  if (moveRatio >= 0.0006) {
    return "normal";
  }

  return "calm";
};

interface MarketRuntimeOptions {
  logger: FastifyBaseLogger;
  repository: TradingRepository;
  marketSource: string;
  hyperliquidCoin: string;
  hyperliquidCandleInterval: string;
  configuredTradingSymbol: string;
  onLiveTick: (tick: MarketTick) => Promise<void>;
  onBroadcast: () => void;
}

export class MarketRuntime {
  private marketSimulatorState: MarketSimulatorState = { ...DEFAULT_MARKET_SIMULATOR_STATE };

  private marketSimulatorTimer: NodeJS.Timeout | undefined;

  private marketFlushTimer: NodeJS.Timeout | undefined;

  private marketSimulatorRunning = false;

  private marketData: HyperliquidMarketSnapshot = {
    source: "simulator",
    coin: "BTC",
    connected: false,
    book: {
      bids: [],
      asks: []
    },
    trades: [],
    candles: []
  };

  private marketTickInFlight = false;

  private lastFlushedClosedCandleOpenTime = 0;

  private readonly hyperliquidClient: HyperliquidMarketClient;

  constructor(private readonly options: MarketRuntimeOptions) {
    this.hyperliquidClient = new HyperliquidMarketClient({
      coin: options.hyperliquidCoin,
      candleInterval: options.hyperliquidCandleInterval,
      onTick: async (tick) => {
        if (this.marketTickInFlight) {
          return;
        }

        this.marketTickInFlight = true;

        try {
          await this.options.onLiveTick(tick);
        } finally {
          this.marketTickInFlight = false;
        }
      },
      onSnapshot: (snapshot) => {
        this.handleMarketSnapshot(snapshot);
      }
    });
  }

  getMarketData() {
    return this.marketData;
  }

  getMarketSimulatorState() {
    return this.marketSimulatorState;
  }

  getHyperliquidCoin() {
    return this.options.hyperliquidCoin;
  }

  getHyperliquidCandleInterval() {
    return this.options.hyperliquidCandleInterval;
  }

  isMarketTickInFlight() {
    return this.marketTickInFlight;
  }

  setMarketTickInFlight(value: boolean) {
    this.marketTickInFlight = value;
  }

  setBootstrapState(symbol: string, latestPrice: number | undefined, marketData: HyperliquidMarketSnapshot | null) {
    if (marketData) {
      const filteredMarketData = {
        ...marketData,
        candles: filterRecentCandles(marketData.candles)
      };
      this.marketData = filteredMarketData;
      this.lastFlushedClosedCandleOpenTime = filteredMarketData.candles
        .filter((candle) => candle.interval === this.options.hyperliquidCandleInterval && candle.closeTime <= Date.now())
        .reduce((maxOpenTime, candle) => Math.max(maxOpenTime, candle.openTime), 0);
    }

    const bootPrice = resolveBootstrapAnchorPrice(symbol, latestPrice);

    this.marketSimulatorState = {
      ...this.marketSimulatorState,
      symbol,
      anchorPrice: bootPrice,
      lastPrice: bootPrice
    };
  }

  maybeStartConfiguredSource() {
    if ((process.env.ENABLE_MARKET_SIMULATOR ?? "true") !== "true") {
      return;
    }

    if (this.options.marketSource === "hyperliquid") {
      this.startMarketFlushTimer();
      this.hyperliquidClient.connect();
    } else {
      this.startMarketSimulator();
    }
  }

  async shutdown(): Promise<void> {
    this.stopMarketSimulator();
    this.stopMarketFlushTimer();
    await this.flushClosedMinuteCandles();
    this.hyperliquidClient.close();
  }

  async getMarketHistory(limit: number) {
    const persistedMarketSnapshot = await this.options.repository.loadRecentMarketSnapshot(
      this.options.hyperliquidCoin,
      this.options.hyperliquidCandleInterval
    );
    const now = Date.now();
    const sourceMarket = persistedMarketSnapshot
      ? {
        ...persistedMarketSnapshot,
        connected: this.marketData.connected,
        bestBid: this.marketData.bestBid ?? persistedMarketSnapshot.bestBid,
        bestAsk: this.marketData.bestAsk ?? persistedMarketSnapshot.bestAsk,
        markPrice: this.marketData.markPrice ?? persistedMarketSnapshot.markPrice,
        book: this.marketData.book.bids.length > 0 || this.marketData.book.asks.length > 0
          ? this.marketData.book
          : persistedMarketSnapshot.book,
        assetCtx: this.marketData.assetCtx ?? persistedMarketSnapshot.assetCtx,
        trades: mergeByKey(
          [...this.marketData.trades, ...persistedMarketSnapshot.trades],
          (trade) => trade.id
        ).sort((left, right) => right.time - left.time),
        candles: filterRecentCandles(mergeByKey(
          [...persistedMarketSnapshot.candles, ...this.marketData.candles],
          (candle) => candle.id
        ).sort((left, right) => left.openTime - right.openTime), now)
      }
      : this.marketData;
    const candles = sourceMarket.candles.slice(-Math.max(10, Math.min(limit, 500)));
    const trades = sourceMarket.trades.slice(0, Math.max(10, Math.min(limit, 200)));

    return {
      coin: sourceMarket.coin,
      interval: this.options.hyperliquidCandleInterval,
      candles,
      trades,
      book: sourceMarket.book,
      assetCtx: sourceMarket.assetCtx
    };
  }

  async getMarketVolume(limit: number, interval: string, coin: string) {
    const records = await this.options.repository.loadRecentVolumeRecords(coin, interval, limit);

    return {
      coin,
      interval,
      records
    };
  }

  startMarketSimulator(
    payload: Partial<Pick<MarketSimulatorState, "intervalMs" | "driftBps" | "volatilityBps" | "anchorPrice">> = {},
    latestTick?: MarketTick | null
  ): MarketSimulatorState {
    this.marketSimulatorState = {
      ...this.marketSimulatorState,
      intervalMs: payload.intervalMs && payload.intervalMs > 100 ? payload.intervalMs : this.marketSimulatorState.intervalMs,
      driftBps: Number.isFinite(payload.driftBps) ? payload.driftBps as number : this.marketSimulatorState.driftBps,
      volatilityBps: Number.isFinite(payload.volatilityBps) ? payload.volatilityBps as number : this.marketSimulatorState.volatilityBps,
      anchorPrice: payload.anchorPrice && payload.anchorPrice > 0 ? payload.anchorPrice : this.marketSimulatorState.anchorPrice
    };

    if (this.marketSimulatorTimer) {
      clearInterval(this.marketSimulatorTimer);
    }

    this.marketSimulatorState = {
      ...this.marketSimulatorState,
      enabled: true,
      lastPrice: resolveBootstrapAnchorPrice(
        this.marketSimulatorState.symbol,
        latestTick?.last ?? this.marketSimulatorState.lastPrice
      )
    };

    this.marketSimulatorTimer = setInterval(() => {
      void this.runMarketSimulationTick(latestTick ?? undefined);
    }, this.marketSimulatorState.intervalMs);

    void this.runMarketSimulationTick(latestTick ?? undefined);
    this.options.onBroadcast();

    return this.marketSimulatorState;
  }

  stopMarketSimulator(): MarketSimulatorState {
    if (this.marketSimulatorTimer) {
      clearInterval(this.marketSimulatorTimer);
      this.marketSimulatorTimer = undefined;
    }

    this.marketSimulatorState = {
      ...this.marketSimulatorState,
      enabled: false
    };

    this.options.onBroadcast();

    return this.marketSimulatorState;
  }

  async runMarketSimulationTick(latestTick?: MarketTick): Promise<void> {
    if (this.marketSimulatorRunning) {
      return;
    }

    this.marketSimulatorRunning = true;

    try {
      const tick = this.buildSyntheticTick(latestTick);
      await this.options.onLiveTick(tick);
    } finally {
      this.marketSimulatorRunning = false;
    }
  }

  setMarketSimulatorRunning(value: boolean) {
    this.marketSimulatorRunning = value;
  }

  private handleMarketSnapshot(snapshot: HyperliquidMarketSnapshot): void {
    if (snapshot.source === "hyperliquid") {
      const now = Date.now();
      const mergedTrades = mergeByKey(
        [...snapshot.trades, ...this.marketData.trades],
        (trade) => trade.id
      )
        .sort((left, right) => right.time - left.time)
        .slice(0, DEFAULT_LIVE_TRADE_LIMIT);
      const mergedCandles = filterRecentCandles(mergeByKey(
        [...this.marketData.candles, ...snapshot.candles],
        (candle) => candle.id
      )
        .sort((left, right) => left.openTime - right.openTime), now)
        .slice(-DEFAULT_LIVE_CANDLE_LIMIT);

      this.marketData = {
        source: "hyperliquid",
        coin: snapshot.coin,
        connected: snapshot.connected,
        bestBid: snapshot.bestBid ?? this.marketData.bestBid,
        bestAsk: snapshot.bestAsk ?? this.marketData.bestAsk,
        markPrice: snapshot.markPrice ?? this.marketData.markPrice,
        book: snapshot.book.bids.length > 0 || snapshot.book.asks.length > 0
          ? snapshot.book
          : this.marketData.book,
        trades: mergedTrades,
        candles: mergedCandles,
        assetCtx: snapshot.assetCtx ?? this.marketData.assetCtx
      };
    } else {
      this.marketData = snapshot;
    }

    this.options.onBroadcast();
  }

  private startMarketFlushTimer(): void {
    if (this.marketFlushTimer) {
      clearInterval(this.marketFlushTimer);
    }

    this.marketFlushTimer = setInterval(() => {
      void this.flushClosedMinuteCandles();
    }, DEFAULT_MARKET_FLUSH_INTERVAL_MS);
  }

  private stopMarketFlushTimer(): void {
    if (this.marketFlushTimer) {
      clearInterval(this.marketFlushTimer);
      this.marketFlushTimer = undefined;
    }
  }

  private async flushClosedMinuteCandles(): Promise<void> {
    if (this.marketData.source !== "hyperliquid") {
      return;
    }

    const now = Date.now();
    const candlesToPersist = this.marketData.candles.filter((candle) =>
      candle.interval === this.options.hyperliquidCandleInterval
      && candle.closeTime <= now
      && candle.openTime > this.lastFlushedClosedCandleOpenTime
    );

    if (candlesToPersist.length === 0) {
      return;
    }

    await this.options.repository.persistClosedMinuteCandles(candlesToPersist, this.marketData.source)
      .then(() => {
        this.lastFlushedClosedCandleOpenTime = candlesToPersist.reduce(
          (maxOpenTime, candle) => Math.max(maxOpenTime, candle.openTime),
          this.lastFlushedClosedCandleOpenTime
        );
      })
      .catch((error: unknown) => {
        this.options.logger.error({ error }, "Failed to persist closed Hyperliquid candles");
      });
  }

  private buildSyntheticTick(latestTick?: MarketTick): MarketTick {
    const basePrice = resolveBootstrapAnchorPrice(
      this.marketSimulatorState.symbol,
      latestTick?.last ?? this.marketSimulatorState.lastPrice
    );
    const driftRatio = this.marketSimulatorState.driftBps / 10000;
    const volatilityRatio = this.marketSimulatorState.volatilityBps / 10000;
    const meanReversionRatio = (this.marketSimulatorState.anchorPrice - basePrice) / this.marketSimulatorState.anchorPrice * 0.08;
    const randomShock = (Math.random() - 0.5) * 2 * volatilityRatio;
    const rawNextLast = basePrice * (1 + driftRatio + meanReversionRatio + randomShock);
    const nextLast = Number(Math.max(rawNextLast, 1).toFixed(2));
    const spreadRatio = Math.max(volatilityRatio * 0.28, 0.00012);
    const nextSpread = Number(Math.max(nextLast * spreadRatio * (0.65 + Math.random() * 0.9), 0.5).toFixed(2));
    const bid = Number((nextLast - nextSpread / 2).toFixed(2));
    const ask = Number((nextLast + nextSpread / 2).toFixed(2));
    const tickTime = new Date().toISOString();

    this.marketSimulatorState = {
      ...this.marketSimulatorState,
      lastPrice: nextLast,
      tickCount: this.marketSimulatorState.tickCount + 1,
      lastGeneratedAt: tickTime
    };

    this.marketData = {
      source: "simulator",
      coin: this.options.hyperliquidCoin,
      connected: false,
      bestBid: bid,
      bestAsk: ask,
      markPrice: nextLast,
      book: {
        bids: [],
        asks: [],
        updatedAt: Date.now()
      },
      trades: [],
      candles: []
    };

    return {
      symbol: this.marketSimulatorState.symbol,
      bid,
      ask,
      last: nextLast,
      spread: Number((ask - bid).toFixed(2)),
      tickTime,
      volatilityTag: nextVolatilityTag(Math.abs(nextLast - basePrice) / basePrice)
    };
  }
}
