import { describe, expect, it } from "vitest";
import type { MarketTick } from "@stratium/shared";
import {
  DEFAULT_SYMBOL_CONFIG,
  TradingEngine,
  createInitialTradingState,
  replayEvents,
  replayEventsFromState
} from "../src";

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
    const fillEvent = result.events.find((event) => event.eventType === "OrderFilled");
    expect(fillEvent).toBeDefined();
    expect((fillEvent?.payload as { liquidityRole: string }).liquidityRole).toBe("taker");
    expect((fillEvent?.payload as { feeRate: number }).feeRate).toBe(0.0005);
  });

  it("closes an existing long with a market sell and realizes pnl", () => {
    const engine = new TradingEngine(createInitialTradingState());

    engine.ingestMarketTick(baseTick);
    engine.submitOrder({
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      side: "buy",
      orderType: "market",
      quantity: 1,
      submittedAt: "2026-03-26T00:00:02.000Z"
    });

    engine.ingestMarketTick({
      ...baseTick,
      bid: 103,
      ask: 104,
      last: 103.5,
      tickTime: "2026-03-26T00:00:03.000Z"
    });

    const result = engine.submitOrder({
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      side: "sell",
      orderType: "market",
      quantity: 1,
      submittedAt: "2026-03-26T00:00:04.000Z"
    });

    expect(result.state.position.side).toBe("flat");
    expect(result.state.position.quantity).toBe(0);
    expect(result.state.account.realizedPnl).toBeGreaterThan(0);
    expect(result.state.orders.map((order) => order.status)).toEqual(["FILLED", "FILLED"]);
    expect(result.events.map((event) => event.eventType)).toContain("OrderFilled");
    expect(result.events.map((event) => event.eventType)).toContain("PositionClosed");
  });

  it("adds to an existing long position and updates the weighted average entry price", () => {
    const engine = new TradingEngine(createInitialTradingState());

    engine.ingestMarketTick(baseTick);
    engine.submitOrder({
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      side: "buy",
      orderType: "market",
      quantity: 1,
      submittedAt: "2026-03-26T00:00:01.000Z"
    });

    engine.ingestMarketTick({
      ...baseTick,
      bid: 103,
      ask: 104,
      last: 103.5,
      tickTime: "2026-03-26T00:00:02.000Z"
    });

    const result = engine.submitOrder({
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      side: "buy",
      orderType: "market",
      quantity: 2,
      submittedAt: "2026-03-26T00:00:03.000Z"
    });

    expect(result.state.position.side).toBe("long");
    expect(result.state.position.quantity).toBe(3);
    expect(result.state.position.averageEntryPrice).toBeGreaterThan(101);
    expect(result.state.position.averageEntryPrice).toBeLessThan(104.1);
    expect(result.events.map((event) => event.eventType)).toContain("PositionUpdated");
  });

  it("partially fills an eligible resting limit order and completes it on a later tick when partial fills are enabled", () => {
    const engine = new TradingEngine(createInitialTradingState(), {
      symbolConfig: {
        ...DEFAULT_SYMBOL_CONFIG,
        partialFillEnabled: true
      }
    });

    engine.ingestMarketTick(baseTick);

    const accepted = engine.submitOrder({
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      side: "buy",
      orderType: "limit",
      quantity: 2,
      limitPrice: 99,
      submittedAt: "2026-03-26T00:00:01.000Z"
    });

    expect(accepted.state.orders[0]?.status).toBe("ACCEPTED");

    const partial = engine.ingestMarketTick({
      ...baseTick,
      bid: 98.5,
      ask: 99,
      last: 98.75,
      tickTime: "2026-03-26T00:00:02.000Z"
    });

    expect(partial.state.orders[0]).toMatchObject({
      status: "PARTIALLY_FILLED",
      filledQuantity: 1,
      remainingQuantity: 1
    });
    expect(partial.state.position).toMatchObject({
      side: "long",
      quantity: 1
    });
    expect(partial.events.map((event) => event.eventType)).toContain("OrderPartiallyFilled");

    const completed = engine.ingestMarketTick({
      ...baseTick,
      bid: 98.4,
      ask: 98.9,
      last: 98.65,
      tickTime: "2026-03-26T00:00:03.000Z"
    });

    expect(completed.state.orders[0]).toMatchObject({
      status: "FILLED",
      filledQuantity: 2,
      remainingQuantity: 0
    });
    expect(completed.state.position).toMatchObject({
      side: "long",
      quantity: 2
    });
    expect(completed.events.map((event) => event.eventType)).toContain("OrderFilled");
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
    const fillEvent = filled.events.find((event) => event.eventType === "OrderFilled");
    expect(fillEvent).toBeDefined();
    expect((fillEvent?.payload as { liquidityRole: string }).liquidityRole).toBe("maker");
    expect((fillEvent?.payload as { feeRate: number }).feeRate).toBe(0.00015);
    expect((fillEvent?.payload as { slippage: number }).slippage).toBe(0);
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

  it("continues replay correctly from a persisted snapshot state", () => {
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

    const snapshotState = engine.getState();
    const tailEvents = engine.ingestMarketTick({
      ...baseTick,
      bid: 104,
      ask: 105,
      last: 104.5,
      tickTime: "2026-03-26T00:00:03.000Z"
    }).events;

    const replay = replayEventsFromState(snapshotState, tailEvents);

    expect(replay.state.account).toEqual(engine.getState().account);
    expect(replay.state.position).toEqual(engine.getState().position);
    expect(replay.state.orders).toEqual(engine.getState().orders);
    expect(replay.state.nextSequence).toBe(engine.getState().nextSequence);
  });

  it("liquidates an underwater position and replays the same terminal state", () => {
    const engine = new TradingEngine(createInitialTradingState({ initialBalance: 100 }));
    const history = [];

    history.push(...engine.ingestMarketTick(baseTick).events);
    history.push(...engine.submitOrder({
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      side: "buy",
      orderType: "market",
      quantity: 9,
      submittedAt: "2026-03-26T00:00:02.000Z"
    }).events);
    history.push(...engine.submitOrder({
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      side: "sell",
      orderType: "limit",
      quantity: 1,
      limitPrice: 120,
      submittedAt: "2026-03-26T00:00:03.000Z"
    }).events);

    const liquidation = engine.ingestMarketTick({
      ...baseTick,
      bid: 93.5,
      ask: 94,
      last: 93.75,
      spread: 0.5,
      tickTime: "2026-03-26T00:00:04.000Z"
    });

    history.push(...liquidation.events);

    expect(liquidation.events.map((event) => event.eventType)).toEqual([
      "MarketTickReceived",
      "AccountBalanceUpdated",
      "MarginUpdated",
      "LiquidationTriggered",
      "LiquidationExecuted",
      "PositionClosed",
      "FeeCharged",
      "OrderCanceled",
      "AccountBalanceUpdated",
      "MarginUpdated"
    ]);
    expect(liquidation.state.position.side).toBe("flat");
    expect(liquidation.state.position.quantity).toBe(0);
    expect(liquidation.state.orders.find((order) => order.id === "ord_2")?.status).toBe("CANCELED");
    expect(liquidation.state.account.riskRatio).toBe(0);

    const replay = replayEvents(history, { initialBalance: 100 });

    expect(replay.state.orders).toEqual(engine.getState().orders);
    expect(replay.state.position).toEqual(engine.getState().position);
    expect(replay.state.account).toEqual(engine.getState().account);
  });
});
