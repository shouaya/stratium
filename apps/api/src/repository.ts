import { Prisma, PrismaClient } from "@prisma/client";
import type { AnyEventEnvelope, FillPayload, MarketTick, OrderView, PositionView, TradingSymbolConfig } from "@stratium/shared";
import type { TradingEngineState } from "@stratium/trading-core";
import type { PlatformSettingsView } from "./auth.js";
import type {
  HyperliquidAssetContext,
  HyperliquidCandle,
  HyperliquidMarketSnapshot,
  HyperliquidTrade
} from "./hyperliquid-market.js";

const prisma = new PrismaClient();
const RECENT_MARKET_WINDOW_MS = 24 * 60 * 60 * 1000;
const RECENT_MARKET_CANDLE_LIMIT = 1_440;
const EVENT_LOAD_BATCH_SIZE = 2_000;

const toNumber = (value: { toString(): string } | number): number => Number(value.toString());
const toJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const toStoredJson = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

const isFillEvent = (eventType: string): boolean =>
  eventType === "OrderFilled" || eventType === "OrderPartiallyFilled";

const positionRowId = (accountId: string, symbol: string): string => `${accountId}:${symbol}`;
const simulationEventRowId = (sessionId: string, eventId: string): string => `${sessionId}:${eventId}`;
const orderRowId = (accountId: string, orderId: string): string => `${accountId}:${orderId}`;
const fillRowId = (accountId: string, fillId: string): string => `${accountId}:${fillId}`;
const minuteBucketKey = (timestamp: string): string => timestamp.slice(0, 16);
const marketTickRowId = (symbol: string, tickTime: string): string => `${symbol}:${minuteBucketKey(tickTime)}`;
const triggerOrderRowId = (accountId: string, oid: number): string => `${accountId}:trigger:${oid}`;

type AuthSeedInput = {
  username: string;
  passwordHash: string;
  displayName: string;
  tradingAccountId?: string;
};

export class TradingRepository {
  async connect(): Promise<void> {
    await prisma.$connect();
  }

  async close(): Promise<void> {
    await prisma.$disconnect();
  }

  async ensureDefaultAccess(input: {
    frontend: AuthSeedInput;
    admin: AuthSeedInput;
  }): Promise<void> {
    await prisma.appUser.upsert({
      where: { username: input.frontend.username },
      update: {},
      create: {
        username: input.frontend.username,
        passwordHash: input.frontend.passwordHash,
        role: "frontend",
        displayName: input.frontend.displayName,
        tradingAccountId: input.frontend.tradingAccountId ?? input.frontend.username,
        isActive: true
      }
    });

    await prisma.appUser.upsert({
      where: { username: input.admin.username },
      update: {},
      create: {
        username: input.admin.username,
        passwordHash: input.admin.passwordHash,
        role: "admin",
        displayName: input.admin.displayName,
        tradingAccountId: null,
        isActive: true
      }
    });

    await prisma.platformSettings.upsert({
      where: { id: "platform" },
      update: {},
      create: {
        id: "platform",
        platformName: "Stratium Demo",
        platformAnnouncement: "Demo environment. Accounts are issued by admin only.",
        activeExchange: process.env.TRADING_EXCHANGE ?? process.env.MARKET_SOURCE ?? "hyperliquid",
        activeSymbol: process.env.TRADING_SYMBOL ?? "BTC-USD",
        maintenanceMode: false,
        allowFrontendTrading: true,
        allowManualTicks: true
      }
    });
  }

  async findUserByUsername(username: string): Promise<{
    id: string;
    username: string;
    passwordHash: string;
    role: "frontend" | "admin";
    displayName: string;
    tradingAccountId: string | null;
    isActive: boolean;
  } | null> {
    const user = await prisma.appUser.findUnique({
      where: { username }
    });

    if (!user) {
      return null;
    }

    return {
      id: user.id,
      username: user.username,
      passwordHash: user.passwordHash,
      role: user.role as "frontend" | "admin",
      displayName: user.displayName,
      tradingAccountId: user.tradingAccountId,
      isActive: user.isActive
    };
  }

  async listFrontendUsers(): Promise<Array<{
    id: string;
    username: string;
    passwordHash: string;
    role: "frontend";
    displayName: string;
    tradingAccountId: string | null;
    isActive: boolean;
  }>> {
    const users = await prisma.appUser.findMany({
      where: { role: "frontend" },
      orderBy: { username: "asc" }
    });

    return users.map((user) => ({
      id: user.id,
      username: user.username,
      passwordHash: user.passwordHash,
      role: "frontend" as const,
      displayName: user.displayName,
      tradingAccountId: user.tradingAccountId,
      isActive: user.isActive
    }));
  }

  async createFrontendUser(input: {
    username: string;
    passwordHash: string;
    displayName: string;
    tradingAccountId: string;
  }): Promise<{
    id: string;
    username: string;
    passwordHash: string;
    role: "frontend";
    displayName: string;
    tradingAccountId: string | null;
    isActive: boolean;
  }> {
    const user = await prisma.appUser.create({
      data: {
        username: input.username,
        passwordHash: input.passwordHash,
        role: "frontend",
        displayName: input.displayName,
        tradingAccountId: input.tradingAccountId,
        isActive: true
      }
    });

    return {
      id: user.id,
      username: user.username,
      passwordHash: user.passwordHash,
      role: "frontend",
      displayName: user.displayName,
      tradingAccountId: user.tradingAccountId,
      isActive: user.isActive
    };
  }

  async updateFrontendUser(userId: string, input: {
    passwordHash?: string;
    displayName?: string;
    tradingAccountId?: string | null;
    isActive?: boolean;
  }): Promise<{
    id: string;
    username: string;
    passwordHash: string;
    role: "frontend";
    displayName: string;
    tradingAccountId: string | null;
    isActive: boolean;
  }> {
    const user = await prisma.appUser.update({
      where: { id: userId },
      data: {
        ...(input.passwordHash ? { passwordHash: input.passwordHash } : {}),
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.tradingAccountId !== undefined ? { tradingAccountId: input.tradingAccountId } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {})
      }
    });

    return {
      id: user.id,
      username: user.username,
      passwordHash: user.passwordHash,
      role: "frontend",
      displayName: user.displayName,
      tradingAccountId: user.tradingAccountId,
      isActive: user.isActive
    };
  }

  async getPlatformSettings(): Promise<PlatformSettingsView> {
    const settings = await prisma.platformSettings.findUnique({
      where: { id: "platform" }
    });

    if (!settings) {
      return {
        platformName: "Stratium Demo",
        platformAnnouncement: "",
        activeExchange: process.env.TRADING_EXCHANGE ?? process.env.MARKET_SOURCE ?? "hyperliquid",
        activeSymbol: process.env.TRADING_SYMBOL ?? "BTC-USD",
        maintenanceMode: false,
        allowFrontendTrading: true,
        allowManualTicks: true
      };
    }

    return {
      platformName: settings.platformName,
      platformAnnouncement: settings.platformAnnouncement ?? "",
      activeExchange: settings.activeExchange,
      activeSymbol: settings.activeSymbol,
      maintenanceMode: settings.maintenanceMode,
      allowFrontendTrading: settings.allowFrontendTrading,
      allowManualTicks: settings.allowManualTicks
    };
  }

  async updatePlatformSettings(input: PlatformSettingsView): Promise<PlatformSettingsView> {
    const settings = await prisma.platformSettings.upsert({
      where: { id: "platform" },
      update: {
        platformName: input.platformName,
        platformAnnouncement: input.platformAnnouncement || null,
        activeExchange: input.activeExchange,
        activeSymbol: input.activeSymbol,
        maintenanceMode: input.maintenanceMode,
        allowFrontendTrading: input.allowFrontendTrading,
        allowManualTicks: input.allowManualTicks
      },
      create: {
        id: "platform",
        platformName: input.platformName,
        platformAnnouncement: input.platformAnnouncement || null,
        activeExchange: input.activeExchange,
        activeSymbol: input.activeSymbol,
        maintenanceMode: input.maintenanceMode,
        allowFrontendTrading: input.allowFrontendTrading,
        allowManualTicks: input.allowManualTicks
      }
    });

    return {
      platformName: settings.platformName,
      platformAnnouncement: settings.platformAnnouncement ?? "",
      activeExchange: settings.activeExchange,
      activeSymbol: settings.activeSymbol,
      maintenanceMode: settings.maintenanceMode,
      allowFrontendTrading: settings.allowFrontendTrading,
      allowManualTicks: settings.allowManualTicks
    };
  }

  async loadEvents(sessionId: string, afterSequence?: number): Promise<AnyEventEnvelope[]> {
    const events: Prisma.SimulationEventGetPayload<Record<string, never>>[] = [];
    let lastSequence: number | null = null;

    while (true) {
      const minSequence = Math.max(afterSequence ?? 0, lastSequence ?? 0);
      const batch: Prisma.SimulationEventGetPayload<Record<string, never>>[] = await prisma.simulationEvent.findMany({
        where: {
          simulationSessionId: sessionId,
          ...(minSequence > 0 ? { sequence: { gt: minSequence } } : {})
        },
        orderBy: {
          sequence: "asc"
        },
        take: EVENT_LOAD_BATCH_SIZE
      });

      if (batch.length === 0) {
        break;
      }

      events.push(...batch);
      lastSequence = batch[batch.length - 1]?.sequence ?? null;

      if (batch.length < EVENT_LOAD_BATCH_SIZE) {
        break;
      }
    }

    return events.map((event) => ({
      eventId: event.id,
      eventType: event.eventType as AnyEventEnvelope["eventType"],
      occurredAt: event.occurredAt.toISOString(),
      sequence: event.sequence,
      simulationSessionId: event.simulationSessionId,
      accountId: event.accountId,
      symbol: event.symbol,
      source: event.source as AnyEventEnvelope["source"],
      payload: event.payload as AnyEventEnvelope["payload"]
    }) as AnyEventEnvelope);
  }

  async loadSimulationSnapshot(sessionId: string): Promise<null | {
    lastSequence: number;
    createdAt: string;
    updatedAt: string;
    state: TradingEngineState;
  }> {
    const row = await prisma.simulationSnapshot.findUnique({
      where: { simulationSessionId: sessionId }
    });

    if (!row) {
      return null;
    }

    const state = row.state as unknown as TradingEngineState;

    return {
      lastSequence: row.lastSequence,
      createdAt: row.createdAt?.toISOString?.() ?? row.updatedAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      state: {
        ...state,
        simulationSessionId: row.simulationSessionId,
        account: {
          ...state.account,
          accountId: row.accountId
        },
        position: {
          ...state.position,
          symbol: row.symbol
        }
      }
    };
  }

  async listFillHistoryEvents(accountId: string): Promise<AnyEventEnvelope[]> {
    const fills = await prisma.fill.findMany({
      where: { accountId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });

    if (fills.length === 0) {
      return [];
    }

    const orders = await prisma.order.findMany({
      where: {
        accountId,
        id: {
          in: fills.map((fill) => orderRowId(accountId, fill.orderId))
        }
      }
    });
    const orderMap = new Map(
      orders.map((order) => [order.id, order])
    );
    const fillIdPrefix = `${accountId}:`;

    return fills.map((fill, index) => {
      const order = orderMap.get(orderRowId(accountId, fill.orderId));
      const fillPrice = toNumber(fill.price);
      const fillQuantity = toNumber(fill.quantity);
      const fee = toNumber(fill.fee);
      const notional = fillPrice * fillQuantity;
      const rawFillId = fill.id.startsWith(fillIdPrefix) ? fill.id.slice(fillIdPrefix.length) : fill.id;

      return {
        eventId: `persisted-${fill.id}`,
        eventType: "OrderFilled",
        occurredAt: fill.createdAt.toISOString(),
        sequence: index + 1,
        simulationSessionId: `persisted-${accountId}`,
        accountId,
        symbol: fill.symbol,
        source: "system",
        payload: {
          orderId: fill.orderId,
          fillId: rawFillId,
          fillPrice,
          fillQuantity,
          filledQuantityTotal: fillQuantity,
          remainingQuantity: 0,
          slippage: toNumber(fill.slippage),
          fee,
          feeRate: notional > 0 ? Number((fee / notional).toFixed(8)) : 0,
          liquidityRole: order?.orderType === "limit" ? "maker" : "taker",
          filledAt: fill.createdAt.toISOString()
        }
      } as AnyEventEnvelope;
    });
  }

  async listOrderHistoryViews(accountId: string): Promise<OrderView[]> {
    const rows = await prisma.order.findMany({
      where: { accountId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });

    return rows.map((row) => ({
      id: row.id.startsWith(`${accountId}:`) ? row.id.slice(`${accountId}:`.length) : row.id,
      accountId: row.accountId,
      symbol: row.symbol,
      side: row.side as OrderView["side"],
      orderType: row.orderType as OrderView["orderType"],
      status: row.status as OrderView["status"],
      quantity: toNumber(row.quantity),
      limitPrice: row.limitPrice == null ? undefined : toNumber(row.limitPrice),
      filledQuantity: toNumber(row.filledQuantity),
      remainingQuantity: toNumber(row.remainingQuantity),
      averageFillPrice: row.averageFillPrice == null ? undefined : toNumber(row.averageFillPrice),
      rejectionCode: row.rejectionCode == null ? undefined : row.rejectionCode as OrderView["rejectionCode"],
      rejectionMessage: row.rejectionMessage ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    }));
  }

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
    source: string;
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
      source: row.source,
      symbol: row.symbol,
      coin: row.coin,
      leverage: row.engineDefaultLeverage,
      maxLeverage: row.maxLeverage,
      szDecimals: row.szDecimals,
      quoteAsset: row.quoteAsset
    };
  }

  async listAvailableSymbolConfigMeta(): Promise<Array<{
    source: string;
    symbol: string;
    coin: string;
    leverage: number;
    maxLeverage: number;
    szDecimals: number;
    quoteAsset: string;
  }>> {
    const rows = await prisma.symbolConfig.findMany({
      where: { isActive: true },
      orderBy: [{ source: "asc" }, { coin: "asc" }, { symbol: "asc" }]
    });

    return rows.map((row) => ({
      source: row.source,
      symbol: row.symbol,
      coin: row.coin,
      leverage: row.engineDefaultLeverage,
      maxLeverage: row.maxLeverage,
      szDecimals: row.szDecimals,
      quoteAsset: row.quoteAsset
    }));
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

  async persistClosedMinuteCandles(
    candles: HyperliquidCandle[],
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
            coin_interval_openTime: {
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
            coin_interval_bucketStart: {
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

  async persistMarketSnapshot(snapshot: HyperliquidMarketSnapshot): Promise<void> {
    await this.persistClosedMinuteCandles(snapshot.candles, snapshot.source);
  }

  async loadRecentMarketSnapshot(coin: string, interval = "1m"): Promise<HyperliquidMarketSnapshot | null> {
    const candleWindowStart = new Date(Date.now() - RECENT_MARKET_WINDOW_MS);
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
        where: {
          coin,
          interval,
          source: "hyperliquid",
          openTime: {
            gte: candleWindowStart
          }
        },
        orderBy: { openTime: "asc" },
        take: RECENT_MARKET_CANDLE_LIMIT
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

  async persistState(state: TradingEngineState, events: AnyEventEnvelope[], persistSnapshot = true): Promise<void> {
    const operations: Promise<unknown>[] = [];
    const snapshotLastSequence = Math.max(0, state.nextSequence - 1);

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
            id: simulationEventRowId(event.simulationSessionId, event.eventId),
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
          prisma.marketTick.upsert({
            where: {
              id: marketTickRowId(event.symbol, payload.tickTime)
            },
            update: {
              symbol: event.symbol,
              bid: payload.bid,
              ask: payload.ask,
              last: payload.last,
              spread: payload.spread,
              volatilityTag: payload.volatilityTag,
              tickTime: new Date(payload.tickTime)
            },
            create: {
              id: marketTickRowId(event.symbol, payload.tickTime),
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
              id: fillRowId(event.accountId, payload.fillId)
            },
            update: {
              price: payload.fillPrice,
              quantity: payload.fillQuantity,
              slippage: payload.slippage,
              fee: payload.fee
            },
            create: {
              id: fillRowId(event.accountId, payload.fillId),
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

    if (persistSnapshot) {
      // Defer snapshot upsert until after the event batch is written so the
      // snapshot becomes the source of truth before we prune old events.
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
          id: positionRowId(state.account.accountId, state.position.symbol)
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
          id: positionRowId(state.account.accountId, state.position.symbol),
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
            id: orderRowId(order.accountId, order.id)
          },
          update: this.mapOrder(order),
          create: {
            id: orderRowId(order.accountId, order.id),
            ...this.mapOrder(order)
          }
        })
      );
    }

    await Promise.allSettled(operations);

    if (!persistSnapshot) {
      return;
    }

    await prisma.simulationSnapshot.upsert({
      where: {
        simulationSessionId: state.simulationSessionId
      },
      update: {
        accountId: state.account.accountId,
        symbol: state.position.symbol,
        lastSequence: snapshotLastSequence,
        state: toStoredJson(state)
      },
      create: {
        simulationSessionId: state.simulationSessionId,
        accountId: state.account.accountId,
        symbol: state.position.symbol,
        lastSequence: snapshotLastSequence,
        state: toStoredJson(state)
      }
    });

    await prisma.simulationEvent.deleteMany({
      where: {
        simulationSessionId: state.simulationSessionId,
        sequence: {
          lte: snapshotLastSequence
        }
      }
    });
  }

  async loadSnapshot(accountId: string): Promise<{
    account: TradingEngineState["account"] | null;
    position: TradingEngineState["position"] | null;
  }> {
    const [account, position] = await Promise.all([
      prisma.account.findUnique({ where: { id: accountId } }),
      prisma.position.findFirst({ where: { accountId }, orderBy: { updatedAt: "desc" } })
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

  async getNextTriggerOrderOid(base = 1_000_000_000): Promise<number> {
    const latest = await prisma.triggerOrderHistory.findFirst({
      orderBy: { oid: "desc" },
      select: { oid: true }
    });

    return Math.max(base, latest?.oid ?? base) + 1;
  }

  async upsertTriggerOrderHistory(input: {
    oid: number;
    accountId: string;
    asset: number;
    isBuy: boolean;
    triggerPx: number;
    actualTriggerPx?: number | null;
    isMarket: boolean;
    tpsl: "tp" | "sl";
    size: number;
    limitPx?: number | null;
    reduceOnly: boolean;
    cloid?: string;
    status: string;
    createdAt?: number;
    updatedAt?: number;
  }): Promise<void> {
    await prisma.triggerOrderHistory.upsert({
      where: { oid: input.oid },
      update: {
        asset: input.asset,
        isBuy: input.isBuy,
        triggerPx: input.triggerPx,
        actualTriggerPx: input.actualTriggerPx ?? null,
        isMarket: input.isMarket,
        tpsl: input.tpsl,
        size: input.size,
        limitPx: input.limitPx ?? null,
        reduceOnly: input.reduceOnly,
        cloid: input.cloid ?? null,
        status: input.status,
        updatedAt: new Date(input.updatedAt ?? Date.now())
      },
      create: {
        id: triggerOrderRowId(input.accountId, input.oid),
        oid: input.oid,
        accountId: input.accountId,
        asset: input.asset,
        isBuy: input.isBuy,
        triggerPx: input.triggerPx,
        actualTriggerPx: input.actualTriggerPx ?? null,
        isMarket: input.isMarket,
        tpsl: input.tpsl,
        size: input.size,
        limitPx: input.limitPx ?? null,
        reduceOnly: input.reduceOnly,
        cloid: input.cloid ?? null,
        status: input.status,
        createdAt: new Date(input.createdAt ?? Date.now()),
        updatedAt: new Date(input.updatedAt ?? Date.now())
      }
    });
  }

  async listTriggerOrderHistory(accountId: string): Promise<Array<{
    oid: number;
    accountId: string;
    asset: number;
    isBuy: boolean;
    triggerPx: number;
    actualTriggerPx?: number;
    isMarket: boolean;
    tpsl: "tp" | "sl";
    size: number;
    limitPx?: number;
    reduceOnly: boolean;
    cloid?: string;
    status: "waitingForParent" | "triggerPending" | "triggered" | "filled" | "canceled";
    createdAt: number;
    updatedAt: number;
  }>> {
    const rows = await prisma.triggerOrderHistory.findMany({
      where: { accountId },
      orderBy: { updatedAt: "desc" }
    });

    return rows.map((row) => ({
      oid: row.oid,
      accountId: row.accountId,
      asset: row.asset,
      isBuy: row.isBuy,
      triggerPx: toNumber(row.triggerPx),
      actualTriggerPx: row.actualTriggerPx == null ? undefined : toNumber(row.actualTriggerPx),
      isMarket: row.isMarket,
      tpsl: row.tpsl as "tp" | "sl",
      size: toNumber(row.size),
      limitPx: row.limitPx == null ? undefined : toNumber(row.limitPx),
      reduceOnly: row.reduceOnly,
      cloid: row.cloid ?? undefined,
      status: row.status as "waitingForParent" | "triggerPending" | "triggered" | "filled" | "canceled",
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime()
    }));
  }

  async listPendingTriggerOrders(): Promise<Array<{
    oid: number;
    accountId: string;
    asset: number;
    isBuy: boolean;
    triggerPx: number;
    isMarket: boolean;
    tpsl: "tp" | "sl";
    size: number;
    limitPx?: number;
    reduceOnly: boolean;
    cloid?: string;
    createdAt: number;
  }>> {
    const rows = await prisma.triggerOrderHistory.findMany({
      where: { status: "triggerPending" },
      orderBy: { createdAt: "asc" }
    });

    return rows.map((row) => ({
      oid: row.oid,
      accountId: row.accountId,
      asset: row.asset,
      isBuy: row.isBuy,
      triggerPx: toNumber(row.triggerPx),
      isMarket: row.isMarket,
      tpsl: row.tpsl as "tp" | "sl",
      size: toNumber(row.size),
      limitPx: row.limitPx == null ? undefined : toNumber(row.limitPx),
      reduceOnly: row.reduceOnly,
      cloid: row.cloid ?? undefined,
      createdAt: row.createdAt.getTime()
    }));
  }

  async findTriggerOrder(accountId: string, oidOrCloid: number | string): Promise<null | {
    oid: number;
    accountId: string;
    asset: number;
    isBuy: boolean;
    triggerPx: number;
    actualTriggerPx?: number;
    isMarket: boolean;
    tpsl: "tp" | "sl";
    size: number;
    limitPx?: number;
    reduceOnly: boolean;
    cloid?: string;
    status: "waitingForParent" | "triggerPending" | "triggered" | "filled" | "canceled";
    createdAt: number;
    updatedAt: number;
  }> {
    const row = typeof oidOrCloid === "string" && oidOrCloid.startsWith("0x")
      ? await prisma.triggerOrderHistory.findFirst({ where: { accountId, cloid: oidOrCloid } })
      : await prisma.triggerOrderHistory.findFirst({ where: { accountId, oid: Number(oidOrCloid) } });

    if (!row) {
      return null;
    }

    return {
      oid: row.oid,
      accountId: row.accountId,
      asset: row.asset,
      isBuy: row.isBuy,
      triggerPx: toNumber(row.triggerPx),
      actualTriggerPx: row.actualTriggerPx == null ? undefined : toNumber(row.actualTriggerPx),
      isMarket: row.isMarket,
      tpsl: row.tpsl as "tp" | "sl",
      size: toNumber(row.size),
      limitPx: row.limitPx == null ? undefined : toNumber(row.limitPx),
      reduceOnly: row.reduceOnly,
      cloid: row.cloid ?? undefined,
      status: row.status as "waitingForParent" | "triggerPending" | "triggered" | "filled" | "canceled",
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime()
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
