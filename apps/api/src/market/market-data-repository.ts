import { Prisma } from "@prisma/client";
import type { AnyEventEnvelope } from "@stratium/shared";
import { TriggerOrderRepository } from "../persistence/trigger-order-repository.js";
import type {
  MarketAssetContext,
  MarketCandle,
  MarketSnapshot,
  MarketTrade
} from "../market/market-data.js";
import { prisma } from "../persistence/prisma-client.js";

const RECENT_MARKET_WINDOW_MS = 24 * 60 * 60 * 1000;
const RECENT_MARKET_CANDLE_LIMIT = 1_440;

const toNumber = (value: { toString(): string } | number): number => Number(value.toString());
const minuteBucketKey = (timestamp: string): string => timestamp.slice(0, 16);
const marketTickRowId = (symbol: string, tickTime: string): string => `${symbol}:${minuteBucketKey(tickTime)}`;

export class MarketDataRepository extends TriggerOrderRepository {
  async listMarketTickEvents(symbol: string, from: string, to: string): Promise<AnyEventEnvelope[]> {
    const rows = await prisma.marketTick.findMany({
      where: {
        symbol,
        tickTime: {
          gte: new Date(from),
          lte: new Date(to)
        }
      },
      orderBy: [{ tickTime: "asc" }, { id: "asc" }]
    });

    return rows.map((row, index) => ({
      eventId: `persisted-market-${row.id}`,
      eventType: "MarketTickReceived",
      occurredAt: row.tickTime.toISOString(),
      sequence: index + 1,
      simulationSessionId: `persisted-market-${symbol}`,
      accountId: "",
      symbol: row.symbol,
      source: "market",
      payload: {
        bid: toNumber(row.bid),
        ask: toNumber(row.ask),
        last: toNumber(row.last),
        spread: toNumber(row.spread),
        tickTime: row.tickTime.toISOString(),
        volatilityTag: row.volatilityTag ?? undefined
      }
    }) as AnyEventEnvelope);
  }

  async persistMinuteCandles(
    candles: MarketCandle[],
    source = "hyperliquid"
  ): Promise<void> {
    if (candles.length === 0) {
      return;
    }

    const operations: Prisma.PrismaPromise<unknown>[] = [];

    for (const candle of candles) {
      if (candle.interval !== "1m") {
        continue;
      }

      operations.push(
        prisma.marketCandle.upsert({
          where: {
            source_coin_interval_openTime: {
              source,
              coin: candle.coin,
              interval: candle.interval,
              openTime: new Date(candle.openTime)
            }
          },
          update: this.mapMarketCandle(candle, source),
          create: {
            id: candle.id,
            ...this.mapMarketCandle(candle, source)
          }
        })
      );

      operations.push(
        prisma.marketVolumeRecord.upsert({
          where: {
            source_coin_interval_bucketStart: {
              source,
              coin: candle.coin,
              interval: candle.interval,
              bucketStart: new Date(candle.openTime)
            }
          },
          update: this.mapMarketVolumeRecord(candle, source),
          create: {
            id: `vol-${candle.coin}-${candle.interval}-${candle.openTime}`,
            ...this.mapMarketVolumeRecord(candle, source)
          }
        })
      );
    }

    if (operations.length > 0) {
      await Promise.allSettled(operations);
    }
  }

  async persistClosedMinuteCandles(
    candles: MarketCandle[],
    source = "hyperliquid"
  ): Promise<void> {
    await this.persistMinuteCandles(candles, source);
  }

  async persistMarketSnapshot(snapshot: MarketSnapshot): Promise<void> {
    await this.persistClosedMinuteCandles(snapshot.candles, snapshot.source);
  }

  async loadRecentMarketSnapshot(coin: string, interval = "1m", source = "hyperliquid"): Promise<MarketSnapshot | null> {
    const candleWindowStart = new Date(Date.now() - RECENT_MARKET_WINDOW_MS);
    const [bookSnapshot, trades, candles, assetCtx] = await Promise.all([
      prisma.marketBookSnapshot.findFirst({
        where: { coin, source },
        orderBy: { capturedAt: "desc" }
      }),
      prisma.marketTrade.findMany({
        where: { coin, source },
        orderBy: { tradeTime: "desc" },
        take: 80
      }),
      prisma.marketCandle.findMany({
        where: {
          coin,
          interval,
          source,
          openTime: {
            gte: candleWindowStart
          }
        },
        orderBy: { openTime: "asc" },
        take: RECENT_MARKET_CANDLE_LIMIT
      }),
      prisma.marketAssetContext.findFirst({
        where: { coin, source },
        orderBy: { capturedAt: "desc" }
      })
    ]);
    const [bids, asks] = await Promise.all([
      prisma.marketBookLevel.findMany({
        where: { snapshotId: bookSnapshot?.id ?? "", side: "bid", source },
        orderBy: { levelIndex: "asc" },
        take: 12
      }),
      prisma.marketBookLevel.findMany({
        where: { snapshotId: bookSnapshot?.id ?? "", side: "ask", source },
        orderBy: { levelIndex: "asc" },
        take: 12
      })
    ]);

    if (!bookSnapshot && trades.length === 0 && candles.length === 0 && !assetCtx) {
      return null;
    }

    return {
      source,
      coin,
      connected: false,
      bestBid: bookSnapshot ? toNumber(bookSnapshot.bestBid ?? 0) || undefined : undefined,
      bestAsk: bookSnapshot ? toNumber(bookSnapshot.bestAsk ?? 0) || undefined : undefined,
      markPrice: assetCtx?.markPrice ? toNumber(assetCtx.markPrice) : undefined,
      book: {
        bids: bids
          .sort((left, right) => left.levelIndex - right.levelIndex)
          .map((level) => ({ price: toNumber(level.price), size: toNumber(level.size), orders: level.orders })),
        asks: asks
          .sort((left, right) => left.levelIndex - right.levelIndex)
          .map((level) => ({ price: toNumber(level.price), size: toNumber(level.size), orders: level.orders })),
        updatedAt: bookSnapshot?.capturedAt.getTime()
      },
      trades: trades.map((trade) => ({
        id: trade.id,
        coin: trade.coin,
        side: trade.side as MarketTrade["side"],
        price: toNumber(trade.price),
        size: toNumber(trade.size),
        time: trade.tradeTime.getTime()
      })),
      candles: candles.map((candle) => ({
        id: candle.id,
        coin: candle.coin,
        interval: candle.interval,
        openTime: candle.openTime.getTime(),
        closeTime: candle.closeTime.getTime(),
        open: toNumber(candle.open),
        high: toNumber(candle.high),
        low: toNumber(candle.low),
        close: toNumber(candle.close),
        volume: toNumber(candle.volume),
        tradeCount: candle.tradeCount
      })),
      assetCtx: assetCtx ? {
        coin: assetCtx.coin,
        markPrice: assetCtx.markPrice ? toNumber(assetCtx.markPrice) : undefined,
        midPrice: assetCtx.midPrice ? toNumber(assetCtx.midPrice) : undefined,
        oraclePrice: assetCtx.oraclePrice ? toNumber(assetCtx.oraclePrice) : undefined,
        fundingRate: assetCtx.fundingRate ? toNumber(assetCtx.fundingRate) : undefined,
        openInterest: assetCtx.openInterest ? toNumber(assetCtx.openInterest) : undefined,
        prevDayPrice: assetCtx.prevDayPrice ? toNumber(assetCtx.prevDayPrice) : undefined,
        dayNotionalVolume: assetCtx.dayNotionalVolume ? toNumber(assetCtx.dayNotionalVolume) : undefined,
        capturedAt: assetCtx.capturedAt.getTime()
      } : undefined
    };
  }

  async loadRecentVolumeRecords(coin: string, interval = "1m", limit = 500, source = "hyperliquid"): Promise<Array<{
    id: string;
    source: string;
    coin: string;
    interval: string;
    bucketStart: number;
    bucketEnd: number;
    volume: number;
    tradeCount: number;
  }>> {
    const rows = await prisma.marketVolumeRecord.findMany({
      where: { coin, interval, source },
      orderBy: { bucketStart: "asc" },
      take: Math.max(1, Math.min(limit, 2000))
    });

    return rows.map((row) => ({
      id: row.id,
      source: row.source,
      coin: row.coin,
      interval: row.interval,
      bucketStart: row.bucketStart.getTime(),
      bucketEnd: row.bucketEnd.getTime(),
      volume: toNumber(row.volume),
      tradeCount: row.tradeCount
    }));
  }

  protected marketTickEventRowId(symbol: string, tickTime: string): string {
    return marketTickRowId(symbol, tickTime);
  }

  protected mapMarketTrade(trade: MarketTrade, source: string) {
    return {
      source,
      coin: trade.coin,
      side: trade.side,
      price: trade.price,
      size: trade.size,
      tradeTime: new Date(trade.time)
    };
  }

  protected mapMarketCandle(candle: MarketCandle, source: string) {
    return {
      source,
      coin: candle.coin,
      interval: candle.interval,
      openTime: new Date(candle.openTime),
      closeTime: new Date(candle.closeTime),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      tradeCount: candle.tradeCount
    };
  }

  protected mapMarketVolumeRecord(candle: MarketCandle, source: string) {
    return {
      source,
      coin: candle.coin,
      interval: candle.interval,
      bucketStart: new Date(candle.openTime),
      bucketEnd: new Date(candle.closeTime),
      volume: candle.volume,
      tradeCount: candle.tradeCount
    };
  }

  protected mapAssetContext(assetCtx: MarketAssetContext, source: string) {
    return {
      source,
      coin: assetCtx.coin,
      markPrice: assetCtx.markPrice ?? null,
      midPrice: assetCtx.midPrice ?? null,
      oraclePrice: assetCtx.oraclePrice ?? null,
      fundingRate: assetCtx.fundingRate ?? null,
      openInterest: assetCtx.openInterest ?? null,
      prevDayPrice: assetCtx.prevDayPrice ?? null,
      dayNotionalVolume: assetCtx.dayNotionalVolume ?? null,
      capturedAt: new Date(assetCtx.capturedAt)
    };
  }
}
