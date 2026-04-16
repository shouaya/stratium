import type { PlatformSettingsView } from "../auth/auth.js";
import { AuthRuntime } from "../auth/auth.js";
import { BatchJobStateFeed } from "../batch/batch-job-state.js";
import { MarketRuntime, type SymbolConfigState } from "../market/market-runtime.js";
import { TradingRepository } from "../persistence/repository.js";
import { loadApiBootstrapState } from "./bootstrap.js";
import { TradingRuntime } from "./trading-runtime.js";

const resolveConfiguredSymbol = (platformSettings: PlatformSettingsView, configuredTradingSymbol: string): string =>
  platformSettings.activeSymbol?.trim() || configuredTradingSymbol;

const resolveConfiguredCoin = (symbol: string, fallbackCoin: string): string =>
  symbol.replace(/-USD$/i, "") || fallbackCoin;

const resolveSymbolConfigState = (input: {
  bootstrapState: Awaited<ReturnType<typeof loadApiBootstrapState>>;
  platformSettings: PlatformSettingsView;
  symbolConfigState: SymbolConfigState;
  configuredSymbol: string;
  configuredCoin: string;
}): SymbolConfigState => {
  const { bootstrapState, platformSettings, symbolConfigState, configuredSymbol, configuredCoin } = input;

  if (bootstrapState.persistedSymbolMeta) {
    return {
      source: bootstrapState.persistedSymbolMeta.source,
      marketSymbol: bootstrapState.persistedSymbolMeta.marketSymbol,
      symbol: bootstrapState.persistedSymbolMeta.symbol,
      coin: bootstrapState.persistedSymbolMeta.coin,
      leverage: bootstrapState.persistedSymbolMeta.leverage,
      maxLeverage: bootstrapState.persistedSymbolMeta.maxLeverage,
      szDecimals: bootstrapState.persistedSymbolMeta.szDecimals,
      quoteAsset: bootstrapState.persistedSymbolMeta.quoteAsset
    };
  }

  if (bootstrapState.persistedSymbolConfig) {
    return {
      ...symbolConfigState,
      leverage: bootstrapState.persistedSymbolConfig.leverage
    };
  }

  return {
    ...symbolConfigState,
    source: platformSettings.activeExchange,
    symbol: configuredSymbol,
    coin: configuredCoin
  };
};

export interface ApiRuntimeBootstrapResult {
  platformSettings: PlatformSettingsView;
  symbolConfigState: SymbolConfigState;
  runningBatchJobs: ReturnType<BatchJobStateFeed["getRunningJobs"]>;
  lastBatchJobExecution: ReturnType<BatchJobStateFeed["getLastExecution"]>;
}

export interface ApiRuntimeBootstrapOptions {
  repository: TradingRepository;
  authRuntime: AuthRuntime;
  tradingRuntime: TradingRuntime;
  marketRuntime: MarketRuntime;
  batchJobStateFeed: BatchJobStateFeed;
  symbolConfigState: SymbolConfigState;
  configuredTradingSymbol: string;
  fallbackCoin: string;
  hyperliquidCandleInterval: string;
}

export const bootstrapApiRuntime = async (
  options: ApiRuntimeBootstrapOptions
): Promise<ApiRuntimeBootstrapResult> => {
  const platformSettings = await options.authRuntime.bootstrap();
  const configuredSymbol = resolveConfiguredSymbol(platformSettings, options.configuredTradingSymbol);
  const configuredCoin = resolveConfiguredCoin(configuredSymbol, options.fallbackCoin);

  await options.batchJobStateFeed.connect();
  const runningBatchJobs = options.batchJobStateFeed.getRunningJobs();
  const lastBatchJobExecution = options.batchJobStateFeed.getLastExecution();
  const bootstrapState = await loadApiBootstrapState(options.repository, {
    configuredTradingSymbol: configuredSymbol,
    configuredExchange: platformSettings.activeExchange,
    fallbackHyperliquidCoin: configuredCoin,
    hyperliquidCandleInterval: options.hyperliquidCandleInterval
  });
  const frontendUsers = await options.authRuntime.listFrontendUsers();

  await options.tradingRuntime.bootstrap({
    frontendAccountIds: frontendUsers
      .map((user) => user.tradingAccountId)
      .filter((accountId): accountId is string => Boolean(accountId)),
    persistedSymbolConfig: bootstrapState.persistedSymbolConfig
  });

  const symbolConfigState = resolveSymbolConfigState({
    bootstrapState,
    platformSettings,
    symbolConfigState: options.symbolConfigState,
    configuredSymbol,
    configuredCoin
  });

  options.marketRuntime.configureActiveMarket({
    exchange: platformSettings.activeExchange,
    symbol: symbolConfigState.symbol,
    coin: symbolConfigState.coin,
    marketSymbol: bootstrapState.persistedSymbolMeta?.marketSymbol ?? symbolConfigState.coin
  });

  const primaryAccountId = options.tradingRuntime.getPrimaryAccountId();
  options.marketRuntime.setBootstrapState(
    primaryAccountId
      ? options.tradingRuntime.getEngineState(primaryAccountId).position.symbol
      : symbolConfigState.symbol,
    primaryAccountId
      ? options.tradingRuntime.getEngineState(primaryAccountId).latestTick?.last
      : undefined,
    bootstrapState.persistedMarketSnapshot
  );

  await options.tradingRuntime.setBootstrapReady(true);
  options.marketRuntime.maybeStartConfiguredSource();

  return {
    platformSettings,
    symbolConfigState,
    runningBatchJobs,
    lastBatchJobExecution
  };
};
