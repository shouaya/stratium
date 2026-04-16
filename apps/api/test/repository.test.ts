import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnyEventEnvelope } from "@stratium/shared";

const prismaMock = vi.hoisted(() => ({
  $connect: vi.fn(),
  $disconnect: vi.fn(),
  $transaction: vi.fn(),
  simulationEvent: {
    findMany: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn()
  },
  simulationSnapshot: {
    findUnique: vi.fn(),
    upsert: vi.fn()
  },
  symbolConfig: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn()
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
  liquidationEvent: {
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
  triggerOrderHistory: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    upsert: vi.fn()
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
    upsert: vi.fn(),
    findMany: vi.fn()
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

const { TradingRepository } = await import("../src/persistence/repository");

describe("TradingRepository", () => {
  const repository = new TradingRepository();

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (input: Array<Promise<unknown>> | ((tx: typeof prismaMock) => Promise<unknown>)) => {
      if (typeof input === "function") {
        return input(prismaMock as never);
      }

      return Promise.all(input);
    });
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
      activeExchange: "hyperliquid",
      activeSymbol: "BTC-USD",
      maintenanceMode: false,
      allowFrontendTrading: false,
      allowManualTicks: false
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
        activeExchange: "hyperliquid",
        activeSymbol: "BTC-USD",
        maintenanceMode: false,
        allowFrontendTrading: false,
        allowManualTicks: false
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
      activeExchange: "hyperliquid",
      activeSymbol: "BTC-USD",
      maintenanceMode: false,
      allowFrontendTrading: true,
      allowManualTicks: true
    });
    expect(await repository.getPlatformSettings()).toEqual({
      platformName: "Desk",
      platformAnnouncement: "Notice",
      activeExchange: "hyperliquid",
      activeSymbol: "BTC-USD",
      maintenanceMode: false,
      allowFrontendTrading: false,
      allowManualTicks: false
    });

    expect(await repository.updatePlatformSettings({
      platformName: "Desk",
      platformAnnouncement: "Notice",
      activeExchange: "hyperliquid",
      activeSymbol: "BTC-USD",
      maintenanceMode: false,
      allowFrontendTrading: false,
      allowManualTicks: false
    })).toEqual({
      platformName: "Desk",
      platformAnnouncement: "Notice",
      activeExchange: "hyperliquid",
      activeSymbol: "BTC-USD",
      maintenanceMode: false,
      allowFrontendTrading: false,
      allowManualTicks: false
    });
  });

  it("loads events and symbol config metadata", async () => {
    prismaMock.simulationEvent.findMany.mockResolvedValueOnce([{
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
    prismaMock.simulationSnapshot.findUnique.mockResolvedValue({
      simulationSessionId: "session-1",
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      lastSequence: 12,
      updatedAt: new Date("2026-01-01T00:12:00.000Z"),
      state: {
        simulationSessionId: "session-1",
        account: {
          accountId: "paper-account-1",
          walletBalance: 10000,
          availableBalance: 10000,
          positionMargin: 0,
          orderMargin: 0,
          equity: 10000,
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
        orders: [],
        nextSequence: 13,
        nextOrderId: 1,
        nextFillId: 1
      }
    });
    prismaMock.symbolConfig.findFirst
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
        source: "hyperliquid",
        symbol: "BTC-USD",
        coin: "BTC",
        marketSymbol: "BTC",
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
    expect(await repository.loadSimulationSnapshot("session-1")).toEqual({
      lastSequence: 12,
      createdAt: "2026-01-01T00:12:00.000Z",
      updatedAt: "2026-01-01T00:12:00.000Z",
      state: {
        simulationSessionId: "session-1",
        account: {
          accountId: "paper-account-1",
          walletBalance: 10000,
          availableBalance: 10000,
          positionMargin: 0,
          orderMargin: 0,
          equity: 10000,
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
        orders: [],
        nextSequence: 13,
        nextOrderId: 1,
        nextFillId: 1
      }
    });
    expect(prismaMock.simulationEvent.findMany).toHaveBeenNthCalledWith(1, {
      where: {
        simulationSessionId: "session-1"
      },
      orderBy: {
        sequence: "asc"
      },
      take: 2000
    });
    expect(prismaMock.simulationSnapshot.findUnique).toHaveBeenCalledWith({
      where: { simulationSessionId: "session-1" }
    });
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
      source: "hyperliquid",
      symbol: "BTC-USD",
      coin: "BTC",
      marketSymbol: "BTC",
      leverage: 8,
      maxLeverage: 20,
      szDecimals: 5,
      quoteAsset: "USDC"
    });
  });

  it("returns null for missing symbol config rows", async () => {
    prismaMock.symbolConfig.findFirst.mockResolvedValue(null);
    prismaMock.symbolConfig.findUnique.mockResolvedValue(null);

    expect(await repository.loadSymbolConfig("ETH-USD")).toBeNull();
    expect(await repository.loadSymbolConfigMeta("ETH-USD")).toBeNull();
  });

  it("updates leverage and persists 1m candles only", async () => {
    await repository.updateSymbolLeverage("BTC-USD", 4);
    expect(prismaMock.symbolConfig.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { symbol: "BTC-USD" }
    }));

    await repository.persistMarketSnapshot({
      source: "hyperliquid",
      coin: "BTC",
      connected: false,
      book: { bids: [], asks: [] },
      trades: [],
      candles: []
    });
    expect(prismaMock.marketBookSnapshot.upsert).not.toHaveBeenCalled();

    await repository.persistMinuteCandles([
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

    await repository.persistClosedMinuteCandles([
      {
        id: "candle-1b",
        coin: "BTC",
        interval: "1m",
        openTime: 2000,
        closeTime: 3000,
        open: 2,
        high: 3,
        low: 1.5,
        close: 2.5,
        volume: 50,
        tradeCount: 2
      }
    ]);

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
    expect(prismaMock.marketCandle.upsert).toHaveBeenCalledTimes(3);
    expect(prismaMock.marketVolumeRecord.upsert).toHaveBeenCalledTimes(3);
  });

  it("covers repository fallback branches for leverage updates and market mappers", async () => {
    prismaMock.symbolConfig.updateMany = undefined as unknown as typeof prismaMock.symbolConfig.updateMany;
    prismaMock.symbolConfig.update.mockResolvedValue({});

    await repository.updateSymbolLeverage("BTC-USD", 9);

    expect(prismaMock.symbolConfig.update).toHaveBeenCalledWith({
      where: { symbol: "BTC-USD" },
      data: expect.objectContaining({
        engineDefaultLeverage: 9
      })
    });

    await repository.persistMinuteCandles([]);
    expect(prismaMock.marketCandle.upsert).not.toHaveBeenCalled();

    const repo = repository as never;
    expect(repo.mapMarketTrade({
      id: "trade-1",
      coin: "BTC",
      side: "buy",
      price: 101.5,
      size: 0.2,
      time: 1_000
    }, "okx")).toEqual({
      source: "okx",
      coin: "BTC",
      side: "buy",
      price: 101.5,
      size: 0.2,
      tradeTime: new Date(1_000)
    });
    expect(repo.mapMarketCandle({
      id: "candle-1",
      coin: "BTC",
      interval: "1m",
      openTime: 2_000,
      closeTime: 62_000,
      open: 100,
      high: 102,
      low: 99,
      close: 101,
      volume: 10,
      tradeCount: 3
    }, "okx")).toEqual({
      source: "okx",
      coin: "BTC",
      interval: "1m",
      openTime: new Date(2_000),
      closeTime: new Date(62_000),
      open: 100,
      high: 102,
      low: 99,
      close: 101,
      volume: 10,
      tradeCount: 3
    });
  });

  it("supports source-scoped symbol config lookups and leverage updates", async () => {
    prismaMock.symbolConfig.findFirst
      .mockResolvedValueOnce({
        symbol: "BTC-USD",
        source: "okx",
        marketSymbol: "BTC-USDT-SWAP",
        coin: "BTC",
        engineDefaultLeverage: 6,
        engineMaintenanceMarginRate: 0.01,
        baseTakerFeeRate: 0.0005,
        baseMakerFeeRate: 0.0002,
        engineBaseSlippageBps: 3,
        enginePartialFillEnabled: false
      })
      .mockResolvedValueOnce({
        symbol: "BTC-USD",
        source: "okx",
        marketSymbol: "BTC-USDT-SWAP",
        coin: "BTC",
        engineDefaultLeverage: 6,
        maxLeverage: 20,
        szDecimals: 3,
        quoteAsset: "USDT"
      });

    expect(await repository.loadSymbolConfig("BTC-USD", "okx")).toMatchObject({
      symbol: "BTC-USD",
      leverage: 6
    });
    expect(prismaMock.symbolConfig.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { symbol: "BTC-USD", source: "okx" }
    }));
    expect(await repository.loadSymbolConfigMeta("BTC-USD", "okx")).toEqual({
      source: "okx",
      symbol: "BTC-USD",
      coin: "BTC",
      marketSymbol: "BTC-USDT-SWAP",
      leverage: 6,
      maxLeverage: 20,
      szDecimals: 3,
      quoteAsset: "USDT"
    });

    await repository.updateSymbolLeverage("BTC-USD", 7, "okx");
    expect(prismaMock.symbolConfig.update).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        source_symbol: {
          source: "okx",
          symbol: "BTC-USD"
        }
      }
    }));
  });

  it("falls back to coin when a source-scoped marketSymbol is null", async () => {
    prismaMock.symbolConfig.findFirst.mockResolvedValue({
      source: "okx",
      symbol: "HYPE-USD",
      coin: "HYPE",
      marketSymbol: null,
      engineDefaultLeverage: 6,
      maxLeverage: 20,
      szDecimals: 3,
      quoteAsset: "USDT"
    });

    expect(await repository.loadSymbolConfigMeta("HYPE-USD", "okx")).toEqual({
      source: "okx",
      symbol: "HYPE-USD",
      coin: "HYPE",
      marketSymbol: "HYPE",
      leverage: 6,
      maxLeverage: 20,
      szDecimals: 3,
      quoteAsset: "USDT"
    });
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

  it("loads paged events and trigger order history helpers", async () => {
    prismaMock.simulationEvent.findMany
      .mockResolvedValueOnce(Array.from({ length: 2000 }, (_, index) => ({
        id: `evt-${index + 1}`,
        eventType: "OrderAccepted",
        occurredAt: new Date("2026-01-01T00:00:00.000Z"),
        sequence: index + 1,
        simulationSessionId: "session-paged",
        accountId: "paper-account-1",
        symbol: "BTC-USD",
        source: "system",
        payload: { orderId: `ord-${index + 1}` }
      })))
      .mockResolvedValueOnce([{
        id: "evt-2001",
        eventType: "OrderFilled",
        occurredAt: new Date("2026-01-01T00:00:01.000Z"),
        sequence: 2001,
        simulationSessionId: "session-paged",
        accountId: "paper-account-1",
        symbol: "BTC-USD",
        source: "system",
        payload: { orderId: "ord-2001" }
      }]);

    const events = await repository.loadEvents("session-paged");
    expect(events).toHaveLength(2001);
    expect(prismaMock.simulationEvent.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({
        sequence: { gt: 2000 }
      })
    }));

    prismaMock.triggerOrderHistory.findFirst
      .mockResolvedValueOnce({ oid: 1000000003 })
      .mockResolvedValueOnce({
        oid: 1000000001,
        accountId: "paper-account-1",
        asset: 0,
        isBuy: false,
        triggerPx: 69950,
        actualTriggerPx: null,
        isMarket: false,
        tpsl: "sl",
        size: 0.5,
        limitPx: null,
        reduceOnly: true,
        cloid: "0xtrigger",
        status: "triggerPending",
        createdAt: new Date(1000),
        updatedAt: new Date(2000)
      })
      .mockResolvedValueOnce(null);
    prismaMock.triggerOrderHistory.findMany
      .mockResolvedValueOnce([{
        oid: 1000000001,
        accountId: "paper-account-1",
        asset: 0,
        isBuy: false,
        triggerPx: 69950,
        actualTriggerPx: null,
        isMarket: false,
        tpsl: "sl",
        size: 0.5,
        limitPx: null,
        reduceOnly: true,
        cloid: null,
        status: "triggerPending",
        createdAt: new Date(1000),
        updatedAt: new Date(2000)
      }])
      .mockResolvedValueOnce([{
        oid: 1000000002,
        accountId: "paper-account-1",
        asset: 0,
        isBuy: true,
        triggerPx: 70100,
        isMarket: true,
        tpsl: "tp",
        size: 1,
        limitPx: 70110,
        reduceOnly: true,
        cloid: "0xpending",
        createdAt: new Date(3000)
      }]);

    expect(await repository.getNextTriggerOrderOid(1000000000)).toBe(1000000004);

    await repository.upsertTriggerOrderHistory({
      oid: 1000000001,
      accountId: "paper-account-1",
      asset: 0,
      isBuy: false,
      triggerPx: 69950,
      isMarket: false,
      tpsl: "sl",
      size: 0.5,
      reduceOnly: true,
      status: "triggerPending"
    });
    expect(prismaMock.triggerOrderHistory.upsert).toHaveBeenCalled();

    expect(await repository.listTriggerOrderHistory("paper-account-1")).toEqual([{
      oid: 1000000001,
      accountId: "paper-account-1",
      asset: 0,
      isBuy: false,
      triggerPx: 69950,
      actualTriggerPx: undefined,
      isMarket: false,
      tpsl: "sl",
      size: 0.5,
      limitPx: undefined,
      reduceOnly: true,
      cloid: undefined,
      status: "triggerPending",
      createdAt: 1000,
      updatedAt: 2000
    }]);

    expect(await repository.listPendingTriggerOrders()).toEqual([{
      oid: 1000000002,
      accountId: "paper-account-1",
      asset: 0,
      isBuy: true,
      triggerPx: 70100,
      isMarket: true,
      tpsl: "tp",
      size: 1,
      limitPx: 70110,
      reduceOnly: true,
      cloid: "0xpending",
      createdAt: 3000
    }]);

    expect(await repository.findTriggerOrder("paper-account-1", "0xtrigger")).toEqual({
      oid: 1000000001,
      accountId: "paper-account-1",
      asset: 0,
      isBuy: false,
      triggerPx: 69950,
      actualTriggerPx: undefined,
      isMarket: false,
      tpsl: "sl",
      size: 0.5,
      limitPx: undefined,
      reduceOnly: true,
      cloid: "0xtrigger",
      status: "triggerPending",
      createdAt: 1000,
      updatedAt: 2000
    });
    expect(await repository.findTriggerOrder("paper-account-1", 1000000009)).toBeNull();
  });

  it("covers repository mapper fallbacks for nullable values", () => {
    const repo = repository as never;

    expect(repo.mapOrder({
      id: "ord_1",
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      side: "buy",
      orderType: "limit",
      status: "ACCEPTED",
      quantity: 1,
      filledQuantity: 0,
      remainingQuantity: 1,
      createdAt: "2026-04-10T00:00:00.000Z",
      updatedAt: "2026-04-10T00:00:01.000Z"
    })).toMatchObject({
      clientOrderId: null,
      limitPrice: null,
      averageFillPrice: null,
      rejectionCode: null,
      rejectionMessage: null
    });

    expect(repo.mapAssetContext({
      coin: "BTC",
      capturedAt: 1000
    }, "hyperliquid")).toMatchObject({
      source: "hyperliquid",
      coin: "BTC",
      markPrice: null,
      midPrice: null,
      oraclePrice: null,
      fundingRate: null,
      openInterest: null,
      prevDayPrice: null,
      dayNotionalVolume: null
    });
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
      nextSequence: 3,
      nextOrderId: 2,
      nextFillId: 2,
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
        clientOrderId: "0xpersisted-order-1",
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
    expect(prismaMock.simulationSnapshot.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        simulationSessionId: "session-1"
      },
      update: expect.objectContaining({
        accountId: "paper-account-1",
        symbol: "BTC-USD",
        lastSequence: 2
      })
    }));
    expect(prismaMock.simulationEvent.deleteMany).toHaveBeenCalledWith({
      where: {
        simulationSessionId: "session-1",
        sequence: {
          lte: 2
        }
      }
    });
    expect(prismaMock.account.upsert).toHaveBeenCalled();
    expect(prismaMock.position.upsert).toHaveBeenCalled();
    expect(prismaMock.order.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        clientOrderId: "0xpersisted-order-1"
      }),
      create: expect.objectContaining({
        clientOrderId: "0xpersisted-order-1"
      })
    }));
    expect(prismaMock.$transaction).toHaveBeenCalled();

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
    prismaMock.order.findMany.mockResolvedValue([{
      id: "paper-account-1:ord-1",
      accountId: "paper-account-1",
      clientOrderId: "0xpersisted-order-1",
      symbol: "BTC-USD",
      side: "buy",
      orderType: "market",
      status: "FILLED",
      quantity: 1,
      limitPrice: null,
      filledQuantity: 1,
      remainingQuantity: 0,
      averageFillPrice: 70001,
      rejectionCode: null,
      rejectionMessage: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:01.000Z")
    }]);

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
    expect(await repository.listOrderHistoryViews("paper-account-1")).toEqual([{
      id: "ord-1",
      accountId: "paper-account-1",
      clientOrderId: "0xpersisted-order-1",
      symbol: "BTC-USD",
      side: "buy",
      orderType: "market",
      status: "FILLED",
      quantity: 1,
      limitPrice: undefined,
      filledQuantity: 1,
      remainingQuantity: 0,
      averageFillPrice: 70001,
      rejectionCode: undefined,
      rejectionMessage: undefined,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z"
    }]);
  });

  it("skips snapshot writes when requested while keeping runtime mirrors up to date", async () => {
    await repository.persistState({
      simulationSessionId: "session-1",
      nextSequence: 2,
      nextOrderId: 1,
      nextFillId: 1,
      latestTick: null,
      account: {
        accountId: "paper-account-1",
        walletBalance: 10,
        availableBalance: 10,
        positionMargin: 0,
        orderMargin: 0,
        equity: 10,
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
      orders: []
    }, [], false);

    expect(prismaMock.simulationSnapshot.upsert).not.toHaveBeenCalled();
    expect(prismaMock.simulationEvent.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.account.upsert).toHaveBeenCalled();
    expect(prismaMock.position.upsert).toHaveBeenCalled();
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it("persists liquidation audit rows when liquidation events are present", async () => {
    const events = [
      {
        eventId: "evt-1",
        eventType: "LiquidationTriggered",
        occurredAt: "2026-01-01T00:00:01.000Z",
        sequence: 1,
        simulationSessionId: "session-1",
        accountId: "paper-account-1",
        symbol: "BTC-USD",
        source: "system",
        payload: {
          positionId: "position_1",
          triggerPrice: 93.75,
          riskRatio: 1,
          triggeredAt: "2026-01-01T00:00:01.000Z"
        }
      },
      {
        eventId: "evt-2",
        eventType: "LiquidationExecuted",
        occurredAt: "2026-01-01T00:00:01.000Z",
        sequence: 2,
        simulationSessionId: "session-1",
        accountId: "paper-account-1",
        symbol: "BTC-USD",
        source: "system",
        payload: {
          positionId: "position_1",
          liquidationOrderId: "liq_4",
          executionPrice: 93.45325,
          executionQuantity: 9,
          executedAt: "2026-01-01T00:00:01.000Z"
        }
      }
    ] satisfies AnyEventEnvelope[];

    await repository.persistState({
      simulationSessionId: "session-1",
      nextSequence: 3,
      nextOrderId: 2,
      nextFillId: 1,
      latestTick: null,
      account: {
        accountId: "paper-account-1",
        walletBalance: 30,
        availableBalance: 30,
        positionMargin: 0,
        orderMargin: 0,
        equity: 30,
        realizedPnl: -70,
        unrealizedPnl: 0,
        riskRatio: 0
      },
      position: {
        symbol: "BTC-USD",
        side: "flat",
        quantity: 0,
        averageEntryPrice: 0,
        markPrice: 93.75,
        realizedPnl: -70,
        unrealizedPnl: 0,
        initialMargin: 0,
        maintenanceMargin: 0,
        liquidationPrice: 0
      },
      orders: []
    }, events, false);

    expect(prismaMock.liquidationEvent.upsert).toHaveBeenCalledWith({
      where: {
        id: "paper-account-1:liquidation:liq_4"
      },
      update: {
        accountId: "paper-account-1",
        positionId: "position_1",
        liquidationOrderId: "liq_4",
        triggerPrice: 93.75,
        executionPrice: 93.45325,
        executionQuantity: 9
      },
      create: {
        id: "paper-account-1:liquidation:liq_4",
        accountId: "paper-account-1",
        positionId: "position_1",
        liquidationOrderId: "liq_4",
        triggerPrice: 93.75,
        executionPrice: 93.45325,
        executionQuantity: 9
      }
    });
  });

  it("coalesces market tick persistence into one row per minute bucket", async () => {
    await repository.persistState({
      simulationSessionId: "session-1",
      nextSequence: 3,
      nextOrderId: 1,
      nextFillId: 1,
      latestTick: null,
      account: {
        accountId: "paper-account-1",
        walletBalance: 10,
        availableBalance: 10,
        positionMargin: 0,
        orderMargin: 0,
        equity: 10,
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
      orders: []
    }, [{
      eventId: "evt-1",
      eventType: "MarketTickReceived",
      occurredAt: "2026-01-01T00:00:05.000Z",
      sequence: 1,
      simulationSessionId: "session-1",
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      source: "system",
      payload: {
        symbol: "BTC-USD",
        bid: 100,
        ask: 101,
        last: 100.5,
        spread: 1,
        tickTime: "2026-01-01T00:00:05.000Z",
        volatilityTag: "normal"
      }
    }, {
      eventId: "evt-2",
      eventType: "MarketTickReceived",
      occurredAt: "2026-01-01T00:00:45.000Z",
      sequence: 2,
      simulationSessionId: "session-1",
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      source: "system",
      payload: {
        symbol: "BTC-USD",
        bid: 101,
        ask: 102,
        last: 101.5,
        spread: 1,
        tickTime: "2026-01-01T00:00:45.000Z",
        volatilityTag: "normal"
      }
    } satisfies AnyEventEnvelope]);

    expect(prismaMock.marketTick.upsert).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: {
        id: "BTC-USD:2026-01-01T00:00"
      }
    }));
    expect(prismaMock.marketTick.upsert).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: {
        id: "BTC-USD:2026-01-01T00:00"
      },
      update: expect.objectContaining({
        tickTime: new Date("2026-01-01T00:00:45.000Z"),
        last: 101.5
      })
    }));
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
      nextSequence: 2,
      nextOrderId: 1,
      nextFillId: 2,
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

  it("covers repository nullish mapping and fallback branches", async () => {
    prismaMock.platformSettings.findUnique.mockReset();
    prismaMock.platformSettings.upsert.mockReset();
    prismaMock.appUser.update.mockResolvedValue({
      id: "user-3",
      username: "blank",
      passwordHash: "existing-hash",
      role: "frontend",
      displayName: "Blank User",
      tradingAccountId: "paper-blank",
      isActive: true
    });
    await repository.updateFrontendUser("user-3", {
      passwordHash: "",
      displayName: undefined,
      tradingAccountId: undefined,
      isActive: undefined
    });
    expect(prismaMock.appUser.update).toHaveBeenCalledWith({
      where: { id: "user-3" },
      data: {}
    });

    prismaMock.platformSettings.findUnique.mockResolvedValue({
      id: "platform",
      platformName: "Desk",
      platformAnnouncement: null,
      activeExchange: "hyperliquid",
      activeSymbol: "ETH-USD",
      maintenanceMode: true,
      allowFrontendTrading: true,
      allowManualTicks: false
    });
    expect(await repository.getPlatformSettings()).toEqual({
      platformName: "Desk",
      platformAnnouncement: "",
      activeExchange: "hyperliquid",
      activeSymbol: "ETH-USD",
      maintenanceMode: true,
      allowFrontendTrading: true,
      allowManualTicks: false
    });

    prismaMock.platformSettings.upsert.mockResolvedValue({
      id: "platform",
      platformName: "Desk",
      platformAnnouncement: null,
      activeExchange: "hyperliquid",
      activeSymbol: "ETH-USD",
      maintenanceMode: false,
      allowFrontendTrading: true,
      allowManualTicks: true
    });
    expect(await repository.updatePlatformSettings({
      platformName: "Desk",
      platformAnnouncement: "",
      activeExchange: "hyperliquid",
      activeSymbol: "ETH-USD",
      maintenanceMode: false,
      allowFrontendTrading: true,
      allowManualTicks: true
    })).toEqual({
      platformName: "Desk",
      platformAnnouncement: "",
      activeExchange: "hyperliquid",
      activeSymbol: "ETH-USD",
      maintenanceMode: false,
      allowFrontendTrading: true,
      allowManualTicks: true
    });
    expect(prismaMock.platformSettings.upsert).toHaveBeenLastCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        platformAnnouncement: null
      }),
      create: expect.objectContaining({
        platformAnnouncement: null
      })
    }));

    prismaMock.simulationEvent.findMany.mockResolvedValue([]);
    expect(await repository.loadEvents("session-empty", 5)).toEqual([]);
    expect(prismaMock.simulationEvent.findMany).toHaveBeenCalledWith({
      where: {
        simulationSessionId: "session-empty",
        sequence: { gt: 5 }
      },
      orderBy: {
        sequence: "asc"
      },
      take: 2000
    });

    prismaMock.simulationSnapshot.findUnique.mockResolvedValue(null);
    expect(await repository.loadSimulationSnapshot("missing-session")).toBeNull();

    prismaMock.marketBookSnapshot.findFirst.mockResolvedValue({
      id: "snapshot-zero",
      bestBid: 0,
      bestAsk: 0,
      capturedAt: new Date(1000)
    });
    prismaMock.marketBookLevel.findMany.mockResolvedValue([]);
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
      capturedAt: new Date(2000)
    });

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
        capturedAt: 2000
      }
    });

    prismaMock.triggerOrderHistory.findFirst.mockResolvedValueOnce({ oid: 1_000_000_005 });
    expect(await repository.getNextTriggerOrderOid()).toBe(1_000_000_006);

    prismaMock.triggerOrderHistory.findMany
      .mockResolvedValueOnce([{
        oid: 101,
        accountId: "paper-account-1",
        asset: 0,
        isBuy: false,
        triggerPx: 69950,
        actualTriggerPx: null,
        isMarket: false,
        tpsl: "sl",
        size: 0.5,
        limitPx: null,
        reduceOnly: true,
        cloid: null,
        status: "triggerPending",
        createdAt: new Date(1000),
        updatedAt: new Date(2000)
      }])
      .mockResolvedValueOnce([{
        oid: 102,
        accountId: "paper-account-1",
        asset: 0,
        isBuy: false,
        triggerPx: 69900,
        actualTriggerPx: null,
        isMarket: false,
        tpsl: "sl",
        size: 0.25,
        limitPx: null,
        reduceOnly: true,
        cloid: null,
        status: "triggerPending",
        createdAt: new Date(3000),
        updatedAt: new Date(4000)
      }]);
    expect(await repository.listTriggerOrderHistory("paper-account-1")).toEqual([{
      oid: 101,
      accountId: "paper-account-1",
      asset: 0,
      isBuy: false,
      triggerPx: 69950,
      actualTriggerPx: undefined,
      isMarket: false,
      tpsl: "sl",
      size: 0.5,
      limitPx: undefined,
      reduceOnly: true,
      cloid: undefined,
      status: "triggerPending",
      createdAt: 1000,
      updatedAt: 2000
    }]);
    expect(await repository.listPendingTriggerOrders("paper-account-1" as never)).toEqual([{
      oid: 102,
      accountId: "paper-account-1",
      asset: 0,
      isBuy: false,
      triggerPx: 69900,
      isMarket: false,
      tpsl: "sl",
      size: 0.25,
      limitPx: undefined,
      reduceOnly: true,
      cloid: undefined,
      createdAt: 3000
    }]);

    prismaMock.triggerOrderHistory.findFirst
      .mockResolvedValueOnce({
        oid: 103,
        accountId: "paper-account-1",
        asset: 0,
        isBuy: true,
        triggerPx: 71000,
        actualTriggerPx: null,
        isMarket: true,
        tpsl: "tp",
        size: 1,
        limitPx: null,
        reduceOnly: true,
        cloid: null,
        status: "filled",
        createdAt: new Date(5000),
        updatedAt: new Date(6000)
      })
      .mockResolvedValueOnce(null);
    expect(await repository.findTriggerOrder("paper-account-1", "0xmissing-cloid")).toEqual({
      oid: 103,
      accountId: "paper-account-1",
      asset: 0,
      isBuy: true,
      triggerPx: 71000,
      actualTriggerPx: undefined,
      isMarket: true,
      tpsl: "tp",
      size: 1,
      limitPx: undefined,
      reduceOnly: true,
      cloid: undefined,
      status: "filled",
      createdAt: 5000,
      updatedAt: 6000
    });
    expect(await repository.findTriggerOrder("paper-account-1", 999)).toBeNull();
  });
});
