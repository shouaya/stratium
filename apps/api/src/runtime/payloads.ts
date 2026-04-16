import type { AnyEventEnvelope } from "@stratium/shared";
import type { PlatformSettingsView } from "../auth/auth.js";
import type { BatchJobExecution } from "../batch/batch-job-runner.js";
import type { MarketSnapshot } from "../market/market-data.js";
import type { SymbolConfigState } from "../market/market-runtime.js";

export interface TradingStateLike {
  simulationSessionId: string;
  account: unknown;
  orders: unknown;
  position: unknown;
  latestTick?: unknown;
}

export interface BatchJobPayload {
  runningJobs: BatchJobExecution[];
  lastExecution: BatchJobExecution | null;
}

interface RuntimePayloadInput {
  state: TradingStateLike;
  events: AnyEventEnvelope[];
  market: MarketSnapshot;
  symbolConfig: SymbolConfigState;
  platform: PlatformSettingsView;
  batch: BatchJobPayload;
}

export interface StatePayload {
  sessionId: string;
  account: unknown;
  orders: unknown;
  position: unknown;
  latestTick?: unknown;
  events: AnyEventEnvelope[];
  market: MarketSnapshot;
  symbolConfig: SymbolConfigState;
  platform: PlatformSettingsView;
  batch: BatchJobPayload;
}

export interface ReplayPayload {
  sessionId: string;
  events: AnyEventEnvelope[];
  state: TradingStateLike;
  market: MarketSnapshot;
  platform: PlatformSettingsView;
  batch: BatchJobPayload;
}

export interface PositionReplayPayload {
  sessionId: string;
  fillId: string;
  fills: AnyEventEnvelope[];
  events: AnyEventEnvelope[];
  marketEvents: AnyEventEnvelope[];
  state: TradingStateLike;
}

export interface SocketBootstrapPayload {
  type: "bootstrap";
  state: TradingStateLike;
  events: AnyEventEnvelope[];
  market: MarketSnapshot;
  platform: PlatformSettingsView;
  batch: BatchJobPayload;
}

export interface SocketEventsPayload {
  type: "events";
  events: AnyEventEnvelope[];
  state: TradingStateLike;
  market: MarketSnapshot;
  symbolConfig: SymbolConfigState;
  platform: PlatformSettingsView;
  batch: BatchJobPayload;
}

export const createStatePayload = (input: RuntimePayloadInput): StatePayload => ({
  sessionId: input.state.simulationSessionId,
  account: input.state.account,
  orders: input.state.orders,
  position: input.state.position,
  latestTick: input.state.latestTick,
  events: input.events,
  market: input.market,
  symbolConfig: input.symbolConfig,
  platform: input.platform,
  batch: input.batch
});

export const createReplayPayload = (
  sessionId: string,
  state: TradingStateLike,
  events: AnyEventEnvelope[],
  market: MarketSnapshot,
  platform: PlatformSettingsView,
  batch: BatchJobPayload
): ReplayPayload => ({
  sessionId,
  events,
  state,
  market,
  platform,
  batch
});

export const createPositionReplayPayload = (
  sessionId: string,
  fillId: string,
  fills: AnyEventEnvelope[],
  events: AnyEventEnvelope[],
  marketEvents: AnyEventEnvelope[],
  state: TradingStateLike
): PositionReplayPayload => ({
  sessionId,
  fillId,
  fills,
  events,
  marketEvents,
  state
});

export const createSocketBootstrapPayload = (
  state: TradingStateLike,
  events: AnyEventEnvelope[],
  market: MarketSnapshot,
  platform: PlatformSettingsView,
  batch: BatchJobPayload
): SocketBootstrapPayload => ({
  type: "bootstrap" as const,
  state,
  events,
  market,
  platform,
  batch
});

export const createSocketEventsPayload = (
  state: TradingStateLike,
  events: AnyEventEnvelope[],
  market: MarketSnapshot,
  symbolConfig: SymbolConfigState,
  platform: PlatformSettingsView,
  batch: BatchJobPayload
): SocketEventsPayload => ({
  type: "events" as const,
  events,
  state,
  market,
  symbolConfig,
  platform,
  batch
});
