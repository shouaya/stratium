export const MARKET_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface MarketCandleWindowItem {
  openTime: number;
}

export const filterCandlesToRecent24Hours = <T extends MarketCandleWindowItem>(
  candles: T[],
  now = Date.now()
): T[] => candles.filter((candle) => candle.openTime >= now - MARKET_WINDOW_MS);
