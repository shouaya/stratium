import { describe, expect, it, vi } from "vitest";
import type { AnyEventEnvelope, OrderView } from "@stratium/shared";
import { HyperliquidPrivateWsHub } from "../src/platform/hyperliquid-private-ws";

describe("HyperliquidPrivateWsHub", () => {
  it("subscribes sockets, sends snapshots, and broadcasts user-scoped updates", () => {
    const orders: OrderView[] = [{
      id: "ord_1",
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      side: "buy",
      orderType: "limit",
      status: "ACCEPTED",
      quantity: 2,
      filledQuantity: 0,
      remainingQuantity: 2,
      limitPrice: 70000,
      clientOrderId: "0xabc",
      createdAt: "2026-04-10T00:00:00.000Z",
      updatedAt: "2026-04-10T00:00:00.000Z"
    }];
    const fillEvents: AnyEventEnvelope[] = [{
      eventId: "evt-fill-1",
      eventType: "OrderFilled",
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      occurredAt: "2026-04-10T00:00:01.000Z",
      payload: {
        orderId: "ord_1",
        fillId: "fill_1",
        fillPrice: 70001,
        fillQuantity: 1,
        fee: 0.5,
        filledAt: "2026-04-10T00:00:01.000Z"
      }
    }];
    const userEvents: AnyEventEnvelope[] = [{
      eventId: "evt-req-1",
      eventType: "OrderRequested",
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      occurredAt: "2026-04-10T00:00:00.000Z",
      payload: {
        orderId: "ord_1"
      }
    }];

    const hub = new HyperliquidPrivateWsHub({
      getOrders: vi.fn(() => orders),
      getFillHistoryEvents: vi.fn(() => fillEvents),
      getEventStore: vi.fn(() => userEvents)
    });
    const socket = {
      send: vi.fn(),
      on: vi.fn()
    };

    hub.addSocket(socket, "paper-account-1");
    hub.handleMessage(socket, JSON.stringify({
      method: "subscribe",
      subscription: {
        type: "orderUpdates",
        user: "0xpaper"
      }
    }));
    hub.handleMessage(socket, JSON.stringify({
      method: "subscribe",
      subscription: {
        type: "userFills",
        user: "0xpaper"
      }
    }));
    hub.handleMessage(socket, JSON.stringify({
      method: "subscribe",
      subscription: {
        type: "userEvents",
        user: "0xpaper"
      }
    }));

    expect(socket.send).toHaveBeenNthCalledWith(1, JSON.stringify({
      channel: "orderUpdates",
      data: [{
        order: {
          coin: "BTC",
          side: "B",
          limitPx: "70000",
          sz: "2",
          oid: 1,
          timestamp: new Date("2026-04-10T00:00:00.000Z").getTime(),
          origSz: "2",
          cloid: "0xabc"
        },
        status: "ACCEPTED",
        statusTimestamp: new Date("2026-04-10T00:00:00.000Z").getTime()
      }]
    }));
    expect(socket.send).toHaveBeenNthCalledWith(2, JSON.stringify({
      channel: "userFills",
      data: [{
        coin: "BTC",
        px: "70001",
        sz: "1",
        side: undefined,
        time: new Date("2026-04-10T00:00:01.000Z").getTime(),
        startPosition: "0",
        dir: "unknown",
        closedPnl: "0",
        hash: "0x0000000000000000000000000000000000000000000000000000000000000000",
        oid: 1,
        crossed: false,
        fee: "0.5",
        tid: 1,
        cloid: undefined
      }]
    }));
    expect(socket.send).toHaveBeenNthCalledWith(3, JSON.stringify({
      channel: "userEvents",
      data: [{
        eventType: "OrderRequested",
        eventId: "evt-req-1",
        symbol: "BTC-USD",
        occurredAt: "2026-04-10T00:00:00.000Z",
        payload: {
          orderId: "ord_1"
        }
      }]
    }));

    hub.broadcast("paper-account-1", fillEvents);

    expect(socket.send).toHaveBeenLastCalledWith(JSON.stringify({
      channel: "userEvents",
      data: [{
        eventType: "OrderFilled",
        eventId: "evt-fill-1",
        symbol: "BTC-USD",
        occurredAt: "2026-04-10T00:00:01.000Z",
        payload: {
          orderId: "ord_1",
          fillId: "fill_1",
          fillPrice: 70001,
          fillQuantity: 1,
          fee: 0.5,
          filledAt: "2026-04-10T00:00:01.000Z"
        }
      }]
    }));
  });

  it("ignores unknown sockets, invalid subscribe payloads, empty broadcasts, and non-matching accounts", () => {
    const hub = new HyperliquidPrivateWsHub({
      getOrders: vi.fn(() => []),
      getFillHistoryEvents: vi.fn(() => []),
      getEventStore: vi.fn(() => [])
    });
    const first = {
      send: vi.fn(),
      on: vi.fn()
    };
    const second = {
      send: vi.fn(),
      on: vi.fn()
    };

    hub.handleMessage(first, JSON.stringify({
      method: "subscribe",
      subscription: { type: "orderUpdates", user: "0xignored" }
    }));
    hub.addSocket(first, "paper-account-1");
    hub.addSocket(second, "paper-account-2");

    hub.handleMessage(first, JSON.stringify({ method: "ping" }));
    hub.handleMessage(first, JSON.stringify({
      method: "subscribe",
      subscription: { user: "0xmissing-type" }
    }));
    hub.broadcast(undefined, []);
    hub.broadcast("paper-account-3", []);
    hub.broadcast("paper-account-2", []);

    expect(first.send).not.toHaveBeenCalled();
    expect(second.send).not.toHaveBeenCalled();
  });

  it("filters inactive orders and suppresses empty incremental channel payloads", () => {
    const hub = new HyperliquidPrivateWsHub({
      getOrders: vi.fn(() => [{
        id: "ord_2",
        accountId: "paper-account-1",
        symbol: "BTC",
        side: "sell",
        orderType: "limit",
        status: "PARTIALLY_FILLED",
        quantity: 1,
        filledQuantity: 1,
        remainingQuantity: 0,
        averageFillPrice: 70100,
        createdAt: "2026-04-10T00:00:00.000Z",
        updatedAt: "2026-04-10T00:00:01.000Z"
      }]),
      getFillHistoryEvents: vi.fn(() => []),
      getEventStore: vi.fn(() => [{
        eventId: "evt-market-1",
        eventType: "MarketTickReceived",
        accountId: "paper-account-1",
        symbol: "BTC-USD",
        occurredAt: "2026-04-10T00:00:00.000Z",
        payload: {}
      }])
    });
    const socket = {
      send: vi.fn(),
      on: vi.fn()
    };

    hub.addSocket(socket, "paper-account-1");
    hub.handleMessage(socket, JSON.stringify({
      method: "subscribe",
      subscription: { type: "orderUpdates", user: "0xpaper" }
    }));
    hub.handleMessage(socket, JSON.stringify({
      method: "subscribe",
      subscription: { type: "userFills", user: "0xpaper" }
    }));
    hub.handleMessage(socket, JSON.stringify({
      method: "subscribe",
      subscription: { type: "userEvents", user: "0xpaper" }
    }));

    expect(socket.send).toHaveBeenNthCalledWith(1, JSON.stringify({
      channel: "orderUpdates",
      data: [{
        order: {
          coin: "BTC",
          side: "A",
          limitPx: "70100",
          sz: "1",
          oid: 2,
          timestamp: new Date("2026-04-10T00:00:00.000Z").getTime(),
          origSz: "1"
        },
        status: "PARTIALLY_FILLED",
        statusTimestamp: new Date("2026-04-10T00:00:01.000Z").getTime()
      }]
    }));
    expect(socket.send).toHaveBeenNthCalledWith(2, JSON.stringify({
      channel: "userFills",
      data: []
    }));
    expect(socket.send).toHaveBeenNthCalledWith(3, JSON.stringify({
      channel: "userEvents",
      data: []
    }));

    hub.broadcast("paper-account-1", [{
      eventId: "evt-market-2",
      eventType: "MarketTickReceived",
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      occurredAt: "2026-04-10T00:00:02.000Z",
      payload: {}
    }]);

    hub.broadcast("paper-account-1", []);

    expect(socket.send).toHaveBeenCalledTimes(3);
  });

  it("replaces duplicate subscriptions instead of duplicating delivery", () => {
    const hub = new HyperliquidPrivateWsHub({
      getOrders: vi.fn(() => []),
      getFillHistoryEvents: vi.fn(() => []),
      getEventStore: vi.fn(() => [])
    });
    const socket = {
      send: vi.fn(),
      on: vi.fn()
    };

    hub.addSocket(socket, "paper-account-1");
    const subscribePayload = JSON.stringify({
      method: "subscribe",
      subscription: { type: "userEvents", user: "0xpaper" }
    });
    hub.handleMessage(socket, subscribePayload);
    hub.handleMessage(socket, subscribePayload);
    hub.broadcast("paper-account-1", [{
      eventId: "evt-req-2",
      eventType: "OrderRequested",
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      occurredAt: "2026-04-10T00:00:03.000Z",
      payload: { orderId: "ord_2" }
    }]);

    expect(socket.send).toHaveBeenCalledTimes(3);
  });

  it("removes sockets on close and sends fill increments for partial fills", () => {
    const partialFillEvent: AnyEventEnvelope = {
      eventId: "evt-fill-2",
      eventType: "OrderPartiallyFilled",
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      occurredAt: "2026-04-10T00:00:02.000Z",
      payload: {
        orderId: "ord_9",
        fillId: "fill_x",
        fillPrice: 69999,
        fillQuantity: 0.25,
        fee: 0.1,
        filledAt: "2026-04-10T00:00:02.000Z",
        side: "sell"
      }
    };
    const hub = new HyperliquidPrivateWsHub({
      getOrders: vi.fn(() => []),
      getFillHistoryEvents: vi.fn(() => []),
      getEventStore: vi.fn(() => [])
    });
    const socket = {
      send: vi.fn(),
      on: vi.fn()
    };

    hub.addSocket(socket, "paper-account-1");
    const closeListener = socket.on.mock.calls[0]?.[1] as (() => void) | undefined;
    hub.handleMessage(socket, JSON.stringify({
      method: "subscribe",
      subscription: { type: "userFills", user: "0xpaper" }
    }));
    expect(socket.send).toHaveBeenCalledTimes(1);

    hub.broadcast("paper-account-1", [partialFillEvent]);
    expect(socket.send).toHaveBeenLastCalledWith(JSON.stringify({
      channel: "userFills",
      data: [{
        coin: "BTC",
        px: "69999",
        sz: "0.25",
        side: "sell",
        time: new Date("2026-04-10T00:00:02.000Z").getTime(),
        startPosition: "0",
        dir: "unknown",
        closedPnl: "0",
        hash: "0x0000000000000000000000000000000000000000000000000000000000000000",
        oid: 9,
        crossed: false,
        fee: "0.1",
        tid: 0,
        cloid: undefined
      }]
    }));

    closeListener?.();
    hub.broadcast("paper-account-1", [partialFillEvent]);
    expect(socket.send).toHaveBeenCalledTimes(2);
  });
});
