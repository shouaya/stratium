export interface MarketTick {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  spread: number;
  tickTime: string;
  volatilityTag?: string;
}

export interface TradingSymbolConfig {
  symbol: string;
  leverage: number;
  maintenanceMarginRate: number;
  takerFeeRate: number;
  makerFeeRate: number;
  baseSlippageBps: number;
  partialFillEnabled: boolean;
}
