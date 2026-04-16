import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HyperliquidMarketClient } from "../src/market/hyperliquid-market";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  public readonly sent: string[] = [];

  private readonly listeners = new Map<string, Array<(event?: { data?: string }) => void>>();

  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(event: string, listener: (event?: { data?: string }) => void) {
    const queue = this.listeners.get(event) ?? [];
    queue.push(listener);
    this.listeners.set(event, queue);
  }

  send(message: string) {
    this.sent.push(message);
  }

  close() {
    this.emit("close");
  }

  emit(event: string, payload?: { data?: string }) {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(payload);
    }
  }
}

describe("HyperliquidMarketClient", () => {
  const onTick = vi.fn();
  const onSnapshot = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    FakeWebSocket.instances.length = 0;
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("connects, subscribes, and emits snapshots through websocket lifecycle", () => {
    vi.useFakeTimers();
    const client = new HyperliquidMarketClient({
      coin: "BTC",
      onTick,
      onSnapshot
    });

    client.connect();

    const socket = FakeWebSocket.instances[0];
    expect(socket.url).toBe("wss://api.hyperliquid.xyz/ws");

    socket.emit("open");
    expect(socket.sent).toHaveLength(4);
    expect(onSnapshot).toHaveBeenCalled();

    socket.emit("error");
    expect(onSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({
      connected: false
    }));

    vi.advanceTimersByTime(3000);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("builds ticks from book updates and keeps the best levels sorted", async () => {
    const client = new HyperliquidMarketClient({
      coin: "BTC",
      onTick,
      onSnapshot
    });

    await (client as never).handleMessage(JSON.stringify({
      channel: "l2Book",
      data: {
        coin: "BTC",
        levels: [
          [{ px: "70000", sz: "1", n: 1 }, { px: "70010", sz: "2", n: 2 }],
          [{ px: "70030", sz: "1.5", n: 1 }, { px: "70020", sz: "1", n: 1 }]
        ],
        time: 1000
      }
    }));

    expect(onTick).toHaveBeenCalledWith({
      symbol: "BTC-USD",
      bid: 70010,
      ask: 70020,
      last: 70015,
      spread: 10,
      tickTime: "1970-01-01T00:00:01.000Z",
      volatilityTag: "normal"
    });
    expect(client.getSnapshot().book.bids[0]?.price).toBe(70010);
    expect(client.getSnapshot().book.asks[0]?.price).toBe(70020);
  });

  it("ignores irrelevant books and handles empty best bid/ask snapshots", async () => {
    const client = new HyperliquidMarketClient({
      coin: "BTC",
      onTick,
      onSnapshot
    });

    await (client as never).handleMessage(JSON.stringify({
      channel: "l2Book",
      data: {
        coin: "ETH",
        levels: [[], []],
        time: 1000
      }
    }));

    expect(onTick).not.toHaveBeenCalled();

    await (client as never).handleMessage(JSON.stringify({
      channel: "l2Book",
      data: {
        coin: "BTC",
        levels: [[], []],
        time: 1000
      }
    }));

    expect(onSnapshot).toHaveBeenCalled();
    expect(onTick).not.toHaveBeenCalled();
  });

  it("deduplicates trades and normalizes side values", async () => {
    const client = new HyperliquidMarketClient({
      coin: "BTC",
      onTick,
      onSnapshot
    });

    await (client as never).handleMessage(JSON.stringify({
      channel: "trades",
      data: [
        { coin: "BTC", side: "A", px: "70001", sz: "0.1", time: 2000, tid: 1 },
        { coin: "BTC", side: "buy", px: "70002", sz: "0.2", time: 3000, tid: 2 },
        { coin: "ETH", side: "sell", px: "1", sz: "1", time: 4000, tid: 3 }
      ]
    }));
    await (client as never).handleMessage(JSON.stringify({
      channel: "trades",
      data: [
        { coin: "BTC", side: "buy", px: "70002", sz: "0.2", time: 3000, tid: 2 }
      ]
    }));

    expect(client.getSnapshot().trades).toEqual([
      { id: "BTC-3000-2", coin: "BTC", side: "buy", price: 70002, size: 0.2, time: 3000 },
      { id: "BTC-2000-1", coin: "BTC", side: "sell", price: 70001, size: 0.1, time: 2000 }
    ]);

    await (client as never).handleMessage(JSON.stringify({
      channel: "trades",
      data: [{ coin: "ETH", side: "sell", px: "1", sz: "1", time: 1, tid: 1 }]
    }));
    expect(client.getSnapshot().trades).toHaveLength(2);
  });

  it("accepts candle payload variants and keeps them ordered", async () => {
    const client = new HyperliquidMarketClient({
      coin: "BTC",
      onTick,
      onSnapshot
    });

    await (client as never).handleMessage(JSON.stringify({
      channel: "candle",
      data: {
        candle: { s: "BTC", i: "1m", t: 20, T: 30, o: "1", h: "3", l: "0.5", c: "2", v: "10", n: 4 }
      }
    }));
    await (client as never).handleMessage(JSON.stringify({
      channel: "candle",
      data: [
        { s: "BTC", i: "1m", t: 10, T: 20, o: "0.8", h: "2.5", l: "0.4", c: "1.8", v: "8", n: 3 }
      ]
    }));

    expect(client.getSnapshot().candles).toEqual([
      {
        id: "BTC-1m-10",
        coin: "BTC",
        interval: "1m",
        openTime: 10,
        closeTime: 20,
        open: 0.8,
        high: 2.5,
        low: 0.4,
        close: 1.8,
        volume: 8,
        tradeCount: 3
      },
      {
        id: "BTC-1m-20",
        coin: "BTC",
        interval: "1m",
        openTime: 20,
        closeTime: 30,
        open: 1,
        high: 3,
        low: 0.5,
        close: 2,
        volume: 10,
        tradeCount: 4
      }
    ]);

    await (client as never).handleMessage(JSON.stringify({
      channel: "candle",
      data: { foo: "bar" }
    }));
    expect(client.getSnapshot().candles).toHaveLength(2);
  });

  it("handles asset context updates and mark price fallback", async () => {
    const client = new HyperliquidMarketClient({
      coin: "BTC",
      onTick,
      onSnapshot
    });

    await (client as never).handleMessage(JSON.stringify({
      channel: "activeAssetCtx",
      data: {
        coin: "BTC",
        ctx: {
          markPx: "70005",
          midPx: "70004",
          oraclePx: "70003",
          funding: "0.0001",
          openInterest: "12",
          prevDayPx: "69000",
          dayNtlVlm: "1000000"
        }
      }
    }));

    expect(client.getSnapshot()).toEqual(expect.objectContaining({
      markPrice: 70005,
      assetCtx: expect.objectContaining({
        midPrice: 70004,
        oraclePrice: 70003,
        fundingRate: 0.0001
      })
    }));

    await (client as never).handleMessage(JSON.stringify({
      channel: "noop",
      data: {}
    }));

    expect(onSnapshot).toHaveBeenCalled();
  });

  it("ignores missing or mismatched asset context payloads and avoids duplicate reconnect timers", async () => {
    vi.useFakeTimers();
    const client = new HyperliquidMarketClient({
      coin: "BTC",
      onTick,
      onSnapshot
    });

    await (client as never).handleMessage(JSON.stringify({
      channel: "activeAssetCtx",
      data: [{ coin: "ETH", ctx: {} }]
    }));
    expect(client.getSnapshot().assetCtx).toBeUndefined();

    client.connect();
    const socket = FakeWebSocket.instances[0];
    socket.emit("close");
    socket.emit("error");
    vi.advanceTimersByTime(3000);

    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("closes cleanly and avoids reconnects after manual shutdown", () => {
    vi.useFakeTimers();
    const client = new HyperliquidMarketClient({
      coin: "BTC",
      onTick,
      onSnapshot
    });

    client.connect();
    const socket = FakeWebSocket.instances[0];
    socket.emit("open");

    client.close();
    vi.advanceTimersByTime(3000);

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(onSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({
      connected: false
    }));
  });

  it("covers nullish asset context fields and explicit close cleanup", async () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const client = new HyperliquidMarketClient({
      coin: "BTC",
      onTick,
      onSnapshot
    });
    const clientAny = client as never;

    clientAny.reconnectTimer = 123;
    clientAny.socket = {
      close: vi.fn()
    };
    client.close();
    expect(clearTimeoutSpy).toHaveBeenCalled();

    await clientAny.handleMessage(JSON.stringify({
      channel: "candle",
      data: null
    }));

    await clientAny.handleMessage(JSON.stringify({
      channel: "activeAssetCtx",
      data: {
        coin: "BTC",
        ctx: {
          markPx: null,
          midPx: null,
          oraclePx: null,
          funding: null,
          openInterest: null,
          prevDayPx: null,
          dayNtlVlm: null
        }
      }
    }));

    expect(client.getSnapshot().assetCtx).toMatchObject({
      coin: "BTC",
      markPrice: undefined,
      midPrice: undefined,
      oraclePrice: undefined,
      fundingRate: undefined,
      openInterest: undefined,
      prevDayPrice: undefined,
      dayNotionalVolume: undefined
    });
  });
});
