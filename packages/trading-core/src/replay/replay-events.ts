import type { AnyEventEnvelope, FillPayload } from "@stratium/shared";
import { createInitialTradingState, type TradingEngineOptions, type TradingEngineState } from "../domain/state.js";
import { applyEvent } from "./apply-event.js";

export interface ReplayResult {
  readonly state: TradingEngineState;
  readonly events: AnyEventEnvelope[];
}

const parseNumericSuffix = (value: string, prefix: string): number => {
  if (!value.startsWith(prefix)) {
    return 0;
  }

  const parsed = Number(value.slice(prefix.length));

  return Number.isFinite(parsed) ? parsed : 0;
};

export const replayEvents = (
  events: AnyEventEnvelope[],
  options: TradingEngineOptions = {}
): ReplayResult => {
  const sortedEvents = [...events].sort((left, right) => left.sequence - right.sequence);
  const initialState = createInitialTradingState({
    ...options,
    sessionId: sortedEvents[0]?.simulationSessionId ?? options.sessionId
  });

  const replayedState = sortedEvents.reduce(applyEvent, initialState);
  const nextOrderId = replayedState.orders.reduce(
    (maxValue, order) => Math.max(maxValue, parseNumericSuffix(order.id, "ord_")),
    0
  ) + 1;
  const nextFillId = sortedEvents.reduce((maxValue, event) => {
    if (event.eventType !== "OrderFilled" && event.eventType !== "OrderPartiallyFilled") {
      return maxValue;
    }

    const payload = event.payload as FillPayload;

    return Math.max(maxValue, parseNumericSuffix(payload.fillId, "fill_"));
  }, 0) + 1;
  const latestTick = replayedState.latestTick
    ? {
      ...replayedState.latestTick,
      symbol: replayedState.position.symbol
    }
    : undefined;
  const state: TradingEngineState = {
    ...replayedState,
    latestTick,
    nextOrderId,
    nextFillId
  };

  return {
    state,
    events: sortedEvents
  };
};
