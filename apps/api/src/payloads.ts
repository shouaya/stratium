import type { AnyEventEnvelope } from "@stratium/shared";
import type { PlatformSettingsView } from "./auth.js";
import type { BatchJobExecution } from "./batch-job-runner.js";
import type { HyperliquidMarketSnapshot } from "./hyperliquid-market.js";
import type { MarketSimulatorState, SymbolConfigState } from "./market-runtime.js";

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
  simulator: MarketSimulatorState;
  market: HyperliquidMarketSnapshot;
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
  simulator: MarketSimulatorState;
  market: HyperliquidMarketSnapshot;
  symbolConfig: SymbolConfigState;
  platform: PlatformSettingsView;
  batch: BatchJobPayload;
}

export interface ReplayPayload {
  sessionId: string;
  events: AnyEventEnvelope[];
  state: TradingStateLike;
  simulator: MarketSimulatorState;
  market: HyperliquidMarketSnapshot;
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
  simulator: MarketSimulatorState;
  market: HyperliquidMarketSnapshot;
  platform: PlatformSettingsView;
  batch: BatchJobPayload;
}

export interface SocketEventsPayload {
  type: "events";
  events: AnyEventEnvelope[];
  state: TradingStateLike;
  simulator: MarketSimulatorState;
  market: HyperliquidMarketSnapshot;
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
  simulator: input.simulator,
  market: input.market,
  symbolConfig: input.symbolConfig,
  platform: input.platform,
  batch: input.batch
});

export const createReplayPayload = (
  sessionId: string,
  state: TradingStateLike,
  events: AnyEventEnvelope[],
  simulator: MarketSimulatorState,
  market: HyperliquidMarketSnapshot,
  platform: PlatformSettingsView,
  batch: BatchJobPayload
): ReplayPayload => ({
  sessionId,
  events,
  state,
  simulator,
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
  simulator: MarketSimulatorState,
  market: HyperliquidMarketSnapshot,
  platform: PlatformSettingsView,
  batch: BatchJobPayload
): SocketBootstrapPayload => ({
  type: "bootstrap" as const,
  state,
  events,
  simulator,
  market,
  platform,
  batch
});

export const createSocketEventsPayload = (
  state: TradingStateLike,
  events: AnyEventEnvelope[],
  simulator: MarketSimulatorState,
  market: HyperliquidMarketSnapshot,
  symbolConfig: SymbolConfigState,
  platform: PlatformSettingsView,
  batch: BatchJobPayload
): SocketEventsPayload => ({
  type: "events" as const,
  events,
  state,
  simulator,
  market,
  symbolConfig,
  platform,
  batch
});
