import type { MarketTick } from "@stratium/shared";
import type {
  MarketAssetContext,
  MarketBookLevel,
  MarketCandle,
  MarketDataAdapter,
  MarketDataAdapterConfig,
  MarketSnapshot,
  MarketTrade
} from "./market-data.js";

export type HyperliquidBookLevel = MarketBookLevel;
export type HyperliquidTrade = MarketTrade;
export type HyperliquidCandle = MarketCandle;
export type HyperliquidAssetContext = MarketAssetContext;
export type HyperliquidMarketSnapshot = MarketSnapshot & { source: "hyperliquid" };

interface HyperliquidSubscriptionMessage {
  channel?: string;
  data?: unknown;
}

interface HyperliquidWsLevel {
  px: string;
  sz: string;
  n: number;
}

interface HyperliquidWsBook {
  coin: string;
  levels: [HyperliquidWsLevel[], HyperliquidWsLevel[]];
  time: number;
}

interface HyperliquidWsTrade {
  coin: string;
  side: string;
  px: string;
  sz: string;
  time: number;
  tid: number;
}

interface HyperliquidWsCandle {
  t: number;
  T: number;
  s: string;
  i: string;
  o: number | string;
  c: number | string;
  h: number | string;
  l: number | string;
  v: number | string;
  n: number;
}

interface HyperliquidWsActiveAssetCtx {
  coin: string;
  ctx: {
    dayNtlVlm?: number | string;
    prevDayPx?: number | string;
    markPx?: number | string;
    midPx?: number | string;
    oraclePx?: number | string;
    funding?: number | string;
    openInterest?: number | string;
  };
}

const isWsCandle = (value: unknown): value is HyperliquidWsCandle => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return "s" in value && "i" in value && "t" in value;
};

export interface HyperliquidMarketClientOptions extends Omit<MarketDataAdapterConfig, "source"> {
  coin: string;
  candleInterval?: string;
  wsUrl?: string;
}

const HYPERLIQUID_WS_URL = "wss://api.hyperliquid.xyz/ws";
const DEFAULT_CANDLE_INTERVAL = "1m";

const toLevel = (level: HyperliquidWsLevel): HyperliquidBookLevel => ({
  price: Number(level.px),
  size: Number(level.sz),
  orders: level.n
});

export class HyperliquidMarketClient implements MarketDataAdapter {
  private readonly coin: string;

  private readonly candleInterval: string;

  private readonly wsUrl: string;

  private readonly onTick: HyperliquidMarketClientOptions["onTick"];

  private readonly onSnapshot: HyperliquidMarketClientOptions["onSnapshot"];

  private socket?: WebSocket;

  private reconnectTimer?: NodeJS.Timeout;

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

  constructor(options: HyperliquidMarketClientOptions) {
    this.coin = options.coin;
    this.candleInterval = options.candleInterval ?? DEFAULT_CANDLE_INTERVAL;
    this.wsUrl = options.wsUrl ?? HYPERLIQUID_WS_URL;
    this.onTick = options.onTick;
    this.onSnapshot = options.onSnapshot;
  }

  connect() {
    this.shouldReconnect = true;
    this.cleanupSocket();

    this.socket = new WebSocket(this.wsUrl);
    this.socket.addEventListener("open", () => {
      this.connected = true;
      this.subscribe("l2Book");
      this.subscribe("trades");
      this.subscribe("candle");
      this.subscribe("activeAssetCtx");
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

  close() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    this.cleanupSocket();
    this.connected = false;
    this.pushSnapshot();
  }

  getSnapshot(): HyperliquidMarketSnapshot {
    const bestBid = this.book.bids[0]?.price;
    const bestAsk = this.book.asks[0]?.price;

    return {
      source: "hyperliquid",
      coin: this.coin,
      connected: this.connected,
      bestBid,
      bestAsk,
      markPrice: this.assetCtx?.markPrice ?? this.lastTradePrice ?? (bestBid && bestAsk ? Number(((bestBid + bestAsk) / 2).toFixed(2)) : undefined),
      book: this.book,
      trades: this.trades,
      candles: this.candles,
      assetCtx: this.assetCtx
    };
  }

  private subscribe(type: "l2Book" | "trades" | "candle" | "activeAssetCtx") {
    const subscription = type === "candle"
      ? { type, coin: this.coin, interval: this.candleInterval }
      : { type, coin: this.coin };

    this.socket?.send(JSON.stringify({
      method: "subscribe",
      subscription
    }));
  }

  private handleMessage(raw: string) {
    const message = JSON.parse(raw) as HyperliquidSubscriptionMessage;

    if (message.channel === "l2Book") {
      this.handleBook(message.data as HyperliquidWsBook);
      return;
    }

    if (message.channel === "trades") {
      this.handleTrades(message.data as HyperliquidWsTrade[]);
      return;
    }

    if (message.channel === "candle") {
      this.handleCandles(message.data as HyperliquidWsCandle | HyperliquidWsCandle[] | { candle?: HyperliquidWsCandle });
      return;
    }

    if (message.channel === "activeAssetCtx") {
      this.handleAssetCtx(message.data as HyperliquidWsActiveAssetCtx | HyperliquidWsActiveAssetCtx[]);
    }
  }

  private handleBook(book: HyperliquidWsBook) {
    if (book.coin !== this.coin) {
      return;
    }

    this.book = {
      bids: book.levels[0].map(toLevel).sort((left, right) => right.price - left.price).slice(0, 12),
      asks: book.levels[1].map(toLevel).sort((left, right) => left.price - right.price).slice(0, 12),
      updatedAt: book.time
    };

    const bestBid = this.book.bids[0]?.price;
    const bestAsk = this.book.asks[0]?.price;

    if (!bestBid || !bestAsk) {
      this.pushSnapshot();
      return;
    }

    const mid = Number(((bestBid + bestAsk) / 2).toFixed(2));
    const tick: MarketTick = {
      symbol: `${this.coin}-USD`,
      bid: Number(bestBid.toFixed(2)),
      ask: Number(bestAsk.toFixed(2)),
      last: Number((this.lastTradePrice ?? this.assetCtx?.markPrice ?? mid).toFixed(2)),
      spread: Number((bestAsk - bestBid).toFixed(2)),
      tickTime: new Date(book.time).toISOString(),
      volatilityTag: "normal"
    };

    void this.onTick(tick);
    this.pushSnapshot();
  }

  private handleTrades(trades: HyperliquidWsTrade[]) {
    const parsedTrades = trades
      .filter((trade) => trade.coin === this.coin)
      .map((trade) => ({
        id: `${trade.coin}-${trade.time}-${trade.tid}`,
        coin: trade.coin,
        side: trade.side === "A" || trade.side.toLowerCase() === "sell" ? "sell" as const : "buy" as const,
        price: Number(trade.px),
        size: Number(trade.sz),
        time: trade.time
      }));

    if (parsedTrades.length === 0) {
      return;
    }

    this.lastTradePrice = parsedTrades[0]?.price ?? this.lastTradePrice;
    this.trades = [...parsedTrades, ...this.trades]
      .reduce<MarketTrade[]>((accumulator, trade) => {
        if (accumulator.some((entry) => entry.id === trade.id)) {
          return accumulator;
        }

        accumulator.push(trade);
        return accumulator;
      }, [])
      .sort((left, right) => right.time - left.time)
      .slice(0, 80);

    this.pushSnapshot();
  }

  private handleCandles(payload: HyperliquidWsCandle | HyperliquidWsCandle[] | { candle?: HyperliquidWsCandle }) {
    const candidates = Array.isArray(payload)
      ? payload
      : typeof payload === "object" && payload !== null && "candle" in payload && payload.candle
        ? [payload.candle]
        : [payload];
    const candles = candidates.filter(isWsCandle);
    const parsedCandles = candles
      .filter((candle) => candle.s === this.coin)
      .map((candle) => ({
        id: `${candle.s}-${candle.i}-${candle.t}`,
        coin: candle.s,
        interval: candle.i,
        openTime: candle.t,
        closeTime: candle.T,
        open: Number(candle.o),
        high: Number(candle.h),
        low: Number(candle.l),
        close: Number(candle.c),
        volume: Number(candle.v),
        tradeCount: candle.n
      }));

    if (parsedCandles.length === 0) {
      return;
    }

    this.candles = [...parsedCandles, ...this.candles]
      .reduce<MarketCandle[]>((accumulator, candle) => {
        if (accumulator.some((entry) => entry.id === candle.id)) {
          return accumulator;
        }

        accumulator.push(candle);
        return accumulator;
      }, [])
      .sort((left, right) => left.openTime - right.openTime)
      .slice(-500);

    this.pushSnapshot();
  }

  private handleAssetCtx(payload: HyperliquidWsActiveAssetCtx | HyperliquidWsActiveAssetCtx[]) {
    const message = Array.isArray(payload) ? payload.find((entry) => entry.coin === this.coin) : payload;

    if (!message) {
      return;
    }

    if (message.coin !== this.coin) {
      return;
    }

    this.assetCtx = {
      coin: message.coin,
      markPrice: message.ctx.markPx != null ? Number(message.ctx.markPx) : undefined,
      midPrice: message.ctx.midPx != null ? Number(message.ctx.midPx) : undefined,
      oraclePrice: message.ctx.oraclePx != null ? Number(message.ctx.oraclePx) : undefined,
      fundingRate: message.ctx.funding != null ? Number(message.ctx.funding) : undefined,
      openInterest: message.ctx.openInterest != null ? Number(message.ctx.openInterest) : undefined,
      prevDayPrice: message.ctx.prevDayPx != null ? Number(message.ctx.prevDayPx) : undefined,
      dayNotionalVolume: message.ctx.dayNtlVlm != null ? Number(message.ctx.dayNtlVlm) : undefined,
      capturedAt: Date.now()
    };

    this.pushSnapshot();
  }

  private pushSnapshot() {
    this.onSnapshot(this.getSnapshot());
  }

  private cleanupSocket() {
    if (this.socket) {
      this.socket.close();
      this.socket = undefined;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, 3000);
  }
}
