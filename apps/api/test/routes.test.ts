import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerRoutes } from "../src/routes";

describe("registerRoutes", () => {
  let app: ReturnType<typeof Fastify>;
  const frontendSession = {
    token: "frontend-token",
    user: {
      id: "frontend-user-1",
      username: "demo",
      role: "frontend" as const,
      displayName: "Demo Trader",
      tradingAccountId: "paper-account-1",
      isActive: true
    }
  };
  const adminSession = {
    token: "admin-token",
    user: {
      id: "admin-user-1",
      username: "admin",
      role: "admin" as const,
      displayName: "Platform Admin",
      tradingAccountId: null,
      isActive: true
    }
  };
  const platformSettings = {
    platformName: "Stratium Demo",
    platformAnnouncement: "",
    activeExchange: "hyperliquid",
    activeSymbol: "BTC-USD",
    maintenanceMode: false,
    allowFrontendTrading: true,
    allowManualTicks: true
  };
  const canonicalStringify = (value: unknown): string => {
    if (Array.isArray(value)) {
      return `[${value.map((entry) => canonicalStringify(entry)).join(",")}]`;
    }
    if (value && typeof value === "object") {
      return `{${Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalStringify(entry)}`)
        .join(",")}}`;
    }
    return JSON.stringify(value);
  };
  const waitForSocketOpen = (socket: {
    addEventListener: (event: string, listener: (...args: unknown[]) => void, options?: { once?: boolean }) => void;
  }) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for websocket open")), 5_000);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("Websocket connection failed"));
      }, { once: true });
    });
  const waitForSocketClose = (socket: {
    addEventListener: (event: string, listener: (...args: unknown[]) => void, options?: { once?: boolean }) => void;
  }) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for websocket close")), 5_000);
      socket.addEventListener("close", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("Websocket close failed"));
      }, { once: true });
    });
  const waitForSocketMessage = (socket: {
    addEventListener: (event: string, listener: (...args: unknown[]) => void, options?: { once?: boolean }) => void;
  }) =>
    new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for websocket message")), 5_000);
      socket.addEventListener("message", (event: unknown) => {
        clearTimeout(timer);
        const payload = event as { data?: unknown };
        resolve(typeof payload.data === "string" ? JSON.parse(payload.data) : payload.data);
      }, { once: true });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("Websocket message failed"));
      }, { once: true });
    });
  const runtime = {
    login: vi.fn(),
    logout: vi.fn(),
    getSession: vi.fn(),
    getPlatformSettings: vi.fn(),
    getAccountIds: vi.fn(),
    getStatePayload: vi.fn(),
    getMarketData: vi.fn(),
    getMarketHistory: vi.fn(),
    getOrders: vi.fn(),
    getOrderByClientOrderId: vi.fn(),
    getSessionStartedAt: vi.fn(() => "2026-04-09T00:00:00.000Z"),
    getHyperliquidCandleInterval: vi.fn(() => "1m"),
    getHyperliquidCoin: vi.fn(() => "BTC"),
    getMarketVolume: vi.fn(),
    getEngineState: vi.fn(),
    getEventStore: vi.fn(),
    getFillHistoryEvents: vi.fn(),
    getFillHistoryPayload: vi.fn(),
    getReplayPayload: vi.fn(),
    getPositionReplayPayload: vi.fn(),
    getSymbolConfigState: vi.fn(),
    getAdminStatePayload: vi.fn(),
    listBatchJobs: vi.fn(),
    runBatchJob: vi.fn(),
    listRunningBatchJobs: vi.fn(),
    getBatchJobExecution: vi.fn(),
    listFrontendUsers: vi.fn(),
    createFrontendUser: vi.fn(),
    updateFrontendUser: vi.fn(),
    updatePlatformSettings: vi.fn(),
    updateLeverage: vi.fn(),
    cancelAllOpenOrders: vi.fn(),
    ingestManualTick: vi.fn(),
    submitOrder: vi.fn(),
    cancelOrder: vi.fn(),
    addSocket: vi.fn(),
    onBroadcast: vi.fn(() => () => undefined)
  };

  beforeEach(async () => {
    const exchangeOrders: Array<{
      id: string;
      clientOrderId?: string;
      accountId: string;
      symbol: string;
      side: "buy" | "sell";
      orderType: "market" | "limit";
      status: "ACCEPTED" | "FILLED";
      quantity: number;
      limitPrice?: number;
      filledQuantity: number;
      remainingQuantity: number;
      averageFillPrice?: number;
      createdAt: string;
      updatedAt: string;
    }> = [];

    vi.clearAllMocks();
    runtime.login.mockResolvedValue(frontendSession);
    runtime.getSession.mockImplementation((token?: string) => {
      if (token === frontendSession.token) {
        return frontendSession;
      }
      if (token === adminSession.token) {
        return adminSession;
      }
      return null;
    });
    runtime.getPlatformSettings.mockReturnValue(platformSettings);
    runtime.getAccountIds.mockReturnValue(["paper-account-1"]);
    runtime.getStatePayload.mockResolvedValue({ ok: true });
    runtime.getMarketData.mockReturnValue({
      source: "hyperliquid",
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
        markPrice: 70000,
        midPrice: 70000,
        oraclePrice: 70002,
        fundingRate: 0.0001,
        openInterest: 1234,
        prevDayPrice: 69000,
        dayNotionalVolume: 999999,
        capturedAt: 1_700_000_000_000
      }
    });
    runtime.getMarketHistory.mockResolvedValue({ candles: [], trades: [] });
    runtime.getOrders.mockImplementation(() => exchangeOrders);
    runtime.getOrderByClientOrderId.mockImplementation((_accountId: string, cloid: string) =>
      exchangeOrders.find((order) => order.clientOrderId === cloid)
    );
    runtime.getMarketVolume.mockResolvedValue({ records: [] });
    runtime.getEngineState.mockReturnValue({
      simulationSessionId: "session-1",
      account: {
        accountId: "paper-account-1",
        walletBalance: 1000,
        availableBalance: 800,
        positionMargin: 100,
        orderMargin: 50,
        equity: 1010,
        realizedPnl: 5,
        unrealizedPnl: 5,
        riskRatio: 0.2
      },
      orders: [],
      position: {
        symbol: "BTC-USD",
        side: "long",
        quantity: 1,
        averageEntryPrice: 70000,
        markPrice: 70100,
        realizedPnl: 5,
        unrealizedPnl: 5,
        initialMargin: 100,
        maintenanceMargin: 50,
        liquidationPrice: 65000
      }
    });
    runtime.getEventStore.mockReturnValue([]);
    runtime.getFillHistoryEvents.mockReturnValue([]);
    runtime.getFillHistoryPayload.mockResolvedValue({
      sessionId: "session-1",
      events: []
    });
    runtime.getReplayPayload.mockReturnValue({ sessionId: "session-1" });
    runtime.getPositionReplayPayload.mockResolvedValue({
      sessionId: "session-1",
      fillId: "fill_1",
      fills: [],
      events: [],
      marketEvents: [],
      state: { simulationSessionId: "session-1" }
    });
    runtime.getSymbolConfigState.mockReturnValue({
      symbol: "BTC-USD",
      coin: "BTC",
      leverage: 10,
      maxLeverage: 20,
      szDecimals: 5
    });
    runtime.getAdminStatePayload.mockReturnValue({ events: [], platform: platformSettings });
    runtime.listBatchJobs.mockReturnValue([
      {
        id: "batch-refresh-hl-day",
        label: "Refresh Hyperliquid Day",
        description: "Reload today's candles."
      }
    ]);
    runtime.runBatchJob.mockResolvedValue({
      executionId: "exec-1",
      jobId: "batch-refresh-hl-day",
      status: "running",
      startedAt: "2026-04-09T00:00:00.000Z",
      command: "",
      args: [],
      stdout: "",
      stderr: ""
    });
    runtime.listRunningBatchJobs.mockResolvedValue([{
      executionId: "exec-1",
      jobId: "batch-refresh-hl-day",
      status: "running",
      startedAt: "2026-04-09T00:00:00.000Z",
      command: "",
      args: [],
      stdout: "",
      stderr: ""
    }]);
    runtime.getBatchJobExecution.mockResolvedValue({
      executionId: "exec-1",
      jobId: "batch-refresh-hl-day",
      status: "success",
      startedAt: "2026-04-09T00:00:00.000Z",
      finishedAt: "2026-04-09T00:10:00.000Z",
      command: "",
      args: [],
      stdout: "ok",
      stderr: ""
    });
    runtime.listFrontendUsers.mockResolvedValue([frontendSession.user]);
    runtime.createFrontendUser.mockResolvedValue(frontendSession.user);
    runtime.updateFrontendUser.mockResolvedValue(frontendSession.user);
    runtime.updatePlatformSettings.mockResolvedValue(platformSettings);
    runtime.updateLeverage.mockResolvedValue(undefined);
    runtime.ingestManualTick.mockResolvedValue({ ok: true, result: { events: [] } });
    runtime.submitOrder.mockImplementation(async (input: {
      accountId: string;
      symbol: string;
      side: "buy" | "sell";
      orderType: "market" | "limit";
      quantity: number;
      limitPrice?: number;
      clientOrderId?: string;
    }) => {
      const nextOrder = {
        id: `ord_${exchangeOrders.length + 1}`,
        clientOrderId: input.clientOrderId,
        accountId: input.accountId,
        symbol: input.symbol,
        side: input.side,
        orderType: input.orderType,
        status: input.orderType === "market" ? "FILLED" as const : "ACCEPTED" as const,
        quantity: input.quantity,
        limitPrice: input.limitPrice,
        filledQuantity: input.orderType === "market" ? input.quantity : 0,
        remainingQuantity: input.orderType === "market" ? 0 : input.quantity,
        averageFillPrice: input.orderType === "market" ? 70000 : undefined,
        createdAt: "2026-04-10T00:00:00.000Z",
        updatedAt: "2026-04-10T00:00:00.000Z"
      };
      exchangeOrders.push(nextOrder);
      return {
        events: [{
          eventType: "OrderRequested",
          payload: {
            orderId: nextOrder.id
          }
        }]
      };
    });
    runtime.cancelOrder.mockResolvedValue({ events: [] });
    runtime.cancelAllOpenOrders.mockResolvedValue([]);

    app = Fastify();
    await app.register(websocket);
    await registerRoutes(app, runtime as never);
  });

  afterEach(async () => {
    await app.close();
  });

  it("serves read endpoints", async () => {
    expect((await app.inject({ method: "GET", url: "/health" })).json()).toEqual({ status: "ok" });
    expect((await app.inject({
      method: "GET",
      url: "/api/state",
      headers: { authorization: `Bearer ${frontendSession.token}` }
    })).json()).toEqual({ ok: true });
    expect((await app.inject({
      method: "GET",
      url: "/api/market-history?limit=50",
      headers: { authorization: `Bearer ${frontendSession.token}` }
    })).statusCode).toBe(200);
    expect(runtime.getMarketHistory).toHaveBeenCalledWith(50);
    expect((await app.inject({
      method: "GET",
      url: "/api/market-volume?limit=20&interval=5m&coin=ETH",
      headers: { authorization: `Bearer ${frontendSession.token}` }
    })).statusCode).toBe(200);
    expect(runtime.getMarketVolume).toHaveBeenCalledWith(20, "5m", "ETH");
    expect((await app.inject({
      method: "GET",
      url: "/api/account",
      headers: { authorization: `Bearer ${frontendSession.token}` }
    })).json()).toMatchObject({ accountId: "paper-account-1" });
    expect((await app.inject({
      method: "GET",
      url: "/api/orders",
      headers: { authorization: `Bearer ${frontendSession.token}` }
    })).json()).toEqual([]);
    expect((await app.inject({
      method: "GET",
      url: "/api/events",
      headers: { authorization: `Bearer ${frontendSession.token}` }
    })).json()).toEqual({
      sessionId: "session-1",
      events: []
    });
    expect((await app.inject({
      method: "GET",
      url: "/api/replay/session-2",
      headers: { authorization: `Bearer ${frontendSession.token}` }
    })).json()).toEqual({ sessionId: "session-1" });
    expect((await app.inject({
      method: "GET",
      url: "/api/fill-history",
      headers: { authorization: `Bearer ${frontendSession.token}` }
    })).json()).toEqual({
      sessionId: "session-1",
      events: []
    });
    expect((await app.inject({
      method: "GET",
      url: "/api/fills/fill_1/replay",
      headers: { authorization: `Bearer ${frontendSession.token}` }
    })).json()).toEqual({
      sessionId: "session-1",
      fillId: "fill_1",
      fills: [],
      events: [],
      marketEvents: [],
      state: { simulationSessionId: "session-1" }
    });
  });

  it("blocks frontend APIs during maintenance while keeping admin access", async () => {
    runtime.getPlatformSettings.mockReturnValue({
      ...platformSettings,
      maintenanceMode: true
    });

    const frontendStateResponse = await app.inject({
      method: "GET",
      url: "/api/state",
      headers: { authorization: `Bearer ${frontendSession.token}` }
    });
    expect(frontendStateResponse.statusCode).toBe(503);
    expect(frontendStateResponse.json()).toEqual({
      status: "maintenance",
      message: "The API is temporarily unavailable during maintenance."
    });

    const frontendMarketHistoryResponse = await app.inject({
      method: "GET",
      url: "/api/market-history",
      headers: { authorization: `Bearer ${frontendSession.token}` }
    });
    expect(frontendMarketHistoryResponse.statusCode).toBe(503);

    expect((await app.inject({
      method: "GET",
      url: "/api/market-volume",
      headers: { authorization: `Bearer ${frontendSession.token}` }
    })).statusCode).toBe(503);

    expect((await app.inject({
      method: "GET",
      url: "/api/bot-credentials",
      headers: { authorization: `Bearer ${frontendSession.token}` }
    })).statusCode).toBe(503);

    expect((await app.inject({
      method: "GET",
      url: "/api/account",
      headers: { authorization: `Bearer ${frontendSession.token}` }
    })).statusCode).toBe(503);

    expect((await app.inject({
      method: "GET",
      url: "/api/orders",
      headers: { authorization: `Bearer ${frontendSession.token}` }
    })).statusCode).toBe(503);

    expect((await app.inject({
      method: "GET",
      url: "/api/positions",
      headers: { authorization: `Bearer ${frontendSession.token}` }
    })).statusCode).toBe(503);

    expect((await app.inject({
      method: "GET",
      url: "/api/events",
      headers: { authorization: `Bearer ${frontendSession.token}` }
    })).statusCode).toBe(503);

    expect((await app.inject({
      method: "GET",
      url: "/api/fill-history",
      headers: { authorization: `Bearer ${frontendSession.token}` }
    })).statusCode).toBe(503);

    expect((await app.inject({
      method: "GET",
      url: "/api/replay/session-1",
      headers: { authorization: `Bearer ${frontendSession.token}` }
    })).statusCode).toBe(503);

    expect((await app.inject({
      method: "GET",
      url: "/api/order-history",
      headers: { authorization: `Bearer ${frontendSession.token}` }
    })).statusCode).toBe(503);

    expect((await app.inject({
      method: "POST",
      url: "/api/leverage",
      headers: { authorization: `Bearer ${frontendSession.token}` },
      payload: { leverage: 5 }
    })).statusCode).toBe(503);

    expect((await app.inject({
      method: "POST",
      url: "/api/orders",
      headers: { authorization: `Bearer ${frontendSession.token}` },
      payload: { symbol: "BTC-USD", side: "buy", orderType: "market", quantity: 1 }
    })).statusCode).toBe(503);

    expect((await app.inject({
      method: "POST",
      url: "/api/orders/cancel",
      headers: { authorization: `Bearer ${frontendSession.token}` },
      payload: { orderId: "ord_1" }
    })).statusCode).toBe(503);

    expect((await app.inject({
      method: "POST",
      url: "/api/orders/ord_1/cancel",
      headers: { authorization: `Bearer ${frontendSession.token}` },
      payload: {}
    })).statusCode).toBe(503);

    expect((await app.inject({
      method: "GET",
      url: "/api/fills/fill_1/replay",
      headers: { authorization: `Bearer ${frontendSession.token}` }
    })).statusCode).toBe(503);

    expect((await app.inject({
      method: "POST",
      url: "/info",
      headers: { authorization: `Bearer ${frontendSession.token}` },
      payload: { type: "openOrders", user: "paper-account-1" }
    })).statusCode).toBe(503);

    expect((await app.inject({
      method: "POST",
      url: "/exchange",
      headers: { authorization: `Bearer ${frontendSession.token}` },
      payload: {
        action: { type: "order", orders: [] },
        nonce: 1,
        signature: { r: "0x1", s: "0x2", v: 27 }
      }
    })).statusCode).toBe(503);

    const adminPlatformSettingsResponse = await app.inject({
      method: "GET",
      url: "/api/admin/platform-settings",
      headers: { authorization: `Bearer ${adminSession.token}` }
    });
    expect(adminPlatformSettingsResponse.statusCode).toBe(200);
    expect(adminPlatformSettingsResponse.json()).toEqual({
      ...platformSettings,
      maintenanceMode: true
    });
  });

  it("rejects unauthenticated admin-only maintenance controls", async () => {
    expect((await app.inject({
      method: "GET",
      url: "/api/admin/batch-job-executions/running"
    })).statusCode).toBe(401);

    expect((await app.inject({
      method: "GET",
      url: "/api/admin/batch-job-executions/exec-1"
    })).statusCode).toBe(401);

    expect((await app.inject({
      method: "POST",
      url: "/api/admin/batch-jobs/batch-refresh-hl-day/run",
      payload: {}
    })).statusCode).toBe(401);

    expect((await app.inject({
      method: "POST",
      url: "/api/market-ticks",
      payload: { symbol: "BTC-USD" }
    })).statusCode).toBe(401);
  });

  it("serves hyperliquid-compatible info endpoints", async () => {
    const metaResponse = await app.inject({
      method: "POST",
      url: "/info",
      payload: { type: "meta" }
    });
    expect(metaResponse.statusCode).toBe(200);
    expect(metaResponse.json()).toEqual({
      universe: [{
        szDecimals: 5,
        name: "BTC",
        maxLeverage: 20,
        marginTableId: 1
      }],
      marginTables: [[1, {
        description: "stratium-single-symbol",
        marginTiers: [{
          lowerBound: "0.0",
          maxLeverage: 20
        }]
      }]],
      collateralToken: 0
    });

    const orderBookResponse = await app.inject({
      method: "POST",
      url: "/info",
      payload: { type: "l2Book", coin: "BTC" }
    });
    expect(orderBookResponse.statusCode).toBe(200);
    expect(orderBookResponse.json()).toEqual({
      coin: "BTC",
      time: 1_700_000_000_000,
      levels: [
        [{ px: "69999", sz: "1.2", n: 3 }],
        [{ px: "70001", sz: "1.4", n: 2 }]
      ]
    });

    const unsupportedResponse = await app.inject({
      method: "POST",
      url: "/info",
      payload: { type: "userState" }
    });
    expect(unsupportedResponse.statusCode).toBe(400);
  });

  it("serves hyperliquid-compatible private info endpoints", async () => {
    await app.inject({
      method: "POST",
      url: "/exchange",
      headers: { authorization: `Bearer ${frontendSession.token}` },
      payload: {
        action: {
          type: "order",
          orders: [{
            a: 0,
            b: true,
            p: "70000",
            s: "2",
            r: false,
            t: { limit: { tif: "Gtc" } },
            c: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
          }],
          grouping: "na"
        },
        nonce: 1,
        signature: { r: "0x1", s: "0x2", v: 27 }
      }
    });

    const openOrdersResponse = await app.inject({
      method: "POST",
      url: "/info",
      headers: { authorization: `Bearer ${frontendSession.token}` },
      payload: { type: "openOrders", user: "paper-account-1" }
    });
    expect(openOrdersResponse.statusCode).toBe(200);
    expect(openOrdersResponse.json()).toEqual([{
      coin: "BTC",
      side: "B",
      limitPx: "70000",
      sz: "2",
      oid: 1,
      timestamp: new Date("2026-04-10T00:00:00.000Z").getTime(),
      origSz: "2",
      cloid: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }]);

    const orderStatusResponse = await app.inject({
      method: "POST",
      url: "/info",
      headers: { authorization: `Bearer ${frontendSession.token}` },
      payload: { type: "orderStatus", user: "paper-account-1", oid: 1 }
    });
    expect(orderStatusResponse.statusCode).toBe(200);
    expect(orderStatusResponse.json()).toEqual({
      order: {
        order: {
          coin: "BTC",
          side: "B",
          limitPx: "70000",
          sz: "2",
          oid: 1,
          timestamp: new Date("2026-04-10T00:00:00.000Z").getTime(),
          origSz: "2",
          cloid: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        },
        status: "open",
        statusTimestamp: new Date("2026-04-10T00:00:00.000Z").getTime()
      }
    });

    const clearinghouseResponse = await app.inject({
      method: "POST",
      url: "/info",
      headers: { authorization: `Bearer ${frontendSession.token}` },
      payload: { type: "clearinghouseState", user: "paper-account-1" }
    });
    expect(clearinghouseResponse.statusCode).toBe(200);
    expect(clearinghouseResponse.json()).toMatchObject({
      marginSummary: {
        accountValue: "1010",
        totalNtlPos: "70000",
        totalRawUsd: "1000",
        totalMarginUsed: "150"
      },
      crossMaintenanceMarginUsed: "50",
      withdrawable: "800"
    });
  });

  it("serves hyperliquid-compatible exchange endpoints", async () => {
    const placeResponse = await app.inject({
      method: "POST",
      url: "/exchange",
      headers: { authorization: `Bearer ${frontendSession.token}` },
      payload: {
        action: {
          type: "order",
          orders: [{
            a: 0,
            b: true,
            p: "70000",
            s: "1",
            r: false,
            t: { limit: { tif: "Gtc" } },
            c: "0x1234567890abcdef1234567890abcdef"
          }],
          grouping: "na"
        },
        nonce: 1,
        signature: { r: "0x1", s: "0x2", v: 27 }
      }
    });

    expect(placeResponse.statusCode).toBe(200);
    expect(placeResponse.json()).toEqual({
      status: "ok",
      response: {
        type: "order",
        data: {
          statuses: [{
            resting: {
              oid: 1,
              cloid: "0x1234567890abcdef1234567890abcdef"
            }
          }]
        }
      }
    });

    const cancelByCloidResponse = await app.inject({
      method: "POST",
      url: "/exchange",
      headers: { authorization: `Bearer ${frontendSession.token}` },
      payload: {
        action: {
          type: "cancelByCloid",
          cancels: [{
            asset: 0,
            cloid: "0x1234567890abcdef1234567890abcdef"
          }]
        },
        nonce: 2,
        signature: { r: "0x1", s: "0x2", v: 27 }
      }
    });

    expect(cancelByCloidResponse.statusCode).toBe(200);
    expect(cancelByCloidResponse.json()).toEqual({
      status: "ok",
      response: {
        type: "cancel",
        data: {
          statuses: [{ success: "ok" }]
        }
      }
    });

    const scheduleCancelResponse = await app.inject({
      method: "POST",
      url: "/exchange",
      headers: { authorization: `Bearer ${frontendSession.token}` },
      payload: {
        action: {
          type: "scheduleCancel",
          time: Date.now() + 10_000
        },
        nonce: 3,
        signature: { r: "0x1", s: "0x2", v: 27 }
      }
    });

    expect(scheduleCancelResponse.statusCode).toBe(200);
    expect(scheduleCancelResponse.json().response.type).toBe("scheduleCancel");
  });

  it("supports modify reduceOnly and trigger compatibility flows", async () => {
    await app.inject({
      method: "POST",
      url: "/exchange",
      headers: { authorization: `Bearer ${frontendSession.token}` },
      payload: {
        action: {
          type: "order",
          orders: [{
            a: 0,
            b: false,
            p: "70010",
            s: "1",
            r: false,
            t: { limit: { tif: "Gtc" } },
            c: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
          }]
        },
        nonce: 11,
        signature: { r: "0x1", s: "0x2", v: 27 }
      }
    });

    const modifyResponse = await app.inject({
      method: "POST",
      url: "/exchange",
      headers: { authorization: `Bearer ${frontendSession.token}` },
      payload: {
        action: {
          type: "modify",
          oid: 1,
          order: {
            a: 0,
            b: false,
            p: "70020",
            s: "1",
            r: false,
            t: { limit: { tif: "Gtc" } }
          }
        },
        nonce: 12,
        signature: { r: "0x1", s: "0x2", v: 27 }
      }
    });
    expect(modifyResponse.statusCode).toBe(200);
    expect(modifyResponse.json().response.data.statuses[0]).toEqual({
      resting: {
        oid: 2,
        cloid: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      }
    });

    const reduceOnlyResponse = await app.inject({
      method: "POST",
      url: "/exchange",
      headers: { authorization: `Bearer ${frontendSession.token}` },
      payload: {
        action: {
          type: "order",
          orders: [{
            a: 0,
            b: true,
            p: "70000",
            s: "1",
            r: true,
            t: { limit: { tif: "Gtc" } }
          }]
        },
        nonce: 13,
        signature: { r: "0x1", s: "0x2", v: 27 }
      }
    });
    expect(reduceOnlyResponse.statusCode).toBe(200);
    expect(reduceOnlyResponse.json().response.data.statuses[0]).toEqual({
      error: "reduceOnly buy order can only reduce a short position"
    });

    const triggerResponse = await app.inject({
      method: "POST",
      url: "/exchange",
      headers: { authorization: `Bearer ${frontendSession.token}` },
      payload: {
        action: {
          type: "order",
          orders: [{
            a: 0,
            b: false,
            p: "69900",
            s: "0.5",
            r: true,
            t: { trigger: { isMarket: false, triggerPx: "69950", tpsl: "sl" } },
            c: "0xtrigger00000000000000000000000001"
          }]
        },
        nonce: 14,
        signature: { r: "0x1", s: "0x2", v: 27 }
      }
    });
    expect(triggerResponse.statusCode).toBe(200);
    expect(triggerResponse.json().response.data.statuses[0].resting.oid).toBeGreaterThanOrEqual(1000000001);

    const triggerOpenOrdersResponse = await app.inject({
      method: "POST",
      url: "/info",
      headers: { authorization: `Bearer ${frontendSession.token}` },
      payload: { type: "openOrders", user: "paper-account-1" }
    });
    expect(triggerOpenOrdersResponse.statusCode).toBe(200);
    expect(triggerOpenOrdersResponse.json().some((entry: { triggerCondition?: unknown }) => Boolean(entry.triggerCondition))).toBe(true);

    const frontendOpenOrdersResponse = await app.inject({
      method: "POST",
      url: "/info",
      headers: { authorization: `Bearer ${frontendSession.token}` },
      payload: { type: "frontendOpenOrders", user: "paper-account-1" }
    });
    expect(frontendOpenOrdersResponse.statusCode).toBe(200);
    expect(Array.isArray(frontendOpenOrdersResponse.json())).toBe(true);
    expect(frontendOpenOrdersResponse.json().some((entry: { triggerCondition?: unknown }) => Boolean(entry.triggerCondition))).toBe(true);
  });

  it("validates leverage updates and handles success", async () => {
    expect((await app.inject({
      method: "POST",
      url: "/api/leverage",
      headers: { authorization: `Bearer ${frontendSession.token}` },
      payload: { leverage: "abc" }
    })).statusCode).toBe(400);

    expect((await app.inject({
      method: "POST",
      url: "/api/leverage",
      headers: { authorization: `Bearer ${frontendSession.token}` },
      payload: { leverage: 0 }
    })).statusCode).toBe(400);

    expect((await app.inject({
      method: "POST",
      url: "/api/leverage",
      headers: { authorization: `Bearer ${frontendSession.token}` },
      payload: { symbol: "ETH-USD", leverage: 5 }
    })).statusCode).toBe(400);

    expect((await app.inject({
      method: "POST",
      url: "/api/leverage",
      headers: { authorization: `Bearer ${frontendSession.token}` },
      payload: { leverage: 30 }
    })).statusCode).toBe(400);

    const response = await app.inject({
      method: "POST",
      url: "/api/leverage",
      headers: { authorization: `Bearer ${frontendSession.token}` },
      payload: { leverage: 5 }
    });

    expect(response.statusCode).toBe(202);
    expect(runtime.updateLeverage).toHaveBeenCalledWith("BTC-USD", 5);
  });

  it("handles manual ticks", async () => {
    runtime.ingestManualTick.mockResolvedValueOnce({ ok: false, message: "bad tick" });
    expect((await app.inject({
      method: "POST",
      url: "/api/market-ticks",
      headers: { authorization: `Bearer ${adminSession.token}` },
      payload: { symbol: "BTC-USD" }
    })).statusCode).toBe(400);

    expect((await app.inject({
      method: "POST",
      url: "/api/market-ticks",
      headers: { authorization: `Bearer ${adminSession.token}` },
      payload: { symbol: "BTC-USD", bid: 1, ask: 2, last: 1.5, spread: 1, tickTime: "2026-01-01T00:00:00.000Z" }
    })).statusCode).toBe(202);
  });

  it("handles order submit and cancel endpoints", async () => {
    expect((await app.inject({
      method: "POST",
      url: "/api/orders",
      headers: { authorization: `Bearer ${frontendSession.token}` },
      payload: { accountId: "paper-account-1", symbol: "BTC-USD", side: "buy", orderType: "market", quantity: 1 }
    })).statusCode).toBe(202);
    expect(runtime.submitOrder).toHaveBeenCalledWith({
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      side: "buy",
      orderType: "market",
      quantity: 1
    });

    expect((await app.inject({
      method: "POST",
      url: "/api/orders/cancel",
      headers: { authorization: `Bearer ${frontendSession.token}` },
      payload: { accountId: "paper-account-1", orderId: "ord_1" }
    })).statusCode).toBe(202);
    expect(runtime.cancelOrder).toHaveBeenCalledWith({ accountId: "paper-account-1", orderId: "ord_1" });

    await app.inject({
      method: "POST",
      url: "/api/orders/ord_9/cancel",
      headers: { authorization: `Bearer ${frontendSession.token}` },
      payload: {}
    });
    expect(runtime.cancelOrder).toHaveBeenLastCalledWith({
      accountId: "paper-account-1",
      orderId: "ord_9",
      requestedAt: undefined
    });
  });

  it("builds combined order history entries for live, inferred tpsl, and trigger orders", async () => {
    await app.inject({
      method: "POST",
      url: "/api/orders",
      headers: { authorization: `Bearer ${frontendSession.token}` },
      payload: {
        symbol: "BTC-USD",
        side: "buy",
        orderType: "market",
        quantity: 1,
        clientOrderId: "0xtp-aaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      }
    });

    await app.inject({
      method: "POST",
      url: "/api/orders",
      headers: { authorization: `Bearer ${frontendSession.token}` },
      payload: {
        symbol: "BTC-USD",
        side: "sell",
        orderType: "limit",
        quantity: 1,
        limitPrice: 69950,
        clientOrderId: "0xsl-bbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      }
    });

    await app.inject({
      method: "POST",
      url: "/exchange",
      headers: { authorization: `Bearer ${frontendSession.token}` },
      payload: {
        action: {
          type: "order",
          orders: [{
            a: 0,
            b: false,
            p: "69900",
            s: "0.5",
            r: true,
            t: { trigger: { isMarket: false, triggerPx: "69950", tpsl: "sl" } },
            c: "0xtrigger-history"
          }]
        },
        nonce: 50,
        signature: { r: "0x1", s: "0x2", v: 27 }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/order-history",
      headers: { authorization: `Bearer ${frontendSession.token}` }
    });

    expect(response.statusCode).toBe(200);
    const history = response.json() as Array<{
      kind: string;
      clientOrderId?: string;
      orderType?: string;
      triggerCondition?: { triggerPx: string; isMarket: boolean; tpsl: string };
      reduceOnly?: boolean;
    }>;

    expect(history).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "order",
        clientOrderId: "0xtp-aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        triggerCondition: {
          triggerPx: "",
          isMarket: true,
          tpsl: "tp"
        }
      }),
      expect.objectContaining({
        kind: "order",
        clientOrderId: "0xsl-bbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        triggerCondition: {
          triggerPx: "",
          isMarket: false,
          tpsl: "sl"
        }
      }),
      expect.objectContaining({
        kind: "trigger",
        clientOrderId: "0xtrigger-history",
        orderType: "limit",
        reduceOnly: true,
        triggerCondition: {
          triggerPx: "",
          isMarket: false,
          tpsl: "sl"
        }
      })
    ]));
  });

  it("handles auth and admin management endpoints", async () => {
    const loginResponse = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "demo",
        password: "demo123456",
        role: "frontend"
      }
    });
    expect(loginResponse.statusCode).toBe(200);
    expect(runtime.login).toHaveBeenCalledWith("demo", "demo123456", "frontend");

    const meResponse = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${adminSession.token}` }
    });
    expect(meResponse.json()).toEqual({
      user: adminSession.user,
      platform: platformSettings
    });

    const botCredentialsResponse = await app.inject({
      method: "GET",
      url: "/api/bot-credentials",
      headers: { authorization: `Bearer ${frontendSession.token}` }
    });
    expect(botCredentialsResponse.statusCode).toBe(200);
    expect(botCredentialsResponse.json()).toMatchObject({
      accountId: "paper-account-1"
    });

    const listUsersResponse = await app.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: { authorization: `Bearer ${adminSession.token}` }
    });
    expect(listUsersResponse.json()).toEqual({
      users: [frontendSession.user]
    });

    const createUserResponse = await app.inject({
      method: "POST",
      url: "/api/admin/users",
      headers: { authorization: `Bearer ${adminSession.token}` },
      payload: {
        username: "new-demo",
        password: "secret123",
        displayName: "New Demo",
        tradingAccountId: "paper-account-2"
      }
    });
    expect(createUserResponse.statusCode).toBe(201);
    expect(runtime.createFrontendUser).toHaveBeenCalledWith({
      username: "new-demo",
      password: "secret123",
      displayName: "New Demo",
      tradingAccountId: "paper-account-2"
    });

    const updateUserResponse = await app.inject({
      method: "PUT",
      url: "/api/admin/users/frontend-user-1",
      headers: { authorization: `Bearer ${adminSession.token}` },
      payload: {
        displayName: "Renamed Demo",
        isActive: false
      }
    });
    expect(updateUserResponse.statusCode).toBe(200);
    expect(runtime.updateFrontendUser).toHaveBeenCalledWith("frontend-user-1", {
      displayName: "Renamed Demo",
      isActive: false
    });

    const settingsResponse = await app.inject({
      method: "PUT",
      url: "/api/admin/platform-settings",
      headers: { authorization: `Bearer ${adminSession.token}` },
      payload: {
        platformName: "My Desk",
        platformAnnouncement: "Scheduled maintenance",
        activeExchange: "hyperliquid",
        activeSymbol: "ETH-USD",
        maintenanceMode: true,
        allowFrontendTrading: false,
        allowManualTicks: true
      }
    });
    expect(settingsResponse.statusCode).toBe(200);
    expect(runtime.updatePlatformSettings).toHaveBeenCalledWith({
      platformName: "My Desk",
      platformAnnouncement: "Scheduled maintenance",
      activeExchange: "hyperliquid",
      activeSymbol: "ETH-USD",
      maintenanceMode: true,
      allowFrontendTrading: false,
      allowManualTicks: true
    });

    const adminStateResponse = await app.inject({
      method: "GET",
      url: "/api/admin/state",
      headers: { authorization: `Bearer ${adminSession.token}` }
    });
    expect(adminStateResponse.json()).toEqual({ events: [], platform: platformSettings });

    const batchJobsResponse = await app.inject({
      method: "GET",
      url: "/api/admin/batch-jobs",
      headers: { authorization: `Bearer ${adminSession.token}` }
    });
    expect(batchJobsResponse.json()).toEqual({
      jobs: [
        {
          id: "batch-refresh-hl-day",
          label: "Refresh Hyperliquid Day",
          description: "Reload today's candles."
        }
      ]
    });

    const runningExecutionsResponse = await app.inject({
      method: "GET",
      url: "/api/admin/batch-job-executions/running",
      headers: { authorization: `Bearer ${adminSession.token}` }
    });
    expect(runningExecutionsResponse.statusCode).toBe(200);
    expect(runningExecutionsResponse.json()).toEqual({
      jobs: [{
        executionId: "exec-1",
        jobId: "batch-refresh-hl-day",
        status: "running",
        startedAt: "2026-04-09T00:00:00.000Z",
        command: "",
        args: [],
        stdout: "",
        stderr: ""
      }]
    });

    const executionResponse = await app.inject({
      method: "GET",
      url: "/api/admin/batch-job-executions/exec-1",
      headers: { authorization: `Bearer ${adminSession.token}` }
    });
    expect(executionResponse.statusCode).toBe(200);
    expect(executionResponse.json()).toEqual({
      executionId: "exec-1",
      jobId: "batch-refresh-hl-day",
      status: "success",
      startedAt: "2026-04-09T00:00:00.000Z",
      finishedAt: "2026-04-09T00:10:00.000Z",
      command: "",
      args: [],
      stdout: "ok",
      stderr: ""
    });

    const runBatchJobResponse = await app.inject({
      method: "POST",
      url: "/api/admin/batch-jobs/batch-refresh-hl-day/run",
      headers: { authorization: `Bearer ${adminSession.token}` },
      payload: {
        coin: "BTC",
        date: "2026-04-09"
      }
    });
    expect(runBatchJobResponse.statusCode).toBe(202);
    expect(runtime.runBatchJob).toHaveBeenCalledWith("batch-refresh-hl-day", {
      coin: "BTC",
      date: "2026-04-09"
    });

    const logoutResponse = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { authorization: `Bearer ${frontendSession.token}` }
    });
    expect(logoutResponse.statusCode).toBe(204);
    expect(runtime.logout).toHaveBeenCalledWith(frontendSession.token);
  });

  it("returns localized auth and admin failures", async () => {
    expect((await app.inject({
      method: "GET",
      url: "/api/state"
    })).statusCode).toBe(401);

    expect((await app.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: { authorization: `Bearer ${frontendSession.token}` }
    })).statusCode).toBe(401);

    runtime.getPlatformSettings
      .mockReturnValueOnce({
        ...platformSettings,
        allowFrontendTrading: false
      })
      .mockReturnValueOnce({
        ...platformSettings,
        allowFrontendTrading: false
      });
    expect((await app.inject({
      method: "POST",
      url: "/api/orders",
      headers: { authorization: `Bearer ${frontendSession.token}` },
      payload: { symbol: "BTC-USD", side: "buy", orderType: "market", quantity: 1 }
    })).statusCode).toBe(403);

    runtime.getPlatformSettings.mockReturnValueOnce({
      ...platformSettings,
      allowManualTicks: false
    });
    expect((await app.inject({
      method: "POST",
      url: "/api/market-ticks",
      headers: { authorization: `Bearer ${adminSession.token}` },
      payload: { symbol: "BTC-USD" }
    })).statusCode).toBe(403);

    runtime.listRunningBatchJobs.mockRejectedValueOnce(new Error("runner unavailable"));
    expect((await app.inject({
      method: "GET",
      url: "/api/admin/batch-job-executions/running",
      headers: { authorization: `Bearer ${adminSession.token}` }
    })).statusCode).toBe(500);

    runtime.getBatchJobExecution.mockRejectedValueOnce(new Error("execution missing"));
    expect((await app.inject({
      method: "GET",
      url: "/api/admin/batch-job-executions/exec-missing",
      headers: { authorization: `Bearer ${adminSession.token}` }
    })).statusCode).toBe(500);

    runtime.login.mockRejectedValueOnce(new Error("Invalid credentials."));
    expect((await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "demo", password: "bad", role: "frontend" }
    })).statusCode).toBe(401);

    expect((await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "", password: "", role: undefined }
    })).statusCode).toBe(400);
  });

  it("covers additional route error branches and less-used endpoints", async () => {
    const meUnauthorized = await app.inject({
      method: "GET",
      url: "/api/auth/me"
    });
    expect(meUnauthorized.statusCode).toBe(401);

    const marketHistoryUnauthorized = await app.inject({
      method: "GET",
      url: "/api/market-history"
    });
    expect(marketHistoryUnauthorized.statusCode).toBe(401);

    const marketVolumeUnauthorized = await app.inject({
      method: "GET",
      url: "/api/market-volume"
    });
    expect(marketVolumeUnauthorized.statusCode).toBe(401);

    const privateInfoUnauthorized = await app.inject({
      method: "POST",
      url: "/info",
      payload: { type: "openOrders", user: "paper-account-1" }
    });
    expect(privateInfoUnauthorized.statusCode).toBe(401);

    const publicInfoMissingType = await app.inject({
      method: "POST",
      url: "/info",
      payload: {}
    });
    expect(publicInfoMissingType.statusCode).toBe(400);

    expect((await app.inject({
      method: "POST",
      url: "/exchange",
      payload: {
        action: { type: "order", orders: [] },
        nonce: 1,
        signature: { r: "0x1", s: "0x2", v: 27 }
      }
    })).statusCode).toBe(401);

    expect((await app.inject({
      method: "GET",
      url: "/api/bot-credentials"
    })).statusCode).toBe(401);

    expect((await app.inject({
      method: "GET",
      url: "/api/account"
    })).statusCode).toBe(401);

    expect((await app.inject({
      method: "GET",
      url: "/api/orders"
    })).statusCode).toBe(401);

    expect((await app.inject({
      method: "GET",
      url: "/api/events"
    })).statusCode).toBe(401);

    expect((await app.inject({
      method: "GET",
      url: "/api/fill-history"
    })).statusCode).toBe(401);

    expect((await app.inject({
      method: "GET",
      url: "/api/replay/session-unauthorized"
    })).statusCode).toBe(401);

    expect((await app.inject({
      method: "GET",
      url: "/api/order-history"
    })).statusCode).toBe(401);

    expect((await app.inject({
      method: "GET",
      url: "/api/admin/state",
      headers: { authorization: `Bearer ${frontendSession.token}` }
    })).statusCode).toBe(401);

    expect((await app.inject({
      method: "GET",
      url: "/api/admin/platform-settings",
      headers: { authorization: `Bearer ${frontendSession.token}` }
    })).statusCode).toBe(401);

    expect((await app.inject({
      method: "GET",
      url: "/api/admin/batch-jobs",
      headers: { authorization: `Bearer ${frontendSession.token}` }
    })).statusCode).toBe(401);

    expect((await app.inject({
      method: "POST",
      url: "/api/orders/cancel",
      payload: { orderId: "ord_1" }
    })).statusCode).toBe(401);

    expect((await app.inject({
      method: "POST",
      url: "/api/orders/ord_1/cancel",
      payload: {}
    })).statusCode).toBe(401);

    expect((await app.inject({
      method: "GET",
      url: "/api/fills/fill_1/replay"
    })).statusCode).toBe(401);

    const exchangeBadPayload = await app.inject({
      method: "POST",
      url: "/exchange",
      headers: { authorization: `Bearer ${frontendSession.token}` },
      payload: {
        nonce: 999,
        signature: { r: "0x1", s: "0x2", v: 27 }
      }
    });
    expect(exchangeBadPayload.statusCode).toBe(400);
    expect(exchangeBadPayload.json()).toEqual({
      status: "error",
      response: {
        type: "error",
        data: "Missing action"
      }
    });

    const positionsResponse = await app.inject({
      method: "GET",
      url: "/api/positions",
      headers: { authorization: `Bearer ${frontendSession.token}` }
    });
    expect(positionsResponse.statusCode).toBe(200);
    expect(positionsResponse.json()).toMatchObject({
      symbol: "BTC-USD",
      side: "long",
      quantity: 1
    });

    const fillHistoryResponse = await app.inject({
      method: "GET",
      url: "/api/fill-history",
      headers: { authorization: `Bearer ${frontendSession.token}` }
    });
    expect(fillHistoryResponse.statusCode).toBe(200);
    expect(fillHistoryResponse.json()).toEqual({
      sessionId: "session-1",
      events: []
    });

    const adminPlatformSettingsResponse = await app.inject({
      method: "GET",
      url: "/api/admin/platform-settings",
      headers: { authorization: `Bearer ${adminSession.token}` }
    });
    expect(adminPlatformSettingsResponse.statusCode).toBe(200);
    expect(adminPlatformSettingsResponse.json()).toEqual(platformSettings);

    const createUserRejected = await app.inject({
      method: "POST",
      url: "/api/admin/users",
      headers: { authorization: `Bearer ${adminSession.token}` },
      payload: {
        username: "missing-fields"
      }
    });
    expect(createUserRejected.statusCode).toBe(400);

    await app.inject({
      method: "GET",
      url: "/api/market-history",
      headers: { authorization: `Bearer ${frontendSession.token}` }
    });
    expect(runtime.getMarketHistory).toHaveBeenLastCalledWith(200);

    await app.inject({
      method: "GET",
      url: "/api/market-volume",
      headers: { authorization: `Bearer ${frontendSession.token}` }
    });
    expect(runtime.getMarketVolume).toHaveBeenLastCalledWith(500, "1m", "BTC");

    await app.inject({
      method: "PUT",
      url: "/api/admin/platform-settings",
      headers: { authorization: `Bearer ${adminSession.token}` },
      payload: {}
    });
    expect(runtime.updatePlatformSettings).toHaveBeenLastCalledWith({
      platformName: "Stratium Demo",
      platformAnnouncement: "",
      activeExchange: "hyperliquid",
      activeSymbol: "BTC-USD",
      maintenanceMode: false,
      allowFrontendTrading: true,
      allowManualTicks: true
    });

    runtime.runBatchJob
      .mockResolvedValueOnce({
        executionId: "exec-2",
        jobId: "batch-refresh-hl-day",
        status: "success",
        ok: true
      })
      .mockResolvedValueOnce({
        executionId: "exec-3",
        jobId: "batch-refresh-hl-day",
        status: "failed",
        ok: false
      })
      .mockRejectedValueOnce("runner exploded");

    expect((await app.inject({
      method: "POST",
      url: "/api/admin/batch-jobs/batch-refresh-hl-day/run",
      headers: { authorization: `Bearer ${adminSession.token}` },
      payload: {}
    })).statusCode).toBe(200);

    expect((await app.inject({
      method: "POST",
      url: "/api/admin/batch-jobs/batch-refresh-hl-day/run",
      headers: { authorization: `Bearer ${adminSession.token}` },
      payload: {}
    })).statusCode).toBe(500);

    const batchRunRejected = await app.inject({
      method: "POST",
      url: "/api/admin/batch-jobs/batch-refresh-hl-day/run",
      headers: { authorization: `Bearer ${adminSession.token}` },
      payload: {}
    });
    expect(batchRunRejected.statusCode).toBe(400);
    expect(batchRunRejected.json()).toEqual({
      ok: false,
      message: "Batch job request failed."
    });

    runtime.login.mockRejectedValueOnce(new Error("Custom auth backend error"));
    const loginCustomError = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "demo", password: "bad", role: "frontend" }
    });
    expect(loginCustomError.statusCode).toBe(401);
    expect(loginCustomError.json()).toEqual({
      status: "unauthorized",
      message: "Custom auth backend error"
    });

    const cancelByIdResponse = await app.inject({
      method: "POST",
      url: "/api/orders/ord_10/cancel",
      headers: { authorization: `Bearer ${frontendSession.token}` },
      payload: { requestedAt: "2026-04-10T00:00:00.000Z" }
    });
    expect(cancelByIdResponse.statusCode).toBe(202);
    expect(runtime.cancelOrder).toHaveBeenLastCalledWith({
      accountId: "paper-account-1",
      orderId: "ord_10",
      requestedAt: "2026-04-10T00:00:00.000Z"
    });
  });

  it("authenticates bot signer requests without frontend session", async () => {
    const credentialsResponse = await app.inject({
      method: "GET",
      url: "/api/bot-credentials",
      headers: { authorization: `Bearer ${frontendSession.token}` }
    });
    const credentials = credentialsResponse.json() as {
      accountId: string;
      vaultAddress: string;
      signerAddress: string;
      apiSecret: string;
    };

    const signBody = (body: Record<string, unknown>) => {
      return `0x${createHmac("sha256", credentials.apiSecret).update(canonicalStringify(body)).digest("hex")}`;
    };

    const exchangeBody = {
      action: {
        type: "order",
        orders: [{
          a: 0,
          b: true,
          p: "70000",
          s: "1",
          r: false,
          t: { limit: { tif: "Gtc" } }
        }]
      },
      nonce: 101,
      vaultAddress: credentials.vaultAddress,
      signature: {
        r: credentials.signerAddress,
        s: "",
        v: 27
      }
    };
    exchangeBody.signature.s = signBody({
      action: exchangeBody.action,
      nonce: exchangeBody.nonce,
      vaultAddress: exchangeBody.vaultAddress
    });

    const exchangeResponse = await app.inject({
      method: "POST",
      url: "/exchange",
      payload: exchangeBody
    });
    expect(exchangeResponse.statusCode).toBe(200);

    const replayResponse = await app.inject({
      method: "POST",
      url: "/exchange",
      payload: exchangeBody
    });
    expect(replayResponse.statusCode).toBe(401);

    const infoBody = {
      type: "openOrders",
      user: credentials.accountId,
      nonce: 102,
      vaultAddress: credentials.vaultAddress,
      signature: {
        r: credentials.signerAddress,
        s: "",
        v: 27
      }
    };
    infoBody.signature.s = signBody({
      type: infoBody.type,
      user: infoBody.user,
      nonce: infoBody.nonce,
      vaultAddress: infoBody.vaultAddress
    });

    const infoResponse = await app.inject({
      method: "POST",
      url: "/info",
      payload: infoBody
    });
    expect(infoResponse.statusCode).toBe(200);
    expect(Array.isArray(infoResponse.json())).toBe(true);
  });

  it("handles websocket auth branches and private websocket subscriptions", async () => {
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const credentialsResponse = await app.inject({
      method: "GET",
      url: "/api/bot-credentials",
      headers: { authorization: `Bearer ${frontendSession.token}` }
    });
    const credentials = credentialsResponse.json() as {
      accountId: string;
      vaultAddress: string;
      signerAddress: string;
      apiSecret: string;
    };
    const signBody = (body: Record<string, unknown>) =>
      `0x${createHmac("sha256", credentials.apiSecret).update(canonicalStringify(body)).digest("hex")}`;

    const unauthorizedFrontendSocket = new (globalThis as unknown as { WebSocket: new (url: string) => {
      close: () => void;
      addEventListener: (event: string, listener: (...args: unknown[]) => void, options?: { once?: boolean }) => void;
    } }).WebSocket(`${address.replace("http", "ws")}/ws`);
    await waitForSocketClose(unauthorizedFrontendSocket);

    const frontendSocket = new (globalThis as unknown as { WebSocket: new (url: string) => {
      close: () => void;
      addEventListener: (event: string, listener: (...args: unknown[]) => void, options?: { once?: boolean }) => void;
    } }).WebSocket(`${address.replace("http", "ws")}/ws?token=${frontendSession.token}`);
    await waitForSocketOpen(frontendSocket);
    expect(runtime.addSocket).toHaveBeenCalledTimes(1);
    frontendSocket.close();
    await waitForSocketClose(frontendSocket);

    const invalidPrivateSocket = new (globalThis as unknown as { WebSocket: new (url: string) => {
      close: () => void;
      addEventListener: (event: string, listener: (...args: unknown[]) => void, options?: { once?: boolean }) => void;
    } }).WebSocket(`${address.replace("http", "ws")}/ws-hyperliquid?nonce=401&vaultAddress=0xdeadbeef&signer=0xdeadbeef&sig=0xdeadbeef`);
    await waitForSocketClose(invalidPrivateSocket);

    const nonce = 402;
    const vaultAddress = credentials.vaultAddress;
    const signer = credentials.signerAddress;
    const sig = signBody({ nonce, vaultAddress });
    const privateSocket = new (globalThis as unknown as { WebSocket: new (url: string) => {
      close: () => void;
      send: (payload: string) => void;
      addEventListener: (event: string, listener: (...args: unknown[]) => void, options?: { once?: boolean }) => void;
    } }).WebSocket(`${address.replace("http", "ws")}/ws-hyperliquid?nonce=${nonce}&vaultAddress=${encodeURIComponent(vaultAddress)}&signer=${encodeURIComponent(signer)}&sig=${encodeURIComponent(sig)}`);
    await waitForSocketOpen(privateSocket);
    privateSocket.send(JSON.stringify({
      method: "subscribe",
      subscription: {
        type: "orderUpdates",
        user: vaultAddress
      }
    }));
    const message = await waitForSocketMessage(privateSocket);
    expect(message).toEqual({
      channel: "orderUpdates",
      data: []
    });
    privateSocket.close();
    await waitForSocketClose(privateSocket);
  });

  it("closes frontend websocket connections during maintenance", async () => {
    runtime.getPlatformSettings.mockReturnValue({
      ...platformSettings,
      maintenanceMode: true
    });

    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const frontendSocket = new (globalThis as unknown as { WebSocket: new (url: string) => {
      close: () => void;
      addEventListener: (event: string, listener: (...args: unknown[]) => void, options?: { once?: boolean }) => void;
    } }).WebSocket(`${address.replace("http", "ws")}/ws?token=${frontendSession.token}`);

    await waitForSocketClose(frontendSocket);
    expect(runtime.addSocket).not.toHaveBeenCalled();
  });

  it("covers trigger-store route branches, token extraction variants, and non-Error failures", async () => {
    const routeApp = Fastify();
    await routeApp.register(websocket);

    const triggerRuntime = {
      ...runtime,
      getSession: vi.fn((token?: string) => {
        if (token === frontendSession.token) {
          return frontendSession;
        }
        if (token === adminSession.token) {
          return adminSession;
        }
        return null;
      }),
      getOrders: vi.fn(() => [{
        id: "ord_99",
        clientOrderId: "0xlinked-trigger",
        symbol: "BTC-USD",
        side: "sell" as const,
        orderType: "limit" as const,
        status: "ACCEPTED",
        quantity: 1,
        filledQuantity: 0,
        remainingQuantity: 1,
        limitPrice: 70010,
        averageFillPrice: undefined,
        createdAt: "2026-04-10T00:00:00.000Z",
        updatedAt: "2026-04-10T00:00:02.000Z"
      }]),
      getNextTriggerOrderOid: vi.fn(async () => 1000000200),
      upsertTriggerOrderHistory: vi.fn(async () => undefined),
      listTriggerOrderHistory: vi.fn(async () => [{
        oid: 1000000101,
        accountId: "paper-account-1",
        asset: 0,
        isBuy: true,
        triggerPx: 71000,
        actualTriggerPx: 71010,
        isMarket: true,
        tpsl: "tp" as const,
        size: 1,
        limitPx: 71020,
        reduceOnly: true,
        cloid: "0xlinked-trigger",
        status: "filled",
        createdAt: new Date("2026-04-10T00:00:00.000Z").getTime(),
        updatedAt: new Date("2026-04-10T00:00:05.000Z").getTime()
      }]),
      listPendingTriggerOrders: vi.fn(async () => []),
      findTriggerOrder: vi.fn(async () => null)
    };

    await registerRoutes(routeApp, triggerRuntime as never);

    const orderHistoryWithQueryToken = await routeApp.inject({
      method: "GET",
      url: `/api/order-history?token=${frontendSession.token}`
    });
    expect(orderHistoryWithQueryToken.statusCode).toBe(200);
    expect(orderHistoryWithQueryToken.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "trigger",
        side: "buy",
        orderType: "market",
        filledQuantity: 1,
        averageFillPrice: 71020
      }),
      expect.objectContaining({
        kind: "order",
        clientOrderId: "0xlinked-trigger",
        reduceOnly: true,
        triggerCondition: {
          triggerPx: "71010",
          isMarket: true,
          tpsl: "tp"
        }
      })
    ]));

    const exchangeWithoutBody = await routeApp.inject({
      method: "POST",
      url: "/exchange"
    });
    expect(exchangeWithoutBody.statusCode).toBe(401);

    triggerRuntime.getMarketData.mockImplementationOnce(() => {
      throw "info exploded";
    });
    const infoStringFailure = await routeApp.inject({
      method: "POST",
      url: "/info",
      payload: { type: "meta" }
    });
    expect(infoStringFailure.statusCode).toBe(400);
    expect(infoStringFailure.json()).toEqual({
      status: "error",
      message: "Unsupported Hyperliquid info request."
    });

    triggerRuntime.submitOrder.mockRejectedValueOnce("exchange exploded");
    const exchangeStringFailure = await routeApp.inject({
      method: "POST",
      url: "/exchange",
      headers: { authorization: `Bearer ${frontendSession.token}` },
      payload: {
        action: {
          type: "order",
          orders: [{
            a: 0,
            b: true,
            p: "70000",
            s: "1",
            r: false,
            t: { limit: { tif: "Gtc" } }
          }]
        },
        nonce: 200,
        signature: { r: "0x1", s: "0x2", v: 27 }
      }
    });
    expect(exchangeStringFailure.statusCode).toBe(400);
    expect(exchangeStringFailure.json()).toEqual({
      status: "error",
      response: {
        type: "error",
        data: "exchange exploded"
      }
    });

    triggerRuntime.listRunningBatchJobs.mockRejectedValueOnce("runner exploded");
    expect((await routeApp.inject({
      method: "GET",
      url: "/api/admin/batch-job-executions/running",
      headers: { authorization: `Bearer ${adminSession.token}` }
    })).json()).toEqual({
      message: "Batch job request failed."
    });

    triggerRuntime.getBatchJobExecution.mockRejectedValueOnce("execution exploded");
    expect((await routeApp.inject({
      method: "GET",
      url: "/api/admin/batch-job-executions/exec-2",
      headers: { authorization: `Bearer ${adminSession.token}` }
    })).json()).toEqual({
      message: "Batch job request failed."
    });

    await routeApp.close();
  });
});
