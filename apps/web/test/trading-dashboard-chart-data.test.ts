import { describe, expect, it } from "vitest";
import {
  buildCandlesFromMarket,
  buildCandlesFromTicks,
  buildVolumeFromMarket,
  buildVolumeFromTicks,
  mergeCandlesWithTicks
} from "../app/trading-dashboard/chart-data";
import type { EnrichedTick } from "../app/trading-dashboard/types";

describe("trading dashboard chart data", () => {
  it("keeps manual tick jumps in the derived candle series", () => {
    const ticks: EnrichedTick[] = [
      {
        symbol: "HYPE-USD",
        bid: 43,
        ask: 44,
        last: 43.5,
        spread: 1,
        tickTime: "2026-04-15T07:58:10.000Z",
        volatilityTag: "live",
        syntheticVolume: 0.12,
        aggressorSide: "buy"
      },
      {
        symbol: "HYPE-USD",
        bid: 90,
        ask: 91,
        last: 90,
        spread: 1,
        tickTime: "2026-04-15T07:58:59.200Z",
        volatilityTag: "manual",
        syntheticVolume: 0.31,
        aggressorSide: "buy"
      }
    ];

    expect(buildCandlesFromTicks(ticks, 60_000)).toEqual([
      {
        time: 1776239880,
        open: 43.5,
        high: 90,
        low: 43.5,
        close: 90
      }
    ]);
  });

  it("overlays tick-derived updates onto market candles for the same bucket", () => {
    const marketCandles = [
      {
        time: 1776239880,
        open: 43.2,
        high: 44,
        low: 42.8,
        close: 43.4
      }
    ];
    const tickCandles = [
      {
        time: 1776239880,
        open: 43.5,
        high: 90,
        low: 43.5,
        close: 90
      }
    ];

    expect(mergeCandlesWithTicks(marketCandles, tickCandles)).toEqual([
      {
        time: 1776239880,
        open: 43.2,
        high: 90,
        low: 42.8,
        close: 90
      }
    ]);
  });

  it("aggregates market candles and volume by timeframe bucket", () => {
    const marketCandles = [
      {
        id: "c1",
        coin: "HYPE",
        interval: "1m",
        openTime: Date.parse("2026-04-15T07:58:00.000Z"),
        closeTime: Date.parse("2026-04-15T07:59:00.000Z"),
        open: 40,
        high: 45,
        low: 39,
        close: 44,
        volume: 12,
        tradeCount: 5
      },
      {
        id: "c2",
        coin: "HYPE",
        interval: "1m",
        openTime: Date.parse("2026-04-15T07:59:00.000Z"),
        closeTime: Date.parse("2026-04-15T08:00:00.000Z"),
        open: 44,
        high: 46,
        low: 43,
        close: 45,
        volume: 8,
        tradeCount: 3
      }
    ];

    expect(buildCandlesFromMarket(marketCandles as any, 300_000)).toEqual([
      {
        time: 1776239700,
        open: 40,
        high: 46,
        low: 39,
        close: 45
      }
    ]);
    expect(buildVolumeFromMarket(marketCandles as any, 300_000)).toEqual([
      {
        time: 1776239700,
        value: 20,
        color: "#2dd4bf88"
      }
    ]);
  });

  it("aggregates tick volume and keeps standalone tick candles when no market candle exists", () => {
    const ticks: EnrichedTick[] = [
      {
        symbol: "HYPE-USD",
        bid: 50,
        ask: 51,
        last: 50.5,
        spread: 1,
        tickTime: "2026-04-15T08:02:10.000Z",
        volatilityTag: "manual",
        syntheticVolume: 0.2,
        aggressorSide: "buy"
      },
      {
        symbol: "HYPE-USD",
        bid: 49,
        ask: 50,
        last: 49.5,
        spread: 1,
        tickTime: "2026-04-15T08:02:20.000Z",
        volatilityTag: "manual",
        syntheticVolume: 0.3,
        aggressorSide: "sell"
      }
    ];

    expect(buildVolumeFromTicks(ticks, 60_000)).toEqual([
      {
        time: 1776240120,
        value: 0.5,
        color: "#f8717188"
      }
    ]);
    expect(mergeCandlesWithTicks([], buildCandlesFromTicks(ticks, 60_000))).toEqual([
      {
        time: 1776240120,
        open: 50.5,
        high: 50.5,
        low: 49.5,
        close: 49.5
      }
    ]);
  });
});
