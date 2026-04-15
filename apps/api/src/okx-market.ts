import type { MarketTick } from "@stratium/shared";
import type { MarketAssetContext, MarketCandle, MarketDataAdapter, MarketDataAdapterConfig, MarketSnapshot, MarketTrade } from "./market-data.js";

interface OkxWsEnvelope {
  event?: string;
  action?: string;
  arg?: {
    channel?: string;
    instId?: string;
  };
  data?: unknown[];
}

interface OkxBookRow {
  bids?: string[][];
  asks?: string[][];
  ts?: string;
}

interface OkxTradeRow {
  instId?: string;
  side?: string;
  px?: string;
  sz?: string;
  ts?: string;
  tradeId?: string;
}

type OkxCandleRow = string[];

interface OkxMarkPriceRow {
  instId?: string;
  markPx?: string;
  ts?: string;
}

interface OkxTickerRow {
  instId?: string;
  last?: string;
  bidPx?: string;
  askPx?: string;
  open24h?: string;
  high24h?: string;
  low24h?: string;
  vol24h?: string;
  volCcy24h?: string;
  ts?: string;
}

interface OkxIndexTickerRow {
  instId?: string;
  idxPx?: string;
  open24h?: string;
  high24h?: string;
  low24h?: string;
  ts?: string;
}

interface OkxFundingRateResponseRow {
  instId?: string;
  fundingRate?: string;
}

interface OkxOpenInterestResponseRow {
  instId?: string;
  oi?: string;
}

interface OkxRestEnvelope<T> {
  code?: string;
  msg?: string;
  data?: T[];
}

const OKX_PUBLIC_WS_URL = "wss://ws.okx.com:8443/ws/v5/public";
const OKX_API_BASE_URL = "https://www.okx.com";
const DEFAULT_TRADE_LIMIT = 80;
const DEFAULT_CANDLE_LIMIT = 500;
const DEFAULT_BOOK_LEVEL_LIMIT = 40;
const DEFAULT_SUPPLEMENTAL_REFRESH_MS = 10_000;

const toFixedNumber = (value: number, digits = 2): number => Number(value.toFixed(digits));

const parseTimestamp = (value: string | undefined, fallback = Date.now()): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseFiniteNumber = (value: string | undefined): number | undefined => {
  if (value == null) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const parseRequiredNumber = (value: string | undefined): number => Number(value ?? 0);

const normalizeBookLevels = (
  levels: string[][],
  side: "bid" | "ask"
): MarketSnapshot["book"]["bids"] => levels
  .map((level) => ({
    price: parseRequiredNumber(level[0]),
    size: parseRequiredNumber(level[1]),
    orders: Number(level[3] ?? 1)
  }))
  .filter((level) => Number.isFinite(level.price) && Number.isFinite(level.size) && level.price > 0 && level.size > 0)
  .sort((left, right) => side === "bid" ? right.price - left.price : left.price - right.price)
  .slice(0, DEFAULT_BOOK_LEVEL_LIMIT);

const mergeBookLevels = (
  currentLevels: MarketSnapshot["book"]["bids"],
  updates: string[][],
  side: "bid" | "ask"
): MarketSnapshot["book"]["bids"] => {
  const byPrice = new Map<number, { price: number; size: number; orders: number }>();

  for (const level of currentLevels) {
    byPrice.set(level.price, level);
  }

  for (const update of updates) {
    const price = parseRequiredNumber(update[0]);
    const size = parseRequiredNumber(update[1]);
    const orders = Number(update[3] ?? 1);

    if (!Number.isFinite(price) || price <= 0) {
      continue;
    }

    if (!Number.isFinite(size) || size <= 0) {
      byPrice.delete(price);
      continue;
    }

    byPrice.set(price, {
      price,
      size,
      orders
    });
  }

  return [...byPrice.values()]
    .sort((left, right) => side === "bid" ? right.price - left.price : left.price - right.price)
    .slice(0, DEFAULT_BOOK_LEVEL_LIMIT);
};

const mergeAssetCtx = (
  current: MarketAssetContext | undefined,
  coin: string,
  next: Partial<MarketAssetContext> & { capturedAt?: number }
): MarketAssetContext => ({
  ...(current ?? { coin, capturedAt: Date.now() }),
  coin,
  ...next,
  capturedAt: next.capturedAt ?? current?.capturedAt ?? Date.now()
});

export class OkxMarketClient implements MarketDataAdapter {
  private readonly coin: string;

  private readonly marketSymbol: string;

  private readonly candleInterval: string;

  private readonly onTick: (tick: MarketTick) => Promise<void> | void;

  private readonly onSnapshot: (snapshot: MarketSnapshot) => void;

  private socket?: WebSocket;

  private reconnectTimer?: NodeJS.Timeout;

  private supplementalRefreshTimer?: NodeJS.Timeout;

  private connected = false;

  private shouldReconnect = true;

  private lastTradePrice?: number;

  private book: MarketSnapshot["book"] = {
    bids: [],
    asks: []
  };

  private trades: MarketTrade[] = [];

  private candles: MarketCandle[] = [];

  private assetCtx?: MarketAssetContext;

  constructor(config: MarketDataAdapterConfig) {
    this.coin = config.coin;
    this.marketSymbol = config.marketSymbol;
    this.candleInterval = config.candleInterval ?? "1m";
    this.onTick = config.onTick;
    this.onSnapshot = config.onSnapshot;
  }

  connect(): void {
    this.shouldReconnect = true;
    this.cleanupSocket();

    this.socket = new WebSocket(OKX_PUBLIC_WS_URL);
    this.socket.addEventListener("open", () => {
      this.connected = true;
      this.subscribeAll();
      void this.refreshSupplementalData();
      this.startSupplementalRefreshTimer();
      this.pushSnapshot();
    });
    this.socket.addEventListener("message", (event) => {
      this.handleMessage(String(event.data));
    });
    this.socket.addEventListener("close", () => {
      this.connected = false;
      this.pushSnapshot();
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    });
    this.socket.addEventListener("error", () => {
      this.connected = false;
      this.pushSnapshot();
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    });
  }

  close(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.supplementalRefreshTimer) {
      clearInterval(this.supplementalRefreshTimer);
      this.supplementalRefreshTimer = undefined;
    }

    this.cleanupSocket();
    this.connected = false;
    this.pushSnapshot();
  }

  getSnapshot(): MarketSnapshot {
    const bestBid = this.book.bids[0]?.price;
    const bestAsk = this.book.asks[0]?.price;

    return {
      source: "okx",
      coin: this.coin,
      connected: this.connected,
      bestBid,
      bestAsk,
      markPrice: this.assetCtx?.markPrice ?? this.lastTradePrice ?? (bestBid && bestAsk ? toFixedNumber((bestBid + bestAsk) / 2) : undefined),
      book: this.book,
      trades: this.trades,
      candles: this.candles,
      assetCtx: this.assetCtx
    };
  }

  private subscribeAll(): void {
    const candleChannel = this.toOkxCandleChannel(this.candleInterval);
    this.socket?.send(JSON.stringify({
      op: "subscribe",
      args: [
        { channel: "books", instId: this.marketSymbol },
        { channel: "tickers", instId: this.marketSymbol },
        { channel: "trades", instId: this.marketSymbol },
        { channel: candleChannel, instId: this.marketSymbol },
        { channel: "index-tickers", instId: this.resolveIndexSymbol() },
        { channel: "mark-price", instId: this.marketSymbol }
      ]
    }));
  }

  private toOkxCandleChannel(interval: string): string {
    const normalized = interval.trim().toLowerCase();
    if (normalized === "1m") {
      return "candle1m";
    }
    if (normalized === "5m") {
      return "candle5m";
    }
    if (normalized === "15m") {
      return "candle15m";
    }
    if (normalized === "1h") {
      return "candle1H";
    }

    return "candle1m";
  }

  private handleMessage(raw: string): void {
    const message = JSON.parse(raw) as OkxWsEnvelope;
    const channel = message.arg?.channel;
    const data = Array.isArray(message.data) ? message.data : [];

    if (!channel || data.length === 0) {
      return;
    }

    if (channel.startsWith("books")) {
      this.handleBooks(data as OkxBookRow[], message.action);
      return;
    }

    if (channel === "tickers") {
      this.handleTickers(data as OkxTickerRow[]);
      return;
    }

    if (channel === "trades") {
      this.handleTrades(data as OkxTradeRow[]);
      return;
    }

    if (channel.startsWith("candle")) {
      this.handleCandles(data as OkxCandleRow[]);
      return;
    }

    if (channel === "mark-price") {
      this.handleMarkPrice(data as OkxMarkPriceRow[]);
      return;
    }

    if (channel === "index-tickers") {
      this.handleIndexTickers(data as OkxIndexTickerRow[]);
    }
  }

  private handleBooks(data: OkxBookRow[], action?: string): void {
    const row = data[0];
    if (!row) {
      return;
    }

    const isSnapshot = action == null || action === "snapshot";
    this.book = {
      bids: isSnapshot
        ? normalizeBookLevels(row.bids ?? [], "bid")
        : mergeBookLevels(this.book.bids, row.bids ?? [], "bid"),
      asks: isSnapshot
        ? normalizeBookLevels(row.asks ?? [], "ask")
        : mergeBookLevels(this.book.asks, row.asks ?? [], "ask"),
      updatedAt: parseTimestamp(row.ts)
    };

    const bestBid = this.book.bids[0]?.price;
    const bestAsk = this.book.asks[0]?.price;

    if (!bestBid || !bestAsk) {
      this.pushSnapshot();
      return;
    }

    const mid = toFixedNumber((bestBid + bestAsk) / 2);
    this.assetCtx = mergeAssetCtx(this.assetCtx, this.coin, {
      midPrice: mid,
      capturedAt: this.book.updatedAt
    });
    const tick: MarketTick = {
      symbol: `${this.coin}-USD`,
      bid: toFixedNumber(bestBid),
      ask: toFixedNumber(bestAsk),
      last: toFixedNumber(this.lastTradePrice ?? this.assetCtx?.markPrice ?? mid),
      spread: toFixedNumber(bestAsk - bestBid),
      tickTime: new Date(this.book.updatedAt ?? Date.now()).toISOString(),
      volatilityTag: "normal"
    };

    void this.onTick(tick);
    this.pushSnapshot();
  }

  private handleTickers(rows: OkxTickerRow[]): void {
    const row = rows.find((entry) => entry.instId === this.marketSymbol) ?? rows[0];

    if (!row) {
      return;
    }

    const ts = parseTimestamp(row.ts);
    const bid = parseFiniteNumber(row.bidPx);
    const ask = parseFiniteNumber(row.askPx);
    const midPrice = bid != null && ask != null ? toFixedNumber((bid + ask) / 2) : this.assetCtx?.midPrice;

    this.lastTradePrice = parseFiniteNumber(row.last) ?? this.lastTradePrice;
    this.assetCtx = mergeAssetCtx(this.assetCtx, this.coin, {
      midPrice,
      prevDayPrice: parseFiniteNumber(row.open24h),
      dayNotionalVolume: parseFiniteNumber(row.volCcy24h ?? row.vol24h),
      capturedAt: ts
    });

    this.pushSnapshot();
  }

  private handleTrades(data: OkxTradeRow[]): void {
    const parsed = data
      .filter((row) => row.instId === this.marketSymbol)
      .map((row) => ({
        id: `okx-${row.instId}-${row.tradeId ?? row.ts}`,
        coin: this.coin,
        side: row.side === "sell" ? "sell" as const : "buy" as const,
        price: Number(row.px ?? 0),
        size: Number(row.sz ?? 0),
        time: parseTimestamp(row.ts)
      }))
      .filter((trade) => Number.isFinite(trade.price) && Number.isFinite(trade.size) && trade.price > 0);

    if (parsed.length === 0) {
      return;
    }

    this.lastTradePrice = parsed[0]?.price ?? this.lastTradePrice;
    this.trades = [...parsed, ...this.trades]
      .reduce<MarketTrade[]>((accumulator, trade) => {
        if (accumulator.some((entry) => entry.id === trade.id)) {
          return accumulator;
        }

        accumulator.push(trade);
        return accumulator;
      }, [])
      .sort((left, right) => right.time - left.time)
      .slice(0, DEFAULT_TRADE_LIMIT);

    this.pushSnapshot();
  }

  private handleCandles(rows: OkxCandleRow[]): void {
    const parsed = rows
      .map((row) => {
        const openTime = parseTimestamp(row[0]);
        const closeTime = openTime + this.resolveIntervalMs(this.candleInterval);

        return {
          id: `okx-${this.marketSymbol}-${this.candleInterval}-${openTime}`,
          coin: this.coin,
          interval: this.candleInterval,
          openTime,
          closeTime,
          open: Number(row[1] ?? 0),
          high: Number(row[2] ?? 0),
          low: Number(row[3] ?? 0),
          close: Number(row[4] ?? 0),
          volume: Number(row[5] ?? 0),
          tradeCount: Number(row[8] ?? 0)
        };
      })
      .filter((candle) => Number.isFinite(candle.open) && Number.isFinite(candle.close));

    if (parsed.length === 0) {
      return;
    }

    this.candles = [...parsed, ...this.candles]
      .reduce<MarketCandle[]>((accumulator, candle) => {
        if (accumulator.some((entry) => entry.id === candle.id)) {
          return accumulator;
        }

        accumulator.push(candle);
        return accumulator;
      }, [])
      .sort((left, right) => left.openTime - right.openTime)
      .slice(-DEFAULT_CANDLE_LIMIT);

    this.pushSnapshot();
  }

  private handleMarkPrice(rows: OkxMarkPriceRow[]): void {
    const row = rows.find((entry) => entry.instId === this.marketSymbol) ?? rows[0];

    if (!row) {
      return;
    }

    this.assetCtx = mergeAssetCtx(this.assetCtx, this.coin, {
      markPrice: row.markPx != null ? Number(row.markPx) : this.assetCtx?.markPrice,
      capturedAt: parseTimestamp(row.ts)
    });

    this.pushSnapshot();
  }

  private handleIndexTickers(rows: OkxIndexTickerRow[]): void {
    const row = rows.find((entry) => entry.instId === this.resolveIndexSymbol()) ?? rows[0];

    if (!row) {
      return;
    }

    this.assetCtx = mergeAssetCtx(this.assetCtx, this.coin, {
      oraclePrice: parseFiniteNumber(row.idxPx) ?? this.assetCtx?.oraclePrice,
      capturedAt: parseTimestamp(row.ts)
    });

    this.pushSnapshot();
  }

  private resolveIntervalMs(interval: string): number {
    const matched = interval.match(/^(\d+)([mh])$/i);

    if (!matched) {
      return 60_000;
    }

    const amount = Number(matched[1]);
    if (!Number.isFinite(amount) || amount <= 0) {
      return 60_000;
    }

    return matched[2]?.toLowerCase() === "h"
      ? amount * 60 * 60 * 1000
      : amount * 60 * 1000;
  }

  private pushSnapshot(): void {
    this.onSnapshot(this.getSnapshot());
  }

  private resolveIndexSymbol(): string {
    return this.marketSymbol.replace(/-SWAP$/i, "");
  }

  private startSupplementalRefreshTimer(): void {
    if (this.supplementalRefreshTimer) {
      return;
    }

    this.supplementalRefreshTimer = setInterval(() => {
      void this.refreshSupplementalData();
    }, DEFAULT_SUPPLEMENTAL_REFRESH_MS);
  }

  private async refreshSupplementalData(): Promise<void> {
    try {
      const [fundingRows, openInterestRows] = await Promise.all([
        this.fetchRestRows<OkxFundingRateResponseRow>("/api/v5/public/funding-rate", { instId: this.marketSymbol }),
        this.fetchRestRows<OkxOpenInterestResponseRow>("/api/v5/public/open-interest", { instId: this.marketSymbol })
      ]);

      const fundingRow = fundingRows.find((entry) => entry.instId === this.marketSymbol) ?? fundingRows[0];
      const openInterestRow = openInterestRows.find((entry) => entry.instId === this.marketSymbol) ?? openInterestRows[0];

      if (!fundingRow && !openInterestRow) {
        return;
      }

      this.assetCtx = mergeAssetCtx(this.assetCtx, this.coin, {
        fundingRate: parseFiniteNumber(fundingRow?.fundingRate) ?? this.assetCtx?.fundingRate,
        openInterest: parseFiniteNumber(openInterestRow?.oi) ?? this.assetCtx?.openInterest,
        capturedAt: Date.now()
      });
      this.pushSnapshot();
    } catch {
      // Keep the market feed running even if supplemental public endpoints fail.
    }
  }

  private async fetchRestRows<T>(pathname: string, params: Record<string, string>): Promise<T[]> {
    const url = new URL(pathname, OKX_API_BASE_URL);

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`OKX request failed: ${response.status} ${response.statusText}`);
    }

    const payload = await response.json() as OkxRestEnvelope<T>;

    if (payload.code && payload.code !== "0") {
      throw new Error(`OKX responded with code ${payload.code}: ${payload.msg ?? "unknown error"}`);
    }

    return Array.isArray(payload.data) ? payload.data : [];
  }

  private cleanupSocket(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = undefined;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, 3000);
  }
}
