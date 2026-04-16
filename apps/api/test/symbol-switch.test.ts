import { describe, expect, it, vi } from "vitest";
import { ensureSymbolSwitchAllowed, runActiveSymbolSwitchBatchJob } from "../src/runtime/symbol-switch";

const platformSettings = {
  platformName: "Desk",
  platformAnnouncement: "",
  activeExchange: "hyperliquid",
  activeSymbol: "BTC-USD",
  maintenanceMode: false,
  allowFrontendTrading: true,
  allowManualTicks: true
};

const createOptions = () => ({
  repository: {
    loadSymbolConfigMeta: vi.fn(async () => ({
      source: "okx",
      symbol: "ETH-USD",
      coin: "ETH",
      marketSymbol: "ETH-USDT-SWAP",
      leverage: 5,
      maxLeverage: 20,
      szDecimals: 2,
      quoteAsset: "USDT"
    })),
    listPendingTriggerOrders: vi.fn(async () => [])
  },
  tradingRuntime: {
    getAccountIds: vi.fn(() => []),
    getEngineState: vi.fn(() => ({
      position: { side: "flat", quantity: 0 },
      orders: []
    }))
  },
  platformSettings
});

describe("symbol-switch", () => {
  it("rejects invalid exchange or symbol inputs", async () => {
    const options = createOptions();

    await expect(ensureSymbolSwitchAllowed(options as never, "   ", "ETH-USD"))
      .rejects.toThrow("Active exchange is required.");
    await expect(ensureSymbolSwitchAllowed(options as never, "okx", "   "))
      .rejects.toThrow("Active symbol is required.");
    await expect(ensureSymbolSwitchAllowed(options as never, "hyperliquid", "btc-usd"))
      .rejects.toThrow("Active symbol is already BTC-USD on hyperliquid.");
  });

  it("rejects missing symbol metadata or mismatched source metadata", async () => {
    const missingMeta = createOptions();
    missingMeta.repository.loadSymbolConfigMeta.mockResolvedValueOnce(null);

    await expect(ensureSymbolSwitchAllowed(missingMeta as never, "okx", "eth-usd"))
      .rejects.toThrow("Symbol config ETH-USD was not found in DB.");

    const mismatchedSource = createOptions();
    mismatchedSource.repository.loadSymbolConfigMeta.mockResolvedValueOnce({
      source: "hyperliquid",
      symbol: "ETH-USD",
      coin: "ETH",
      marketSymbol: "ETH",
      leverage: 5,
      maxLeverage: 20,
      szDecimals: 2,
      quoteAsset: "USDT"
    });

    await expect(ensureSymbolSwitchAllowed(mismatchedSource as never, "okx", "eth-usd"))
      .rejects.toThrow("Symbol ETH-USD belongs to hyperliquid, not okx.");
  });

  it("rejects open positions, open orders, and pending trigger orders", async () => {
    const openPosition = createOptions();
    openPosition.tradingRuntime.getAccountIds.mockReturnValue(["paper-1"]);
    openPosition.tradingRuntime.getEngineState.mockReturnValue({
      position: { side: "long", quantity: 1 },
      orders: []
    });

    await expect(ensureSymbolSwitchAllowed(openPosition as never, "okx", "eth-usd"))
      .rejects.toThrow("Cannot switch active symbol while account paper-1 still has open positions or orders.");

    const openOrder = createOptions();
    openOrder.tradingRuntime.getAccountIds.mockReturnValue(["paper-1"]);
    openOrder.tradingRuntime.getEngineState.mockReturnValue({
      position: { side: "flat", quantity: 0 },
      orders: [{ status: "PARTIALLY_FILLED" }]
    });

    await expect(ensureSymbolSwitchAllowed(openOrder as never, "okx", "eth-usd"))
      .rejects.toThrow("Cannot switch active symbol while account paper-1 still has open positions or orders.");

    const pendingTriggerOrders = createOptions();
    pendingTriggerOrders.repository.listPendingTriggerOrders.mockResolvedValueOnce([{ oid: 1 }]);

    await expect(ensureSymbolSwitchAllowed(pendingTriggerOrders as never, "okx", "eth-usd"))
      .rejects.toThrow("Cannot switch active symbol while pending trigger orders still exist.");
  });

  it("returns normalized symbol switch metadata when the switch is allowed", async () => {
    const options = createOptions();

    await expect(ensureSymbolSwitchAllowed(options as never, " OKX ", " eth-usd "))
      .resolves.toEqual({
        source: "okx",
        coin: "ETH",
        normalizedSymbol: "ETH-USD"
      });
  });

  it("runs the batch job in maintenance mode and restores settings after failures", async () => {
    const options = createOptions();
    const updatePlatformSettings = vi.fn(async (input: unknown) => input);
    const batchJobRunner = {
      run: vi.fn(async () => ({ executionId: "exec-1" }))
    };
    const okxPlatformSettings = {
      ...platformSettings,
      activeExchange: "okx"
    };

    await expect(runActiveSymbolSwitchBatchJob({
      input: {
        symbol: "eth-usd"
      },
      platformSettings: okxPlatformSettings,
      repository: options.repository as never,
      tradingRuntime: options.tradingRuntime as never,
      batchJobRunner: batchJobRunner as never,
      updatePlatformSettings
    })).resolves.toEqual({ executionId: "exec-1" });

    expect(updatePlatformSettings).toHaveBeenCalledWith(expect.objectContaining({
      maintenanceMode: true,
      allowFrontendTrading: false,
      allowManualTicks: false
    }));
    expect(batchJobRunner.run).toHaveBeenCalledWith("batch-switch-active-symbol", expect.objectContaining({
      exchange: "okx",
      symbol: "ETH-USD"
    }));

    batchJobRunner.run.mockRejectedValueOnce(new Error("runner failed"));

    await expect(runActiveSymbolSwitchBatchJob({
      input: {
        exchange: "okx",
        symbol: "eth-usd"
      },
      platformSettings,
      repository: options.repository as never,
      tradingRuntime: options.tradingRuntime as never,
      batchJobRunner: batchJobRunner as never,
      updatePlatformSettings
    })).rejects.toThrow("runner failed");

    expect(updatePlatformSettings).toHaveBeenLastCalledWith(platformSettings);
  });

  it("rejects batch runs without a target symbol", async () => {
    const options = createOptions();

    await expect(runActiveSymbolSwitchBatchJob({
      input: {},
      platformSettings: {
        ...platformSettings,
        activeExchange: "okx",
        activeSymbol: ""
      },
      repository: options.repository as never,
      tradingRuntime: options.tradingRuntime as never,
      batchJobRunner: {
        run: vi.fn()
      } as never,
      updatePlatformSettings: vi.fn(async (input: unknown) => input as never)
    })).rejects.toThrow("Active symbol is required.");
  });
});
