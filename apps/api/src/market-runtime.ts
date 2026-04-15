import type { FastifyBaseLogger } from "fastify";
import type { MarketTick } from "@stratium/shared";
import type { MarketDataAdapter, MarketSnapshot } from "./market-data.js";
import { createMarketDataAdapter } from "./market-adapters.js";
import { TradingRepository } from "./repository.js";

export interface SymbolConfigState {
  source?: string;
  marketSymbol?: string;
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

const DEFAULT_MARKET_FLUSH_INTERVAL_MS = Number(process.env.MARKET_PERSIST_INTERVAL_MS ?? 60_000);
const DEFAULT_LIVE_TRADE_LIMIT = Number(process.env.MARKET_LIVE_TRADE_LIMIT ?? 200);
const MARKET_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LIVE_CANDLE_LIMIT = Number(process.env.MARKET_LIVE_CANDLE_LIMIT ?? 1_440);

export const filterRecentCandles = <T extends { openTime: number }>(candles: T[], now = Date.now()): T[] =>
  candles.filter((candle) => candle.openTime >= now - MARKET_WINDOW_MS);

const resolveIntervalMs = (interval: string): number => {
  const matched = interval.match(/^(\d+)([mh])$/i);

  if (!matched) {
    return 60_000;
  }

  const amount = Number(matched[1]);
  const unit = matched[2]?.toLowerCase();

  if (!Number.isFinite(amount) || amount <= 0) {
    return 60_000;
  }

  return unit === "h" ? amount * 60 * 60 * 1000 : amount * 60 * 1000;
};

interface MarketRuntimeOptions {
  logger: FastifyBaseLogger;
  repository: TradingRepository;
  hyperliquidCoin?: string;
  hyperliquidCandleInterval?: string;
  configuredExchange?: string;
  configuredCoin?: string;
  configuredMarketSymbol?: string;
  marketCandleInterval?: string;
  configuredTradingSymbol: string;
  onLiveTick: (tick: MarketTick) => Promise<void>;
  onBroadcast: () => void;
}

export class MarketRuntime {
  private marketFlushTimer: NodeJS.Timeout | undefined;

  private marketData: MarketSnapshot = {
    source: "hyperliquid",
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

  private marketAdapter: MarketDataAdapter;
  private activeExchange: string;
  private activeCoin: string;
  private activeMarketSymbol: string;
  private readonly activeCandleInterval: string;

  constructor(private readonly options: MarketRuntimeOptions) {
    void options.configuredTradingSymbol;
    this.activeExchange = options.configuredExchange ?? "hyperliquid";
    this.activeCoin = options.configuredCoin ?? options.hyperliquidCoin ?? "BTC";
    this.activeMarketSymbol = options.configuredMarketSymbol ?? options.configuredTradingSymbol ?? this.activeCoin;
    this.activeCandleInterval = options.marketCandleInterval ?? options.hyperliquidCandleInterval ?? "1m";
    this.marketAdapter = this.createMarketAdapter(this.activeExchange, this.activeCoin, this.activeMarketSymbol);
  }

  getMarketData() {
    return this.marketData;
  }

  getActiveExchange() {
    return this.activeExchange;
  }

  getActiveCoin() {
    return this.activeCoin;
  }

  getHyperliquidCoin() {
    return this.getActiveCoin();
  }

  getActiveCandleInterval() {
    return this.activeCandleInterval;
  }

  getHyperliquidCandleInterval() {
    return this.getActiveCandleInterval();
  }

  configureActiveMarket(input: {
    exchange: string;
    symbol: string;
    coin: string;
    marketSymbol?: string;
  }) {
    void input.symbol;
    this.marketAdapter.close();
    this.activeExchange = input.exchange;
    this.activeCoin = input.coin;
    this.activeMarketSymbol = input.marketSymbol ?? input.symbol;
    this.marketData = {
      source: input.exchange,
      coin: input.coin,
      connected: false,
      book: {
        bids: [],
        asks: []
      },
      trades: [],
      candles: []
    };
    this.lastFlushedClosedCandleOpenTime = 0;
    this.marketAdapter = this.createMarketAdapter(this.activeExchange, this.activeCoin, this.activeMarketSymbol);
  }

  isMarketTickInFlight() {
    return this.marketTickInFlight;
  }

  setMarketTickInFlight(value: boolean) {
    this.marketTickInFlight = value;
  }

  setBootstrapState(symbol: string, latestPrice: number | undefined, marketData: MarketSnapshot | null) {
    void symbol;
    void latestPrice;

    if (!marketData) {
      return;
    }

    const filteredMarketData = {
      ...marketData,
      candles: filterRecentCandles(marketData.candles)
    };
    this.marketData = filteredMarketData;
    this.lastFlushedClosedCandleOpenTime = filteredMarketData.candles
      .filter((candle) => candle.interval === this.activeCandleInterval && candle.closeTime <= Date.now())
      .reduce((maxOpenTime, candle) => Math.max(maxOpenTime, candle.openTime), 0);
  }

  maybeStartConfiguredSource() {
    this.startMarketFlushTimer();
    this.marketAdapter.connect();
  }

  async shutdown(): Promise<void> {
    this.stopMarketFlushTimer();
    await this.flushClosedMinuteCandles();
    this.marketAdapter.close();
  }

  async getMarketHistory(limit: number) {
    const persistedMarketSnapshot = await this.options.repository.loadRecentMarketSnapshot(
      this.activeCoin,
      this.activeCandleInterval,
      this.activeExchange
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
      interval: this.activeCandleInterval,
      candles,
      trades,
      book: sourceMarket.book,
      assetCtx: sourceMarket.assetCtx
    };
  }

  async getMarketVolume(limit: number, interval: string, coin: string) {
    const records = await this.options.repository.loadRecentVolumeRecords(coin, interval, limit, this.activeExchange);

    return {
      coin,
      interval,
      records
    };
  }

  async ingestManualTick(tick: MarketTick): Promise<void> {
    const tickTime = Date.parse(tick.tickTime);
    const capturedAt = Number.isFinite(tickTime) ? tickTime : Date.now();
    const intervalMs = resolveIntervalMs(this.activeCandleInterval);
    const openTime = Math.floor(capturedAt / intervalMs) * intervalMs;
    const closeTime = openTime + intervalMs;
    const candleId = `${this.activeExchange}-${this.activeCoin}-${this.activeCandleInterval}-${openTime}`;
    const existingCandle = this.marketData.candles.find((entry) => entry.id === candleId);
    const nextCandle = existingCandle
      ? {
        ...existingCandle,
        high: Math.max(existingCandle.high, tick.last),
        low: Math.min(existingCandle.low, tick.last),
        close: tick.last,
        tradeCount: existingCandle.tradeCount + 1
      }
      : {
        id: candleId,
        coin: this.activeCoin,
        interval: this.activeCandleInterval,
        openTime,
        closeTime,
        open: tick.last,
        high: tick.last,
        low: tick.last,
        close: tick.last,
        volume: 0,
        tradeCount: 1
      };

    const mergedCandles = filterRecentCandles(
      [
        ...this.marketData.candles.filter((entry) => entry.id !== candleId),
        nextCandle
      ].sort((left, right) => left.openTime - right.openTime)
    ).slice(-DEFAULT_LIVE_CANDLE_LIMIT);

    this.marketData = {
      ...this.marketData,
      source: this.activeExchange,
      coin: this.activeCoin,
      bestBid: tick.bid,
      bestAsk: tick.ask,
      markPrice: tick.last,
      book: {
        bids: [{ price: tick.bid, size: 0, orders: 1 }],
        asks: [{ price: tick.ask, size: 0, orders: 1 }],
        updatedAt: capturedAt
      },
      candles: mergedCandles,
      assetCtx: {
        ...this.marketData.assetCtx,
        coin: this.activeCoin,
        markPrice: tick.last,
        midPrice: Number(((tick.bid + tick.ask) / 2).toFixed(2)),
        oraclePrice: tick.last,
        capturedAt
      }
    };

    try {
      await this.options.repository.persistMinuteCandles([nextCandle], this.marketData.source);
    } catch (error: unknown) {
      this.options.logger.error({ error }, "Failed to persist manual market candle");
    }

    this.options.onBroadcast();
  }

  private handleMarketSnapshot(snapshot: MarketSnapshot): void {
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
      source: snapshot.source,
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
    const now = Date.now();
    const candlesToPersist = this.marketData.candles.filter((candle) =>
      candle.interval === this.activeCandleInterval
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
        this.options.logger.error({ error }, `Failed to persist closed ${this.marketData.source} candles`);
      });
  }

  private createMarketAdapter(source: string, coin: string, marketSymbol: string): MarketDataAdapter {
    return createMarketDataAdapter({
      source: source || "hyperliquid",
      coin: coin || "BTC",
      marketSymbol: marketSymbol || coin || "BTC",
      candleInterval: this.activeCandleInterval,
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
}
