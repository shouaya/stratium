import { describe, expect, it } from "vitest";
import { buildCandlesFromTicks, mergeCandlesWithTicks } from "../app/trading-dashboard/chart-data";
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
});
