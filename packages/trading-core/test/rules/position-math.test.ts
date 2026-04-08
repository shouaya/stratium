import { describe, expect, it } from "vitest";
import type { PositionView } from "@stratium/shared";
import { DEFAULT_SYMBOL_CONFIG } from "../../src/domain/state";
import {
  computeLiquidationPrice,
  computeNextPosition,
  computeRealizedPnl,
  computeUnrealizedPnl,
  toPositionSide,
  toSignedQuantity
} from "../../src/rules/position-math";

const flatPosition: PositionView = {
  symbol: "BTC-USD",
  side: "flat",
  quantity: 0,
  averageEntryPrice: 0,
  markPrice: 0,
  realizedPnl: 0,
  unrealizedPnl: 0,
  initialMargin: 0,
  maintenanceMargin: 0,
  liquidationPrice: 0
};

describe("position math", () => {
  it("converts between signed quantity and position side", () => {
    expect(toSignedQuantity("long", 2)).toBe(2);
    expect(toSignedQuantity("short", 2)).toBe(-2);
    expect(toSignedQuantity("flat", 2)).toBe(0);
    expect(toPositionSide(2)).toBe("long");
    expect(toPositionSide(-2)).toBe("short");
    expect(toPositionSide(0)).toBe("flat");
  });

  it("computes realized and unrealized pnl for long, short, and flat", () => {
    const longPosition = { ...flatPosition, side: "long" as const, quantity: 2, averageEntryPrice: 100 };
    const shortPosition = { ...flatPosition, side: "short" as const, quantity: 2, averageEntryPrice: 100 };

    expect(computeRealizedPnl(longPosition, "sell", 1, 110)).toBe(10);
    expect(computeRealizedPnl(shortPosition, "buy", 1, 90)).toBe(10);
    expect(computeRealizedPnl(longPosition, "buy", 1, 110)).toBe(0);
    expect(computeUnrealizedPnl("long", 2, 100, 110)).toBe(20);
    expect(computeUnrealizedPnl("short", 2, 100, 90)).toBe(20);
    expect(computeUnrealizedPnl("flat", 2, 100, 90)).toBe(0);
  });

  it("computes deterministic liquidation prices", () => {
    expect(computeLiquidationPrice("flat", 0, 100, 1000, DEFAULT_SYMBOL_CONFIG)).toBe(0);
    expect(computeLiquidationPrice("long", 2, 100, 50, DEFAULT_SYMBOL_CONFIG)).toBeCloseTo(78.94736842, 8);
    expect(computeLiquidationPrice("short", 2, 100, 50, DEFAULT_SYMBOL_CONFIG)).toBeCloseTo(119.04761905, 8);
  });

  it("opens, reduces, and flips positions with updated balances", () => {
    const opened = computeNextPosition(flatPosition, 10000, 101, DEFAULT_SYMBOL_CONFIG, "buy", 2, 101.0505, 0.1010505);
    expect(opened.position.side).toBe("long");
    expect(opened.position.quantity).toBe(2);
    expect(opened.position.averageEntryPrice).toBe(101.0505);
    expect(opened.walletBalance).toBe(9999.8989495);

    const reduced = computeNextPosition(opened.position, opened.walletBalance, 110, DEFAULT_SYMBOL_CONFIG, "sell", 1, 110, 0.055);
    expect(reduced.position.side).toBe("long");
    expect(reduced.position.quantity).toBe(1);
    expect(reduced.position.realizedPnl).toBeCloseTo(8.9495, 8);
    expect(reduced.walletBalance).toBeCloseTo(10008.7934495, 8);

    const flipped = computeNextPosition(reduced.position, reduced.walletBalance, 90, DEFAULT_SYMBOL_CONFIG, "sell", 3, 90, 0.135);
    expect(flipped.position.side).toBe("short");
    expect(flipped.position.quantity).toBe(2);
    expect(flipped.position.averageEntryPrice).toBe(90);
    expect(flipped.position.realizedPnl).toBeCloseTo(-2.101, 8);
    expect(flipped.walletBalance).toBeCloseTo(9997.6079495, 8);
  });
});
