import type { AnyEventEnvelope } from "@stratium/shared";
import type { TradingCommandHandler, HandleMarketTickArgs } from "./handler-types";

export const handleMarketTick: TradingCommandHandler<HandleMarketTickArgs> = ({
  context,
  tick
}) => {
  const events: AnyEventEnvelope[] = [];
  const occurredAt = tick.tickTime;

  context.emitAndApply(events, "MarketTickReceived", "market", tick.symbol, {
    bid: tick.bid,
    ask: tick.ask,
    last: tick.last,
    spread: tick.spread,
    tickTime: tick.tickTime,
    volatilityTag: tick.volatilityTag
  }, occurredAt);

  context.refreshAccountSnapshot(events, occurredAt);
  context.tryFillActiveOrders(events, occurredAt);

  return {
    state: context.getState(),
    events
  };
};
