import type { AnyEventEnvelope } from "@stratium/shared";
import type { AuthSession, PlatformSettingsView } from "../auth/auth.js";
import type { MarketSnapshot } from "../market/market-data.js";
import type { SocketLike, SymbolConfigState } from "../market/market-runtime.js";
import {
  createReplayPayload,
  createSocketBootstrapPayload,
  createSocketEventsPayload,
  createStatePayload,
  type BatchJobPayload,
  type ReplayPayload,
  type SocketBootstrapPayload,
  type SocketEventsPayload,
  type StatePayload,
  type TradingStateLike
} from "./payloads.js";
import type { MarketRuntime } from "../market/market-runtime.js";
import type { TradingRuntime } from "./trading-runtime.js";

interface RuntimePayloadContext {
  tradingRuntime: Pick<
    TradingRuntime,
    | "getAccountIds"
    | "getEngineState"
    | "getPrimaryAccountId"
    | "getRecentEventStore"
    | "getReplayData"
  >;
  marketRuntime: Pick<MarketRuntime, "getMarketData">;
  symbolConfigState: SymbolConfigState;
  platformSettings: PlatformSettingsView;
  batch: BatchJobPayload;
  socketEventBootstrapLimit: number;
}

const createAdminBootstrapState = (): TradingStateLike => ({
  simulationSessionId: "session-admin",
  account: null,
  orders: [],
  position: null,
  latestTick: null
});

export const filterBroadcastEvents = (
  accountId: string | undefined,
  events: AnyEventEnvelope[] = []
): AnyEventEnvelope[] =>
  accountId ? events.filter((event) => event.accountId === accountId) : events;

export const createApiStatePayload = (
  accountId: string,
  context: RuntimePayloadContext
): StatePayload =>
  createStatePayload({
    state: context.tradingRuntime.getEngineState(accountId),
    events: context.tradingRuntime.getRecentEventStore(accountId, context.socketEventBootstrapLimit),
    market: context.marketRuntime.getMarketData(),
    symbolConfig: context.symbolConfigState,
    platform: context.platformSettings,
    batch: context.batch
  });

export const createApiAdminStatePayload = (
  context: RuntimePayloadContext
): {
  latestTick: unknown;
  platform: PlatformSettingsView;
  accountIds: string[];
  runningBatchJobs: BatchJobPayload["runningJobs"];
  lastBatchJobExecution: BatchJobPayload["lastExecution"];
} => {
  const primaryAccountId = context.tradingRuntime.getPrimaryAccountId();

  return {
    latestTick: primaryAccountId ? context.tradingRuntime.getEngineState(primaryAccountId).latestTick : null,
    platform: context.platformSettings,
    accountIds: context.tradingRuntime.getAccountIds(),
    runningBatchJobs: context.batch.runningJobs,
    lastBatchJobExecution: context.batch.lastExecution
  };
};

export const createApiReplayPayload = async (
  accountId: string,
  sessionId: string,
  context: RuntimePayloadContext
): Promise<ReplayPayload> => {
  const replay = await context.tradingRuntime.getReplayData(accountId, sessionId);

  return createReplayPayload(
    sessionId,
    replay.state,
    replay.events,
    context.marketRuntime.getMarketData(),
    context.platformSettings,
    context.batch
  );
};

export const createSocketPayloadFactory = (
  session: AuthSession,
  context: RuntimePayloadContext
): ((events?: AnyEventEnvelope[]) => SocketBootstrapPayload | SocketEventsPayload) =>
  (events = []) => {
    if (session.user.role === "admin") {
      const primaryAccountId = context.tradingRuntime.getPrimaryAccountId();

      return createSocketBootstrapPayload(
        primaryAccountId
          ? context.tradingRuntime.getEngineState(primaryAccountId)
          : createAdminBootstrapState(),
        [],
        context.marketRuntime.getMarketData(),
        context.platformSettings,
        context.batch
      );
    }

    const accountId = session.user.tradingAccountId;

    if (!accountId) {
      throw new Error("Frontend user is missing a trading account.");
    }

    const state = context.tradingRuntime.getEngineState(accountId);
    const filteredEvents = filterBroadcastEvents(accountId, events);

    return events.length === 0
      ? createSocketBootstrapPayload(
        state,
        context.tradingRuntime.getRecentEventStore(accountId, context.socketEventBootstrapLimit),
        context.marketRuntime.getMarketData(),
        context.platformSettings,
        context.batch
      )
      : createSocketEventsPayload(
        state,
        filteredEvents,
        context.marketRuntime.getMarketData(),
        context.symbolConfigState,
        context.platformSettings,
        context.batch
      );
  };

export type { SocketLike };
