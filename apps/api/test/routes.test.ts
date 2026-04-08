import Fastify from "fastify";
import websocket from "@fastify/websocket";
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
    allowFrontendTrading: true,
    allowManualTicks: true,
    allowSimulatorControl: true
  };
  const runtime = {
    login: vi.fn(),
    logout: vi.fn(),
    getSession: vi.fn(),
    getPlatformSettings: vi.fn(),
    getStatePayload: vi.fn(),
    getMarketHistory: vi.fn(),
    getHyperliquidCandleInterval: vi.fn(() => "1m"),
    getHyperliquidCoin: vi.fn(() => "BTC"),
    getMarketVolume: vi.fn(),
    getEngineState: vi.fn(),
    getEventStore: vi.fn(),
    getReplayPayload: vi.fn(),
    getMarketSimulatorState: vi.fn(),
    getSymbolConfigState: vi.fn(),
    getAdminStatePayload: vi.fn(),
    listFrontendUsers: vi.fn(),
    createFrontendUser: vi.fn(),
    updateFrontendUser: vi.fn(),
    updatePlatformSettings: vi.fn(),
    updateLeverage: vi.fn(),
    startMarketSimulator: vi.fn(),
    stopMarketSimulator: vi.fn(),
    ingestManualTick: vi.fn(),
    submitOrder: vi.fn(),
    cancelOrder: vi.fn(),
    addSocket: vi.fn()
  };

  beforeEach(async () => {
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
    runtime.getStatePayload.mockResolvedValue({ ok: true });
    runtime.getMarketHistory.mockResolvedValue({ candles: [], trades: [] });
    runtime.getMarketVolume.mockResolvedValue({ records: [] });
    runtime.getEngineState.mockReturnValue({
      simulationSessionId: "session-1",
      account: { accountId: "paper-account-1" },
      orders: [],
      position: {}
    });
    runtime.getEventStore.mockReturnValue([]);
    runtime.getReplayPayload.mockReturnValue({ sessionId: "session-1" });
    runtime.getMarketSimulatorState.mockReturnValue({ enabled: false });
    runtime.getSymbolConfigState.mockReturnValue({
      symbol: "BTC-USD",
      leverage: 10,
      maxLeverage: 20
    });
    runtime.getAdminStatePayload.mockReturnValue({ events: [], platform: platformSettings });
    runtime.listFrontendUsers.mockResolvedValue([frontendSession.user]);
    runtime.createFrontendUser.mockResolvedValue(frontendSession.user);
    runtime.updateFrontendUser.mockResolvedValue(frontendSession.user);
    runtime.updatePlatformSettings.mockResolvedValue(platformSettings);
    runtime.updateLeverage.mockResolvedValue(undefined);
    runtime.startMarketSimulator.mockReturnValue({ enabled: true });
    runtime.stopMarketSimulator.mockReturnValue({ enabled: false });
    runtime.ingestManualTick.mockResolvedValue({ ok: true, result: { events: [] } });
    runtime.submitOrder.mockResolvedValue({ events: [] });
    runtime.cancelOrder.mockResolvedValue({ events: [] });

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
    })).json()).toEqual({ accountId: "paper-account-1" });
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

  it("handles simulator controls and manual ticks", async () => {
    expect((await app.inject({
      method: "POST",
      url: "/api/market-simulator/start",
      headers: { authorization: `Bearer ${adminSession.token}` },
      payload: { intervalMs: 500 }
    })).json()).toEqual({
      status: "started",
      simulator: { enabled: true }
    });

    expect((await app.inject({
      method: "POST",
      url: "/api/market-simulator/stop",
      headers: { authorization: `Bearer ${adminSession.token}` }
    })).json()).toEqual({
      status: "stopped",
      simulator: { enabled: false }
    });

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
        allowFrontendTrading: false,
        allowManualTicks: true,
        allowSimulatorControl: false
      }
    });
    expect(settingsResponse.statusCode).toBe(200);
    expect(runtime.updatePlatformSettings).toHaveBeenCalledWith({
      platformName: "My Desk",
      platformAnnouncement: "Scheduled maintenance",
      allowFrontendTrading: false,
      allowManualTicks: true,
      allowSimulatorControl: false
    });

    const adminStateResponse = await app.inject({
      method: "GET",
      url: "/api/admin/state",
      headers: { authorization: `Bearer ${adminSession.token}` }
    });
    expect(adminStateResponse.json()).toEqual({ events: [], platform: platformSettings });

    const logoutResponse = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { authorization: `Bearer ${frontendSession.token}` }
    });
    expect(logoutResponse.statusCode).toBe(204);
    expect(runtime.logout).toHaveBeenCalledWith(frontendSession.token);
  });
});
