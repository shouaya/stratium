import { describe, expect, it } from "vitest";
import {
  createPositionReplayPayload,
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
const market = { source: "hyperliquid" as const, coin: "BTC", connected: true, book: { bids: [], asks: [] }, trades: [], candles: [] };
const symbolConfig = { symbol: "BTC-USD", coin: "BTC", leverage: 10, maxLeverage: 20, szDecimals: 5, quoteAsset: "USDC" };
const platform = {
  platformName: "Stratium Demo",
  platformAnnouncement: "",
  activeExchange: "hyperliquid",
  activeSymbol: "BTC-USD",
  maintenanceMode: false,
  allowFrontendTrading: true,
  allowManualTicks: true
};
const batch = {
  runningJobs: [],
  lastExecution: null
};

describe("payload factories", () => {
  it("creates the state payload shape", () => {
    expect(createStatePayload({ state, events: events as never, market, symbolConfig, platform, batch })).toEqual({
      sessionId: "session-1",
      account: { accountId: "paper-account-1" },
      orders: [{ id: "ord-1" }],
      position: { symbol: "BTC-USD" },
      latestTick: { symbol: "BTC-USD", last: 70000 },
      events,
      market,
      symbolConfig,
      platform,
      batch
    });
  });

  it("creates replay and websocket payloads", () => {
    expect(createReplayPayload("session-2", state, events as never, market, platform, batch)).toEqual({
      sessionId: "session-2",
      events,
      state,
      market,
      platform,
      batch
    });

    expect(createPositionReplayPayload("session-2", "fill-1", events as never, events as never, [], state)).toEqual({
      sessionId: "session-2",
      fillId: "fill-1",
      fills: events,
      events,
      marketEvents: [],
      state
    });

    expect(createSocketBootstrapPayload(state, events as never, market, platform, batch)).toEqual({
      type: "bootstrap",
      state,
      events,
      market,
      platform,
      batch
    });

    expect(createSocketEventsPayload(state, events as never, market, symbolConfig, platform, batch)).toEqual({
      type: "events",
      events,
      state,
      market,
      symbolConfig,
      platform,
      batch
    });
  });
});
