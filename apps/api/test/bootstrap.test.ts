import { describe, expect, it, vi } from "vitest";
import { loadApiBootstrapState } from "../src/bootstrap";

describe("loadApiBootstrapState", () => {
  it("loads trading and market bootstrap data from the repository", async () => {
    const repository = {
      loadSymbolConfig: vi.fn().mockResolvedValue({ symbol: "BTC-USD", leverage: 7 }),
      loadSymbolConfigMeta: vi.fn().mockResolvedValue({ symbol: "BTC-USD", coin: "BTC", leverage: 7 }),
      loadRecentMarketSnapshot: vi.fn().mockResolvedValue({ source: "hyperliquid", coin: "BTC", candles: [] })
    };

    const state = await loadApiBootstrapState(repository as never, {
      configuredTradingSymbol: "BTC-USD",
      fallbackHyperliquidCoin: "BTC",
      hyperliquidCandleInterval: "1m"
    });

    expect(repository.loadSymbolConfig).toHaveBeenCalledWith("BTC-USD");
    expect(repository.loadSymbolConfigMeta).toHaveBeenCalledWith("BTC-USD");
    expect(repository.loadRecentMarketSnapshot).toHaveBeenCalledWith("BTC", "1m");
    expect(state).toEqual({
      persistedSymbolConfig: { symbol: "BTC-USD", leverage: 7 },
      persistedSymbolMeta: { symbol: "BTC-USD", coin: "BTC", leverage: 7 },
      persistedMarketSnapshot: { source: "hyperliquid", coin: "BTC", candles: [] }
    });
  });

  it("returns nullables untouched when repository has no persisted state", async () => {
    const repository = {
      loadSymbolConfig: vi.fn().mockResolvedValue(null),
      loadSymbolConfigMeta: vi.fn().mockResolvedValue(null),
      loadRecentMarketSnapshot: vi.fn().mockResolvedValue(null)
    };

    const state = await loadApiBootstrapState(repository as never, {
      configuredTradingSymbol: "ETH-USD",
      fallbackHyperliquidCoin: "ETH",
      hyperliquidCandleInterval: "5m"
    });

    expect(state).toEqual({
      persistedSymbolConfig: null,
      persistedSymbolMeta: null,
      persistedMarketSnapshot: null
    });
  });
});
