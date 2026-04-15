import { describe, expect, it, vi } from "vitest";
import { buildHyperliquidInfoResponse } from "../src/hyperliquid-compat";
import { hyperliquidCompatAddressForAccountId } from "../src/hyperliquid-user";

describe("buildHyperliquidInfoResponse", () => {
  const makeRuntime = () => ({
    getMarketData: () => ({
      source: "hyperliquid" as const,
      coin: "BTC",
      connected: true,
      bestBid: 69999,
      bestAsk: 70001,
      markPrice: 70000,
      book: {
        bids: [{ price: 69999, size: 1.2, orders: 3 }],
        asks: [{ price: 70001, size: 1.4, orders: 2 }],
        updatedAt: 1_700_000_000_000
      },
      trades: [],
      candles: [],
      assetCtx: {
        coin: "BTC",
        fundingRate: 0.0001,
        openInterest: 1200,
        prevDayPrice: 69000,
        dayNotionalVolume: 900000,
        oraclePrice: 70002,
        markPrice: 70000,
        midPrice: 70000.5,
        capturedAt: 1_700_000_000_000
      }
    }),
    getMarketHistory: vi.fn(async () => ({
      coin: "BTC",
      interval: "1m",
      candles: [{
        openTime: 1000,
        closeTime: 1999,
        coin: "BTC",
        interval: "1m",
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 100,
        tradeCount: 10
      }],
      trades: [{
        coin: "BTC",
        side: "buy" as const,
        price: 70001,
        size: 0.25,
        time: 1234567890000,
        id: "trade-1"
      }],
      book: {
        bids: [],
        asks: []
      }
    })),
    getSymbolConfigState: () => ({
      coin: "BTC",
      maxLeverage: 20,
      leverage: 10,
      szDecimals: 5
    }),
    getEngineState: vi.fn(() => ({
      account: {
        walletBalance: 1000,
        availableBalance: 800,
        positionMargin: 100,
        orderMargin: 50,
        equity: 1010,
        realizedPnl: 5,
        unrealizedPnl: 5,
        riskRatio: 0.2
      },
      position: {
        symbol: "BTC-USD",
        side: "long" as const,
        quantity: 1,
        averageEntryPrice: 70000,
        markPrice: 70100,
        unrealizedPnl: 5,
        liquidationPrice: 65000,
        initialMargin: 100,
        maintenanceMargin: 50
      }
    })),
    getOrders: vi.fn(() => [{
      id: "ord_1",
      clientOrderId: "0xabc",
      symbol: "BTC-USD",
      side: "buy" as const,
      status: "ACCEPTED",
      quantity: 2,
      remainingQuantity: 1,
      limitPrice: 70000,
      createdAt: "2026-04-10T00:00:00.000Z",
      updatedAt: "2026-04-10T00:00:01.000Z"
    }, {
      id: "ord_2",
      symbol: "BTC-USD",
      side: "sell" as const,
      status: "REJECTED",
      quantity: 1,
      remainingQuantity: 1,
      createdAt: "2026-04-10T00:00:00.000Z",
      updatedAt: "2026-04-10T00:00:01.000Z"
    }]),
    getOrderByClientOrderId: vi.fn((_accountId: string, cloid: string) => cloid === "0xabc" ? {
      id: "ord_1",
      clientOrderId: "0xabc",
      symbol: "BTC-USD",
      side: "buy" as const,
      status: "FILLED",
      quantity: 2,
      remainingQuantity: 0,
      limitPrice: 70000,
      createdAt: "2026-04-10T00:00:00.000Z",
      updatedAt: "2026-04-10T00:00:01.000Z"
    } : undefined),
    getVirtualOpenOrders: vi.fn(() => [{
      coin: "BTC",
      side: "A" as const,
      limitPx: "69900",
      sz: "0.5",
      oid: 1000000001,
      timestamp: 1_700_000_000_000,
      origSz: "0.5",
      cloid: "0xtrigger",
      triggerCondition: {
        triggerPx: "69950",
        isMarket: false,
        tpsl: "sl" as const
      }
    }]),
    getVirtualOrderStatus: vi.fn((_accountId: string, oid: number | string) => oid === 1000000001 ? {
      order: {
        coin: "BTC",
        side: "A" as const,
        limitPx: "69900",
        sz: "0.5",
        oid: 1000000001,
        timestamp: 1_700_000_000_000,
        origSz: "0.5",
        cloid: "0xtrigger",
        triggerCondition: {
          triggerPx: "69950",
          isMarket: false,
          tpsl: "sl" as const
        }
      },
      status: "triggerPending",
      statusTimestamp: 1_700_000_000_000
    } : undefined)
  });

  it("serves public info variants and validation errors", async () => {
    const runtime = makeRuntime();
    expect(await buildHyperliquidInfoResponse(runtime as never, { type: "meta" })).toMatchObject({
      universe: [{ name: "BTC", maxLeverage: 20 }]
    });
    expect(await buildHyperliquidInfoResponse(runtime as never, { type: "metaAndAssetCtxs" })).toHaveLength(2);
    expect(await buildHyperliquidInfoResponse(runtime as never, { type: "allMids" })).toEqual({ BTC: "70000.5" });
    expect(await buildHyperliquidInfoResponse(runtime as never, { type: "l2Book", coin: "BTC" })).toMatchObject({
      coin: "BTC"
    });
    expect(await buildHyperliquidInfoResponse(runtime as never, {
      type: "candleSnapshot",
      req: { coin: "BTC", interval: "1m", startTime: 1000, endTime: 2000 }
    })).toEqual([{
      t: 1000,
      T: 1999,
      s: "BTC",
      i: "1m",
      o: "1",
      c: "1.5",
      h: "2",
      l: "0.5",
      v: "100",
      n: 10
    }]);
    expect(await buildHyperliquidInfoResponse(runtime as never, { type: "recentTrades", coin: "BTC" })).toHaveLength(1);
    expect(await buildHyperliquidInfoResponse(runtime as never, { type: "exchangeStatus" })).toBe("ok");

    await expect(buildHyperliquidInfoResponse(runtime as never, { type: "l2Book", coin: "ETH" })).rejects.toThrow("Unsupported coin ETH");
    await expect(buildHyperliquidInfoResponse(runtime as never, { type: "candleSnapshot", req: { coin: "BTC" } })).rejects.toThrow("candleSnapshot requires");
    await expect(buildHyperliquidInfoResponse(runtime as never, { type: "recentTrades", coin: "ETH" })).rejects.toThrow("Unsupported coin ETH");
    await expect(buildHyperliquidInfoResponse(runtime as never, { type: "unknownType" })).rejects.toThrow("Unsupported info type");
  });

  it("serves authenticated private info variants including virtual orders", async () => {
    const runtime = makeRuntime();
    const accountId = "paper-account-1";
    const user = hyperliquidCompatAddressForAccountId(accountId);

    const openOrders = await buildHyperliquidInfoResponse(runtime as never, {
      type: "openOrders",
      user
    }, accountId);
    expect(openOrders).toHaveLength(2);

    const virtualStatus = await buildHyperliquidInfoResponse(runtime as never, {
      type: "orderStatus",
      user,
      oid: 1000000001
    }, accountId);
    expect(virtualStatus).toMatchObject({
      order: {
        status: "triggerPending"
      }
    });

    const filledStatus = await buildHyperliquidInfoResponse(runtime as never, {
      type: "orderStatus",
      user,
      oid: "0xabc"
    }, accountId);
    expect(filledStatus).toMatchObject({
      order: {
        status: "filled"
      }
    });

    const unknownStatus = await buildHyperliquidInfoResponse(runtime as never, {
      type: "orderStatus",
      user,
      oid: 9999
    }, accountId);
    expect(unknownStatus).toEqual({ status: "unknownOid" });

    const clearinghouseState = await buildHyperliquidInfoResponse(runtime as never, {
      type: "clearinghouseState",
      user
    }, accountId);
    expect(clearinghouseState).toMatchObject({
      marginSummary: {
        accountValue: "1010"
      },
      assetPositions: [{
        position: {
          coin: "BTC",
          szi: "1"
        }
      }]
    });
  });

  it("rejects unauthenticated or mismatched private requests and handles empty account state", async () => {
    const runtime = makeRuntime();
    const accountId = "paper-account-1";

    await expect(buildHyperliquidInfoResponse(runtime as never, {
      type: "openOrders",
      user: accountId
    })).rejects.toThrow("Authentication required");

    await expect(buildHyperliquidInfoResponse(runtime as never, {
      type: "openOrders",
      user: "paper-account-2"
    }, accountId)).rejects.toThrow("Requested user does not match");

    await expect(buildHyperliquidInfoResponse(runtime as never, {
      type: "orderStatus",
      user: hyperliquidCompatAddressForAccountId(accountId)
    }, accountId)).rejects.toThrow("orderStatus requires oid");

    runtime.getEngineState = vi.fn(() => ({
      account: null,
      position: null
    }));
    expect(await buildHyperliquidInfoResponse(runtime as never, {
      type: "clearinghouseState",
      user: hyperliquidCompatAddressForAccountId(accountId)
    }, accountId)).toMatchObject({
      marginSummary: {
        accountValue: "0.0"
      },
      assetPositions: []
    });
  });

  it("covers fallback market mapping, status variants, and flat or short clearinghouse positions", async () => {
    const runtime = makeRuntime();
    const accountId = "paper-account-1";
    const user = hyperliquidCompatAddressForAccountId(accountId);

    runtime.getMarketData = () => ({
      source: "hyperliquid" as const,
      coin: "BTC",
      connected: true,
      bestBid: 69990,
      bestAsk: 70010,
      markPrice: null,
      book: {
        bids: [],
        asks: [],
        updatedAt: undefined
      },
      trades: [],
      candles: [],
      assetCtx: undefined
    });
    runtime.getMarketHistory = vi.fn(async () => ({
      coin: "BTC",
      interval: "1m",
      candles: [{
        openTime: 10,
        closeTime: 20,
        coin: "ETH",
        interval: "5m",
        open: 1,
        high: 1,
        low: 1,
        close: 1,
        volume: 1,
        tradeCount: 1
      }],
      trades: [{
        coin: "BTC",
        side: "sell" as const,
        price: 69995,
        size: 0.5,
        time: 2234567890000,
        id: "trade-sell"
      }],
      book: {
        bids: [],
        asks: []
      }
    }));

    expect(await buildHyperliquidInfoResponse(runtime as never, { type: "metaAndAssetCtxs" })).toEqual([
      expect.any(Object),
      [{
        funding: "0",
        openInterest: "0",
        prevDayPx: "69990",
        dayNtlVlm: "0",
        premium: "0.0",
        oraclePx: "69990",
        markPx: "69990",
        midPx: "69990",
        impactPxs: ["69990", "70010"],
        dayBaseVlm: "0"
      }]
    ]);

    expect(await buildHyperliquidInfoResponse(runtime as never, { type: "allMids" })).toEqual({
      BTC: "70000"
    });

    expect(await buildHyperliquidInfoResponse(runtime as never, {
      type: "candleSnapshot",
      req: { coin: "BTC", interval: "1m", startTime: 1000, endTime: 2000 }
    })).toEqual([]);

    expect(await buildHyperliquidInfoResponse(runtime as never, { type: "recentTrades", coin: "BTC" })).toEqual([{
      coin: "BTC",
      side: "A",
      px: "69995",
      sz: "0.5",
      time: 2234567890000,
      hash: "0x0000000000000000000000000000000000000000000000000000000000000000",
      tid: 234567890000,
      users: [
        "0x0000000000000000000000000000000000000000",
        "0x0000000000000000000000000000000000000000"
      ]
    }]);

    runtime.getOrders = vi.fn(() => [{
      id: "ord_3",
      symbol: "BTC-USD",
      side: "sell" as const,
      status: "CANCELED",
      quantity: 1,
      remainingQuantity: 0.5,
      createdAt: "2026-04-10T00:00:00.000Z",
      updatedAt: "2026-04-10T00:00:01.000Z"
    }, {
      id: "ord_4",
      symbol: "BTC-USD",
      side: "sell" as const,
      status: "REJECTED",
      quantity: 1,
      remainingQuantity: 1,
      createdAt: "2026-04-10T00:00:00.000Z",
      updatedAt: "2026-04-10T00:00:02.000Z"
    }, {
      id: "ord_5",
      symbol: "BTC-USD",
      side: "buy" as const,
      status: "NEW",
      quantity: 2,
      remainingQuantity: 2,
      createdAt: "2026-04-10T00:00:00.000Z",
      updatedAt: "2026-04-10T00:00:03.000Z"
    }]);
    runtime.getVirtualOpenOrders = vi.fn(() => []);
    runtime.getVirtualOrderStatus = vi.fn(() => undefined);

    const openOrders = await buildHyperliquidInfoResponse(runtime as never, {
      type: "frontendOpenOrders",
      user
    }, accountId);
    expect(openOrders).toEqual([{
      coin: "BTC",
      side: "B",
      limitPx: "69990",
      sz: "2",
      oid: 5,
      timestamp: new Date("2026-04-10T00:00:00.000Z").getTime(),
      origSz: "2",
      cloid: undefined
    }]);

    const canceledStatus = await buildHyperliquidInfoResponse(runtime as never, {
      type: "orderStatus",
      user,
      oid: 3
    }, accountId);
    expect(canceledStatus).toMatchObject({ order: { status: "canceled" } });

    const rejectedStatus = await buildHyperliquidInfoResponse(runtime as never, {
      type: "orderStatus",
      user,
      oid: 4
    }, accountId);
    expect(rejectedStatus).toMatchObject({ order: { status: "rejected" } });

    runtime.getEngineState = vi.fn(() => ({
      account: {
        walletBalance: 900,
        availableBalance: 850,
        positionMargin: 25,
        orderMargin: 10,
        equity: 910,
        realizedPnl: 0,
        unrealizedPnl: -5,
        riskRatio: 0.1
      },
      position: {
        symbol: "BTC-USD",
        side: "short" as const,
        quantity: -2,
        averageEntryPrice: 71000,
        markPrice: 70500,
        unrealizedPnl: -5,
        liquidationPrice: 76000,
        initialMargin: 0,
        maintenanceMargin: 12
      }
    }));
    const shortState = await buildHyperliquidInfoResponse(runtime as never, {
      type: "clearinghouseState",
      user
    }, accountId);
    expect(shortState).toMatchObject({
      assetPositions: [{
        position: {
          szi: "-2",
          returnOnEquity: "0"
        }
      }]
    });

    runtime.getEngineState = vi.fn(() => ({
      account: {
        walletBalance: 900,
        availableBalance: 850,
        positionMargin: 0,
        orderMargin: 0,
        equity: 900,
        realizedPnl: 0,
        unrealizedPnl: 0,
        riskRatio: 0
      },
      position: {
        symbol: "BTC-USD",
        side: "flat" as const,
        quantity: 0,
        averageEntryPrice: 0,
        markPrice: 0,
        unrealizedPnl: 0,
        liquidationPrice: 0,
        initialMargin: 0,
        maintenanceMargin: 0
      }
    }));
    const flatState = await buildHyperliquidInfoResponse(runtime as never, {
      type: "clearinghouseState",
      user
    }, accountId);
    expect(flatState).toMatchObject({
      assetPositions: []
    });
  });

  it("covers deep fallback branches for market data and null positions", async () => {
    const runtime = makeRuntime();
    const accountId = "paper-account-1";
    const user = hyperliquidCompatAddressForAccountId(accountId);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T00:00:00.000Z"));

    runtime.getMarketData = () => ({
      source: "hyperliquid" as const,
      coin: "BTC",
      connected: true,
      bestBid: undefined,
      bestAsk: undefined,
      markPrice: undefined,
      book: {
        bids: [],
        asks: [],
        updatedAt: undefined
      },
      trades: [],
      candles: [],
      assetCtx: undefined
    });
    runtime.getMarketHistory = vi.fn(async () => ({
      coin: "BTC",
      interval: "1m",
      candles: [],
      trades: [{
        coin: "BTC",
        side: "buy" as const,
        price: 70001,
        size: 0.25,
        time: 1234567890000,
        id: "trade-default-coin"
      }],
      book: {
        bids: [],
        asks: []
      }
    }));
    runtime.getOrders = vi.fn(() => [{
      id: "ord_6",
      symbol: "BTC-USD",
      side: "sell" as const,
      status: "PARTIALLY_FILLED",
      quantity: 3,
      remainingQuantity: 1,
      limitPrice: undefined,
      createdAt: "2026-04-10T00:00:00.000Z",
      updatedAt: "2026-04-10T00:00:03.000Z"
    }, {
      id: "ord_7",
      symbol: "BTC-USD",
      side: "buy" as const,
      status: "FILLED",
      quantity: 1,
      remainingQuantity: 0,
      limitPrice: undefined,
      createdAt: "2026-04-10T00:00:00.000Z",
      updatedAt: "2026-04-10T00:00:04.000Z"
    }]);
    runtime.getVirtualOpenOrders = vi.fn(() => undefined);
    runtime.getVirtualOrderStatus = vi.fn(() => undefined);
    runtime.getEngineState = vi.fn(() => ({
      account: {
        walletBalance: 1000,
        availableBalance: 900,
        positionMargin: 0,
        orderMargin: 0,
        equity: 1000,
        realizedPnl: 0,
        unrealizedPnl: 0,
        riskRatio: 0
      },
      position: null
    }));

    expect(await buildHyperliquidInfoResponse(runtime as never, {
      type: "metaAndAssetCtxs"
    })).toEqual([
      expect.any(Object),
      [{
        funding: "0",
        openInterest: "0",
        prevDayPx: "0",
        dayNtlVlm: "0",
        premium: "0.0",
        oraclePx: "0",
        markPx: "0",
        midPx: "0",
        impactPxs: ["0", "0"],
        dayBaseVlm: "0"
      }]
    ]);

    expect(await buildHyperliquidInfoResponse(runtime as never, { type: "allMids" })).toEqual({
      BTC: "0"
    });

    expect(await buildHyperliquidInfoResponse(runtime as never, { type: "l2Book" })).toEqual({
      coin: "BTC",
      time: new Date("2026-04-15T00:00:00.000Z").getTime(),
      levels: [[], []]
    });

    expect(await buildHyperliquidInfoResponse(runtime as never, {
      type: "candleSnapshot",
      req: { interval: "1m", startTime: 0, endTime: 2000 }
    })).toEqual([]);

    expect(await buildHyperliquidInfoResponse(runtime as never, {
      type: "recentTrades"
    })).toEqual([{
      coin: "BTC",
      side: "B",
      px: "70001",
      sz: "0.25",
      time: 1234567890000,
      hash: "0x0000000000000000000000000000000000000000000000000000000000000000",
      tid: 234567890000,
      users: [
        "0x0000000000000000000000000000000000000000",
        "0x0000000000000000000000000000000000000000"
      ]
    }]);

    expect(await buildHyperliquidInfoResponse(runtime as never, {
      type: "openOrders",
      user
    }, accountId)).toEqual([{
      coin: "BTC",
      side: "A",
      limitPx: "0",
      sz: "1",
      oid: 6,
      timestamp: new Date("2026-04-10T00:00:00.000Z").getTime(),
      origSz: "3",
      cloid: undefined
    }]);

    expect(await buildHyperliquidInfoResponse(runtime as never, {
      type: "orderStatus",
      user,
      oid: 6
    }, accountId)).toMatchObject({
      order: {
        order: {
          side: "A",
          limitPx: "0",
          oid: 6
        },
        status: "open"
      }
    });

    expect(await buildHyperliquidInfoResponse(runtime as never, {
      type: "clearinghouseState",
      user
    }, accountId)).toMatchObject({
      crossMaintenanceMarginUsed: "0",
      assetPositions: []
    });

    vi.useRealTimers();
  });
});
