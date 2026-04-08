import { describe, expect, it } from "vitest";
import type { MarketTick } from "@stratium/shared";
import { TradingEngine, createInitialTradingState } from "../src";

const tick: MarketTick = {
  symbol: "BTC-USD",
  bid: 100,
  ask: 101,
  last: 100.5,
  spread: 1,
  tickTime: "2026-03-26T00:00:00.000Z"
};

describe("TradingEngine edge cases", () => {
  it("rejects invalid symbol, quantity, price, and insufficient margin", () => {
    const engine = new TradingEngine(createInitialTradingState());
    engine.ingestMarketTick(tick);

    expect(engine.submitOrder({
      accountId: "paper-account-1",
      symbol: "ETH-USD",
      side: "buy",
      orderType: "market",
      quantity: 1
    }).state.orders.at(-1)?.rejectionCode).toBe("INVALID_SYMBOL");

    expect(engine.submitOrder({
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      side: "buy",
      orderType: "market",
      quantity: 0
    }).state.orders.at(-1)?.rejectionCode).toBe("INVALID_QUANTITY");

    expect(engine.submitOrder({
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      side: "buy",
      orderType: "limit",
      quantity: 1,
      limitPrice: 0
    }).state.orders.at(-1)?.rejectionCode).toBe("INVALID_PRICE");

    expect(engine.submitOrder({
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      side: "buy",
      orderType: "market",
      quantity: 10000
    }).state.orders.at(-1)?.rejectionCode).toBe("INSUFFICIENT_MARGIN");
  });

  it("rejects cancel for unknown or already filled orders", () => {
    const engine = new TradingEngine(createInitialTradingState());
    engine.ingestMarketTick(tick);

    const missing = engine.cancelOrder({
      accountId: "paper-account-1",
      orderId: "missing"
    });
    expect(missing.events[0]?.eventType).toBe("OrderRejected");

    engine.submitOrder({
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      side: "buy",
      orderType: "market",
      quantity: 1,
      submittedAt: "2026-03-26T00:00:02.000Z"
    });

    const filledCancel = engine.cancelOrder({
      accountId: "paper-account-1",
      orderId: "ord_1",
      requestedAt: "2026-03-26T00:00:03.000Z"
    });

    expect(filledCancel.events.map((event) => event.eventType)).toEqual([
      "OrderCancelRequested",
      "OrderRejected"
    ]);
  });

  it("opens a short position and later closes it", () => {
    const engine = new TradingEngine(createInitialTradingState());
    engine.ingestMarketTick(tick);

    const shortOpened = engine.submitOrder({
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      side: "sell",
      orderType: "market",
      quantity: 2,
      submittedAt: "2026-03-26T00:00:02.000Z"
    });

    expect(shortOpened.state.position.side).toBe("short");
    expect(shortOpened.events.map((event) => event.eventType)).toContain("PositionOpened");

    const closed = engine.submitOrder({
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      side: "buy",
      orderType: "market",
      quantity: 2,
      submittedAt: "2026-03-26T00:00:03.000Z"
    });

    expect(closed.state.position.side).toBe("flat");
    expect(closed.events.map((event) => event.eventType)).toContain("PositionClosed");
  });

  it("recalculates account state when leverage changes", () => {
    const engine = new TradingEngine(createInitialTradingState());
    engine.ingestMarketTick(tick);
    engine.submitOrder({
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      side: "buy",
      orderType: "market",
      quantity: 2,
      submittedAt: "2026-03-26T00:00:02.000Z"
    });

    const before = engine.getState().account.positionMargin;
    const afterState = engine.setLeverage(20);

    expect(afterState.account.positionMargin).toBeLessThan(before);
    expect(engine.getSymbolConfig().leverage).toBe(20);
  });
});
