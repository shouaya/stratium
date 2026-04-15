import { describe, expect, it, vi } from "vitest";
import { WebSocketHub } from "../src/websocket-hub";

describe("WebSocketHub", () => {
  it("adds sockets, sends bootstrap payloads, broadcasts updates, and removes closed sockets", () => {
    const hub = new WebSocketHub();
    const first = {
      send: vi.fn(),
      on: vi.fn()
    };
    const second = {
      send: vi.fn(),
      on: vi.fn()
    };
    const bootstrapPayload = {
      type: "bootstrap" as const,
      state: { id: "state-1" },
      events: [],
      market: {
        source: "hyperliquid" as const,
        coin: "BTC",
        connected: false,
        book: { bids: [], asks: [] },
        trades: [],
        candles: []
      }
    };

    hub.addSocket(first, () => bootstrapPayload);
    hub.addSocket(second, () => bootstrapPayload);

    expect(first.send).toHaveBeenCalledTimes(1);
    expect(second.send).toHaveBeenCalledTimes(1);

    hub.broadcast([]);
    expect(first.send).toHaveBeenCalledTimes(2);
    expect(second.send).toHaveBeenCalledTimes(2);

    const closeListener = first.on.mock.calls[0]?.[1] as (() => void) | undefined;
    closeListener?.();

    hub.broadcast([]);
    expect(first.send).toHaveBeenCalledTimes(2);
    expect(second.send).toHaveBeenCalledTimes(3);
  });

  it("handles sockets without close listeners and keeps empty payload broadcasts safe", () => {
    const hub = new WebSocketHub();
    const socket = {
      send: vi.fn()
    };

    hub.addSocket(socket, () => ({
      type: "events" as const,
      state: { id: "state-2" },
      events: [],
      market: {
        source: "hyperliquid" as const,
        coin: "BTC",
        connected: false,
        book: { bids: [], asks: [] },
        trades: [],
        candles: []
      },
      symbolConfig: {
        symbol: "BTC-USD",
        coin: "BTC",
        leverage: 10,
        maxLeverage: 20,
        szDecimals: 5
      },
      platform: {
        platformName: "Stratium Demo",
        platformAnnouncement: "",
        activeExchange: "hyperliquid",
        activeSymbol: "BTC-USD",
        maintenanceMode: false,
        allowFrontendTrading: true,
        allowManualTicks: true
      }
    }));

    hub.broadcast([]);
    expect(socket.send).toHaveBeenCalledTimes(2);
  });

  it("removes sockets when bootstrap or broadcast send throws", () => {
    const hub = new WebSocketHub();
    const bootstrapFailureSocket = {
      send: vi.fn(() => {
        throw new Error("bootstrap failed");
      }),
      on: vi.fn()
    };
    const broadcastFailureSocket = {
      send: vi.fn()
        .mockImplementationOnce(() => undefined)
        .mockImplementationOnce(() => {
          throw new Error("broadcast failed");
        }),
      on: vi.fn()
    };
    const healthySocket = {
      send: vi.fn(),
      on: vi.fn()
    };
    const createPayload = () => ({
      type: "events" as const,
      state: { id: "state-3" },
      events: [],
      market: {
        source: "hyperliquid" as const,
        coin: "BTC",
        connected: false,
        book: { bids: [], asks: [] },
        trades: [],
        candles: []
      }
    });

    hub.addSocket(bootstrapFailureSocket, createPayload);
    hub.addSocket(broadcastFailureSocket, createPayload);
    hub.addSocket(healthySocket, createPayload);

    expect(bootstrapFailureSocket.send).toHaveBeenCalledTimes(1);
    expect(broadcastFailureSocket.send).toHaveBeenCalledTimes(1);
    expect(healthySocket.send).toHaveBeenCalledTimes(1);

    hub.broadcast([]);
    hub.broadcast([]);

    expect(broadcastFailureSocket.send).toHaveBeenCalledTimes(2);
    expect(healthySocket.send).toHaveBeenCalledTimes(3);
  });
});
