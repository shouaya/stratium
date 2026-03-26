import { Prisma, PrismaClient } from "@prisma/client";
import type { EventEnvelope, FillPayload, MarketTick, OrderView, PositionView, TradingSymbolConfig } from "@stratium/shared";
import type { TradingEngineState } from "@stratium/trading-core";
import type {
  HyperliquidAssetContext,
  HyperliquidCandle,
  HyperliquidMarketSnapshot,
  HyperliquidTrade
} from "./hyperliquid-market";

const prisma = new PrismaClient();

const toNumber = (value: { toString(): string } | number): number => Number(value.toString());
const toJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

const isFillEvent = (eventType: string): boolean =>
  eventType === "OrderFilled" || eventType === "OrderPartiallyFilled";

export class TradingRepository {
  async connect(): Promise<void> {
    await prisma.$connect();
  }

  async close(): Promise<void> {
    await prisma.$disconnect();
  }

  async loadEvents(sessionId: string): Promise<EventEnvelope<unknown>[]> {
    const events = await prisma.simulationEvent.findMany({
      where: {
        simulationSessionId: sessionId
      },
      orderBy: {
        sequence: "asc"
      }
    });

    return events.map((event) => ({
      eventId: event.id,
      eventType: event.eventType as EventEnvelope["eventType"],
      occurredAt: event.occurredAt.toISOString(),
      sequence: event.sequence,
      simulationSessionId: event.simulationSessionId,
      accountId: event.accountId,
      symbol: event.symbol,
      source: event.source as EventEnvelope["source"],
      payload: event.payload as EventEnvelope["payload"]
    }));
  }

  async loadSymbolConfig(symbol: string): Promise<TradingSymbolConfig | null> {
    const row = await prisma.symbolConfig.findUnique({
      where: { symbol }
    });

    if (!row) {
      return null;
    }

    return {
      symbol: row.symbol,
      leverage: row.engineDefaultLeverage,
      maintenanceMarginRate: toNumber(row.engineMaintenanceMarginRate),
      takerFeeRate: toNumber(row.baseTakerFeeRate),
      makerFeeRate: toNumber(row.baseMakerFeeRate),
      baseSlippageBps: row.engineBaseSlippageBps,
      partialFillEnabled: row.enginePartialFillEnabled
    };
  }

  async loadSymbolConfigMeta(symbol: string): Promise<{
    symbol: string;
    coin: string;
    leverage: number;
    maxLeverage: number;
    szDecimals: number;
    quoteAsset: string;
  } | null> {
    const row = await prisma.symbolConfig.findUnique({
      where: { symbol }
    });

    if (!row) {
      return null;
    }

    return {
      symbol: row.symbol,
      coin: row.coin,
      leverage: row.engineDefaultLeverage,
      maxLeverage: row.maxLeverage,
      szDecimals: row.szDecimals,
      quoteAsset: row.quoteAsset
    };
  }

  async updateSymbolLeverage(symbol: string, leverage: number): Promise<void> {
    await prisma.symbolConfig.update({
      where: { symbol },
      data: {
        engineDefaultLeverage: leverage,
        lastSyncedAt: new Date()
      }
    });
  }

  async persistMarketSnapshot(snapshot: HyperliquidMarketSnapshot): Promise<void> {
    if (snapshot.source !== "hyperliquid") {
      return;
    }

    const capturedAt = new Date(snapshot.book.updatedAt ?? snapshot.assetCtx?.capturedAt ?? Date.now());
    const snapshotId = `${snapshot.coin}-${capturedAt.getTime()}`;
    const operations: Prisma.PrismaPromise<unknown>[] = [];

    if (snapshot.book.bids.length > 0 || snapshot.book.asks.length > 0) {
      operations.push(
        prisma.marketBookSnapshot.upsert({
          where: { id: snapshotId },
          update: {
            source: snapshot.source,
            coin: snapshot.coin,
            symbol: `${snapshot.coin}-USD`,
            bestBid: snapshot.bestBid ?? null,
            bestAsk: snapshot.bestAsk ?? null,
            spread: snapshot.bestBid != null && snapshot.bestAsk != null ? snapshot.bestAsk - snapshot.bestBid : null,
            capturedAt
          },
          create: {
            id: snapshotId,
            source: snapshot.source,
            coin: snapshot.coin,
            symbol: `${snapshot.coin}-USD`,
            bestBid: snapshot.bestBid ?? null,
            bestAsk: snapshot.bestAsk ?? null,
            spread: snapshot.bestBid != null && snapshot.bestAsk != null ? snapshot.bestAsk - snapshot.bestBid : null,
            capturedAt
          }
        })
      );

      const levels = [
        ...snapshot.book.bids.map((level, index) => ({ ...level, side: "bid" as const, index })),
        ...snapshot.book.asks.map((level, index) => ({ ...level, side: "ask" as const, index }))
      ];

      for (const level of levels) {
        operations.push(
          prisma.marketBookLevel.upsert({
            where: {
              id: `${snapshotId}-${level.side}-${level.index}`
            },
            update: {
              source: snapshot.source,
              coin: snapshot.coin,
              side: level.side,
              levelIndex: level.index,
              price: level.price,
              size: level.size,
              orders: level.orders,
              capturedAt
            },
            create: {
              id: `${snapshotId}-${level.side}-${level.index}`,
              snapshotId,
              source: snapshot.source,
              coin: snapshot.coin,
              side: level.side,
              levelIndex: level.index,
              price: level.price,
              size: level.size,
              orders: level.orders,
              capturedAt
            }
          })
        );
      }
    }

    for (const trade of snapshot.trades.slice(0, 12)) {
      operations.push(
        prisma.marketTrade.upsert({
          where: { id: trade.id },
          update: this.mapMarketTrade(trade, snapshot.source),
          create: {
            id: trade.id,
            ...this.mapMarketTrade(trade, snapshot.source)
          }
        })
      );
    }

    for (const candle of snapshot.candles.slice(-8)) {
      operations.push(
        prisma.marketCandle.upsert({
          where: {
            coin_interval_openTime: {
              coin: candle.coin,
              interval: candle.interval,
              openTime: new Date(candle.openTime)
            }
          },
          update: this.mapMarketCandle(candle, snapshot.source),
          create: {
            id: candle.id,
            ...this.mapMarketCandle(candle, snapshot.source)
          }
        })
      );

      operations.push(
        prisma.marketVolumeRecord.upsert({
          where: {
            coin_interval_bucketStart: {
              coin: candle.coin,
              interval: candle.interval,
              bucketStart: new Date(candle.openTime)
            }
          },
          update: this.mapMarketVolumeRecord(candle, snapshot.source),
          create: {
            id: `vol-${candle.coin}-${candle.interval}-${candle.openTime}`,
            ...this.mapMarketVolumeRecord(candle, snapshot.source)
          }
        })
      );
    }

    if (snapshot.assetCtx) {
      operations.push(
        prisma.marketAssetContext.create({
          data: {
            id: crypto.randomUUID(),
            ...this.mapAssetContext(snapshot.assetCtx, snapshot.source)
          }
        })
      );
    }

    if (operations.length > 0) {
      await Promise.allSettled(operations);
    }
  }

  async loadRecentMarketSnapshot(coin: string, interval = "1m"): Promise<HyperliquidMarketSnapshot | null> {
    const [bookSnapshot, trades, candles, assetCtx] = await Promise.all([
      prisma.marketBookSnapshot.findFirst({
        where: { coin, source: "hyperliquid" },
        orderBy: { capturedAt: "desc" }
      }),
      prisma.marketTrade.findMany({
        where: { coin, source: "hyperliquid" },
        orderBy: { tradeTime: "desc" },
        take: 80
      }),
      prisma.marketCandle.findMany({
        where: { coin, interval, source: "hyperliquid" },
        orderBy: { openTime: "asc" },
        take: 500
      }),
      prisma.marketAssetContext.findFirst({
        where: { coin, source: "hyperliquid" },
        orderBy: { capturedAt: "desc" }
      })
    ]);
    const [bids, asks] = await Promise.all([
      prisma.marketBookLevel.findMany({
        where: { snapshotId: bookSnapshot?.id ?? "", side: "bid", source: "hyperliquid" },
        orderBy: { levelIndex: "asc" },
        take: 12
      }),
      prisma.marketBookLevel.findMany({
        where: { snapshotId: bookSnapshot?.id ?? "", side: "ask", source: "hyperliquid" },
        orderBy: { levelIndex: "asc" },
        take: 12
      })
    ]);

    if (!bookSnapshot && trades.length === 0 && candles.length === 0 && !assetCtx) {
      return null;
    }

    return {
      source: "hyperliquid",
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
        side: trade.side as HyperliquidTrade["side"],
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

  async loadRecentVolumeRecords(coin: string, interval = "1m", limit = 500): Promise<Array<{
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
      where: { coin, interval, source: "hyperliquid" },
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

  async persistState(state: TradingEngineState, events: EventEnvelope<unknown>[]): Promise<void> {
    const operations: Promise<unknown>[] = [];

    for (const event of events) {
      operations.push(
        prisma.simulationEvent.upsert({
          where: {
            simulationSessionId_sequence: {
              simulationSessionId: event.simulationSessionId,
              sequence: event.sequence
            }
          },
          update: {
            eventType: event.eventType,
            source: event.source,
            payload: toJson(event.payload),
            occurredAt: new Date(event.occurredAt)
          },
          create: {
            id: event.eventId,
            sequence: event.sequence,
            simulationSessionId: event.simulationSessionId,
            accountId: event.accountId,
            symbol: event.symbol,
            source: event.source,
            eventType: event.eventType,
            payload: toJson(event.payload),
            occurredAt: new Date(event.occurredAt)
          }
        })
      );

      if (event.eventType === "MarketTickReceived") {
        const payload = event.payload as MarketTick;

        operations.push(
          prisma.marketTick.create({
            data: {
              id: event.eventId,
              symbol: event.symbol,
              bid: payload.bid,
              ask: payload.ask,
              last: payload.last,
              spread: payload.spread,
              volatilityTag: payload.volatilityTag,
              tickTime: new Date(payload.tickTime)
            }
          }).catch(() => undefined)
        );
      }

      if (isFillEvent(event.eventType)) {
        const payload = event.payload as FillPayload;

        operations.push(
          prisma.fill.upsert({
            where: {
              id: payload.fillId
            },
            update: {
              price: payload.fillPrice,
              quantity: payload.fillQuantity,
              slippage: payload.slippage,
              fee: payload.fee
            },
            create: {
              id: payload.fillId,
              orderId: payload.orderId,
              accountId: event.accountId,
              symbol: event.symbol,
              price: payload.fillPrice,
              quantity: payload.fillQuantity,
              slippage: payload.slippage,
              fee: payload.fee
            }
          })
        );
      }
    }

    operations.push(
      prisma.account.upsert({
        where: {
          id: state.account.accountId
        },
        update: {
          walletBalance: state.account.walletBalance,
          availableBalance: state.account.availableBalance,
          positionMargin: state.account.positionMargin,
          orderMargin: state.account.orderMargin,
          equity: state.account.equity,
          realizedPnl: state.account.realizedPnl,
          unrealizedPnl: state.account.unrealizedPnl,
          riskRatio: state.account.riskRatio
        },
        create: {
          id: state.account.accountId,
          walletBalance: state.account.walletBalance,
          availableBalance: state.account.availableBalance,
          positionMargin: state.account.positionMargin,
          orderMargin: state.account.orderMargin,
          equity: state.account.equity,
          realizedPnl: state.account.realizedPnl,
          unrealizedPnl: state.account.unrealizedPnl,
          riskRatio: state.account.riskRatio
        }
      })
    );

    operations.push(
      prisma.position.upsert({
        where: {
          id: "position_1"
        },
        update: {
          accountId: state.account.accountId,
          symbol: state.position.symbol,
          side: state.position.side,
          quantity: state.position.quantity,
          averageEntryPrice: state.position.averageEntryPrice,
          markPrice: state.position.markPrice,
          realizedPnl: state.position.realizedPnl,
          unrealizedPnl: state.position.unrealizedPnl,
          initialMargin: state.position.initialMargin,
          maintenanceMargin: state.position.maintenanceMargin,
          liquidationPrice: state.position.liquidationPrice
        },
        create: {
          id: "position_1",
          accountId: state.account.accountId,
          symbol: state.position.symbol,
          side: state.position.side,
          quantity: state.position.quantity,
          averageEntryPrice: state.position.averageEntryPrice,
          markPrice: state.position.markPrice,
          realizedPnl: state.position.realizedPnl,
          unrealizedPnl: state.position.unrealizedPnl,
          initialMargin: state.position.initialMargin,
          maintenanceMargin: state.position.maintenanceMargin,
          liquidationPrice: state.position.liquidationPrice
        }
      })
    );

    for (const order of state.orders) {
      operations.push(
        prisma.order.upsert({
          where: {
            id: order.id
          },
          update: this.mapOrder(order),
          create: {
            id: order.id,
            ...this.mapOrder(order)
          }
        })
      );
    }

    await Promise.allSettled(operations);
  }

  async loadSnapshot(accountId: string): Promise<{
    account: TradingEngineState["account"] | null;
    position: TradingEngineState["position"] | null;
  }> {
    const [account, position] = await Promise.all([
      prisma.account.findUnique({ where: { id: accountId } }),
      prisma.position.findUnique({ where: { id: "position_1" } })
    ]);

    return {
      account: account ? {
        accountId: account.id,
        walletBalance: toNumber(account.walletBalance),
        availableBalance: toNumber(account.availableBalance),
        positionMargin: toNumber(account.positionMargin),
        orderMargin: toNumber(account.orderMargin),
        equity: toNumber(account.equity),
        realizedPnl: toNumber(account.realizedPnl),
        unrealizedPnl: toNumber(account.unrealizedPnl),
        riskRatio: toNumber(account.riskRatio)
      } : null,
      position: position ? this.mapPosition(position) : null
    };
  }

  private mapOrder(order: OrderView) {
    return {
      accountId: order.accountId,
      symbol: order.symbol,
      side: order.side,
      orderType: order.orderType,
      status: order.status,
      quantity: order.quantity,
      limitPrice: order.limitPrice ?? null,
      filledQuantity: order.filledQuantity,
      remainingQuantity: order.remainingQuantity,
      averageFillPrice: order.averageFillPrice ?? null,
      rejectionCode: order.rejectionCode ?? null,
      rejectionMessage: order.rejectionMessage ?? null,
      createdAt: new Date(order.createdAt),
      updatedAt: new Date(order.updatedAt)
    };
  }

  private mapMarketTrade(trade: HyperliquidTrade, source: string) {
    return {
      source,
      coin: trade.coin,
      side: trade.side,
      price: trade.price,
      size: trade.size,
      tradeTime: new Date(trade.time)
    };
  }

  private mapMarketCandle(candle: HyperliquidCandle, source: string) {
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

  private mapMarketVolumeRecord(candle: HyperliquidCandle, source: string) {
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

  private mapAssetContext(assetCtx: HyperliquidAssetContext, source: string) {
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

  private mapPosition(position: {
    symbol: string;
    side: string;
    quantity: { toString(): string };
    averageEntryPrice: { toString(): string };
    markPrice: { toString(): string };
    realizedPnl: { toString(): string };
    unrealizedPnl: { toString(): string };
    initialMargin: { toString(): string };
    maintenanceMargin: { toString(): string };
    liquidationPrice: { toString(): string };
  }): PositionView {
    return {
      symbol: position.symbol,
      side: position.side as PositionView["side"],
      quantity: toNumber(position.quantity),
      averageEntryPrice: toNumber(position.averageEntryPrice),
      markPrice: toNumber(position.markPrice),
      realizedPnl: toNumber(position.realizedPnl),
      unrealizedPnl: toNumber(position.unrealizedPnl),
      initialMargin: toNumber(position.initialMargin),
      maintenanceMargin: toNumber(position.maintenanceMargin),
      liquidationPrice: toNumber(position.liquidationPrice)
    };
  }
}
