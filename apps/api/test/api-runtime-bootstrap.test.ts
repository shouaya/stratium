import { describe, expect, it, vi } from "vitest";
import { bootstrapApiRuntime } from "../src/runtime/api-runtime-bootstrap";

const createBaseOptions = () => {
  const authRuntime = {
    bootstrap: vi.fn(async () => ({
      platformName: "Desk",
      platformAnnouncement: "",
      activeExchange: "hyperliquid",
      activeSymbol: "BTC-USD",
      maintenanceMode: false,
      allowFrontendTrading: true,
      allowManualTicks: true
    })),
    listFrontendUsers: vi.fn(async () => [
      { tradingAccountId: "paper-1" },
      { tradingAccountId: null }
    ])
  };
  const tradingRuntime = {
    bootstrap: vi.fn(async () => undefined),
    getPrimaryAccountId: vi.fn(() => "paper-1"),
    getEngineState: vi.fn(() => ({
      position: { symbol: "BTC-USD" },
      latestTick: { last: 70000 }
    })),
    setBootstrapReady: vi.fn(async () => undefined)
  };
  const marketRuntime = {
    configureActiveMarket: vi.fn(),
    setBootstrapState: vi.fn(),
    maybeStartConfiguredSource: vi.fn()
  };
  const batchJobStateFeed = {
    connect: vi.fn(async () => undefined),
    getRunningJobs: vi.fn(() => [{ executionId: "exec-1" }]),
    getLastExecution: vi.fn(() => ({ executionId: "exec-last" }))
  };
  const repository = {
    loadSymbolConfig: vi.fn(async () => null),
    loadSymbolConfigMeta: vi.fn(async () => null),
    loadRecentMarketSnapshot: vi.fn(async () => ({ source: "hyperliquid", coin: "BTC", candles: [] }))
  };

  return {
    repository,
    authRuntime,
    tradingRuntime,
    marketRuntime,
    batchJobStateFeed,
    symbolConfigState: {
      source: "hyperliquid",
      marketSymbol: "BTC",
      symbol: "BTC-USD",
      coin: "BTC",
      leverage: 10,
      maxLeverage: 20,
      szDecimals: 5,
      quoteAsset: "USDC"
    },
    configuredTradingSymbol: "BTC-USD",
    fallbackCoin: "BTC",
    hyperliquidCandleInterval: "1m"
  };
};

describe("bootstrapApiRuntime", () => {
  it("prefers persisted symbol metadata and bootstraps the active market from the primary account", async () => {
    const options = createBaseOptions();
    options.repository.loadSymbolConfigMeta.mockResolvedValueOnce({
      source: "okx",
      marketSymbol: "ETH-USDT-SWAP",
      symbol: "ETH-USD",
      coin: "ETH",
      leverage: 5,
      maxLeverage: 50,
      szDecimals: 2,
      quoteAsset: "USDT"
    });

    const result = await bootstrapApiRuntime(options as never);

    expect(options.batchJobStateFeed.connect).toHaveBeenCalledOnce();
    expect(options.tradingRuntime.bootstrap).toHaveBeenCalledWith({
      frontendAccountIds: ["paper-1"],
      persistedSymbolConfig: null
    });
    expect(options.marketRuntime.configureActiveMarket).toHaveBeenCalledWith({
      exchange: "hyperliquid",
      symbol: "ETH-USD",
      coin: "ETH",
      marketSymbol: "ETH-USDT-SWAP"
    });
    expect(options.marketRuntime.setBootstrapState).toHaveBeenCalledWith(
      "BTC-USD",
      70000,
      { source: "hyperliquid", coin: "BTC", candles: [] }
    );
    expect(options.tradingRuntime.setBootstrapReady).toHaveBeenCalledWith(true);
    expect(options.marketRuntime.maybeStartConfiguredSource).toHaveBeenCalledOnce();
    expect(result.symbolConfigState).toMatchObject({
      source: "okx",
      symbol: "ETH-USD",
      coin: "ETH"
    });
  });

  it("falls back to persisted leverage when only symbol config exists", async () => {
    const options = createBaseOptions();
    options.repository.loadSymbolConfig.mockResolvedValueOnce({
      symbol: "BTC-USD",
      leverage: 7
    });

    const result = await bootstrapApiRuntime(options as never);

    expect(result.symbolConfigState).toMatchObject({
      source: "hyperliquid",
      symbol: "BTC-USD",
      coin: "BTC",
      leverage: 7
    });
    expect(options.marketRuntime.configureActiveMarket).toHaveBeenCalledWith({
      exchange: "hyperliquid",
      symbol: "BTC-USD",
      coin: "BTC",
      marketSymbol: "BTC"
    });
  });

  it("falls back to configured symbol inputs and handles runtimes without a primary account", async () => {
    const options = createBaseOptions();
    options.authRuntime.bootstrap.mockResolvedValueOnce({
      platformName: "Desk",
      platformAnnouncement: "",
      activeExchange: "hyperliquid",
      activeSymbol: "   ",
      maintenanceMode: false,
      allowFrontendTrading: true,
      allowManualTicks: true
    });
    options.tradingRuntime.getPrimaryAccountId.mockReturnValueOnce(null);
    options.configuredTradingSymbol = "";
    options.fallbackCoin = "ETH";

    const result = await bootstrapApiRuntime(options as never);

    expect(options.repository.loadRecentMarketSnapshot).toHaveBeenCalledWith("ETH", "1m", "hyperliquid");
    expect(options.marketRuntime.setBootstrapState).toHaveBeenCalledWith(
      "",
      undefined,
      { source: "hyperliquid", coin: "BTC", candles: [] }
    );
    expect(result.symbolConfigState).toMatchObject({
      source: "hyperliquid",
      symbol: "",
      coin: "ETH"
    });
  });
});
