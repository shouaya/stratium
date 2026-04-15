import type { TradingSymbolConfig } from "@stratium/shared";
import type { MarketSnapshot } from "./market-data.js";
import type { SymbolConfigState } from "./market-runtime.js";
import { TradingRepository } from "./repository.js";

export interface ApiBootstrapConfig {
  configuredTradingSymbol: string;
  configuredExchange: string;
  fallbackHyperliquidCoin: string;
  hyperliquidCandleInterval: string;
}

export interface ApiBootstrapState {
  persistedSymbolConfig: TradingSymbolConfig | null;
  persistedSymbolMeta: SymbolConfigState | null;
  persistedMarketSnapshot: MarketSnapshot | null;
}

export const loadApiBootstrapState = async (
  repository: TradingRepository,
  config: ApiBootstrapConfig
): Promise<ApiBootstrapState> => {
  const persistedSymbolConfig = await repository.loadSymbolConfig(config.configuredTradingSymbol, config.configuredExchange);
  const persistedSymbolMeta = await repository.loadSymbolConfigMeta(config.configuredTradingSymbol, config.configuredExchange);
  const resolvedCoin = persistedSymbolMeta?.coin
    ?? config.configuredTradingSymbol.replace(/-USD$/i, "")
    ?? config.fallbackHyperliquidCoin;
  const persistedMarketSnapshot = await repository.loadRecentMarketSnapshot(
    resolvedCoin,
    config.hyperliquidCandleInterval,
    config.configuredExchange
  );

  return {
    persistedSymbolConfig,
    persistedSymbolMeta,
    persistedMarketSnapshot
  };
};
