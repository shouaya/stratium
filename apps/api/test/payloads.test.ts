import { describe, expect, it } from "vitest";
import {
  createReplayPayload,
  createSocketBootstrapPayload,
  createSocketEventsPayload,
  createStatePayload
} from "../src/payloads";

const state = {
  simulationSessionId: "session-1",
  account: { accountId: "paper-account-1" },
  orders: [{ id: "ord-1" }],
  position: { symbol: "BTC-USD" },
  latestTick: { symbol: "BTC-USD", last: 70000 }
};

const events = [{ eventId: "evt-1" }];
const simulator = { enabled: false, symbol: "BTC-USD", intervalMs: 1000, driftBps: 0, volatilityBps: 10, anchorPrice: 70000, lastPrice: 70000, tickCount: 0 };
const market = { source: "hyperliquid" as const, coin: "BTC", connected: true, book: { bids: [], asks: [] }, trades: [], candles: [] };
const symbolConfig = { symbol: "BTC-USD", coin: "BTC", leverage: 10, maxLeverage: 20, szDecimals: 5, quoteAsset: "USDC" };

describe("payload factories", () => {
  it("creates the state payload shape", () => {
    expect(createStatePayload({ state, events: events as never, simulator, market, symbolConfig })).toEqual({
      sessionId: "session-1",
      account: { accountId: "paper-account-1" },
      orders: [{ id: "ord-1" }],
      position: { symbol: "BTC-USD" },
      latestTick: { symbol: "BTC-USD", last: 70000 },
      events,
      simulator,
      market,
      symbolConfig
    });
  });

  it("creates replay and websocket payloads", () => {
    expect(createReplayPayload("session-2", state, events as never, simulator, market)).toEqual({
      sessionId: "session-2",
      events,
      state,
      simulator,
      market
    });

    expect(createSocketBootstrapPayload(state, events as never, simulator, market)).toEqual({
      type: "bootstrap",
      state,
      events,
      simulator,
      market
    });

    expect(createSocketEventsPayload(state, events as never, simulator, market, symbolConfig)).toEqual({
      type: "events",
      events,
      state,
      simulator,
      market,
      symbolConfig
    });
  });
});
