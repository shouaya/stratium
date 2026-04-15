import type { CandlestickData, HistogramData, UTCTimestamp } from "lightweight-charts";
import type { EnrichedTick, MarketState } from "./types";

const toBucketTime = (timestampMs: number, bucketMs: number): UTCTimestamp =>
  Math.floor(timestampMs / bucketMs) * (bucketMs / 1000) as UTCTimestamp;

export const buildCandlesFromMarket = (
  candles: MarketState["candles"],
  bucketMs: number
): CandlestickData<UTCTimestamp>[] => {
  const map = new Map<number, CandlestickData<UTCTimestamp>>();

  for (const candle of candles) {
    const bucket = toBucketTime(candle.openTime, bucketMs);
    const existing = map.get(bucket);

    map.set(bucket, existing
      ? {
        time: bucket,
        open: existing.open,
        high: Math.max(existing.high, candle.high),
        low: Math.min(existing.low, candle.low),
        close: candle.close
      }
      : {
        time: bucket,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close
      });
  }

  return [...map.values()].sort((left, right) => Number(left.time) - Number(right.time));
};

export const buildCandlesFromTicks = (
  ticks: EnrichedTick[],
  bucketMs: number
): CandlestickData<UTCTimestamp>[] => {
  const map = new Map<number, CandlestickData<UTCTimestamp>>();

  for (const tick of ticks) {
    const bucket = toBucketTime(new Date(tick.tickTime).getTime(), bucketMs);
    const current = map.get(bucket);

    map.set(bucket, current
      ? {
        ...current,
        high: Math.max(current.high, tick.last),
        low: Math.min(current.low, tick.last),
        close: tick.last
      }
      : {
        time: bucket,
        open: tick.last,
        high: tick.last,
        low: tick.last,
        close: tick.last
      });
  }

  return [...map.values()].sort((left, right) => Number(left.time) - Number(right.time));
};

export const mergeCandlesWithTicks = (
  marketCandles: CandlestickData<UTCTimestamp>[],
  tickCandles: CandlestickData<UTCTimestamp>[]
): CandlestickData<UTCTimestamp>[] => {
  const merged = new Map<number, CandlestickData<UTCTimestamp>>();

  for (const candle of marketCandles) {
    merged.set(Number(candle.time), candle);
  }

  for (const candle of tickCandles) {
    const existing = merged.get(Number(candle.time));

    merged.set(Number(candle.time), existing
      ? {
        time: candle.time,
        open: existing.open,
        high: Math.max(existing.high, candle.high),
        low: Math.min(existing.low, candle.low),
        close: candle.close
      }
      : candle);
  }

  return [...merged.values()].sort((left, right) => Number(left.time) - Number(right.time));
};

export const buildVolumeFromMarket = (
  candles: MarketState["candles"],
  bucketMs: number
): HistogramData<UTCTimestamp>[] => {
  const map = new Map<number, HistogramData<UTCTimestamp>>();

  for (const candle of candles) {
    const bucket = toBucketTime(candle.openTime, bucketMs);
    const existing = map.get(bucket);
    const value = Number((((existing?.value as number | undefined) ?? 0) + candle.volume).toFixed(4));

    map.set(bucket, {
      time: bucket,
      value,
      color: candle.close >= candle.open ? "#2dd4bf88" : "#f8717188"
    });
  }

  return [...map.values()].sort((left, right) => Number(left.time) - Number(right.time));
};

export const buildVolumeFromTicks = (
  ticks: EnrichedTick[],
  bucketMs: number
): HistogramData<UTCTimestamp>[] => {
  const map = new Map<number, HistogramData<UTCTimestamp>>();

  for (const tick of ticks) {
    const bucket = toBucketTime(new Date(tick.tickTime).getTime(), bucketMs);
    const current = map.get(bucket);
    const next = Number((((current?.value as number | undefined) ?? 0) + tick.syntheticVolume).toFixed(4));

    map.set(bucket, {
      time: bucket,
      value: next,
      color: tick.aggressorSide === "buy" ? "#2dd4bf88" : "#f8717188"
    });
  }

  return [...map.values()].sort((left, right) => Number(left.time) - Number(right.time));
};
