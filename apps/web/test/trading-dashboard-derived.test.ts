import { describe, expect, it } from "vitest";
import {
  buildBook,
  buildEnrichedTicks,
  buildStats,
  buildSyntheticBook,
  buildTrades
} from "../app/trading-dashboard/dashboard-derived";

describe("trading dashboard derived helpers", () => {
  it("builds enriched ticks with synthetic volume and aggressor side", () => {
    const ticks = buildEnrichedTicks([
      {
        eventId: "evt-1",
        eventType: "MarketTickReceived",
        occurredAt: "2026-04-15T08:00:00.000Z",
        sequence: 1,
        simulationSessionId: "session-1",
        accountId: "paper-account-1",
        symbol: "HYPE-USD",
        source: "market",
        payload: {
          bid: 90,
          ask: 91,
          last: 90,
          spread: 1,
          tickTime: "2026-04-15T08:00:00.000Z"
        }
      },
      {
        eventId: "evt-2",
        eventType: "MarketTickReceived",
        occurredAt: "2026-04-15T08:01:00.000Z",
        sequence: 2,
        simulationSessionId: "session-1",
        accountId: "paper-account-1",
        symbol: "HYPE-USD",
        source: "market",
        payload: {
          bid: 88,
          ask: 89,
          last: 88,
          spread: 1,
          tickTime: "2026-04-15T08:01:00.000Z"
        }
      }
    ] as any[]);

    expect(ticks).toHaveLength(2);
    expect(ticks[0]).toMatchObject({
      symbol: "HYPE-USD",
      syntheticVolume: 0.1856,
      aggressorSide: "buy"
    });
    expect(ticks[1]).toMatchObject({
      syntheticVolume: 0.2512,
      aggressorSide: "sell"
    });
  });

  it("builds stats from market context and candle fallbacks", () => {
    expect(buildStats({
      market: {
        source: "hyperliquid",
        coin: "HYPE",
        connected: true,
        candles: [],
        book: { bids: [], asks: [] },
        trades: [],
        assetCtx: {
          coin: "HYPE",
          prevDayPrice: 80,
          markPrice: 95,
          capturedAt: 1
        }
      },
      latestTickLast: 90,
      candles: [{ open: 82, high: 96, low: 81, close: 90 }],
      recentMarketCandles: [],
      ticks: []
    })).toEqual({
      last: 90,
      change: 12.5,
      low: 81,
      high: 96
    });

    expect(buildStats({
      market: {
        source: "hyperliquid",
        coin: "HYPE",
        connected: true,
        candles: [],
        book: { bids: [], asks: [] },
        trades: [],
        markPrice: 88,
        assetCtx: {
          coin: "HYPE",
          capturedAt: 1
        }
      },
      candles: [{ open: 82, high: 96, low: 81, close: 90 }],
      recentMarketCandles: [],
      ticks: []
    })).toEqual({
      last: 90,
      change: 9.75609756097561,
      low: 81,
      high: 96
    });

    expect(buildStats({
      candles: [{ open: 10, high: 15, low: 9, close: 12 }],
      recentMarketCandles: [],
      ticks: []
    })).toEqual({
      last: 12,
      change: 20,
      low: 9,
      high: 15
    });

    expect(buildStats({
      candles: [],
      recentMarketCandles: [],
      ticks: []
    })).toEqual({
      last: undefined,
      change: undefined,
      low: undefined,
      high: undefined
    });

    expect(buildStats({
      market: {
        source: "hyperliquid",
        coin: "HYPE",
        connected: true,
        candles: [],
        book: { bids: [], asks: [] },
        trades: [],
        assetCtx: {
          coin: "HYPE",
          capturedAt: 1
        }
      },
      candles: [],
      recentMarketCandles: [],
      ticks: []
    })).toEqual({
      last: undefined,
      change: undefined,
      low: undefined,
      high: undefined
    });

    expect(buildStats({
      candles: [{ open: 0, high: 15, low: 9, close: 12 }],
      recentMarketCandles: [],
      ticks: []
    })).toEqual({
      last: 12,
      change: 0,
      low: 9,
      high: 15
    });
  });

  it("falls back to synthetic order book when live market depth is absent", () => {
    const syntheticBook = buildSyntheticBook({ last: 100, spread: 2 });
    expect(syntheticBook.asks[0]).toEqual({ price: 108, size: 0.25 });
    expect(syntheticBook.bids[0]).toEqual({ price: 99, size: 0.22 });

    expect(buildBook(undefined, syntheticBook)).toBe(syntheticBook);
    const tightSpreadBook = buildSyntheticBook({ last: 10, spread: 0 });
    expect(tightSpreadBook.asks[0]).toEqual({ price: 10.008, size: 0.25 });
    expect(tightSpreadBook.bids[0]).toEqual({ price: 9.999, size: 0.22 });
    const defaultBook = buildSyntheticBook(undefined);
    expect(defaultBook.asks[0]).toEqual({ price: 104, size: 0.25 });
    expect(defaultBook.bids[0]).toEqual({ price: 99.5, size: 0.22 });
    expect(buildBook({
      source: "hyperliquid",
      coin: "BTC",
      connected: true,
      candles: [],
      trades: [],
      book: {
        bids: [{ price: 99, size: 3, orders: 2 }],
        asks: [{ price: 101, size: 2, orders: 1 }]
      }
    }, syntheticBook)).toEqual({
      bids: [{ price: 99, size: 3 }],
      asks: [{ price: 101, size: 2 }]
    });
    expect(buildBook({
      source: "hyperliquid",
      coin: "BTC",
      connected: true,
      candles: [],
      trades: [],
      book: {
        bids: [],
        asks: [{ price: 101, size: 2, orders: 1 }]
      }
    }, syntheticBook)).toBe(syntheticBook);
  });

  it("prefers market trades and otherwise merges fill and tape trades", () => {
    expect(buildTrades({
      market: {
        source: "hyperliquid",
        coin: "BTC",
        connected: true,
        candles: [],
        book: { bids: [], asks: [] },
        trades: [{ id: "trade-1", coin: "BTC", side: "buy", price: 100, size: 0.5, time: 1 }]
      },
      events: [],
      orders: [],
      ticks: []
    })).toEqual([
      {
        id: "trade-1",
        time: new Date(1).toISOString(),
        price: 100,
        size: 0.5,
        side: "buy",
        source: "market"
      }
    ]);

    const fallbackTrades = buildTrades({
      events: [{
        eventId: "evt-fill",
        eventType: "OrderFilled",
        occurredAt: "2026-04-15T08:02:00.000Z",
        sequence: 3,
        simulationSessionId: "session-1",
        accountId: "paper-account-1",
        symbol: "BTC-USD",
        source: "system",
        payload: {
          orderId: "ord_1",
          fillPrice: 101,
          fillQuantity: 1
        }
      }] as any[],
      orders: [{
        id: "ord_1",
        accountId: "paper-account-1",
        symbol: "BTC-USD",
        side: "sell"
      }] as any[],
      ticks: [{
        symbol: "BTC-USD",
        bid: 100,
        ask: 101,
        last: 100.5,
        spread: 1,
        tickTime: "2026-04-15T08:01:00.000Z",
        syntheticVolume: 0.2,
        aggressorSide: "buy"
      }]
    });

    expect(fallbackTrades[0]).toMatchObject({
      id: "evt-fill",
      price: 101,
      size: 1,
      side: "sell",
      source: "fill"
    });
    expect(fallbackTrades[1]).toMatchObject({
      source: "tape",
      price: 100.5,
      side: "buy"
    });

    const noOrderFallback = buildTrades({
      events: [{
        eventId: "evt-partial",
        eventType: "OrderPartiallyFilled",
        occurredAt: "2026-04-15T08:03:00.000Z",
        sequence: 4,
        simulationSessionId: "session-1",
        accountId: "paper-account-1",
        symbol: "BTC-USD",
        source: "system",
        payload: {
          orderId: "missing",
          fillPrice: 102,
          fillQuantity: 0.5
        }
      }] as any[],
      orders: [],
      ticks: []
    });

    expect(noOrderFallback).toEqual([
      expect.objectContaining({
        id: "evt-partial",
        side: "buy",
        source: "fill"
      })
    ]);
  });
});
