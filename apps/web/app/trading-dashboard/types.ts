import type { AccountView, AnyEventEnvelope, OrderView, PositionView } from "@stratium/shared";
import type { AppLocale, AuthUser, PlatformSettings } from "../auth-client";

export type TickPayload = {
  bid: number;
  ask: number;
  last: number;
  spread: number;
  tickTime: string;
  volatilityTag?: string;
};

export type MarketLevel = {
  price: number;
  size: number;
  orders: number;
};

export type MarketTapeTrade = {
  id: string;
  coin: string;
  side: "buy" | "sell";
  price: number;
  size: number;
  time: number;
};

export type MarketState = {
  source: "hyperliquid";
  coin: string;
  connected: boolean;
  bestBid?: number;
  bestAsk?: number;
  markPrice?: number;
  candles: Array<{
    id: string;
    coin: string;
    interval: string;
    openTime: number;
    closeTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    tradeCount: number;
  }>;
  assetCtx?: {
    coin: string;
    markPrice?: number;
    midPrice?: number;
    oraclePrice?: number;
    fundingRate?: number;
    openInterest?: number;
    prevDayPrice?: number;
    dayNotionalVolume?: number;
    capturedAt: number;
  };
  book: {
    bids: MarketLevel[];
    asks: MarketLevel[];
    updatedAt?: number;
  };
  trades: MarketTapeTrade[];
};

export type State = {
  account: AccountView | null;
  orders: OrderView[];
  position: PositionView | null;
  latestTick: (TickPayload & { symbol?: string }) | null;
  events: AnyEventEnvelope[];
  market?: MarketState;
  symbolConfig?: {
    symbol: string;
    coin: string;
    leverage: number;
    maxLeverage: number;
    szDecimals: number;
    quoteAsset: string;
  };
  platform?: PlatformSettings;
};

export type FillHistoryResponse = {
  sessionId: string;
  events: AnyEventEnvelope[];
};

export type BotCredentials = {
  accountId: string;
  vaultAddress: string;
  signerAddress: string;
  apiSecret: string;
};

export type FrontendOpenOrder = {
  coin: string;
  side: "B" | "A";
  limitPx: string;
  sz: string;
  oid: number;
  timestamp: number;
  origSz: string;
  cloid?: string;
  grouping?: "normalTpsl" | "positionTpsl";
  triggerCondition?: {
    triggerPx: string;
    isMarket: boolean;
    tpsl: "tp" | "sl";
  };
};

export type HistoricalOrder = {
  kind: "order" | "trigger";
  orderId: string;
  clientOrderId?: string;
  symbol: string;
  side: "buy" | "sell";
  orderType: "market" | "limit";
  quantity: number;
  filledQuantity: number;
  limitPrice?: number;
  averageFillPrice?: number;
  reduceOnly: boolean;
  grouping?: "normalTpsl" | "positionTpsl";
  status: string;
  createdAt: string;
  updatedAt: string;
  triggerCondition?: {
    triggerPx: string;
    isMarket: boolean;
    tpsl: "tp" | "sl";
  };
};

export type TimeframeId = "1m" | "5m" | "15m" | "1h";

export type EnrichedTick = TickPayload & {
  symbol: string;
  syntheticVolume: number;
  aggressorSide: "buy" | "sell";
};

export type TriggerExecutionMode = "market" | "limit";

export type AdvancedOrderForm = {
  takeProfitEnabled: boolean;
  takeProfitQuantity: string;
  takeProfitTriggerPrice: string;
  takeProfitExecution: TriggerExecutionMode;
  takeProfitLimitPrice: string;
  stopLossEnabled: boolean;
  stopLossQuantity: string;
  stopLossTriggerPrice: string;
  stopLossExecution: TriggerExecutionMode;
  stopLossLimitPrice: string;
};

export type OcoOrderForm = {
  side: "buy" | "sell";
  parentOrderType: "market" | "limit";
  quantity: string;
  limitPrice: string;
  takeProfitEnabled: boolean;
  takeProfitTriggerPrice: string;
  takeProfitExecution: TriggerExecutionMode;
  takeProfitLimitPrice: string;
  stopLossEnabled: boolean;
  stopLossTriggerPrice: string;
  stopLossExecution: TriggerExecutionMode;
  stopLossLimitPrice: string;
};

export type ExchangeResponsePayload = {
  response?: {
    data?: {
      statuses?: Array<{
        error?: string;
        filled?: unknown;
        resting?: unknown;
        success?: string;
      }>;
    };
  };
  message?: string;
};

export type PersonalFill = {
  id: string;
  orderId: string;
  side: "buy" | "sell";
  orderType: "market" | "limit";
  symbol: string;
  price: number;
  quantity: number;
  fee: number;
  slippage: number;
  feeRate: number;
  liquidityRole: "maker" | "taker";
  filledAt: string;
  entryPrice: number;
  exitPrice?: number;
  realizedPnl: number;
  closesPosition: boolean;
};

export type DashboardViewProps = {
  apiBaseUrl: string;
  authToken: string;
  viewer: AuthUser;
  locale: AppLocale;
  onLocaleChange: (locale: AppLocale) => void;
  onLogout: () => void;
};
