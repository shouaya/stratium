import type { AnyEventEnvelope, TradingSymbolConfig } from "@stratium/shared";
import type { HyperliquidMarketSnapshot } from "./hyperliquid-market";
import type { SymbolConfigState } from "./market-runtime";
import { TradingRepository } from "./repository";

export interface ApiBootstrapConfig {
  sessionId: string;
  configuredTradingSymbol: string;
  hyperliquidCoin: string;
  hyperliquidCandleInterval: string;
}

export interface ApiBootstrapState {
  persistedEvents: AnyEventEnvelope[];
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
  const persistedEvents = await repository.loadEvents(config.sessionId);
  const persistedMarketSnapshot = await repository.loadRecentMarketSnapshot(
    config.hyperliquidCoin,
    config.hyperliquidCandleInterval
  );

  return {
    persistedEvents,
    persistedSymbolConfig,
    persistedSymbolMeta,
    persistedMarketSnapshot
  };
};
