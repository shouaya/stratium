import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnyEventEnvelope } from "@stratium/shared";

const prismaMock = vi.hoisted(() => ({
  $connect: vi.fn(),
  $disconnect: vi.fn(),
  simulationEvent: {
    findMany: vi.fn(),
    upsert: vi.fn()
  },
  symbolConfig: {
    findUnique: vi.fn(),
    update: vi.fn()
  },
  marketBookSnapshot: {
    upsert: vi.fn(),
    findFirst: vi.fn()
  },
  marketBookLevel: {
    upsert: vi.fn(),
    findMany: vi.fn()
  },
  marketTrade: {
    upsert: vi.fn(),
    findMany: vi.fn()
  },
  marketCandle: {
    upsert: vi.fn(),
    findMany: vi.fn()
  },
  marketVolumeRecord: {
    upsert: vi.fn(),
    findMany: vi.fn()
  },
  marketAssetContext: {
    create: vi.fn(),
    findFirst: vi.fn()
  },
  marketTick: {
    create: vi.fn(),
    upsert: vi.fn()
  },
  fill: {
    upsert: vi.fn()
  },
  appUser: {
    upsert: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn()
  },
  platformSettings: {
    upsert: vi.fn(),
    findUnique: vi.fn()
  },
  account: {
    upsert: vi.fn(),
    findUnique: vi.fn()
  },
  position: {
    upsert: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn()
  },
  order: {
    upsert: vi.fn()
  }
}));

vi.mock("@prisma/client", () => ({
  PrismaClient: class {
    constructor() {
      return prismaMock;
    }
  },
  Prisma: {}
}));

const { TradingRepository } = await import("../src/repository");

describe("TradingRepository", () => {
  const repository = new TradingRepository();

  beforeEach(() => {
    vi.clearAllMocks();
    for (const group of Object.values(prismaMock)) {
      if (group && typeof group === "object") {
        for (const fn of Object.values(group)) {
          if (typeof fn === "function") {
            fn.mockResolvedValue?.({});
          }
        }
      }
    }
    prismaMock.marketTick.create.mockReturnValue(Promise.resolve({}));
    prismaMock.marketTick.upsert.mockReturnValue(Promise.resolve({}));
  });

  it("connects and closes prisma", async () => {
    await repository.connect();
    await repository.close();

    expect(prismaMock.$connect).toHaveBeenCalled();
    expect(prismaMock.$disconnect).toHaveBeenCalled();
  });

  it("seeds default access, loads users, and manages frontend users and platform settings", async () => {
    prismaMock.appUser.upsert.mockResolvedValue({});
    prismaMock.platformSettings.upsert.mockResolvedValue({
      id: "platform",
      platformName: "Desk",
      platformAnnouncement: "Notice",
      allowFrontendTrading: false,
      allowManualTicks: false,
      allowSimulatorControl: false
    });
    prismaMock.appUser.findUnique.mockResolvedValueOnce({
      id: "user-1",
      username: "demo",
      passwordHash: "hash",
      role: "frontend",
      displayName: "Demo Trader",
      tradingAccountId: "paper-demo",
      isActive: true
    }).mockResolvedValueOnce(null);
    prismaMock.appUser.findMany.mockResolvedValue([{
      id: "user-1",
      username: "demo",
      passwordHash: "hash",
      role: "frontend",
      displayName: "Demo Trader",
      tradingAccountId: "paper-demo",
      isActive: true
    }]);
    prismaMock.appUser.create.mockResolvedValue({
      id: "user-2",
      username: "alice",
      passwordHash: "hash2",
      role: "frontend",
      displayName: "Alice",
      tradingAccountId: "paper-alice",
      isActive: true
    });
    prismaMock.appUser.update.mockResolvedValue({
      id: "user-2",
      username: "alice",
      passwordHash: "hash3",
      role: "frontend",
      displayName: "Alice 2",
      tradingAccountId: null,
      isActive: false
    });
    prismaMock.platformSettings.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "platform",
        platformName: "Desk",
        platformAnnouncement: "Notice",
        allowFrontendTrading: false,
        allowManualTicks: false,
        allowSimulatorControl: false
      });

    await repository.ensureDefaultAccess({
      frontend: {
        username: "demo",
        passwordHash: "hash",
        displayName: "Demo Trader",
        tradingAccountId: "paper-demo"
      },
      admin: {
        username: "admin",
        passwordHash: "hash-admin",
        displayName: "Admin"
      }
    });
    expect(prismaMock.appUser.upsert).toHaveBeenCalledTimes(2);
    expect(prismaMock.platformSettings.upsert).toHaveBeenCalled();

    expect(await repository.findUserByUsername("demo")).toEqual({
      id: "user-1",
      username: "demo",
      passwordHash: "hash",
      role: "frontend",
      displayName: "Demo Trader",
      tradingAccountId: "paper-demo",
      isActive: true
    });
    expect(await repository.findUserByUsername("missing")).toBeNull();

    expect(await repository.listFrontendUsers()).toEqual([{
      id: "user-1",
      username: "demo",
      passwordHash: "hash",
      role: "frontend",
      displayName: "Demo Trader",
      tradingAccountId: "paper-demo",
      isActive: true
    }]);

    expect(await repository.createFrontendUser({
      username: "alice",
      passwordHash: "hash2",
      displayName: "Alice",
      tradingAccountId: "paper-alice"
    })).toEqual({
      id: "user-2",
      username: "alice",
      passwordHash: "hash2",
      role: "frontend",
      displayName: "Alice",
      tradingAccountId: "paper-alice",
      isActive: true
    });

    expect(await repository.updateFrontendUser("user-2", {
      passwordHash: "hash3",
      displayName: "Alice 2",
      tradingAccountId: null,
      isActive: false
    })).toEqual({
      id: "user-2",
      username: "alice",
      passwordHash: "hash3",
      role: "frontend",
      displayName: "Alice 2",
      tradingAccountId: null,
      isActive: false
    });

    expect(await repository.getPlatformSettings()).toEqual({
      platformName: "Stratium Demo",
      platformAnnouncement: "",
      allowFrontendTrading: true,
      allowManualTicks: true,
      allowSimulatorControl: true
    });
    expect(await repository.getPlatformSettings()).toEqual({
      platformName: "Desk",
      platformAnnouncement: "Notice",
      allowFrontendTrading: false,
      allowManualTicks: false,
      allowSimulatorControl: false
    });

    expect(await repository.updatePlatformSettings({
      platformName: "Desk",
      platformAnnouncement: "Notice",
      allowFrontendTrading: false,
      allowManualTicks: false,
      allowSimulatorControl: false
    })).toEqual({
      platformName: "Desk",
      platformAnnouncement: "Notice",
      allowFrontendTrading: false,
      allowManualTicks: false,
      allowSimulatorControl: false
    });
  });

  it("loads events and symbol config metadata", async () => {
    prismaMock.simulationEvent.findMany.mockResolvedValue([{
      id: "evt-1",
      eventType: "OrderAccepted",
      occurredAt: new Date("2026-01-01T00:00:00.000Z"),
      sequence: 1,
      simulationSessionId: "session-1",
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      source: "system",
      payload: { orderId: "ord-1" }
    }]);
    prismaMock.symbolConfig.findUnique
      .mockResolvedValueOnce({
        symbol: "BTC-USD",
        engineDefaultLeverage: 8,
        engineMaintenanceMarginRate: 0.005,
        baseTakerFeeRate: 0.0005,
        baseMakerFeeRate: 0.0002,
        engineBaseSlippageBps: 3,
        enginePartialFillEnabled: false
      })
      .mockResolvedValueOnce({
        symbol: "BTC-USD",
        coin: "BTC",
        engineDefaultLeverage: 8,
        maxLeverage: 20,
        szDecimals: 5,
        quoteAsset: "USDC"
      });

    expect(await repository.loadEvents("session-1")).toEqual([{
      eventId: "evt-1",
      eventType: "OrderAccepted",
      occurredAt: "2026-01-01T00:00:00.000Z",
      sequence: 1,
      simulationSessionId: "session-1",
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      source: "system",
      payload: { orderId: "ord-1" }
    }]);
    expect(await repository.loadSymbolConfig("BTC-USD")).toEqual({
      symbol: "BTC-USD",
      leverage: 8,
      maintenanceMarginRate: 0.005,
      takerFeeRate: 0.0005,
      makerFeeRate: 0.0002,
      baseSlippageBps: 3,
      partialFillEnabled: false
    });
    expect(await repository.loadSymbolConfigMeta("BTC-USD")).toEqual({
      symbol: "BTC-USD",
      coin: "BTC",
      leverage: 8,
      maxLeverage: 20,
      szDecimals: 5,
      quoteAsset: "USDC"
    });
  });

  it("returns null for missing symbol config rows", async () => {
    prismaMock.symbolConfig.findUnique.mockResolvedValue(null);

    expect(await repository.loadSymbolConfig("ETH-USD")).toBeNull();
    expect(await repository.loadSymbolConfigMeta("ETH-USD")).toBeNull();
  });

  it("updates leverage and persists closed 1m candles only", async () => {
    await repository.updateSymbolLeverage("BTC-USD", 4);
    expect(prismaMock.symbolConfig.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { symbol: "BTC-USD" }
    }));

    await repository.persistMarketSnapshot({
      source: "simulator",
      coin: "BTC",
      connected: false,
      book: { bids: [], asks: [] },
      trades: [],
      candles: []
    });
    expect(prismaMock.marketBookSnapshot.upsert).not.toHaveBeenCalled();

    await repository.persistClosedMinuteCandles([
      {
        id: "candle-1",
        coin: "BTC",
        interval: "1m",
        openTime: 1000,
        closeTime: 2000,
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 100,
        tradeCount: 3
      },
      {
        id: "candle-2",
        coin: "BTC",
        interval: "5m",
        openTime: 1000,
        closeTime: 2000,
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 100,
        tradeCount: 3
      }
    ]);

    expect(prismaMock.marketCandle.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.marketVolumeRecord.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.marketBookSnapshot.upsert).not.toHaveBeenCalled();
    expect(prismaMock.marketBookLevel.upsert).not.toHaveBeenCalled();
    expect(prismaMock.marketTrade.upsert).not.toHaveBeenCalled();
    expect(prismaMock.marketAssetContext.create).not.toHaveBeenCalled();

    await repository.persistMarketSnapshot({
      source: "hyperliquid",
      coin: "BTC",
      connected: true,
      bestBid: 70000,
      bestAsk: 70002,
      markPrice: 70001,
      book: {
        bids: [{ price: 70000, size: 1, orders: 2 }],
        asks: [{ price: 70002, size: 1.5, orders: 1 }],
        updatedAt: 1000
      },
      trades: [
        { id: "trade-1", coin: "BTC", side: "buy", price: 70001, size: 0.1, time: 1000 }
      ],
      candles: [
        {
          id: "candle-1",
          coin: "BTC",
          interval: "1m",
          openTime: 1000,
          closeTime: 2000,
          open: 1,
          high: 2,
          low: 0.5,
          close: 1.5,
          volume: 100,
          tradeCount: 3
        }
      ],
      assetCtx: {
        coin: "BTC",
        markPrice: 70001,
        capturedAt: 1000
      }
    });
    expect(prismaMock.marketCandle.upsert).toHaveBeenCalledTimes(2);
    expect(prismaMock.marketVolumeRecord.upsert).toHaveBeenCalledTimes(2);
  });

  it("loads recent market snapshots and volume records", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-09T12:00:00.000Z"));
    prismaMock.marketBookSnapshot.findFirst.mockResolvedValue({
      id: "snapshot-1",
      bestBid: 70000,
      bestAsk: 70002,
      capturedAt: new Date(1000)
    });
    prismaMock.marketTrade.findMany.mockResolvedValue([
      { id: "trade-1", coin: "BTC", side: "buy", price: 70001, size: 0.1, tradeTime: new Date(1000) }
    ]);
    prismaMock.marketCandle.findMany.mockResolvedValue([
      {
        id: "candle-1",
        coin: "BTC",
        interval: "1m",
        openTime: new Date(1000),
        closeTime: new Date(2000),
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 100,
        tradeCount: 3
      }
    ]);
    prismaMock.marketAssetContext.findFirst.mockResolvedValue({
      coin: "BTC",
      markPrice: 70001,
      midPrice: 70000,
      oraclePrice: 69999,
      fundingRate: 0.0001,
      openInterest: 5,
      prevDayPrice: 69000,
      dayNotionalVolume: 10000,
      capturedAt: new Date(3000)
    });
    prismaMock.marketBookLevel.findMany
      .mockResolvedValueOnce([{ levelIndex: 0, price: 70000, size: 1, orders: 2 }])
      .mockResolvedValueOnce([{ levelIndex: 0, price: 70002, size: 1.5, orders: 1 }]);
    prismaMock.marketVolumeRecord.findMany.mockResolvedValue([
      {
        id: "vol-1",
        source: "hyperliquid",
        coin: "BTC",
        interval: "1m",
        bucketStart: new Date(1000),
        bucketEnd: new Date(2000),
        volume: 100,
        tradeCount: 3
      }
    ]);

    expect(await repository.loadRecentMarketSnapshot("BTC", "1m")).toEqual({
      source: "hyperliquid",
      coin: "BTC",
      connected: false,
      bestBid: 70000,
      bestAsk: 70002,
      markPrice: 70001,
      book: {
        bids: [{ price: 70000, size: 1, orders: 2 }],
        asks: [{ price: 70002, size: 1.5, orders: 1 }],
        updatedAt: 1000
      },
      trades: [{ id: "trade-1", coin: "BTC", side: "buy", price: 70001, size: 0.1, time: 1000 }],
      candles: [{
        id: "candle-1",
        coin: "BTC",
        interval: "1m",
        openTime: 1000,
        closeTime: 2000,
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 100,
        tradeCount: 3
      }],
      assetCtx: {
        coin: "BTC",
        markPrice: 70001,
        midPrice: 70000,
        oraclePrice: 69999,
        fundingRate: 0.0001,
        openInterest: 5,
        prevDayPrice: 69000,
        dayNotionalVolume: 10000,
        capturedAt: 3000
      }
    });

    expect(await repository.loadRecentVolumeRecords("BTC", "1m", 5000)).toEqual([{
      id: "vol-1",
      source: "hyperliquid",
      coin: "BTC",
      interval: "1m",
      bucketStart: 1000,
      bucketEnd: 2000,
      volume: 100,
      tradeCount: 3
    }]);
    expect(prismaMock.marketCandle.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        openTime: {
          gte: new Date("2026-04-08T12:00:00.000Z")
        }
      }),
      take: 1440
    }));
  });

  it("maps optional market snapshot fields to undefined and clamps volume query limits", async () => {
    prismaMock.marketBookSnapshot.findFirst.mockResolvedValue({
      id: "snapshot-1",
      bestBid: 0,
      bestAsk: 0,
      capturedAt: new Date(1000)
    });
    prismaMock.marketTrade.findMany.mockResolvedValue([]);
    prismaMock.marketCandle.findMany.mockResolvedValue([]);
    prismaMock.marketAssetContext.findFirst.mockResolvedValue({
      coin: "BTC",
      markPrice: null,
      midPrice: null,
      oraclePrice: null,
      fundingRate: null,
      openInterest: null,
      prevDayPrice: null,
      dayNotionalVolume: null,
      capturedAt: new Date(3000)
    });
    prismaMock.marketBookLevel.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    prismaMock.marketVolumeRecord.findMany.mockResolvedValue([]);

    expect(await repository.loadRecentMarketSnapshot("BTC", "1m")).toEqual({
      source: "hyperliquid",
      coin: "BTC",
      connected: false,
      bestBid: undefined,
      bestAsk: undefined,
      markPrice: undefined,
      book: {
        bids: [],
        asks: [],
        updatedAt: 1000
      },
      trades: [],
      candles: [],
      assetCtx: {
        coin: "BTC",
        markPrice: undefined,
        midPrice: undefined,
        oraclePrice: undefined,
        fundingRate: undefined,
        openInterest: undefined,
        prevDayPrice: undefined,
        dayNotionalVolume: undefined,
        capturedAt: 3000
      }
    });

    await repository.loadRecentVolumeRecords("BTC", "1m", -10);
    expect(prismaMock.marketVolumeRecord.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      take: 1
    }));
  });

  it("returns null when no recent market snapshot is available", async () => {
    prismaMock.marketBookSnapshot.findFirst.mockResolvedValue(null);
    prismaMock.marketTrade.findMany.mockResolvedValue([]);
    prismaMock.marketCandle.findMany.mockResolvedValue([]);
    prismaMock.marketAssetContext.findFirst.mockResolvedValue(null);
    prismaMock.marketBookLevel.findMany.mockResolvedValue([]);

    expect(await repository.loadRecentMarketSnapshot("BTC", "1m")).toBeNull();
  });

  it("persists state, fills, ticks, and loads account snapshots", async () => {
    const events = [
      {
        eventId: "evt-1",
        eventType: "MarketTickReceived",
        occurredAt: "2026-01-01T00:00:00.000Z",
        sequence: 1,
        simulationSessionId: "session-1",
        accountId: "paper-account-1",
        symbol: "BTC-USD",
        source: "system",
        payload: {
          symbol: "BTC-USD",
          bid: 70000,
          ask: 70002,
          last: 70001,
          spread: 2,
          tickTime: "2026-01-01T00:00:00.000Z",
          volatilityTag: "normal"
        }
      },
      {
        eventId: "evt-2",
        eventType: "OrderFilled",
        occurredAt: "2026-01-01T00:00:01.000Z",
        sequence: 2,
        simulationSessionId: "session-1",
        accountId: "paper-account-1",
        symbol: "BTC-USD",
        source: "system",
        payload: {
          orderId: "ord-1",
          fillId: "fill-1",
          fillPrice: 70001,
          fillQuantity: 1,
          slippage: 0.5,
          fee: 10
        }
      }
    ] satisfies AnyEventEnvelope[];

    await repository.persistState({
      simulationSessionId: "session-1",
      sequence: 2,
      latestTick: null,
      account: {
        accountId: "paper-account-1",
        walletBalance: 10000,
        availableBalance: 9000,
        positionMargin: 500,
        orderMargin: 100,
        equity: 10100,
        realizedPnl: 20,
        unrealizedPnl: 80,
        riskRatio: 0.2
      },
      position: {
        symbol: "BTC-USD",
        side: "long",
        quantity: 1,
        averageEntryPrice: 70001,
        markPrice: 70010,
        realizedPnl: 20,
        unrealizedPnl: 9,
        initialMargin: 500,
        maintenanceMargin: 100,
        liquidationPrice: 65000
      },
      orders: [{
        id: "ord-1",
        accountId: "paper-account-1",
        symbol: "BTC-USD",
        side: "buy",
        orderType: "market",
        status: "filled",
        quantity: 1,
        filledQuantity: 1,
        remainingQuantity: 0,
        averageFillPrice: 70001,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:01.000Z"
      }]
    }, events);

    expect(prismaMock.simulationEvent.upsert).toHaveBeenCalledTimes(2);
    expect(prismaMock.marketTick.upsert).toHaveBeenCalled();
    expect(prismaMock.fill.upsert).toHaveBeenCalled();
    expect(prismaMock.account.upsert).toHaveBeenCalled();
    expect(prismaMock.position.upsert).toHaveBeenCalled();
    expect(prismaMock.order.upsert).toHaveBeenCalled();

    prismaMock.account.findUnique.mockResolvedValue({
      id: "paper-account-1",
      walletBalance: 10000,
      availableBalance: 9000,
      positionMargin: 500,
      orderMargin: 100,
      equity: 10100,
      realizedPnl: 20,
      unrealizedPnl: 80,
      riskRatio: 0.2
    });
    prismaMock.position.findFirst.mockResolvedValue({
      symbol: "BTC-USD",
      side: "long",
      quantity: 1,
      averageEntryPrice: 70001,
      markPrice: 70010,
      realizedPnl: 20,
      unrealizedPnl: 9,
      initialMargin: 500,
      maintenanceMargin: 100,
      liquidationPrice: 65000
    });

    expect(await repository.loadSnapshot("paper-account-1")).toEqual({
      account: {
        accountId: "paper-account-1",
        walletBalance: 10000,
        availableBalance: 9000,
        positionMargin: 500,
        orderMargin: 100,
        equity: 10100,
        realizedPnl: 20,
        unrealizedPnl: 80,
        riskRatio: 0.2
      },
      position: {
        symbol: "BTC-USD",
        side: "long",
        quantity: 1,
        averageEntryPrice: 70001,
        markPrice: 70010,
        realizedPnl: 20,
        unrealizedPnl: 9,
        initialMargin: 500,
        maintenanceMargin: 100,
        liquidationPrice: 65000
      }
    });
  });

  it("loads null account and null position snapshots", async () => {
    prismaMock.account.findUnique.mockResolvedValue(null);
    prismaMock.position.findFirst.mockResolvedValue(null);

    expect(await repository.loadSnapshot("paper-account-2")).toEqual({
      account: null,
      position: null
    });
  });

  it("persists partial fill events and nullable order fields", async () => {
    await repository.persistState({
      simulationSessionId: "session-1",
      sequence: 1,
      latestTick: null,
      account: {
        accountId: "paper-account-1",
        walletBalance: 1,
        availableBalance: 1,
        positionMargin: 0,
        orderMargin: 0,
        equity: 1,
        realizedPnl: 0,
        unrealizedPnl: 0,
        riskRatio: 0
      },
      position: {
        symbol: "BTC-USD",
        side: "flat",
        quantity: 0,
        averageEntryPrice: 0,
        markPrice: 0,
        realizedPnl: 0,
        unrealizedPnl: 0,
        initialMargin: 0,
        maintenanceMargin: 0,
        liquidationPrice: 0
      },
      orders: [{
        id: "ord-nullable",
        accountId: "paper-account-1",
        symbol: "BTC-USD",
        side: "sell",
        orderType: "limit",
        status: "rejected",
        quantity: 1,
        limitPrice: 100,
        filledQuantity: 0,
        remainingQuantity: 1,
        averageFillPrice: undefined,
        rejectionCode: undefined,
        rejectionMessage: undefined,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:01.000Z"
      }]
    }, [{
      eventId: "evt-partial",
      eventType: "OrderPartiallyFilled",
      occurredAt: "2026-01-01T00:00:00.000Z",
      sequence: 1,
      simulationSessionId: "session-1",
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      source: "system",
      payload: {
        orderId: "ord-nullable",
        fillId: "fill-partial",
        fillPrice: 100,
        fillQuantity: 0.5,
        slippage: 0,
        fee: 0.1
      }
    } satisfies AnyEventEnvelope]);

    expect(prismaMock.fill.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "paper-account-1:fill-partial" }
    }));
    expect(prismaMock.order.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        averageFillPrice: null,
        rejectionCode: null,
        rejectionMessage: null
      })
    }));
  });
});
