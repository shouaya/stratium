import type { MarketDataAdapter, MarketDataAdapterConfig } from "./market-data.js";
import { HyperliquidMarketClient } from "./hyperliquid-market.js";
import { OkxMarketClient } from "./okx-market.js";

export const createMarketDataAdapter = (config: MarketDataAdapterConfig): MarketDataAdapter => {
  if (config.source === "hyperliquid") {
    return new HyperliquidMarketClient({
      coin: config.coin,
      marketSymbol: config.marketSymbol,
      candleInterval: config.candleInterval,
      onTick: config.onTick,
      onSnapshot: config.onSnapshot
    });
  }

  if (config.source === "okx") {
    return new OkxMarketClient(config);
  }

  throw new Error(`Unsupported market source ${config.source}.`);
};
