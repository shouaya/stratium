import type { LiquidityRole, MarketTick, OrderSide, OrderView } from "@stratium/shared";
import { round } from "../domain/state.js";

export const getMarketReferencePrice = (
  latestTick: MarketTick | undefined,
  side: OrderSide
): number => {
  if (!latestTick) {
    return 0;
  }

  return side === "buy" ? latestTick.ask : latestTick.bid;
};

export const getExecutableReferencePrice = (
  latestTick: MarketTick | undefined,
  order: OrderView
): number | null => {
  if (!latestTick) {
    return null;
  }

  if (order.orderType === "market") {
    return getMarketReferencePrice(latestTick, order.side);
  }

  if (order.side === "buy") {
    return latestTick.ask <= (order.limitPrice ?? 0) ? latestTick.ask : null;
  }

  return latestTick.bid >= (order.limitPrice ?? 0) ? latestTick.bid : null;
};

export const getLiquidityRole = (order: OrderView, occurredAt: string): LiquidityRole => {
  if (order.orderType === "market") {
    return "taker";
  }

  return order.createdAt === occurredAt ? "taker" : "maker";
};

export const applyExecutionPricing = (
  side: OrderSide,
  referencePrice: number,
  liquidityRole: LiquidityRole,
  baseSlippageBps: number
): number => {
  if (liquidityRole === "maker") {
    return round(referencePrice);
  }

  const slippage = round(referencePrice * (baseSlippageBps / 10000));

  return side === "buy"
    ? round(referencePrice + slippage)
    : round(referencePrice - slippage);
};
