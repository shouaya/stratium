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
      simulator: {
        enabled: false,
        symbol: "BTC-USD",
        intervalMs: 1000,
        driftBps: 0,
        volatilityBps: 10,
        anchorPrice: 70000,
        lastPrice: 70000,
        tickCount: 0
      },
      market: {
        source: "simulator" as const,
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
});
