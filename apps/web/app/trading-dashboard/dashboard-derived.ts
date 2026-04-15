import type { AnyEventEnvelope, OrderView } from "@stratium/shared";
import type { EnrichedTick, MarketState, TickPayload } from "./types";

export const buildEnrichedTicks = (events: AnyEventEnvelope[]): EnrichedTick[] => {
  const marketTicks = events
    .filter((event) => event.eventType === "MarketTickReceived")
    .map((event) => ({ symbol: event.symbol, ...(event.payload as TickPayload) }));

  let previousLast: number | undefined;
  let previousVolume = 0.18;
  const acceptedTicks: EnrichedTick[] = [];

  for (const tick of marketTicks) {
    const priceMoveRatio = previousLast ? Math.abs(tick.last - previousLast) / previousLast : 0;
    const spreadRatio = tick.last > 0 ? tick.spread / tick.last : 0;
    const baseVolume = 0.12 + Math.min(priceMoveRatio * 60, 0.22) + Math.min(spreadRatio * 220, 0.08);
    const smoothedVolume = Number((previousVolume * 0.72 + baseVolume * 0.28).toFixed(4));

    acceptedTicks.push({
      ...tick,
      syntheticVolume: smoothedVolume,
      aggressorSide: previousLast && tick.last < previousLast ? "sell" : "buy"
    });

    previousLast = tick.last;
    previousVolume = smoothedVolume;
  }

  return acceptedTicks;
};

export const buildStats = (input: {
  market?: MarketState;
  latestTickLast?: number;
  candles: Array<{ open: number; high: number; low: number; close: number }>;
  recentMarketCandles: Array<{ open: number; high: number; low: number; close: number }>;
  ticks: EnrichedTick[];
}) => {
  const lastCandle = input.candles[input.candles.length - 1];

  if (input.market?.assetCtx) {
    const reference = input.market.assetCtx.prevDayPrice ?? input.candles[0]?.open;
    const last = input.latestTickLast ?? lastCandle?.close ?? input.market.assetCtx.markPrice ?? input.market.markPrice;
    return {
      last,
      change: last && reference ? ((last - reference) / reference) * 100 : undefined,
      low: input.candles.length > 0 ? Math.min(...input.candles.map((candle) => candle.low)) : undefined,
      high: input.candles.length > 0 ? Math.max(...input.candles.map((candle) => candle.high)) : undefined
    };
  }

  if (!input.candles.length) {
    return { last: undefined, change: undefined, low: undefined, high: undefined };
  }

  const first = input.candles[0]?.open ?? 0;
  const last = lastCandle?.close;
  return {
    last,
    change: first && last ? ((last - first) / first) * 100 : 0,
    low: Math.min(...input.candles.map((candle) => candle.low)),
    high: Math.max(...input.candles.map((candle) => candle.high))
  };
};

export const buildSyntheticBook = (latestTick: { last?: number; spread?: number } | null | undefined) => {
  const mid = latestTick?.last ?? 100;
  const step = Math.max((latestTick?.spread ?? 1) / 2, 0.001);
  return {
    asks: Array.from({ length: 8 }, (_, index) => ({ price: Number((mid + step * (8 - index)).toFixed(4)), size: Number((0.25 + index * 0.08).toFixed(4)) })),
    bids: Array.from({ length: 8 }, (_, index) => ({ price: Number((mid - step * (index + 1)).toFixed(4)), size: Number((0.22 + index * 0.09).toFixed(4)) }))
  };
};

export const buildBook = (
  market: MarketState | undefined,
  syntheticBook: ReturnType<typeof buildSyntheticBook>
) => {
  if (market && market.book.asks.length > 0 && market.book.bids.length > 0) {
    return {
      asks: market.book.asks.map((level) => ({ price: level.price, size: level.size })),
      bids: market.book.bids.map((level) => ({ price: level.price, size: level.size }))
    };
  }

  return syntheticBook;
};

export const buildTrades = (input: {
  market?: MarketState;
  events: AnyEventEnvelope[];
  orders: OrderView[];
  ticks: EnrichedTick[];
}) => {
  if (input.market && input.market.trades.length > 0) {
    return input.market.trades.map((trade) => ({
      id: trade.id,
      time: new Date(trade.time).toISOString(),
      price: trade.price,
      size: trade.size,
      side: trade.side,
      source: "market" as const
    }));
  }

  const fillTrades = input.events
    .filter((event) => event.eventType === "OrderFilled" || event.eventType === "OrderPartiallyFilled")
    .slice()
    .reverse()
    .map((event) => {
      const payload = event.payload as { fillPrice: number; fillQuantity: number; orderId: string };
      const order = input.orders.find((entry) => entry.id === payload.orderId);
      return {
        id: event.eventId,
        time: event.occurredAt,
        price: payload.fillPrice,
        size: payload.fillQuantity,
        side: order?.side ?? "buy",
        source: "fill" as const
      };
    });
  const tapeTrades = input.ticks.slice(-24).reverse().map((tick, index) => ({
    id: `tick-${tick.tickTime}-${index}`,
    time: tick.tickTime,
    price: tick.last,
    size: Number((tick.syntheticVolume * (0.92 + index * 0.025)).toFixed(4)),
    side: tick.aggressorSide,
    source: "tape" as const
  }));

  return [...fillTrades, ...tapeTrades]
    .sort((left, right) => new Date(right.time).getTime() - new Date(left.time).getTime())
    .slice(0, 24);
};
