import { describe, expect, it, vi } from "vitest";
import type { AnyEventEnvelope, DomainEventType, MarketTick, OrderSide } from "@stratium/shared";
import { createInitialTradingState, DEFAULT_SYMBOL_CONFIG, type TradingEngineState } from "../../src/domain/state";
import { handleCancelOrder } from "../../src/engine/handle-cancel-order";
import { handleFillOrder } from "../../src/engine/handle-fill-order";
import { handleMarketTick } from "../../src/engine/handle-market-tick";
import { handlePostFill } from "../../src/engine/handle-post-fill";
import { handleRefreshAccount } from "../../src/engine/handle-refresh-account";
import { handleSubmitOrder } from "../../src/engine/handle-submit-order";
import { applyEvent } from "../../src/replay/apply-event";
import { computeNextPosition } from "../../src/rules/position-math";

const baseTick: MarketTick = {
  symbol: "BTC-USD",
  bid: 100,
  ask: 101,
  last: 100.5,
  spread: 1,
  tickTime: "2026-03-26T00:00:00.000Z"
};

const createMutableState = (state: TradingEngineState = createInitialTradingState()) => {
  let currentState = state;

  return {
    getState: () => currentState,
    setState: (nextState: TradingEngineState) => {
      currentState = nextState;
    }
  };
};

const emitAndApply = (
  stateRef: ReturnType<typeof createMutableState>,
  events: AnyEventEnvelope[],
  eventType: DomainEventType,
  source: AnyEventEnvelope["source"],
  symbol: string,
  payload: unknown,
  occurredAt: string
) => {
  const state = stateRef.getState();
  const event: AnyEventEnvelope = {
    eventId: `evt_${state.nextSequence}`,
    eventType,
    occurredAt,
    sequence: state.nextSequence,
    simulationSessionId: state.simulationSessionId,
    accountId: state.account.accountId,
    symbol,
    source,
    payload
  };

  stateRef.setState({
    ...state,
    nextSequence: state.nextSequence + 1
  });
  stateRef.setState(applyEvent(stateRef.getState(), event));
  events.push(event);

  return event;
};

describe("engine handlers", () => {
  it("handles market ticks through the handler context", () => {
    const stateRef = createMutableState();
    const refreshAccountSnapshot = vi.fn();
    const tryFillActiveOrders = vi.fn();

    const result = handleMarketTick({
      context: {
        ...stateRef,
        getSymbolConfig: () => DEFAULT_SYMBOL_CONFIG,
        emitAndApply: (events, eventType, source, symbol, payload, occurredAt) =>
          emitAndApply(stateRef, events, eventType, source, symbol, payload, occurredAt),
        refreshAccountSnapshot,
        tryFillActiveOrders
      },
      tick: baseTick
    });

    expect(result.events[0]?.eventType).toBe("MarketTickReceived");
    expect(refreshAccountSnapshot).toHaveBeenCalledOnce();
    expect(tryFillActiveOrders).toHaveBeenCalledOnce();
    expect(stateRef.getState().latestTick?.last).toBe(baseTick.last);
  });

  it("handles submit order acceptance and advances order ids", () => {
    const startingState = createInitialTradingState();
    const stateRef = createMutableState({
      ...startingState,
      latestTick: baseTick
    });
    const tryFillOrder = vi.fn();

    const result = handleSubmitOrder({
      context: {
        ...stateRef,
        getSymbolConfig: () => DEFAULT_SYMBOL_CONFIG,
        emitAndApply: (events, eventType, source, symbol, payload, occurredAt) =>
          emitAndApply(stateRef, events, eventType, source, symbol, payload, occurredAt),
        now: () => "2026-03-26T00:00:01.000Z",
        tryFillOrder
      },
      input: {
        accountId: "paper-account-1",
        symbol: "BTC-USD",
        side: "buy",
        orderType: "limit",
        quantity: 1,
        limitPrice: 99
      }
    });

    expect(result.events.map((event) => event.eventType)).toEqual(["OrderRequested", "OrderAccepted"]);
    expect(stateRef.getState().nextOrderId).toBe(2);
    expect(tryFillOrder).toHaveBeenCalledWith("ord_1", result.events, "2026-03-26T00:00:01.000Z");
  });

  it("handles cancel missing-order rejection", () => {
    const stateRef = createMutableState();

    const result = handleCancelOrder({
      context: {
        ...stateRef,
        getSymbolConfig: () => DEFAULT_SYMBOL_CONFIG,
        emitAndApply: (events, eventType, source, symbol, payload, occurredAt) =>
          emitAndApply(stateRef, events, eventType, source, symbol, payload, occurredAt),
        createEvent: (eventType, source, symbol, payload, occurredAt) => ({
          eventId: "evt_1",
          eventType,
          occurredAt,
          sequence: 1,
          simulationSessionId: "session-1",
          accountId: "paper-account-1",
          symbol,
          source,
          payload
        }),
        now: () => "2026-03-26T00:00:01.000Z"
      },
      input: {
        accountId: "paper-account-1",
        orderId: "missing"
      }
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.eventType).toBe("OrderRejected");
  });

  it("handles order fills and delegates post-fill processing", () => {
    const stateRef = createMutableState({
      ...createInitialTradingState(),
      latestTick: baseTick,
      orders: [{
        id: "ord_1",
        accountId: "paper-account-1",
        symbol: "BTC-USD",
        side: "buy",
        orderType: "market",
        status: "ACCEPTED",
        quantity: 1,
        filledQuantity: 0,
        remainingQuantity: 1,
        createdAt: "2026-03-26T00:00:00.000Z",
        updatedAt: "2026-03-26T00:00:00.000Z"
      }]
    });
    let nextFillId = 1;
    const applyPostFill = vi.fn();
    const events: AnyEventEnvelope[] = [];

    handleFillOrder({
      context: {
        ...stateRef,
        getSymbolConfig: () => DEFAULT_SYMBOL_CONFIG,
        emitAndApply: (evt, eventType, source, symbol, payload, occurredAt) =>
          emitAndApply(stateRef, evt, eventType, source, symbol, payload, occurredAt),
        incrementNextFillId: () => nextFillId++,
        applyPostFill
      },
      orderId: "ord_1",
      events,
      occurredAt: "2026-03-26T00:00:01.000Z"
    });

    expect(events[0]?.eventType).toBe("OrderFilled");
    expect(applyPostFill).toHaveBeenCalledOnce();
  });

  it("handles post-fill updates and fee/account refresh", () => {
    const stateRef = createMutableState({
      ...createInitialTradingState(),
      latestTick: baseTick
    });
    const refreshAccountSnapshot = vi.fn();
    const computePostFillResult = (
      orderSide: OrderSide,
      fillQuantity: number,
      fillPrice: number,
      fee: number
    ) => ({
      previousState: stateRef.getState(),
      result: computeNextPosition(
        stateRef.getState().position,
        stateRef.getState().account.walletBalance,
        stateRef.getState().latestTick?.last,
        DEFAULT_SYMBOL_CONFIG,
        orderSide,
        fillQuantity,
        fillPrice,
        fee
      )
    });

    const events: AnyEventEnvelope[] = [];

    handlePostFill({
      context: {
        ...stateRef,
        getSymbolConfig: () => DEFAULT_SYMBOL_CONFIG,
        emitAndApply: (evt, eventType, source, symbol, payload, occurredAt) =>
          emitAndApply(stateRef, evt, eventType, source, symbol, payload, occurredAt),
        computePostFillResult,
        applyComputedPostFill: (result) => {
          stateRef.setState({
            ...stateRef.getState(),
            position: result.position,
            account: {
              ...stateRef.getState().account,
              walletBalance: result.walletBalance,
              realizedPnl: result.position.realizedPnl
            }
          });
        },
        buildPositionPayload: (result) => ({
          positionId: "position_1",
          side: result.position.side,
          quantity: result.position.quantity,
          averageEntryPrice: result.position.averageEntryPrice,
          realizedPnl: result.position.realizedPnl,
          unrealizedPnl: result.position.unrealizedPnl,
          markPrice: result.position.markPrice
        }),
        refreshAccountSnapshot,
        getCurrentFillId: () => 2
      },
      orderId: "ord_1",
      orderSide: "buy",
      fillQuantity: 1,
      fillPrice: 101.0505,
      fee: 0.05052525,
      events,
      occurredAt: "2026-03-26T00:00:01.000Z"
    });

    expect(events.map((event) => event.eventType)).toEqual(["PositionOpened", "FeeCharged"]);
    expect(refreshAccountSnapshot).toHaveBeenCalledOnce();
  });

  it("handles account refresh event emission", () => {
    const stateRef = createMutableState({
      ...createInitialTradingState(),
      position: {
        ...createInitialTradingState().position,
        symbol: "BTC-USD"
      }
    });
    const refreshAccountState = vi.fn();
    const events: AnyEventEnvelope[] = [];

    handleRefreshAccount({
      context: {
        ...stateRef,
        getSymbolConfig: () => DEFAULT_SYMBOL_CONFIG,
        emitAndApply: (evt, eventType, source, symbol, payload, occurredAt) =>
          emitAndApply(stateRef, evt, eventType, source, symbol, payload, occurredAt),
        refreshAccountState,
        buildAccountBalancePayload: () => ({
          walletBalance: 1000,
          availableBalance: 990,
          positionMargin: 10,
          orderMargin: 0,
          equity: 1000
        }),
        buildMarginPayload: () => ({
          initialMargin: 10,
          maintenanceMargin: 5,
          riskRatio: 0.005,
          liquidationPrice: 80
        })
      },
      events,
      occurredAt: "2026-03-26T00:00:01.000Z"
    });

    expect(refreshAccountState).toHaveBeenCalledOnce();
    expect(events.map((event) => event.eventType)).toEqual(["AccountBalanceUpdated", "MarginUpdated"]);
  });
});
