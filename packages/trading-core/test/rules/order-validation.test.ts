import { describe, expect, it } from "vitest";
import type { CreateOrderInput } from "@stratium/shared";
import { createInitialTradingState, DEFAULT_SYMBOL_CONFIG } from "../../src/domain/state";
import { getIncrementalExposureQuantity, validateOrder } from "../../src/rules/order-validation";

const validMarketOrder: CreateOrderInput = {
  accountId: "paper-account-1",
  symbol: "BTC-USD",
  side: "buy",
  orderType: "market",
  quantity: 1
};

describe("order validation", () => {
  it("computes incremental exposure for same direction and reversal", () => {
    const sameDirection = createInitialTradingState();
    const oppositeDirection = {
      ...createInitialTradingState(),
      position: {
        ...createInitialTradingState().position,
        side: "long" as const,
        quantity: 2
      }
    };

    expect(getIncrementalExposureQuantity(sameDirection, "buy", 3)).toBe(3);
    expect(getIncrementalExposureQuantity(oppositeDirection, "sell", 1)).toBe(0);
    expect(getIncrementalExposureQuantity(oppositeDirection, "sell", 5)).toBe(3);
  });

  it("rejects invalid account, symbol, quantity, price, tick, and margin cases", () => {
    const baseState = createInitialTradingState();
    const withTick = {
      ...baseState,
      latestTick: {
        symbol: "BTC-USD",
        bid: 100,
        ask: 101,
        last: 100.5,
        spread: 1,
        tickTime: "2026-03-26T00:00:00.000Z"
      }
    };

    expect(validateOrder(baseState, DEFAULT_SYMBOL_CONFIG, { ...validMarketOrder, accountId: "other" })?.code).toBe("ACCOUNT_NOT_FOUND");
    expect(validateOrder(baseState, DEFAULT_SYMBOL_CONFIG, { ...validMarketOrder, symbol: "ETH-USD" })?.code).toBe("INVALID_SYMBOL");
    expect(validateOrder(baseState, DEFAULT_SYMBOL_CONFIG, { ...validMarketOrder, quantity: 0 })?.code).toBe("INVALID_QUANTITY");
    expect(
      validateOrder(baseState, DEFAULT_SYMBOL_CONFIG, {
        ...validMarketOrder,
        orderType: "limit",
        limitPrice: 0
      })?.code
    ).toBe("INVALID_PRICE");
    expect(validateOrder(baseState, DEFAULT_SYMBOL_CONFIG, validMarketOrder)?.code).toBe("MISSING_MARKET_TICK");
    expect(
      validateOrder(
        {
          ...withTick,
          account: {
            ...withTick.account,
            availableBalance: 1
          }
        },
        DEFAULT_SYMBOL_CONFIG,
        { ...validMarketOrder, quantity: 10 }
      )?.code
    ).toBe("INSUFFICIENT_MARGIN");
  });

  it("accepts a valid order", () => {
    const state = {
      ...createInitialTradingState(),
      latestTick: {
        symbol: "BTC-USD",
        bid: 100,
        ask: 101,
        last: 100.5,
        spread: 1,
        tickTime: "2026-03-26T00:00:00.000Z"
      }
    };

    expect(validateOrder(state, DEFAULT_SYMBOL_CONFIG, validMarketOrder)).toBeNull();
  });
});
