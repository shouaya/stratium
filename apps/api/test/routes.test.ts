import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerRoutes } from "../src/routes";

describe("registerRoutes", () => {
  let app: ReturnType<typeof Fastify>;
  const runtime = {
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
    expect((await app.inject({ method: "GET", url: "/api/state" })).json()).toEqual({ ok: true });
    expect((await app.inject({ method: "GET", url: "/api/market-history?limit=50" })).statusCode).toBe(200);
    expect(runtime.getMarketHistory).toHaveBeenCalledWith(50);
    expect((await app.inject({ method: "GET", url: "/api/market-volume?limit=20&interval=5m&coin=ETH" })).statusCode).toBe(200);
    expect(runtime.getMarketVolume).toHaveBeenCalledWith(20, "5m", "ETH");
    expect((await app.inject({ method: "GET", url: "/api/account" })).json()).toEqual({ accountId: "paper-account-1" });
    expect((await app.inject({ method: "GET", url: "/api/orders" })).json()).toEqual([]);
    expect((await app.inject({ method: "GET", url: "/api/events" })).json()).toEqual({
      sessionId: "session-1",
      events: []
    });
    expect((await app.inject({ method: "GET", url: "/api/replay/session-2" })).json()).toEqual({ sessionId: "session-1" });
  });

  it("validates leverage updates and handles success", async () => {
    expect((await app.inject({
      method: "POST",
      url: "/api/leverage",
      payload: { leverage: "abc" }
    })).statusCode).toBe(400);

    expect((await app.inject({
      method: "POST",
      url: "/api/leverage",
      payload: { leverage: 0 }
    })).statusCode).toBe(400);

    expect((await app.inject({
      method: "POST",
      url: "/api/leverage",
      payload: { symbol: "ETH-USD", leverage: 5 }
    })).statusCode).toBe(400);

    expect((await app.inject({
      method: "POST",
      url: "/api/leverage",
      payload: { leverage: 30 }
    })).statusCode).toBe(400);

    const response = await app.inject({
      method: "POST",
      url: "/api/leverage",
      payload: { leverage: 5 }
    });

    expect(response.statusCode).toBe(202);
    expect(runtime.updateLeverage).toHaveBeenCalledWith("BTC-USD", 5);
  });

  it("handles simulator controls and manual ticks", async () => {
    expect((await app.inject({
      method: "POST",
      url: "/api/market-simulator/start",
      payload: { intervalMs: 500 }
    })).json()).toEqual({
      status: "started",
      simulator: { enabled: true }
    });

    expect((await app.inject({
      method: "POST",
      url: "/api/market-simulator/stop"
    })).json()).toEqual({
      status: "stopped",
      simulator: { enabled: false }
    });

    runtime.ingestManualTick.mockResolvedValueOnce({ ok: false, message: "bad tick" });
    expect((await app.inject({
      method: "POST",
      url: "/api/market-ticks",
      payload: { symbol: "BTC-USD" }
    })).statusCode).toBe(400);

    expect((await app.inject({
      method: "POST",
      url: "/api/market-ticks",
      payload: { symbol: "BTC-USD", bid: 1, ask: 2, last: 1.5, spread: 1, tickTime: "2026-01-01T00:00:00.000Z" }
    })).statusCode).toBe(202);
  });

  it("handles order submit and cancel endpoints", async () => {
    expect((await app.inject({
      method: "POST",
      url: "/api/orders",
      payload: { accountId: "paper-account-1", symbol: "BTC-USD", side: "buy", orderType: "market", quantity: 1 }
    })).statusCode).toBe(202);
    expect(runtime.submitOrder).toHaveBeenCalled();

    expect((await app.inject({
      method: "POST",
      url: "/api/orders/cancel",
      payload: { accountId: "paper-account-1", orderId: "ord_1" }
    })).statusCode).toBe(202);
    expect(runtime.cancelOrder).toHaveBeenCalledWith({ accountId: "paper-account-1", orderId: "ord_1" });

    await app.inject({
      method: "POST",
      url: "/api/orders/ord_9/cancel",
      payload: {}
    });
    expect(runtime.cancelOrder).toHaveBeenLastCalledWith({
      accountId: "paper-account-1",
      orderId: "ord_9",
      requestedAt: undefined
    });
  });
});
