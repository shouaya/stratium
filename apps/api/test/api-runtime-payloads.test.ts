import { describe, expect, it, vi } from "vitest";
import type { AnyEventEnvelope } from "@stratium/shared";
import {
  createApiAdminStatePayload,
  createApiReplayPayload,
  createApiStatePayload,
  createSocketPayloadFactory,
  filterBroadcastEvents
} from "../src/runtime/api-runtime-payloads";

const marketData = {
  source: "hyperliquid" as const,
  coin: "BTC",
  connected: true,
  book: { bids: [], asks: [] },
  trades: [],
  candles: []
};

const platformSettings = {
  platformName: "Desk",
  platformAnnouncement: "",
  activeExchange: "hyperliquid",
  activeSymbol: "BTC-USD",
  maintenanceMode: false,
  allowFrontendTrading: true,
  allowManualTicks: true
};

const symbolConfigState = {
  source: "hyperliquid",
  marketSymbol: "BTC",
  symbol: "BTC-USD",
  coin: "BTC",
  leverage: 10,
  maxLeverage: 20,
  szDecimals: 5,
  quoteAsset: "USDC"
};

const events: AnyEventEnvelope[] = [{
  eventId: "evt-1",
  eventType: "OrderAccepted",
  occurredAt: "2026-01-01T00:00:00.000Z",
  sequence: 1,
  simulationSessionId: "session-1",
  accountId: "paper-1",
  symbol: "BTC-USD",
  source: "system",
  payload: {}
}, {
  eventId: "evt-2",
  eventType: "OrderAccepted",
  occurredAt: "2026-01-01T00:00:01.000Z",
  sequence: 2,
  simulationSessionId: "session-2",
  accountId: "paper-2",
  symbol: "BTC-USD",
  source: "system",
  payload: {}
}];

const createContext = () => ({
  tradingRuntime: {
    getAccountIds: vi.fn(() => ["paper-1", "paper-2"]),
    getEngineState: vi.fn((accountId?: string) => ({
      simulationSessionId: `session-${accountId ?? "admin"}`,
      account: { accountId },
      orders: [],
      position: null,
      latestTick: accountId ? { symbol: "BTC-USD", last: 70000 } : null
    })),
    getPrimaryAccountId: vi.fn(() => "paper-1"),
    getRecentEventStore: vi.fn(() => [events[0]]),
    getReplayData: vi.fn(async () => ({
      state: {
        simulationSessionId: "session-replay",
        account: { accountId: "paper-1" },
        orders: [],
        position: null
      },
      events: [events[0]]
    }))
  },
  marketRuntime: {
    getMarketData: vi.fn(() => marketData)
  },
  symbolConfigState,
  platformSettings,
  batch: {
    runningJobs: [{ executionId: "exec-1" }],
    lastExecution: { executionId: "exec-last" }
  },
  socketEventBootstrapLimit: 500
});

describe("api-runtime-payloads", () => {
  it("filters broadcast events only when an account id is provided", () => {
    expect(filterBroadcastEvents(undefined, events)).toEqual(events);
    expect(filterBroadcastEvents("paper-1", events)).toEqual([events[0]]);
    expect(filterBroadcastEvents("paper-missing")).toEqual([]);
  });

  it("creates state, admin, and replay payloads from the runtime context", async () => {
    const context = createContext();

    expect(createApiStatePayload("paper-1", context as never)).toMatchObject({
      sessionId: "session-paper-1",
      events: [events[0]],
      market: marketData,
      symbolConfig: symbolConfigState
    });

    expect(createApiAdminStatePayload(context as never)).toMatchObject({
      latestTick: { symbol: "BTC-USD", last: 70000 },
      accountIds: ["paper-1", "paper-2"],
      runningBatchJobs: [{ executionId: "exec-1" }],
      lastBatchJobExecution: { executionId: "exec-last" }
    });

    context.tradingRuntime.getPrimaryAccountId.mockReturnValueOnce(null);
    expect(createApiAdminStatePayload(context as never).latestTick).toBeNull();

    await expect(createApiReplayPayload("paper-1", "session-replay", context as never)).resolves.toMatchObject({
      sessionId: "session-replay",
      market: marketData,
      events: [events[0]]
    });
  });

  it("creates admin socket bootstrap payloads with and without a primary account", () => {
    const context = createContext();
    const payloadFactory = createSocketPayloadFactory({
      token: "admin-token",
      user: {
        id: "admin-1",
        username: "admin",
        role: "admin",
        displayName: "Admin",
        tradingAccountId: null,
        isActive: true
      }
    }, context as never);

    expect(payloadFactory()).toMatchObject({
      type: "bootstrap",
      state: {
        simulationSessionId: "session-paper-1"
      }
    });

    context.tradingRuntime.getPrimaryAccountId.mockReturnValueOnce(null);
    expect(payloadFactory()).toMatchObject({
      type: "bootstrap",
      state: {
        simulationSessionId: "session-admin",
        account: null
      }
    });
  });

  it("creates frontend socket bootstrap and event payloads and guards missing accounts", () => {
    const context = createContext();
    const frontendSession = {
      token: "frontend-token",
      user: {
        id: "frontend-1",
        username: "demo",
        role: "frontend" as const,
        displayName: "Demo",
        tradingAccountId: "paper-1",
        isActive: true
      }
    };
    const payloadFactory = createSocketPayloadFactory(frontendSession, context as never);

    expect(payloadFactory()).toMatchObject({
      type: "bootstrap",
      events: [events[0]]
    });

    expect(payloadFactory(events)).toMatchObject({
      type: "events",
      events: [events[0]],
      symbolConfig: symbolConfigState
    });

    const missingAccountFactory = createSocketPayloadFactory({
      ...frontendSession,
      user: {
        ...frontendSession.user,
        tradingAccountId: null
      }
    }, context as never);

    expect(() => missingAccountFactory()).toThrow("Frontend user is missing a trading account.");
  });
});
