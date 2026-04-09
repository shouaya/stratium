import type { AccountView, MarketTick, OrderView, PositionView, TradingSymbolConfig } from "@stratium/shared";

export interface TradingEngineState {
  readonly simulationSessionId: string;
  readonly account: AccountView;
  readonly position: PositionView;
  readonly latestTick?: MarketTick;
  readonly orders: OrderView[];
  readonly nextSequence: number;
  readonly nextOrderId: number;
  readonly nextFillId: number;
}

export interface TradingEngineOptions {
  readonly sessionId?: string;
  readonly symbolConfig?: TradingSymbolConfig;
  readonly initialBalance?: number;
  readonly accountId?: string;
}

export const DEFAULT_SYMBOL_CONFIG: TradingSymbolConfig = {
  symbol: "BTC-USD",
  leverage: 10,
  maintenanceMarginRate: 0.05,
  takerFeeRate: 0.0005,
  makerFeeRate: 0.00015,
  baseSlippageBps: 5,
  partialFillEnabled: false
};

export const round = (value: number): number => Number(value.toFixed(8));

export const createBootstrapAccount = (
  accountId = "paper-account-1",
  initialBalance = 10000
): AccountView => ({
  accountId,
  walletBalance: initialBalance,
  availableBalance: initialBalance,
  positionMargin: 0,
  orderMargin: 0,
  equity: initialBalance,
  realizedPnl: 0,
  unrealizedPnl: 0,
  riskRatio: 0
});

export const createBootstrapPosition = (
  symbol = DEFAULT_SYMBOL_CONFIG.symbol
): PositionView => ({
  symbol,
  side: "flat",
  quantity: 0,
  averageEntryPrice: 0,
  markPrice: 0,
  realizedPnl: 0,
  unrealizedPnl: 0,
  initialMargin: 0,
  maintenanceMargin: 0,
  liquidationPrice: 0
});

export const createInitialTradingState = (
  options: TradingEngineOptions = {}
): TradingEngineState => ({
  simulationSessionId: options.sessionId ?? "session-1",
  account: createBootstrapAccount(options.accountId ?? "paper-account-1", options.initialBalance ?? 10000),
  position: createBootstrapPosition(options.symbolConfig?.symbol ?? DEFAULT_SYMBOL_CONFIG.symbol),
  orders: [],
  nextSequence: 1,
  nextOrderId: 1,
  nextFillId: 1
});
