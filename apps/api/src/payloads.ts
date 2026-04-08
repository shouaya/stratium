import type { AnyEventEnvelope } from "@stratium/shared";
import type { HyperliquidMarketSnapshot } from "./hyperliquid-market";
import type { MarketSimulatorState, SymbolConfigState } from "./market-runtime";

export interface TradingStateLike {
  simulationSessionId: string;
  account: unknown;
  orders: unknown;
  position: unknown;
  latestTick?: unknown;
}

interface RuntimePayloadInput {
  state: TradingStateLike;
  events: AnyEventEnvelope[];
  simulator: MarketSimulatorState;
  market: HyperliquidMarketSnapshot;
  symbolConfig: SymbolConfigState;
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
}

export interface ReplayPayload {
  sessionId: string;
  events: AnyEventEnvelope[];
  state: TradingStateLike;
  simulator: MarketSimulatorState;
  market: HyperliquidMarketSnapshot;
}

export interface SocketBootstrapPayload {
  type: "bootstrap";
  state: TradingStateLike;
  events: AnyEventEnvelope[];
  simulator: MarketSimulatorState;
  market: HyperliquidMarketSnapshot;
}

export interface SocketEventsPayload {
  type: "events";
  events: AnyEventEnvelope[];
  state: TradingStateLike;
  simulator: MarketSimulatorState;
  market: HyperliquidMarketSnapshot;
  symbolConfig: SymbolConfigState;
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
  symbolConfig: input.symbolConfig
});

export const createReplayPayload = (
  sessionId: string,
  state: TradingStateLike,
  events: AnyEventEnvelope[],
  simulator: MarketSimulatorState,
  market: HyperliquidMarketSnapshot
): ReplayPayload => ({
  sessionId,
  events,
  state,
  simulator,
  market
});

export const createSocketBootstrapPayload = (
  state: TradingStateLike,
  events: AnyEventEnvelope[],
  simulator: MarketSimulatorState,
  market: HyperliquidMarketSnapshot
): SocketBootstrapPayload => ({
  type: "bootstrap" as const,
  state,
  events,
  simulator,
  market
});

export const createSocketEventsPayload = (
  state: TradingStateLike,
  events: AnyEventEnvelope[],
  simulator: MarketSimulatorState,
  market: HyperliquidMarketSnapshot,
  symbolConfig: SymbolConfigState
): SocketEventsPayload => ({
  type: "events" as const,
  events,
  state,
  simulator,
  market,
  symbolConfig
});
