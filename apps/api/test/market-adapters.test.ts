import { describe, expect, it, vi } from "vitest";
import { createMarketDataAdapter } from "../src/market-adapters";
import { HyperliquidMarketClient } from "../src/hyperliquid-market";
import { OkxMarketClient } from "../src/okx-market";

describe("createMarketDataAdapter", () => {
  const baseConfig = {
    coin: "BTC",
    marketSymbol: "BTC",
    candleInterval: "1m",
    onTick: vi.fn(),
    onSnapshot: vi.fn()
  };

  it("creates a Hyperliquid adapter", () => {
    const adapter = createMarketDataAdapter({
      ...baseConfig,
      source: "hyperliquid"
    });

    expect(adapter).toBeInstanceOf(HyperliquidMarketClient);
  });

  it("creates an OKX adapter", () => {
    const adapter = createMarketDataAdapter({
      ...baseConfig,
      source: "okx",
      marketSymbol: "BTC-USDT-SWAP"
    });

    expect(adapter).toBeInstanceOf(OkxMarketClient);
  });

  it("rejects unknown sources", () => {
    expect(() => createMarketDataAdapter({
      ...baseConfig,
      source: "bybit"
    })).toThrow("Unsupported market source bybit.");
  });
});
