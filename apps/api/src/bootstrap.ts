import type { TradingSymbolConfig } from "@stratium/shared";
import type { HyperliquidMarketSnapshot } from "./hyperliquid-market";
import type { SymbolConfigState } from "./market-runtime";
import { TradingRepository } from "./repository";

export interface ApiBootstrapConfig {
  configuredTradingSymbol: string;
  hyperliquidCoin: string;
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
  const persistedMarketSnapshot = await repository.loadRecentMarketSnapshot(
    config.hyperliquidCoin,
    config.hyperliquidCandleInterval
  );

  return {
    persistedSymbolConfig,
    persistedSymbolMeta,
    persistedMarketSnapshot
  };
};
