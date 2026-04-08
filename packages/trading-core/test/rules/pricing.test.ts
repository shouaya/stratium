import { describe, expect, it } from "vitest";
import type { MarketTick, OrderView } from "@stratium/shared";
import {
  applyExecutionPricing,
  getExecutableReferencePrice,
  getLiquidityRole,
  getMarketReferencePrice
} from "../../src/rules/pricing";

const tick: MarketTick = {
  symbol: "BTC-USD",
  bid: 100,
  ask: 101,
  last: 100.5,
  spread: 1,
  tickTime: "2026-03-26T00:00:00.000Z"
};

const baseOrder: OrderView = {
  id: "ord_1",
  accountId: "paper-account-1",
  symbol: "BTC-USD",
  side: "buy",
  orderType: "limit",
  status: "ACCEPTED",
  quantity: 1,
  limitPrice: 100,
  filledQuantity: 0,
  remainingQuantity: 1,
  createdAt: "2026-03-26T00:00:00.000Z",
  updatedAt: "2026-03-26T00:00:00.000Z"
};

describe("pricing rules", () => {
  it("returns market reference price for buy, sell, and missing tick", () => {
    expect(getMarketReferencePrice(tick, "buy")).toBe(101);
    expect(getMarketReferencePrice(tick, "sell")).toBe(100);
    expect(getMarketReferencePrice(undefined, "buy")).toBe(0);
  });

  it("detects executable prices for market and limit orders", () => {
    expect(getExecutableReferencePrice(undefined, baseOrder)).toBeNull();
    expect(getExecutableReferencePrice(tick, { ...baseOrder, orderType: "market" })).toBe(101);
    expect(getExecutableReferencePrice(tick, { ...baseOrder, limitPrice: 100 })).toBeNull();
    expect(getExecutableReferencePrice(tick, { ...baseOrder, limitPrice: 101 })).toBe(101);
    expect(
      getExecutableReferencePrice(tick, {
        ...baseOrder,
        side: "sell",
        limitPrice: 100,
        orderType: "limit"
      })
    ).toBe(100);
  });

  it("assigns liquidity roles correctly", () => {
    expect(getLiquidityRole({ ...baseOrder, orderType: "market" }, "2026-03-26T00:00:01.000Z")).toBe("taker");
    expect(getLiquidityRole(baseOrder, baseOrder.createdAt)).toBe("taker");
    expect(getLiquidityRole(baseOrder, "2026-03-26T00:00:01.000Z")).toBe("maker");
  });

  it("applies maker and taker pricing deterministically", () => {
    expect(applyExecutionPricing("buy", 100, "maker", 5)).toBe(100);
    expect(applyExecutionPricing("buy", 100, "taker", 5)).toBe(100.05);
    expect(applyExecutionPricing("sell", 100, "taker", 5)).toBe(99.95);
  });
});
