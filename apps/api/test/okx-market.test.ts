import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OkxMarketClient } from "../src/okx-market";

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

describe("OkxMarketClient", () => {
  const onTick = vi.fn();
  const onSnapshot = vi.fn();
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    FakeWebSocket.instances.length = 0;
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockImplementation(async (input: string | URL) => {
      const url = String(input);

      if (url.includes("/api/v5/public/funding-rate")) {
        return new Response(JSON.stringify({
          code: "0",
          data: [{ instId: "BTC-USDT-SWAP", fundingRate: "0.0001" }]
        }), { status: 200 });
      }

      if (url.includes("/api/v5/public/open-interest")) {
        return new Response(JSON.stringify({
          code: "0",
          data: [{ instId: "BTC-USDT-SWAP", oi: "1200.5" }]
        }), { status: 200 });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("connects, subscribes, and reconnects on websocket lifecycle events", () => {
    vi.useFakeTimers();
    const client = new OkxMarketClient({
      source: "okx",
      coin: "BTC",
      marketSymbol: "BTC-USDT-SWAP",
      candleInterval: "1m",
      onTick,
      onSnapshot
    });

    client.connect();

    const socket = FakeWebSocket.instances[0];
    expect(socket.url).toBe("wss://ws.okx.com:8443/ws/v5/public");

    socket.emit("open");
    expect(socket.sent).toHaveLength(1);
    expect(socket.sent[0]).toContain("\"books\"");
    expect(socket.sent[0]).toContain("\"tickers\"");
    expect(socket.sent[0]).toContain("\"index-tickers\"");
    expect(socket.sent[0]).toContain("\"candle1m\"");
    socket.emit("message", { data: JSON.stringify({ arg: { channel: "status" }, data: [{}] }) });

    socket.emit("error");
    socket.emit("error");
    expect(onSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({
      connected: false,
      source: "okx"
    }));

    vi.advanceTimersByTime(3000);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("maps alternate candle intervals and falls back for unknown ones", () => {
    const fiveMinuteClient = new OkxMarketClient({
      source: "okx",
      coin: "BTC",
      marketSymbol: "BTC-USDT-SWAP",
      candleInterval: "5m",
      onTick,
      onSnapshot
    });
    fiveMinuteClient.connect();
    FakeWebSocket.instances[0]?.emit("open");
    expect(FakeWebSocket.instances[0]?.sent[0]).toContain("\"candle5m\"");

    const hourlyClient = new OkxMarketClient({
      source: "okx",
      coin: "BTC",
      marketSymbol: "BTC-USDT-SWAP",
      candleInterval: "1h",
      onTick,
      onSnapshot
    });
    hourlyClient.connect();
    FakeWebSocket.instances[1]?.emit("open");
    expect(FakeWebSocket.instances[1]?.sent[0]).toContain("\"candle1H\"");

    const fallbackClient = new OkxMarketClient({
      source: "okx",
      coin: "BTC",
      marketSymbol: "BTC-USDT-SWAP",
      candleInterval: "2d",
      onTick,
      onSnapshot
    });
    fallbackClient.connect();
    FakeWebSocket.instances[2]?.emit("open");
    expect(FakeWebSocket.instances[2]?.sent[0]).toContain("\"candle1m\"");
  });

  it("builds ticks from book updates and keeps best levels sorted", async () => {
    const client = new OkxMarketClient({
      source: "okx",
      coin: "BTC",
      marketSymbol: "BTC-USDT-SWAP",
      candleInterval: "1m",
      onTick,
      onSnapshot
    });

    await (client as never).handleMessage(JSON.stringify({
      action: "snapshot",
      arg: { channel: "books", instId: "BTC-USDT-SWAP" },
      data: [{
        bids: [["70000", "1", "0", "1"], ["70010", "2", "0", "2"], ["69990", "3", "0", "2"]],
        asks: [["70030", "1.5", "0", "1"], ["70020", "1", "0", "1"], ["70040", "0.8", "0", "1"]],
        ts: "1000"
      }]
    }));
    await (client as never).handleMessage(JSON.stringify({
      action: "update",
      arg: { channel: "books", instId: "BTC-USDT-SWAP" },
      data: [{
        bids: [["70010", "4", "0", "3"], ["69990", "0", "0", "0"]],
        asks: [["70025", "2", "0", "1"]],
        ts: "1100"
      }]
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
    expect(client.getSnapshot().book.bids[0]?.size).toBe(4);
    expect(client.getSnapshot().book.asks[0]?.price).toBe(70020);
    expect(client.getSnapshot().book.asks).toHaveLength(4);
    expect(client.getSnapshot().assetCtx).toEqual(expect.objectContaining({
      midPrice: 70015
    }));
  });

  it("deduplicates trades, parses candles, and updates market metrics", async () => {
    const client = new OkxMarketClient({
      source: "okx",
      coin: "BTC",
      marketSymbol: "BTC-USDT-SWAP",
      candleInterval: "1m",
      onTick,
      onSnapshot
    });

    await (client as never).handleMessage(JSON.stringify({
      arg: { channel: "trades", instId: "BTC-USDT-SWAP" },
      data: [
        { instId: "BTC-USDT-SWAP", side: "sell", px: "70001", sz: "0.1", ts: "2000", tradeId: "1" },
        { instId: "BTC-USDT-SWAP", side: "buy", px: "70002", sz: "0.2", ts: "3000", tradeId: "2" }
      ]
    }));
    await (client as never).handleMessage(JSON.stringify({
      arg: { channel: "trades", instId: "BTC-USDT-SWAP" },
      data: [
        { instId: "BTC-USDT-SWAP", side: "buy", px: "70002", sz: "0.2", ts: "3000", tradeId: "2" }
      ]
    }));
    await (client as never).handleMessage(JSON.stringify({
      arg: { channel: "candle1m", instId: "BTC-USDT-SWAP" },
      data: [["1000", "1", "3", "0.5", "2", "10", "0", "0", "4"]]
    }));
    await (client as never).handleMessage(JSON.stringify({
      arg: { channel: "candle1m", instId: "BTC-USDT-SWAP" },
      data: [["1000", "1", "3", "0.5", "2", "10", "0", "0", "4"]]
    }));
    await (client as never).handleMessage(JSON.stringify({
      arg: { channel: "tickers", instId: "BTC-USDT-SWAP" },
      data: [{
        instId: "BTC-USDT-SWAP",
        last: "70003",
        bidPx: "70001",
        askPx: "70005",
        open24h: "68000",
        high24h: "71000",
        low24h: "67000",
        volCcy24h: "987654.32",
        ts: "3500"
      }]
    }));
    await (client as never).handleMessage(JSON.stringify({
      arg: { channel: "mark-price", instId: "BTC-USDT-SWAP" },
      data: [{ instId: "BTC-USDT-SWAP", markPx: "70005", ts: "4000" }]
    }));
    await (client as never).handleMessage(JSON.stringify({
      arg: { channel: "index-tickers", instId: "BTC-USDT" },
      data: [{ instId: "BTC-USDT", idxPx: "70004", ts: "4500" }]
    }));
    await (client as never).refreshSupplementalData();

    expect(client.getSnapshot().trades).toEqual([
      { id: "okx-BTC-USDT-SWAP-2", coin: "BTC", side: "buy", price: 70002, size: 0.2, time: 3000 },
      { id: "okx-BTC-USDT-SWAP-1", coin: "BTC", side: "sell", price: 70001, size: 0.1, time: 2000 }
    ]);
    expect(client.getSnapshot().candles).toEqual([{
      id: "okx-BTC-USDT-SWAP-1m-1000",
      coin: "BTC",
      interval: "1m",
      openTime: 1000,
      closeTime: 61000,
      open: 1,
      high: 3,
      low: 0.5,
      close: 2,
      volume: 10,
      tradeCount: 4
    }]);
    expect(client.getSnapshot()).toEqual(expect.objectContaining({
      markPrice: 70005,
      assetCtx: expect.objectContaining({
        markPrice: 70005,
        oraclePrice: 70004,
        prevDayPrice: 68000,
        dayNotionalVolume: 987654.32,
        fundingRate: 0.0001,
        openInterest: 1200.5
      })
    }));
  });

  it("ignores malformed payloads and closes cleanly", async () => {
    vi.useFakeTimers();
    const client = new OkxMarketClient({
      source: "okx",
      coin: "BTC",
      marketSymbol: "BTC-USDT-SWAP",
      candleInterval: "15m",
      onTick,
      onSnapshot
    });

    client.connect();
    const socket = FakeWebSocket.instances[0];
    socket.emit("open");
    expect(socket.sent[0]).toContain("\"candle15m\"");

    await (client as never).handleMessage(JSON.stringify({ event: "subscribe" }));
    await (client as never).handleMessage(JSON.stringify({
      arg: { channel: "status", instId: "BTC-USDT-SWAP" },
      data: [{}]
    }));
    await (client as never).handleMessage(JSON.stringify({
      action: "snapshot",
      arg: { channel: "books", instId: "BTC-USDT-SWAP" },
      data: [{ bids: [], asks: [], ts: "1000" }]
    }));
    await (client as never).handleMessage(JSON.stringify({
      arg: { channel: "trades", instId: "BTC-USDT-SWAP" },
      data: [{ instId: "ETH-USDT-SWAP", side: "buy", px: "1", sz: "1", ts: "1", tradeId: "1" }]
    }));
    await (client as never).handleMessage(JSON.stringify({
      arg: { channel: "tickers", instId: "ETH-USDT-SWAP" },
      data: [{ instId: "ETH-USDT-SWAP", last: "1", open24h: "1", ts: "5000" }]
    }));
    await (client as never).handleMessage(JSON.stringify({
      arg: { channel: "mark-price", instId: "ETH-USDT-SWAP" },
      data: [{ instId: "ETH-USDT-SWAP", markPx: "123", ts: "5000" }]
    }));
    await (client as never).handleMessage(JSON.stringify({
      arg: { channel: "mark-price", instId: "BTC-USDT-SWAP" },
      data: []
    }));
    await (client as never).handleMessage(JSON.stringify({
      arg: { channel: "index-tickers", instId: "ETH-USDT" },
      data: [{ instId: "ETH-USDT", idxPx: "123", ts: "6000" }]
    }));
    await (client as never).handleBooks([]);
    await (client as never).handleBooks([], "update");
    await (client as never).handleTickers([]);
    await (client as never).handleTrades([]);
    await (client as never).handleCandles([]);
    await (client as never).handleMarkPrice([]);
    await (client as never).handleIndexTickers([]);

    expect(onTick).not.toHaveBeenCalled();
    expect(client.getSnapshot().assetCtx).toEqual(expect.objectContaining({
      markPrice: 123
    }));
    expect((client as never).resolveIntervalMs("0m")).toBe(60_000);
    expect((client as never).resolveIntervalMs("bad")).toBe(60_000);
    expect((client as never).resolveIntervalMs("2h")).toBe(7_200_000);

    socket.emit("error");
    client.close();
    expect(onSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({
      connected: false
    }));
  });
});
