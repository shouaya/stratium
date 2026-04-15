import type { TradingSymbolConfig } from "@stratium/shared";
import type { HyperliquidMarketSnapshot } from "./hyperliquid-market.js";
import type { SymbolConfigState } from "./market-runtime.js";
import { TradingRepository } from "./repository.js";

export interface ApiBootstrapConfig {
  configuredTradingSymbol: string;
  fallbackHyperliquidCoin: string;
  hyperliquidCandleInterval: string;
}

export interface ApiBootstrapState {
  persistedSymbolConfig: TradingSymbolConfig | null;
  persistedSymbolMeta: SymbolConfigState | null;
  persistedMarketSnapshot: HyperliquidMarketSnapshot | null;
}

export const loadApiBootstrapState = async (
  repository: TradingRepository,
  config: ApiBootstrapConfig
): Promise<ApiBootstrapState> => {
  const persistedSymbolConfig = await repository.loadSymbolConfig(config.configuredTradingSymbol);
  const persistedSymbolMeta = await repository.loadSymbolConfigMeta(config.configuredTradingSymbol);
  const resolvedCoin = persistedSymbolMeta?.coin
    ?? config.configuredTradingSymbol.replace(/-USD$/i, "")
    ?? config.fallbackHyperliquidCoin;
  const persistedMarketSnapshot = await repository.loadRecentMarketSnapshot(
    resolvedCoin,
    config.hyperliquidCandleInterval
  );

  return {
    persistedSymbolConfig,
    persistedSymbolMeta,
    persistedMarketSnapshot
  };
};
