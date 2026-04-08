import { describe, expect, it } from "vitest";
import { createInitialTradingState } from "../../src/domain/state";
import { applyEvent } from "../../src/replay/apply-event";
import { replayEvents } from "../../src/replay/replay-events";

describe("event application and replay", () => {
  it("advances sequence for passive events", () => {
    const initialState = createInitialTradingState();
    const feeApplied = applyEvent(initialState, {
      eventId: "evt_1",
      eventType: "FeeCharged",
      occurredAt: "2026-03-26T00:00:00.000Z",
      sequence: 1,
      simulationSessionId: "session-1",
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      source: "system",
      payload: {
        ledgerEntryId: "ledger_1",
        orderId: "ord_1",
        fillId: "fill_1",
        amount: 1,
        asset: "USD",
        chargedAt: "2026-03-26T00:00:00.000Z"
      }
    });
    const cancelRequested = applyEvent(feeApplied, {
      eventId: "evt_2",
      eventType: "OrderCancelRequested",
      occurredAt: "2026-03-26T00:00:01.000Z",
      sequence: 2,
      simulationSessionId: "session-1",
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      source: "user",
      payload: {
        orderId: "ord_1",
        requestedAt: "2026-03-26T00:00:01.000Z"
      }
    });

    expect(cancelRequested.nextSequence).toBe(3);
  });

  it("replays empty history and histories without fills safely", () => {
    const emptyReplay = replayEvents([]);
    expect(emptyReplay.state.nextOrderId).toBe(1);
    expect(emptyReplay.state.nextFillId).toBe(1);

    const replayWithoutFill = replayEvents([
      {
        eventId: "evt_1",
        eventType: "OrderRequested",
        occurredAt: "2026-03-26T00:00:00.000Z",
        sequence: 1,
        simulationSessionId: "session-1",
        accountId: "paper-account-1",
        symbol: "BTC-USD",
        source: "user",
        payload: {
          orderId: "manual-order",
          side: "buy",
          orderType: "limit",
          quantity: 1,
          limitPrice: 99,
          submittedAt: "2026-03-26T00:00:00.000Z"
        }
      }
    ]);

    expect(replayWithoutFill.state.orders[0]?.id).toBe("manual-order");
    expect(replayWithoutFill.state.nextOrderId).toBe(1);
    expect(replayWithoutFill.state.nextFillId).toBe(1);
  });
});
