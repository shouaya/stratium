import type { MarketTick } from "@stratium/shared";

export interface MarketBookLevel {
  price: number;
  size: number;
  orders: number;
}

export interface MarketTrade {
  id: string;
  coin: string;
  side: "buy" | "sell";
  price: number;
  size: number;
  time: number;
}

export interface MarketCandle {
  id: string;
  coin: string;
  interval: string;
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tradeCount: number;
}

export interface MarketAssetContext {
  coin: string;
  markPrice?: number;
  midPrice?: number;
  oraclePrice?: number;
  fundingRate?: number;
  openInterest?: number;
  prevDayPrice?: number;
  dayNotionalVolume?: number;
  capturedAt: number;
}

export interface MarketSnapshot {
  source: string;
  coin: string;
  connected: boolean;
  bestBid?: number;
  bestAsk?: number;
  markPrice?: number;
  book: {
    bids: MarketBookLevel[];
    asks: MarketBookLevel[];
    updatedAt?: number;
  };
  trades: MarketTrade[];
  candles: MarketCandle[];
  assetCtx?: MarketAssetContext;
}

export interface MarketDataAdapterConfig {
  source: string;
  coin: string;
  marketSymbol: string;
  candleInterval?: string;
  onTick: (tick: MarketTick) => Promise<void> | void;
  onSnapshot: (snapshot: MarketSnapshot) => void;
}

export interface MarketDataAdapter {
  connect(): void;
  close(): void;
  getSnapshot(): MarketSnapshot;
}
