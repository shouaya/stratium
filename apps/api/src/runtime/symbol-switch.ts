import type { BatchJobRunInput, BatchJobRunResult, BatchJobRunner } from "../batch/batch-job-runner.js";
import type { PlatformSettingsView } from "../auth/auth.js";
import type { TradingRuntime } from "./trading-runtime.js";
import type { TradingRepository } from "../persistence/repository.js";

interface SymbolSwitchState {
  source: string;
  coin: string;
  normalizedSymbol: string;
}

interface SymbolSwitchGuardOptions {
  repository: Pick<TradingRepository, "loadSymbolConfigMeta" | "listPendingTriggerOrders">;
  tradingRuntime: Pick<TradingRuntime, "getAccountIds" | "getEngineState">;
  platformSettings: PlatformSettingsView;
}

export const ensureSymbolSwitchAllowed = async (
  options: SymbolSwitchGuardOptions,
  nextExchange: string,
  nextSymbol: string
): Promise<SymbolSwitchState> => {
  const normalizedExchange = nextExchange.trim().toLowerCase();
  const normalizedSymbol = nextSymbol.trim().toUpperCase();

  if (!normalizedExchange) {
    throw new Error("Active exchange is required.");
  }

  if (!normalizedSymbol) {
    throw new Error("Active symbol is required.");
  }

  if (
    normalizedExchange === options.platformSettings.activeExchange
    && normalizedSymbol === options.platformSettings.activeSymbol
  ) {
    throw new Error(`Active symbol is already ${normalizedSymbol} on ${normalizedExchange}.`);
  }

  const symbolMeta = await options.repository.loadSymbolConfigMeta(normalizedSymbol, normalizedExchange);

  if (!symbolMeta) {
    throw new Error(`Symbol config ${normalizedSymbol} was not found in DB.`);
  }

  if (symbolMeta.source !== normalizedExchange) {
    throw new Error(`Symbol ${normalizedSymbol} belongs to ${symbolMeta.source}, not ${normalizedExchange}.`);
  }

  for (const accountId of options.tradingRuntime.getAccountIds()) {
    const state = options.tradingRuntime.getEngineState(accountId);
    const hasOpenPosition = Boolean(
      state.position
      && state.position.side !== "flat"
      && state.position.quantity > 0
    );
    const hasOpenOrders = state.orders.some((order) =>
      order.status === "ACCEPTED" || order.status === "PARTIALLY_FILLED"
    );

    if (hasOpenPosition || hasOpenOrders) {
      throw new Error(`Cannot switch active symbol while account ${accountId} still has open positions or orders.`);
    }
  }

  const pendingTriggerOrders = await options.repository.listPendingTriggerOrders();

  if (pendingTriggerOrders.length > 0) {
    throw new Error("Cannot switch active symbol while pending trigger orders still exist.");
  }

  return {
    source: symbolMeta.source,
    coin: symbolMeta.coin,
    normalizedSymbol
  };
};

interface ActiveSymbolSwitchOptions {
  input: BatchJobRunInput;
  platformSettings: PlatformSettingsView;
  repository: Pick<TradingRepository, "loadSymbolConfigMeta" | "listPendingTriggerOrders">;
  tradingRuntime: Pick<TradingRuntime, "getAccountIds" | "getEngineState">;
  batchJobRunner: Pick<BatchJobRunner, "run">;
  updatePlatformSettings: (input: PlatformSettingsView) => Promise<PlatformSettingsView>;
}

export const runActiveSymbolSwitchBatchJob = async (
  options: ActiveSymbolSwitchOptions
): Promise<BatchJobRunResult> => {
  const nextExchange = options.input.exchange?.trim().toLowerCase() || options.platformSettings.activeExchange;
  const nextSymbol = options.input.symbol?.trim().toUpperCase() ?? "";
  const symbolState = await ensureSymbolSwitchAllowed({
    repository: options.repository,
    tradingRuntime: options.tradingRuntime,
    platformSettings: options.platformSettings
  }, nextExchange, nextSymbol);

  const previousSettings = options.platformSettings;
  await options.updatePlatformSettings({
    ...previousSettings,
    maintenanceMode: true,
    allowFrontendTrading: false,
    allowManualTicks: false
  });

  try {
    return await options.batchJobRunner.run("batch-switch-active-symbol", {
      ...options.input,
      exchange: symbolState.source,
      symbol: symbolState.normalizedSymbol
    });
  } catch (error) {
    await options.updatePlatformSettings(previousSettings);
    throw error;
  }
};
