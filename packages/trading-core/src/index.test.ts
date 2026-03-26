import { describe, expect, it } from "vitest";
import type { MarketTick } from "@stratium/shared";
import { TradingEngine, createInitialTradingState, replayEvents } from "./index";

const baseTick: MarketTick = {
  symbol: "BTC-USD",
  bid: 100,
  ask: 101,
  last: 100.5,
  spread: 1,
  tickTime: "2026-03-26T00:00:00.000Z"
};

describe("TradingEngine", () => {
  it("rejects market orders when no current tick exists", () => {
    const engine = new TradingEngine(createInitialTradingState());
    const result = engine.submitOrder({
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      side: "buy",
      orderType: "market",
      quantity: 1,
      submittedAt: "2026-03-26T00:00:01.000Z"
    });

    expect(result.state.orders).toHaveLength(1);
    expect(result.state.orders[0]?.status).toBe("REJECTED");
    expect(result.state.orders[0]?.rejectionCode).toBe("MISSING_MARKET_TICK");
  });

  it("fills a market buy from ask and opens a long position", () => {
    const engine = new TradingEngine(createInitialTradingState());

    engine.ingestMarketTick(baseTick);

    const result = engine.submitOrder({
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      side: "buy",
      orderType: "market",
      quantity: 2,
      submittedAt: "2026-03-26T00:00:02.000Z"
    });

    const order = result.state.orders[0];

    expect(order?.status).toBe("FILLED");
    expect(order?.filledQuantity).toBe(2);
    expect(order?.averageFillPrice).toBe(101.0505);
    expect(result.state.position.side).toBe("long");
    expect(result.state.position.quantity).toBe(2);
    expect(result.events.map((event) => event.eventType)).toContain("OrderFilled");
    expect(result.events.map((event) => event.eventType)).toContain("PositionOpened");
  });

  it("keeps a non-marketable limit buy active until a later tick crosses the price", () => {
    const engine = new TradingEngine(createInitialTradingState());

    engine.ingestMarketTick(baseTick);

    const accepted = engine.submitOrder({
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      side: "buy",
      orderType: "limit",
      quantity: 1,
      limitPrice: 99,
      submittedAt: "2026-03-26T00:00:02.000Z"
    });

    expect(accepted.state.orders[0]?.status).toBe("ACCEPTED");

    const filled = engine.ingestMarketTick({
      ...baseTick,
      bid: 98.5,
      ask: 99,
      last: 98.75,
      tickTime: "2026-03-26T00:00:03.000Z"
    });

    expect(filled.state.orders[0]?.status).toBe("FILLED");
    expect(filled.events.map((event) => event.eventType)).toContain("OrderFilled");
  });

  it("cancels an accepted resting order", () => {
    const engine = new TradingEngine(createInitialTradingState());

    engine.ingestMarketTick(baseTick);
    engine.submitOrder({
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      side: "buy",
      orderType: "limit",
      quantity: 1,
      limitPrice: 99,
      submittedAt: "2026-03-26T00:00:02.000Z"
    });

    const result = engine.cancelOrder({
      accountId: "paper-account-1",
      orderId: "ord_1",
      requestedAt: "2026-03-26T00:00:03.000Z"
    });

    expect(result.state.orders[0]?.status).toBe("CANCELED");
    expect(result.events.map((event) => event.eventType)).toEqual([
      "OrderCancelRequested",
      "OrderCanceled"
    ]);
  });

  it("replays the same terminal state from stored events", () => {
    const engine = new TradingEngine(createInitialTradingState());
    const history = [];

    history.push(...engine.ingestMarketTick(baseTick).events);
    history.push(...engine.submitOrder({
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      side: "buy",
      orderType: "market",
      quantity: 1,
      submittedAt: "2026-03-26T00:00:02.000Z"
    }).events);
    history.push(...engine.submitOrder({
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      side: "sell",
      orderType: "limit",
      quantity: 1,
      limitPrice: 102,
      submittedAt: "2026-03-26T00:00:03.000Z"
    }).events);
    history.push(...engine.ingestMarketTick({
      ...baseTick,
      bid: 102,
      ask: 103,
      last: 102.5,
      tickTime: "2026-03-26T00:00:04.000Z"
    }).events);

    const replay = replayEvents(history);

    expect(replay.state.orders).toEqual(engine.getState().orders);
    expect(replay.state.position).toEqual(engine.getState().position);
    expect(replay.state.account).toEqual(engine.getState().account);
    expect(replay.state.nextOrderId).toBe(3);
    expect(replay.state.nextFillId).toBe(3);
    expect(replay.state.latestTick?.symbol).toBe("BTC-USD");
  });
});
