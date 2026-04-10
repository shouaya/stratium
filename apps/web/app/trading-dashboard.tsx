"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, HTMLAttributes } from "react";
import type { AccountView, AnyEventEnvelope, OrderView, PositionView } from "@stratium/shared";
import type { CandlestickData, HistogramData, UTCTimestamp } from "lightweight-charts";
import type { AppLocale, AuthUser, PlatformSettings } from "./auth-client";
import { authHeaders } from "./auth-client";
import { APP_LOCALES, getUiText, LOCALE_LABELS } from "./i18n";
import { filterCandlesToRecent24Hours } from "./market-window";
import { formatTokyoDateTime, formatTokyoTime } from "./time";
import { CandlestickChart } from "./candlestick-chart";
import { buildApiUrl, buildWebSocketUrl } from "./api-base-url";

type TickPayload = {
  bid: number;
  ask: number;
  last: number;
  spread: number;
  tickTime: string;
  volatilityTag?: string;
};

type State = {
  account: AccountView | null;
  orders: OrderView[];
  position: PositionView | null;
  latestTick: (TickPayload & { symbol?: string }) | null;
  events: AnyEventEnvelope[];
  simulator?: MarketSimulatorState;
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

type FillHistoryResponse = {
  sessionId: string;
  events: AnyEventEnvelope[];
};

type BotCredentials = {
  accountId: string;
  vaultAddress: string;
  signerAddress: string;
  apiSecret: string;
};

type MarketSimulatorState = {
  enabled: boolean;
  symbol: string;
  intervalMs: number;
  driftBps: number;
  volatilityBps: number;
  anchorPrice: number;
  lastPrice: number;
  tickCount: number;
  lastGeneratedAt?: string;
};

type TimeframeId = "1m" | "5m" | "15m" | "1h";
type EnrichedTick = TickPayload & {
  symbol: string;
  syntheticVolume: number;
  aggressorSide: "buy" | "sell";
};

type MarketLevel = {
  price: number;
  size: number;
  orders: number;
};

type MarketTapeTrade = {
  id: string;
  coin: string;
  side: "buy" | "sell";
  price: number;
  size: number;
  time: number;
};

type MarketState = {
  source: "hyperliquid" | "simulator";
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

const TIMEFRAMES: Array<{ id: TimeframeId; label: string; hint: string; bucketMs: number }> = [
  { id: "1m", label: "1m", hint: "1 minute", bucketMs: 60_000 },
  { id: "5m", label: "5m", hint: "5 minutes", bucketMs: 300_000 },
  { id: "15m", label: "15m", hint: "15 minutes", bucketMs: 900_000 },
  { id: "1h", label: "1h", hint: "1 hour", bucketMs: 3_600_000 }
];
const fmt = (n?: number | null, d = 4) => n == null ? "-" : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const clock = (s?: string) => formatTokyoTime(s);
const dateTime = (s?: string) => formatTokyoDateTime(s);
const priceDigitsForSymbol = (symbol?: string | null) => symbol?.startsWith("BTC-") ? 0 : 4;
const coinFromSymbol = (symbol?: string | null) => {
  if (!symbol) {
    return "BTC";
  }

  if (symbol.includes("-")) {
    return symbol.split("-")[0] ?? symbol;
  }

  if (symbol.includes("/")) {
    return symbol.split("/")[0] ?? symbol;
  }

  return symbol;
};

const mergeEvents = (currentEvents: AnyEventEnvelope[], nextEvents: AnyEventEnvelope[] = []) => {
  if (nextEvents.length === 0) {
    return currentEvents;
  }

  const merged = new Map(currentEvents.map((event) => [event.eventId, event]));

  for (const event of nextEvents) {
    merged.set(event.eventId, event);
  }

  return [...merged.values()].sort((left, right) => left.sequence - right.sequence);
};

const extractResponseMessage = (payload: { events?: AnyEventEnvelope[] }, successMessage: string): string => {
  const rejectedEvent = payload.events?.find((event) => event.eventType === "OrderRejected");

  if (rejectedEvent) {
    const rejection = rejectedEvent.payload as { reasonMessage?: string };
    return rejection.reasonMessage ?? "Order rejected.";
  }

  return successMessage;
};

const extractExchangeMessage = (
  payload: {
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
  },
  successMessage: string
): string => {
  const firstStatus = payload.response?.data?.statuses?.[0];

  if (firstStatus?.error) {
    return firstStatus.error;
  }

  return successMessage;
};

const toOid = (orderId: string): number => {
  const numericPart = Number(orderId.replace(/^ord_/, ""));
  return Number.isFinite(numericPart) ? numericPart : 0;
};

const canonicalStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalStringify(entry)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalStringify(entry)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
};

const toHex = (value: string): string =>
  Array.from(new TextEncoder().encode(value)).map((byte) => byte.toString(16).padStart(2, "0")).join("");

const signBotPayload = async (apiSecret: string, payload: Record<string, unknown>): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(apiSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonicalStringify(payload)));
  return `0x${toHex(String.fromCharCode(...new Uint8Array(signature)))}`;
};

export function TradingDashboard({
  apiBaseUrl,
  authToken,
  viewer,
  locale,
  onLocaleChange,
  onLogout
}: {
  apiBaseUrl: string;
  authToken: string;
  viewer: AuthUser;
  locale: AppLocale;
  onLocaleChange: (locale: AppLocale) => void;
  onLogout: () => void;
}) {
  const ui = getUiText(locale);
  const t = ui.trader;
  const [state, setState] = useState<State>({ account: null, orders: [], position: null, latestTick: null, events: [] });
  const [message, setMessage] = useState("");
  const [fillHistoryEvents, setFillHistoryEvents] = useState<AnyEventEnvelope[]>([]);
  const [botCredentials, setBotCredentials] = useState<BotCredentials | null>(null);
  const [tab, setTab] = useState<"market" | "limit">("market");
  const [bookTab, setBookTab] = useState<"book" | "trades">("book");
  const [accountTab, setAccountTab] = useState<"balances" | "positions" | "openOrders" | "fills">("balances");
  const [timeframe, setTimeframe] = useState<TimeframeId>("1m");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const tradingAccountId = viewer.tradingAccountId ?? "";
  const [orderForm, setOrderForm] = useState({
    symbol: "BTC-USD",
    quantity: "1",
    limitPrice: "100"
  });
  const [leverageDraft, setLeverageDraft] = useState(10);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const priceDigits = useMemo(() => priceDigitsForSymbol(orderForm.symbol), [orderForm.symbol]);
  const contractCoin = useMemo(() => state.market?.coin ?? coinFromSymbol(orderForm.symbol), [orderForm.symbol, state.market?.coin]);
  const quantityDecimals = state.symbolConfig?.szDecimals ?? 4;
  const selectedTimeframe = useMemo(
    () => TIMEFRAMES.find((entry) => entry.id === timeframe) ?? TIMEFRAMES[0],
    [timeframe]
  );
  const quantityValue = Number(orderForm.quantity);
  const limitPriceValue = Number(orderForm.limitPrice);
  const availableBalance = state.account?.availableBalance ?? 0;

  const ticks = useMemo<EnrichedTick[]>(() => {
    const marketTicks = state.events
      .filter((event) => event.eventType === "MarketTickReceived")
      .map((event) => ({ symbol: event.symbol, ...(event.payload as TickPayload) }));

    let previousLast: number | undefined;
    let previousVolume = 0.18;
    const acceptedTicks: EnrichedTick[] = [];

    for (const tick of marketTicks) {
      if (previousLast) {
        const divergence = Math.abs(tick.last - previousLast) / previousLast;

        if (divergence > 0.05) {
          continue;
        }
      }

      const priceMoveRatio = previousLast ? Math.abs(tick.last - previousLast) / previousLast : 0;
      const spreadRatio = tick.last > 0 ? tick.spread / tick.last : 0;
      const baseVolume = 0.12 + Math.min(priceMoveRatio * 60, 0.22) + Math.min(spreadRatio * 220, 0.08);
      const smoothedVolume = Number((previousVolume * 0.72 + baseVolume * 0.28).toFixed(4));
      const enrichedTick: EnrichedTick = {
        ...tick,
        syntheticVolume: smoothedVolume,
        aggressorSide: previousLast && tick.last < previousLast ? "sell" : "buy"
      };

      previousLast = tick.last;
      previousVolume = smoothedVolume;

      acceptedTicks.push(enrichedTick);
    }

    return acceptedTicks;
  }, [state.events]);
  const recentMarketCandles = useMemo(() => {
    if (!state.market) {
      return [];
    }

    return filterCandlesToRecent24Hours(state.market.candles);
  }, [state.market]);
  const candles = useMemo(() => {
    if (recentMarketCandles.length > 0) {
      const map = new Map<number, CandlestickData<UTCTimestamp>>();

      for (const candle of recentMarketCandles) {
        const bucket = Math.floor(candle.openTime / selectedTimeframe.bucketMs) * (selectedTimeframe.bucketMs / 1000) as UTCTimestamp;
        const existing = map.get(bucket);

        if (!existing) {
          map.set(bucket, {
            time: bucket,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close
          });
          continue;
        }

        map.set(bucket, {
          time: bucket,
          open: existing.open,
          high: Math.max(existing.high, candle.high),
          low: Math.min(existing.low, candle.low),
          close: candle.close
        });
      }

      return [...map.values()].sort((left, right) => Number(left.time) - Number(right.time));
    }

    const map = new Map<number, CandlestickData<UTCTimestamp>>();
    const bucketMs = selectedTimeframe.bucketMs;
    for (const t of ticks) {
      const bucket = Math.floor(new Date(t.tickTime).getTime() / bucketMs) * (bucketMs / 1000) as UTCTimestamp;
      const cur = map.get(bucket);
      if (!cur) map.set(bucket, { time: bucket, open: t.last, high: t.last, low: t.last, close: t.last });
      else map.set(bucket, { ...cur, high: Math.max(cur.high, t.last), low: Math.min(cur.low, t.last), close: t.last });
    }
    return [...map.values()].sort((a, b) => Number(a.time) - Number(b.time));
  }, [recentMarketCandles, selectedTimeframe.bucketMs, ticks]);
  const volume = useMemo(() => {
    if (recentMarketCandles.length > 0) {
      const map = new Map<number, HistogramData<UTCTimestamp>>();

      for (const candle of recentMarketCandles) {
        const bucket = Math.floor(candle.openTime / selectedTimeframe.bucketMs) * (selectedTimeframe.bucketMs / 1000) as UTCTimestamp;
        const existing = map.get(bucket);
        const value = Number((((existing?.value as number | undefined) ?? 0) + candle.volume).toFixed(4));

        map.set(bucket, {
          time: bucket,
          value,
          color: candle.close >= candle.open ? "#2dd4bf88" : "#f8717188"
        });
      }

      return [...map.values()].sort((left, right) => Number(left.time) - Number(right.time));
    }

    const map = new Map<number, HistogramData<UTCTimestamp>>();
    const bucketMs = selectedTimeframe.bucketMs;
    for (const t of ticks) {
      const bucket = Math.floor(new Date(t.tickTime).getTime() / bucketMs) * (bucketMs / 1000) as UTCTimestamp;
      const cur = map.get(bucket);
      const next = Number((((cur?.value as number | undefined) ?? 0) + t.syntheticVolume).toFixed(4));
      map.set(bucket, { time: bucket, value: next, color: t.aggressorSide === "buy" ? "#2dd4bf88" : "#f8717188" });
    }
    return [...map.values()].sort((a, b) => Number(a.time) - Number(b.time));
  }, [recentMarketCandles, selectedTimeframe.bucketMs, ticks]);
  const stats = useMemo(() => {
    if (state.market?.assetCtx) {
      const reference = state.market.assetCtx.prevDayPrice ?? recentMarketCandles[0]?.open;
      const last = state.market.assetCtx.markPrice ?? state.market.markPrice ?? state.latestTick?.last;
      const change = last && reference ? ((last - reference) / reference) * 100 : undefined;
      const candleHigh = recentMarketCandles.length > 0 ? Math.max(...recentMarketCandles.map((candle) => candle.high)) : undefined;
      const candleLow = recentMarketCandles.length > 0 ? Math.min(...recentMarketCandles.map((candle) => candle.low)) : undefined;

      return {
        last,
        change,
        low: candleLow,
        high: candleHigh
      };
    }

    if (!ticks.length) return { last: undefined, change: undefined, low: undefined, high: undefined };
    const prices = ticks.map((t) => t.last);
    const first = prices[0] ?? 0;
    const last = prices[prices.length - 1];
    return { last, change: first ? ((last - first) / first) * 100 : 0, low: Math.min(...prices), high: Math.max(...prices) };
  }, [recentMarketCandles, state.latestTick?.last, state.market?.assetCtx, state.market?.markPrice, ticks]);
  const syntheticBook = useMemo(() => {
    const mid = state.latestTick?.last ?? 100;
    const step = Math.max((state.latestTick?.spread ?? 1) / 2, 0.001);
    const asks = Array.from({ length: 8 }, (_, i) => ({ price: Number((mid + step * (8 - i)).toFixed(4)), size: Number((0.25 + i * 0.08).toFixed(4)) }));
    const bids = Array.from({ length: 8 }, (_, i) => ({ price: Number((mid - step * (i + 1)).toFixed(4)), size: Number((0.22 + i * 0.09).toFixed(4)) }));
    return { asks, bids };
  }, [state.latestTick]);
  const book = useMemo(() => {
    if (state.market && state.market.book.asks.length > 0 && state.market.book.bids.length > 0) {
      return {
        asks: state.market.book.asks.map((level) => ({ price: level.price, size: level.size })),
        bids: state.market.book.bids.map((level) => ({ price: level.price, size: level.size }))
      };
    }

    return syntheticBook;
  }, [state.market, syntheticBook]);
  const bookWithDepth = useMemo(() => {
    let askRunningTotal = 0;
    const asks = [...book.asks]
      .sort((left, right) => right.price - left.price)
      .map((level) => {
        askRunningTotal += level.size;

        return {
          ...level,
          total: Number(askRunningTotal.toFixed(4))
        };
      });

    let bidRunningTotal = 0;
    const bids = [...book.bids]
      .sort((left, right) => right.price - left.price)
      .map((level) => {
        bidRunningTotal += level.size;

        return {
          ...level,
          total: Number(bidRunningTotal.toFixed(4))
        };
      });

    return {
      asks,
      bids,
      maxAskTotal: Math.max(...asks.map((level) => level.total), 0),
      maxBidTotal: Math.max(...bids.map((level) => level.total), 0)
    };
  }, [book]);
  const trades = useMemo(() => {
    if (state.market && state.market.trades.length > 0) {
      return state.market.trades.map((trade) => ({
        id: trade.id,
        time: new Date(trade.time).toISOString(),
        price: trade.price,
        size: trade.size,
        side: trade.side,
        source: "market" as const
      }));
    }

    const fillTrades = state.events
      .filter((e) => e.eventType === "OrderFilled" || e.eventType === "OrderPartiallyFilled")
      .slice()
      .reverse()
      .map((event) => {
        const payload = event.payload as { fillPrice: number; fillQuantity: number; orderId: string };
        const order = state.orders.find((entry) => entry.id === payload.orderId);

        return {
          id: event.eventId,
          time: event.occurredAt,
          price: payload.fillPrice,
          size: payload.fillQuantity,
          side: order?.side ?? "buy",
          source: "fill" as const
        };
      });
    const tapeTrades = ticks
      .slice(-24)
      .reverse()
      .map((tick, index) => ({
        id: `tick-${tick.tickTime}-${index}`,
        time: tick.tickTime,
        price: tick.last,
        size: Number((tick.syntheticVolume * (0.92 + index * 0.025)).toFixed(4)),
        side: tick.aggressorSide,
        source: "tape" as const
      }));

    return [...fillTrades, ...tapeTrades]
      .sort((left, right) => new Date(right.time).getTime() - new Date(left.time).getTime())
      .slice(0, 24);
  }, [state.events, state.market, state.orders, ticks]);
  const activeOrders = useMemo(
    () => state.orders.filter((order) => order.status === "ACCEPTED" || order.status === "PARTIALLY_FILLED"),
    [state.orders]
  );
  const orderValidation = useMemo(() => {
    if (!orderForm.quantity.trim()) {
      return t.contractsRequired;
    }

    if (!Number.isFinite(quantityValue)) {
      return t.contractsValidNumber;
    }

    if (quantityValue <= 0) {
      return t.contractsGreaterThanZero;
    }

    const quantityText = orderForm.quantity.trim();
    const decimalPart = quantityText.includes(".") ? quantityText.split(".")[1] ?? "" : "";

    if (decimalPart.length > quantityDecimals) {
      return t.contractsPrecision.replace("{decimals}", String(quantityDecimals)).replace("{coin}", contractCoin);
    }

    if (tab === "limit") {
      if (!orderForm.limitPrice.trim()) {
        return t.limitPriceRequired;
      }

      if (!Number.isFinite(limitPriceValue) || limitPriceValue <= 0) {
        return t.limitPriceGreaterThanZero;
      }
    }

    return null;
  }, [contractCoin, limitPriceValue, orderForm.limitPrice, orderForm.quantity, quantityDecimals, quantityValue, tab]);
  const quantityFieldError = useMemo(() => {
    if (!orderForm.quantity.trim()) {
      return t.enterContracts;
    }

    if (!Number.isFinite(quantityValue)) {
      return t.contractsNumeric;
    }

    if (quantityValue <= 0) {
      return t.contractsGreaterThanZero;
    }

    const decimalPart = orderForm.quantity.trim().includes(".") ? orderForm.quantity.trim().split(".")[1] ?? "" : "";

    if (decimalPart.length > quantityDecimals) {
      return t.maxDecimals.replace("{decimals}", String(quantityDecimals));
    }

    return null;
  }, [orderForm.quantity, quantityDecimals, quantityValue]);
  const limitPriceFieldError = useMemo(() => {
    if (tab !== "limit") {
      return null;
    }

    if (!orderForm.limitPrice.trim()) {
      return t.enterLimitPrice;
    }

    if (!Number.isFinite(limitPriceValue) || limitPriceValue <= 0) {
      return t.priceGreaterThanZero;
    }

    return null;
  }, [limitPriceValue, orderForm.limitPrice, tab]);
  const pricingPreview = useMemo(() => {
    const marketReferencePrice = side === "buy" ? state.latestTick?.ask : state.latestTick?.bid;
    const price = tab === "limit" ? limitPriceValue : marketReferencePrice;
    const leverage = state.symbolConfig?.leverage ?? leverageDraft;

    if (!Number.isFinite(quantityValue) || quantityValue <= 0 || !price || !Number.isFinite(price) || leverage <= 0) {
      return null;
    }

    const notional = quantityValue * price;
    const estimatedMargin = notional / leverage;
    const remainingAvailable = (state.account?.availableBalance ?? 0) - estimatedMargin;

    return {
      referencePrice: price,
      notional,
      estimatedMargin,
      remainingAvailable
    };
  }, [leverageDraft, limitPriceValue, quantityValue, side, state.account?.availableBalance, state.latestTick?.ask, state.latestTick?.bid, state.symbolConfig?.leverage, tab]);
  const orderError = useMemo(() => {
    if (orderValidation) {
      return orderValidation;
    }

    if (pricingPreview && pricingPreview.estimatedMargin > (state.account?.availableBalance ?? 0)) {
      return t.estimatedMarginExceeds;
    }

    return null;
  }, [orderValidation, pricingPreview, state.account?.availableBalance]);
  const orderCheckItems = useMemo(() => {
    const marketReferencePrice = side === "buy" ? state.latestTick?.ask : state.latestTick?.bid;

    return [
      {
        label: t.contracts,
        ok: !quantityFieldError,
        detail: quantityFieldError ?? t.precisionOk.replace("{decimals}", String(quantityDecimals))
      },
      {
        label: tab === "limit" ? t.limitPrice : t.referencePrice,
        ok: tab === "limit" ? !limitPriceFieldError : Boolean(marketReferencePrice),
        detail: tab === "limit"
          ? limitPriceFieldError ?? t.readyAt.replace("{price}", fmt(limitPriceValue, priceDigits))
          : marketReferencePrice
            ? `${side === "buy" ? ui.admin.ask : ui.admin.bid} ${fmt(marketReferencePrice, priceDigits)}`
            : t.waitingForLiveQuote
      },
      {
        label: "Margin",
        ok: Boolean(pricingPreview) && !orderError,
        detail: pricingPreview
          ? t.marginRequired.replace("{amount}", fmt(pricingPreview.estimatedMargin, 2))
          : t.noEstimateYet
      }
    ];
  }, [limitPriceFieldError, limitPriceValue, orderError, priceDigits, pricingPreview, quantityDecimals, quantityFieldError, side, state.latestTick?.ask, state.latestTick?.bid, tab, t, ui.admin.ask, ui.admin.bid]);
  const leverageInUse = state.symbolConfig?.leverage ?? leverageDraft;
  const marginUsageRatio = pricingPreview && availableBalance > 0
    ? Math.min(pricingPreview.estimatedMargin / availableBalance, 1)
    : 0;
  const postTradeAvailableRatio = pricingPreview && state.account?.equity
    ? Math.max(Math.min((pricingPreview.remainingAvailable / state.account.equity) * 100, 100), -100)
    : 0;
  const personalFills = useMemo(() => {
    type PersonalFill = {
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
    };

    let runningPositionSide: "long" | "short" | "flat" = "flat";
    let runningQuantity = 0;
    let runningAverageEntryPrice = 0;
    const fills: PersonalFill[] = [];

      fillHistoryEvents
        .filter((event) => event.eventType === "OrderFilled" || event.eventType === "OrderPartiallyFilled")
        .sort((left, right) => left.sequence - right.sequence)
        .map((event) => {
        const payload = event.payload as {
          orderId: string;
          fillId: string;
          fillPrice: number;
          fillQuantity: number;
          filledQuantityTotal: number;
          remainingQuantity: number;
          slippage: number;
          fee: number;
          feeRate: number;
          liquidityRole: "maker" | "taker";
          filledAt: string;
        };
        const order = state.orders.find((entry) => entry.id === payload.orderId);
        const orderSide = order?.side ?? "buy";
        const notional = payload.fillPrice * payload.fillQuantity;
        const resolvedFeeRate = Number.isFinite(payload.feeRate) && payload.feeRate > 0
          ? payload.feeRate
          : notional > 0
            ? Number((payload.fee / notional).toFixed(8))
            : 0;
        const resolvedLiquidityRole = payload.liquidityRole ?? (order?.orderType === "limit" ? "maker" : "taker");
        const entryPrice = runningAverageEntryPrice;
        let realizedPnl = 0;
        const signedPositionQuantity = runningPositionSide === "long" ? runningQuantity : runningPositionSide === "short" ? -runningQuantity : 0;
        const signedFillQuantity = orderSide === "buy" ? payload.fillQuantity : -payload.fillQuantity;
        const nextSignedQuantity = signedPositionQuantity + signedFillQuantity;
        const isClosingFill = signedPositionQuantity !== 0 && Math.sign(signedPositionQuantity) !== Math.sign(signedFillQuantity);

        if (isClosingFill) {
          const closingQuantity = Math.min(Math.abs(signedPositionQuantity), Math.abs(signedFillQuantity));

          if (runningPositionSide === "long" && orderSide === "sell") {
            realizedPnl = Number(((payload.fillPrice - runningAverageEntryPrice) * closingQuantity).toFixed(8));
          } else if (runningPositionSide === "short" && orderSide === "buy") {
            realizedPnl = Number(((runningAverageEntryPrice - payload.fillPrice) * closingQuantity).toFixed(8));
          }
        }

        if (nextSignedQuantity === 0) {
          runningPositionSide = "flat";
          runningQuantity = 0;
          runningAverageEntryPrice = 0;
        } else if (signedPositionQuantity === 0 || Math.sign(signedPositionQuantity) === Math.sign(signedFillQuantity)) {
          runningAverageEntryPrice = Number((((Math.abs(signedPositionQuantity) * runningAverageEntryPrice) + (payload.fillQuantity * payload.fillPrice)) / Math.abs(nextSignedQuantity)).toFixed(8));
          runningPositionSide = nextSignedQuantity > 0 ? "long" : "short";
          runningQuantity = Math.abs(nextSignedQuantity);
        } else if (Math.abs(signedFillQuantity) > Math.abs(signedPositionQuantity)) {
          runningPositionSide = nextSignedQuantity > 0 ? "long" : "short";
          runningQuantity = Math.abs(nextSignedQuantity);
          runningAverageEntryPrice = payload.fillPrice;
        } else {
          runningPositionSide = nextSignedQuantity > 0 ? "long" : nextSignedQuantity < 0 ? "short" : "flat";
          runningQuantity = Math.abs(nextSignedQuantity);
        }

        fills.push({
          id: payload.fillId,
          orderId: payload.orderId,
          side: orderSide,
          orderType: order?.orderType ?? "market",
          symbol: order?.symbol ?? event.symbol,
          price: payload.fillPrice,
          quantity: payload.fillQuantity,
          fee: payload.fee,
          slippage: payload.slippage,
          feeRate: resolvedFeeRate,
          liquidityRole: resolvedLiquidityRole,
          filledAt: payload.filledAt,
          entryPrice: isClosingFill ? entryPrice : payload.fillPrice,
          exitPrice: isClosingFill ? payload.fillPrice : undefined,
          realizedPnl
        });
      })
      .slice();

      return fills.sort((left, right) => new Date(right.filledAt).getTime() - new Date(left.filledAt).getTime());
    }, [fillHistoryEvents, state.orders]);

  useEffect(() => {
    if (state.symbolConfig?.leverage) {
      setLeverageDraft(state.symbolConfig.leverage);
    }
  }, [state.symbolConfig?.leverage]);

  useEffect(() => {
    if (state.symbolConfig?.symbol && state.symbolConfig.symbol !== orderForm.symbol) {
      setOrderForm((current) => ({
        ...current,
        symbol: state.symbolConfig?.symbol ?? current.symbol
      }));
    }
  }, [orderForm.symbol, state.symbolConfig?.symbol]);

  useEffect(() => {
    void refresh();
    let active = true;
    let socket: WebSocket | null = null;

    const connect = () => {
      if (!active) {
        return;
      }

      socket = new WebSocket(buildWebSocketUrl(apiBaseUrl, authToken));
      socket.addEventListener("message", (event) => {
        const payload = JSON.parse(event.data) as { state?: Partial<State>; events?: AnyEventEnvelope[]; simulator?: MarketSimulatorState; market?: MarketState; symbolConfig?: State["symbolConfig"]; platform?: PlatformSettings };
        if (!payload.state) {
          return;
        }

        const nextState = payload.state;
        setState((cur) => ({
          account: nextState.account ?? cur.account,
          orders: nextState.orders ?? cur.orders,
          position: nextState.position ?? cur.position,
          latestTick: nextState.latestTick ?? cur.latestTick,
          events: mergeEvents(cur.events, payload.events),
          simulator: payload.simulator ?? cur.simulator,
          market: payload.market ?? cur.market,
          symbolConfig: payload.symbolConfig ?? cur.symbolConfig,
          platform: payload.platform ?? cur.platform
        }));
        if (payload.events?.length) {
          const fillEvents = payload.events.filter((event) => event.eventType === "OrderFilled" || event.eventType === "OrderPartiallyFilled");
          setFillHistoryEvents((current) => mergeEvents(
            current,
            fillEvents
          ));
        }
      });

      const scheduleReconnect = () => {
        if (!active || reconnectTimerRef.current) {
          return;
        }

        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          connect();
        }, 1000);
      };

      socket.addEventListener("close", scheduleReconnect);
      socket.addEventListener("error", scheduleReconnect);
    };

    connect();

    return () => {
      active = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      socket?.close();
    };
  }, [apiBaseUrl, authToken]);

  const refresh = async () => {
    try {
      const [stateResponse, fillHistoryResponse, botCredentialsResponse] = await Promise.all([
        fetch(buildApiUrl(apiBaseUrl, "/api/state"), { cache: "no-store", headers: authHeaders(authToken, locale) }),
        fetch(buildApiUrl(apiBaseUrl, "/api/fill-history"), { cache: "no-store", headers: authHeaders(authToken, locale) }),
        fetch(buildApiUrl(apiBaseUrl, "/api/bot-credentials"), { cache: "no-store", headers: authHeaders(authToken, locale) })
      ]);

      if (stateResponse.status === 401 || fillHistoryResponse.status === 401 || botCredentialsResponse.status === 401) {
        setMessage(ui.trader.sessionExpired);
        onLogout();
        return;
      }

      const payload = await stateResponse.json() as State;
      const fillHistoryPayload = await fillHistoryResponse.json() as FillHistoryResponse;
      const credentialsPayload = await botCredentialsResponse?.json().catch(() => null) as BotCredentials | null;
      setState(payload);
      setFillHistoryEvents(fillHistoryPayload.events ?? []);
      setBotCredentials(credentialsPayload);
      setMessage("");
    } catch {
      setMessage(ui.trader.failedLoad);
    }
  };

  const submitOrder = async () => {
    if (!botCredentials) {
      setMessage("Bot credentials are not available.");
      return;
    }

    const body = {
      action: {
        type: "order",
        orders: [{
          a: 0,
          b: side === "buy",
          p: String(tab === "limit" ? Number(orderForm.limitPrice) : (side === "buy" ? state.latestTick?.ask ?? 0 : state.latestTick?.bid ?? 0)),
          s: String(Number(orderForm.quantity)),
          r: false,
          t: {
            limit: {
              tif: tab === "limit" ? "Gtc" as const : "Ioc" as const
            }
          }
        }],
        grouping: "na"
      },
      nonce: Date.now(),
      vaultAddress: botCredentials.vaultAddress
    };
    const signature = await signBotPayload(botCredentials.apiSecret, body);
    const response = await fetch(buildApiUrl(apiBaseUrl, "/exchange"), {
      method: "POST",
      headers: authHeaders(authToken, locale, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        ...body,
        signature: {
          r: botCredentials.signerAddress,
          s: signature,
          v: 27
        }
      })
    });
    const payload = await response.json().catch(() => ({}) as {
      response?: {
        data?: {
          statuses?: Array<{ error?: string }>;
        };
      };
    });
    setMessage(response.ok ? extractExchangeMessage(payload, "Order submitted.") : ui.trader.orderRejected);
    if (response.ok) {
      await refresh();
      setAccountTab("fills");
    }
  };

  const cancelOrder = async (orderId: string) => {
    if (!botCredentials) {
      setMessage("Bot credentials are not available.");
      return;
    }

    const body = {
      action: {
        type: "cancel",
        cancels: [{
          a: 0,
          o: toOid(orderId)
        }]
      },
      nonce: Date.now(),
      vaultAddress: botCredentials.vaultAddress
    };
    const signature = await signBotPayload(botCredentials.apiSecret, body);
    const response = await fetch(buildApiUrl(apiBaseUrl, "/exchange"), {
      method: "POST",
      headers: authHeaders(authToken, locale, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        ...body,
        signature: {
          r: botCredentials.signerAddress,
          s: signature,
          v: 27
        }
      })
    });
    const payload = await response.json().catch(() => ({}) as {
      response?: {
        data?: {
          statuses?: Array<{ error?: string }>;
        };
      };
    });
    setMessage(response.ok ? extractExchangeMessage(payload, `Order ${orderId} canceled.`) : ui.trader.orderRejected);
    if (response.ok) {
      await refresh();
      setAccountTab("openOrders");
    }
  };

  const closePosition = async () => {
    if (!state.position || state.position.side === "flat" || state.position.quantity <= 0) {
      setMessage("No open position to close.");
      return;
    }

    if (!botCredentials) {
      setMessage("Bot credentials are not available.");
      return;
    }

    const closingSide = state.position.side === "long" ? "sell" : "buy";
    const body = {
      action: {
        type: "order",
        orders: [{
          a: 0,
          b: closingSide === "buy",
          p: String(closingSide === "buy" ? state.latestTick?.ask ?? 0 : state.latestTick?.bid ?? 0),
          s: String(state.position.quantity),
          r: false,
          t: {
            limit: {
              tif: "Ioc" as const
            }
          }
        }],
        grouping: "na"
      },
      nonce: Date.now(),
      vaultAddress: botCredentials.vaultAddress
    };
    const signature = await signBotPayload(botCredentials.apiSecret, body);
    const response = await fetch(buildApiUrl(apiBaseUrl, "/exchange"), {
      method: "POST",
      headers: authHeaders(authToken, locale, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        ...body,
        signature: {
          r: botCredentials.signerAddress,
          s: signature,
          v: 27
        }
      })
    });

    const payload = await response.json().catch(() => ({}) as {
      response?: {
        data?: {
          statuses?: Array<{ error?: string }>;
        };
      };
    });
    setMessage(response.ok ? extractExchangeMessage(payload, "Position close order submitted.") : ui.trader.orderRejected);

    if (response.ok) {
      await refresh();
      setAccountTab("positions");
    }
  };

  const updateLeverage = async () => {
      const response = await fetch(buildApiUrl(apiBaseUrl, "/api/leverage"), {
      method: "POST",
      headers: authHeaders(authToken, locale, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        symbol: state.symbolConfig?.symbol ?? orderForm.symbol,
        leverage: leverageDraft
      })
    });
    const payload = await response.json().catch(() => ({}) as { message?: string; symbolConfig?: State["symbolConfig"] });

    if (!response.ok) {
      setMessage(payload.message ?? ui.trader.failedLoad);
      return;
    }

    setMessage(`Leverage updated to ${payload.symbolConfig?.leverage ?? leverageDraft}x.`);
    await refresh();
  };

  return (
    <main style={{ minHeight: "100dvh", width: "100%", background: "#071116", color: "#dbe7ef", padding: 0, fontFamily: "\"Segoe UI\", sans-serif" }}>
      <div style={{ display: "grid", gap: 8, padding: 0, boxSizing: "border-box" }}>
        <div style={{ ...box("12px 16px"), position: "sticky", top: 0, zIndex: 20, borderRadius: 0, backdropFilter: "blur(10px)", background: "rgba(11, 22, 29, 0.92)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "320px minmax(0,1fr) auto", gap: 16, alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <img
                src="/favicon.png"
                alt="Stratium"
                width={48}
                height={48}
                style={{ width: 48, height: 48, borderRadius: 12, objectFit: "cover", boxShadow: "0 8px 24px rgba(15, 23, 42, 0.28)" }}
              />
              <div>
                <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.1 }}>Stratium</div>
                <div style={{ color: "#7e97a5", fontSize: 12, marginTop: 2 }}>{contractCoin} perpetual market replica</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
              <Metric label={locale === "zh" ? "价格" : locale === "ja" ? "価格" : "Price"} value={fmt(stats.last, priceDigits)} strong />
              <Metric label="24h Change" value={`${fmt(stats.change, 2)}%`} tone={stats.change && stats.change < 0 ? "down" : "up"} />
              <Metric label="24h Low" value={fmt(stats.low, priceDigits)} />
              <Metric label="24h High" value={fmt(stats.high, priceDigits)} />
              <Metric label="Mark" value={fmt(state.market?.assetCtx?.markPrice ?? state.market?.markPrice, priceDigits)} />
              <Metric label="Oracle" value={fmt(state.market?.assetCtx?.oraclePrice, priceDigits)} />
              <Metric label="Funding" value={state.market?.assetCtx?.fundingRate != null ? `${fmt(state.market.assetCtx.fundingRate * 100, 4)}%` : "-"} />
              <Metric label="OI" value={fmt(state.market?.assetCtx?.openInterest, 3)} />
              <Metric label="24h Volume" value={state.market?.assetCtx?.dayNotionalVolume != null ? `$${fmt(state.market.assetCtx.dayNotionalVolume, 2)}` : "-"} />
              <Metric label={locale === "zh" ? "时间" : locale === "ja" ? "時刻" : "Clock"} value={clock(state.latestTick?.tickTime)} />
            </div>
            <div style={{ justifySelf: "end", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", justifyContent: "flex-end", textAlign: "right" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "#7e97a5", fontSize: 11 }}>{ui.common.language}</span>
                <select value={locale} onChange={(event) => onLocaleChange(event.target.value as AppLocale)} style={selectStyle}>
                  {APP_LOCALES.map((entry) => <option key={entry} value={entry}>{LOCALE_LABELS[entry]}</option>)}
                </select>
              </div>
              <div>
                <div style={{ color: "#56d7c4", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.16em" }}>{viewer.displayName}</div>
                <div style={{ color: "#9ab0bc", fontSize: 12 }}>{viewer.username}</div>
              </div>
              <button onClick={onLogout} style={btnInline}>{ui.trader.signOut}</button>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(300px,360px)", gap: 8, minHeight: 0, padding: "0 8px 8px", alignItems: "start" }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.8fr) minmax(300px,360px)", gap: 8, minHeight: 0, alignItems: "stretch" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0, height: "100%" }}>
            <div style={box()}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid #16262f", color: "#7e97a5", fontSize: 12 }}>
                <div style={{ display: "flex", gap: 10 }}>
                  {TIMEFRAMES.map((entry) => (
                    <button key={entry.id} onClick={() => setTimeframe(entry.id)} style={chipButton(timeframe === entry.id)} title={entry.hint}>
                      {entry.label}
                    </button>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 12 }}><span>{locale === "zh" ? "指标" : locale === "ja" ? "指標" : "Indicators"}</span><span>{locale === "zh" ? "绘图" : locale === "ja" ? "描画" : "Drawing"}</span><span>{locale === "zh" ? "布局" : locale === "ja" ? "レイアウト" : "Layout"}</span></div>
              </div>
              <div style={{ padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 700 }}>{contractCoin} Perp</div>
                    <div style={{ color: "#7e97a5", fontSize: 12 }}>{message || state.platform?.platformAnnouncement || `${locale === "zh" ? "已就绪" : locale === "ja" ? "準備完了" : "Ready"} · ${selectedTimeframe.label} mode · ${state.market?.connected ? "Hyperliquid" : locale === "zh" ? "合成回退" : locale === "ja" ? "合成フォールバック" : "Synthetic fallback"}`}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ color: stats.change && stats.change < 0 ? "#f87171" : "#2dd4bf", fontSize: 22, fontWeight: 700 }}>{fmt(stats.last, priceDigits)}</div>
                    <div style={{ color: "#7e97a5", fontSize: 12 }}>
                      {locale === "zh" ? "点差" : locale === "ja" ? "スプレッド" : "Spread"} {fmt(state.latestTick?.spread, 4)} · {state.market?.connected ? "Hyperliquid live" : state.simulator?.enabled ? (locale === "zh" ? "模拟器运行中" : locale === "ja" ? "シミュレーター稼働中" : "simulator live") : (locale === "zh" ? "暂停" : locale === "ja" ? "停止中" : "paused")} · {selectedTimeframe.hint}
                    </div>
                  </div>
                </div>
                <CandlestickChart data={candles} volumeData={volume} dark priceDigits={priceDigits} position={state.position} />
              </div>
            </div>

            <div style={{ ...box(), display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
              <div style={{ display: "flex", gap: 4, padding: "0 10px", borderBottom: "1px solid #16262f" }}>
                <TabButton active={accountTab === "balances"} label={t.balances} onClick={() => setAccountTab("balances")} />
                <TabButton active={accountTab === "positions"} label={t.positions} onClick={() => setAccountTab("positions")} />
                <TabButton active={accountTab === "openOrders"} label={t.openOrders} onClick={() => setAccountTab("openOrders")} />
                <TabButton active={accountTab === "fills"} label={t.fillHistory} onClick={() => setAccountTab("fills")} />
              </div>
              <div style={{ overflowX: "auto", overflowY: "auto", flex: 1, minHeight: 0 }}>
                {accountTab === "balances" ? (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ color: "#7e97a5", textAlign: "left" }}>
                        <th style={th}>{t.metric}</th><th style={th}>{t.value}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        [t.wallet, `${fmt(state.account?.walletBalance, 2)} USDC`],
                        [t.available, `${fmt(state.account?.availableBalance, 2)} USDC`],
                        [t.equity, `${fmt(state.account?.equity, 2)} USDC`],
                        [t.realizedPnl, `${fmt(state.account?.realizedPnl, 4)} USDC`],
                        [t.unrealizedPnl, `${fmt(state.account?.unrealizedPnl, 4)} USDC`]
                      ].map(([label, value]) => (
                        <tr key={label} style={{ borderTop: "1px solid #13212a" }}>
                          <td style={td}>{label}</td>
                          <td style={td}>{value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : accountTab === "positions" ? (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead>
                        <tr style={{ color: "#7e97a5", textAlign: "left" }}>
                          <th style={th}>{t.symbol}</th><th style={th}>{t.side}</th><th style={th}>{t.contracts}</th><th style={th}>{t.entry}</th><th style={th}>{t.mark}</th><th style={th}>{t.estimatedLiquidation}</th><th style={th}>{t.unrealizedPnl}</th><th style={th}>{t.action}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {!state.position || state.position.side === "flat" ? (
                          <tr><td colSpan={8} style={{ padding: 18, color: "#60727f", textAlign: "center" }}>{t.noPosition}</td></tr>
                        ) : (
                          <tr style={{ borderTop: "1px solid #13212a" }}>
                            <td style={td}>{state.position.symbol}</td>
                            <td style={{ ...td, color: state.position.side === "long" ? "#2dd4bf" : "#f87171" }}>{state.position.side}</td>
                            <td style={td}>{fmt(state.position.quantity, 4)}</td>
                            <td style={td}>{fmt(state.position.averageEntryPrice, priceDigits)}</td>
                            <td style={td}>{fmt(state.position.markPrice, priceDigits)}</td>
                            <td style={td}>{state.position.liquidationPrice > 0 ? fmt(state.position.liquidationPrice, priceDigits) : "-"}</td>
                            <td style={{ ...td, color: state.position.unrealizedPnl > 0 ? "#2dd4bf" : state.position.unrealizedPnl < 0 ? "#f87171" : "#dbe7ef" }}>{fmt(state.position.unrealizedPnl, 4)} USDC</td>
                            <td style={td}><button onClick={() => void closePosition()} style={btnInline}>{t.closePosition}</button></td>
                          </tr>
                        )}
                    </tbody>
                  </table>
                ) : accountTab === "openOrders" ? (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ color: "#7e97a5", textAlign: "left" }}>
                        <th style={th}>{t.order}</th><th style={th}>{t.side}</th><th style={th}>{t.type}</th><th style={th}>{t.contracts}</th><th style={th}>{t.filled}</th><th style={th}>{t.status}</th><th style={th}>{t.action}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeOrders.length === 0 ? <tr><td colSpan={7} style={{ padding: 18, color: "#60727f", textAlign: "center" }}>{t.noOpenOrders}</td></tr> : activeOrders.map((order) => (
                        <tr key={order.id} style={{ borderTop: "1px solid #13212a" }}>
                          <td style={td}>{order.id}</td>
                          <td style={{ ...td, color: order.side === "buy" ? "#2dd4bf" : "#f87171" }}>{order.side}</td>
                          <td style={td}>{order.orderType}</td>
                          <td style={td}>{fmt(order.quantity)}</td>
                          <td style={td}>{fmt(order.filledQuantity)}</td>
                          <td style={td}>{order.status}</td>
                          <td style={td}><button onClick={() => void cancelOrder(order.id)} style={btnInline}>{t.cancel}</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ color: "#7e97a5", textAlign: "left" }}>
                        <th style={th}>{t.time}</th><th style={th}>{t.order}</th><th style={th}>{t.side}</th><th style={th}>{t.type}</th><th style={th}>{t.role}</th><th style={th}>{t.entryPrice}</th><th style={th}>{t.exitPrice}</th><th style={th}>{t.contracts}</th><th style={th}>{t.realizedPnl}</th><th style={th}>{t.fee}</th><th style={th}>{t.slippage}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {personalFills.length === 0 ? <tr><td colSpan={11} style={{ padding: 18, color: "#60727f", textAlign: "center" }}>{t.noFills}</td></tr> : personalFills.map((fill) => (
                        <tr key={fill.id} style={{ borderTop: "1px solid #13212a" }}>
                          <td style={td}>{dateTime(fill.filledAt)}</td>
                          <td style={td}>{fill.orderId}</td>
                          <td style={{ ...td, color: fill.side === "buy" ? "#2dd4bf" : "#f87171" }}>{fill.side}</td>
                          <td style={td}>{fill.orderType}</td>
                          <td style={{ ...td, textTransform: "uppercase", color: fill.liquidityRole === "maker" ? "#22c55e" : "#f59e0b" }}>{fill.liquidityRole}</td>
                          <td style={td}>{fmt(fill.entryPrice, priceDigits)}</td>
                          <td style={td}>{fill.exitPrice != null ? fmt(fill.exitPrice, priceDigits) : "-"}</td>
                          <td style={td}>{fmt(fill.quantity, 4)}</td>
                          <td style={{ ...td, color: fill.realizedPnl > 0 ? "#2dd4bf" : fill.realizedPnl < 0 ? "#f87171" : "#dbe7ef" }}>{fmt(fill.realizedPnl, 4)} USDC</td>
                          <td style={td}>{fmt(fill.fee, 6)} <span style={{ color: "#60727f" }}>({fmt(fill.feeRate * 100, 3)}%)</span></td>
                          <td style={td}>{fmt(fill.slippage, 6)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>

          <div style={box()}>
            <div style={{ display: "flex", gap: 2, padding: 10, borderBottom: "1px solid #16262f" }}>
              <button onClick={() => setBookTab("book")} style={bookTab === "book" ? tabActive : tabIdle}>{t.orderBook}</button>
              <button onClick={() => setBookTab("trades")} style={bookTab === "trades" ? tabActive : tabIdle}>{t.trades}</button>
            </div>
            {bookTab === "book" ? (
              <div style={{ padding: 14 }}>
                <div style={bookHead}><span>{t.price}</span><span>{t.sizeContracts}</span><span>{t.totalContracts}</span></div>
                {bookWithDepth.asks.map((row) => (
                  <BookRow
                    key={`a-${row.price}`}
                    price={row.price}
                    size={row.size}
                    total={row.total}
                    tone="ask"
                    maxTotal={bookWithDepth.maxAskTotal}
                    priceDigits={priceDigits}
                  />
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", margin: "10px 0", padding: "8px 10px", borderRadius: 8, background: "#10222c" }}><span>{ui.admin.spread}</span><strong>{fmt(state.latestTick?.spread, 4)}</strong></div>
                {bookWithDepth.bids.map((row) => (
                  <BookRow
                    key={`b-${row.price}`}
                    price={row.price}
                    size={row.size}
                    total={row.total}
                    tone="bid"
                    maxTotal={bookWithDepth.maxBidTotal}
                    priceDigits={priceDigits}
                  />
                ))}
              </div>
            ) : (
              <div style={{ padding: 14, display: "grid", gap: 8 }}>
                <div style={bookHead}><span>{t.time}</span><span>{t.price}</span><span>{t.contracts}</span></div>
                {trades.length === 0 ? <div style={{ color: "#60727f" }}>{t.noTrades}</div> : trades.map((trade) => {
                  return <div key={trade.id} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, opacity: trade.source === "tape" ? 0.84 : 1 }}><span>{clock(trade.time)}</span><strong style={{ color: trade.side === "sell" ? "#f87171" : "#2dd4bf" }}>{fmt(trade.price, priceDigits)}</strong><span>{fmt(trade.size, 4)}</span></div>;
                })}
              </div>
            )}
          </div>
          </div>

          <div style={{ display: "grid", gap: 8, alignContent: "start" }}>
            <div style={box()}>
              <div style={{ display: "flex", gap: 2, padding: 10, borderBottom: "1px solid #16262f" }}>
                <button onClick={() => setTab("market")} style={tab === "market" ? tabActive : tabIdle}>{t.market}</button>
                <button onClick={() => setTab("limit")} style={tab === "limit" ? tabActive : tabIdle}>{t.limit}</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, padding: "0 14px 14px" }}>
                <button onClick={() => setSide("buy")} style={side === "buy" ? btnBuyActive : btnSide}>{t.buy}</button>
                <button onClick={() => setSide("sell")} style={side === "sell" ? btnSellActive : btnSide}>{t.sell}</button>
              </div>
              <div style={{ padding: "0 14px 14px", display: "grid", gap: 12 }}>
                <Line label={t.leverage} value={`${leverageInUse}x / max ${state.symbolConfig?.maxLeverage ?? leverageDraft}x`} />
                <Line label={t.rollingMarket} value={state.simulator?.enabled ? `${t.running} · ${state.simulator.intervalMs}ms` : t.stopped} />
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ color: "#7e97a5", fontSize: 12 }}>{t.adjustLeverage}</span>
                  <input
                    type="range"
                    min={1}
                    max={state.symbolConfig?.maxLeverage ?? 10}
                    step={1}
                    value={leverageDraft}
                    onChange={(event) => setLeverageDraft(Number(event.target.value))}
                  />
                  <div style={{ display: "flex", justifyContent: "space-between", color: "#7e97a5", fontSize: 12 }}>
                    <span>1x</span>
                    <strong style={{ color: "#f8fafc" }}>{leverageDraft}x</strong>
                    <span>{state.symbolConfig?.maxLeverage ?? 10}x</span>
                  </div>
                  <button onClick={() => void updateLeverage()} style={btnGhost}>{t.applyLeverage}</button>
                </label>
                <Field
                  label={t.contracts}
                  value={orderForm.quantity}
                  onChange={(v) => setOrderForm((s) => ({ ...s, quantity: v }))}
                  inputMode="decimal"
                  error={quantityFieldError ?? undefined}
                  hint={!quantityFieldError ? t.marginPreviewHint.replace("{decimals}", String(quantityDecimals)) : undefined}
                />
                {tab === "limit" && (
                  <Field
                    label={t.limitPrice}
                    value={orderForm.limitPrice}
                    onChange={(v) => setOrderForm((s) => ({ ...s, limitPrice: v }))}
                    inputMode="decimal"
                    error={limitPriceFieldError ?? undefined}
                    hint={!limitPriceFieldError ? `${t.referencePrice} ${side === "buy" ? ui.admin.ask.toLowerCase() : ui.admin.bid.toLowerCase()} ${fmt(side === "buy" ? state.latestTick?.ask : state.latestTick?.bid, priceDigits)}` : undefined}
                  />
                )}
                <div style={{ color: "#7e97a5", fontSize: 12 }}>{t.oneContract.replace("{coin}", contractCoin)}</div>
                <div style={{ display: "grid", gap: 8 }}>
                  {orderCheckItems.map((item) => (
                    <div
                      key={item.label}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: "9px 10px",
                        borderRadius: 10,
                        border: item.ok ? "1px solid #17433c" : "1px solid #4a2424",
                        background: item.ok ? "rgba(19, 78, 74, 0.2)" : "rgba(127, 29, 29, 0.16)",
                        fontSize: 12
                      }}
                    >
                      <strong style={{ color: item.ok ? "#86efac" : "#fda4af" }}>{item.label}</strong>
                      <span style={{ color: item.ok ? "#d1fae5" : "#fecdd3", textAlign: "right" }}>{item.detail}</span>
                    </div>
                  ))}
                </div>
                {pricingPreview ? (
                  <div style={{ display: "grid", gap: 6, padding: 12, borderRadius: 10, background: "#0f1c23", border: "1px solid #15262e", fontSize: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span style={{ color: "#7e97a5" }}>{t.estimatedPrice}</span><strong>{fmt(pricingPreview.referencePrice, priceDigits)}</strong></div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span style={{ color: "#7e97a5" }}>{t.notional}</span><strong>{fmt(pricingPreview.notional, 2)} USDC</strong></div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span style={{ color: "#7e97a5" }}>{t.requiredMargin}</span><strong>{fmt(pricingPreview.estimatedMargin, 2)} USDC</strong></div>
                    <div style={{ display: "grid", gap: 6, marginTop: 4 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                        <span style={{ color: "#7e97a5" }}>{t.marginUsage}</span>
                        <strong>{fmt(marginUsageRatio * 100, 1)}%</strong>
                      </div>
                      <div style={{ height: 8, borderRadius: 999, background: "#0b151b", overflow: "hidden" }}>
                        <div style={{ width: `${marginUsageRatio * 100}%`, height: "100%", background: marginUsageRatio > 0.85 ? "#ef4444" : marginUsageRatio > 0.6 ? "#f59e0b" : "#22c55e" }} />
                      </div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span style={{ color: "#7e97a5" }}>{t.availableAfter}</span><strong style={{ color: pricingPreview.remainingAvailable < 0 ? "#f87171" : "#dbe7ef" }}>{fmt(pricingPreview.remainingAvailable, 2)} USDC</strong></div>
                    <div style={{ color: "#7e97a5" }}>{t.postTradeFreeMargin.replace("{ratio}", fmt(postTradeAvailableRatio, 1))}</div>
                  </div>
                ) : null}
                {orderError ? <div style={{ color: "#f87171", fontSize: 12 }}>{orderError}</div> : <div style={{ color: "#7e97a5", fontSize: 12 }}>{t.checksPassed}</div>}
                <button disabled={Boolean(orderError)} onClick={() => void submitOrder()} style={{ ...(side === "buy" ? btnBuySubmit : btnSellSubmit), opacity: orderError ? 0.5 : 1, cursor: orderError ? "not-allowed" : "pointer" }}>{side === "buy" ? t.buy : t.sell} {contractCoin} Perp</button>
              </div>
            </div>

            <div style={box()}>
              <div style={{ padding: "12px 14px", borderBottom: "1px solid #16262f", fontWeight: 700 }}>{t.activeOrders}</div>
              <div style={{ padding: 14, display: "grid", gap: 10 }}>
                {activeOrders.length === 0 ? (
                  <div style={{ color: "#60727f", fontSize: 13 }}>{t.noActiveOrders}</div>
                ) : activeOrders.map((order) => (
                  <div key={order.id} style={{ border: "1px solid #15262e", borderRadius: 10, padding: 12, display: "grid", gap: 8, background: "#0c171d" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <strong>{order.id}</strong>
                      <span style={{ color: order.side === "buy" ? "#2dd4bf" : "#f87171", textTransform: "capitalize" }}>{order.side}</span>
                    </div>
                    <div style={{ color: "#7e97a5", fontSize: 12 }}>
                      {order.orderType} · {fmt(order.remainingQuantity, 4)} / {fmt(order.quantity, 4)} contracts
                    </div>
                    <button onClick={() => void cancelOrder(order.id)} style={btnInline}>{t.cancelOrder}</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function Metric({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: "up" | "down" }) {
  return <div><div style={{ color: "#60727f", fontSize: 11 }}>{label}</div><div style={{ color: strong ? "#f8fafc" : tone === "down" ? "#f87171" : tone === "up" ? "#2dd4bf" : "#dbe7ef", fontSize: strong ? 18 : 15, fontWeight: 700 }}>{value}</div></div>;
}

function Line({ label, value }: { label: string; value: string }) {
  return <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13 }}><span style={{ color: "#7e97a5" }}>{label}</span><strong>{value}</strong></div>;
}

function Field({
  label,
  value,
  onChange,
  compact,
  error,
  hint,
  inputMode,
  readOnly
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  compact?: boolean;
  error?: string;
  hint?: string;
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
  readOnly?: boolean;
}) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span style={{ color: "#7e97a5", fontSize: 12 }}>{label}</span>
      <input
        value={value}
        inputMode={inputMode}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        style={{
          borderRadius: 10,
          border: error ? "1px solid #7f1d1d" : "1px solid #22343d",
          background: readOnly ? "#0d171d" : "#101b22",
          color: "#f8fafc",
          padding: compact ? "9px 10px" : "11px 12px",
          outline: "none",
          boxShadow: error ? "0 0 0 1px rgba(248, 113, 113, 0.16)" : "none"
        }}
      />
      {error ? <span style={{ color: "#f87171", fontSize: 12 }}>{error}</span> : hint ? <span style={{ color: "#7e97a5", fontSize: 12 }}>{hint}</span> : null}
    </label>
  );
}

function BookRow({
  price,
  size,
  total,
  tone,
  maxTotal,
  priceDigits
}: {
  price: number;
  size: number;
  total: number;
  tone: "ask" | "bid";
  maxTotal: number;
  priceDigits: number;
}) {
  const width = maxTotal > 0 ? `${Math.max((total / maxTotal) * 100, 2)}%` : "0%";

  return (
    <div
      style={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: 8,
        padding: "6px 8px",
        borderRadius: 6,
        overflow: "hidden"
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          width,
          left: tone === "bid" ? 0 : "auto",
          right: tone === "ask" ? 0 : "auto",
          background: tone === "ask" ? "rgba(248, 113, 113, 0.16)" : "rgba(45, 212, 191, 0.16)",
          pointerEvents: "none"
        }}
      />
      <span style={{ position: "relative", zIndex: 1, color: tone === "ask" ? "#f87171" : "#2dd4bf" }}>{fmt(price, priceDigits)}</span>
      <span style={{ position: "relative", zIndex: 1, textAlign: "right" }}>{fmt(size, 4)}</span>
      <span style={{ position: "relative", zIndex: 1, textAlign: "right", color: "#c8d6df" }}>{fmt(total, 4)}</span>
    </div>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick?: () => void }) {
  return <button onClick={onClick} style={{ border: 0, background: "transparent", color: active ? "#f8fafc" : "#7e97a5", padding: "12px 10px", borderBottom: active ? "2px solid #2dd4bf" : "2px solid transparent", cursor: "pointer" }}>{label}</button>;
}

const box = (padding?: string): CSSProperties => ({ background: "#0b161d", border: "1px solid #16262f", borderRadius: 12, overflow: "hidden", padding });
const chipButton = (active?: boolean): CSSProperties => ({ color: active ? "#f8fafc" : "#7e97a5", background: active ? "#15252d" : "transparent", border: active ? "1px solid #23414d" : "1px solid transparent", padding: "5px 8px", borderRadius: 8, cursor: "pointer" });
const tabIdle: CSSProperties = {
  border: 0,
  background: "transparent",
  color: "#7e97a5",
  padding: "8px 12px",
  borderBottomWidth: 2,
  borderBottomStyle: "solid",
  borderBottomColor: "transparent"
};
const tabActive: CSSProperties = { ...tabIdle, color: "#f8fafc", borderBottomColor: "#2dd4bf" };
const btnGhost: CSSProperties = { border: "1px solid #253740", background: "#111d24", color: "#dce7ee", padding: "10px 14px", borderRadius: 10, cursor: "pointer" };
const btnInline: CSSProperties = { border: "1px solid #394d56", background: "#122028", color: "#dce7ee", borderRadius: 8, padding: "6px 10px", cursor: "pointer" };
const selectStyle: CSSProperties = { border: "1px solid #394d56", background: "#122028", color: "#dce7ee", borderRadius: 8, padding: "6px 10px", outline: "none" };
const btnSide: CSSProperties = {
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "#24353d",
  background: "#132229",
  color: "#d6e2ea",
  padding: "10px 14px",
  borderRadius: 10,
  cursor: "pointer",
  fontWeight: 700
};
const btnBuyActive: CSSProperties = { ...btnSide, background: "#1e6b5f", borderColor: "#1e6b5f", color: "#f8fafc" };
const btnSellActive: CSSProperties = { ...btnSide, background: "#7f3d38", borderColor: "#7f3d38", color: "#f8fafc" };
const btnBuySubmit: CSSProperties = { border: 0, borderRadius: 12, background: "#22c55e", color: "#041015", padding: "14px 16px", cursor: "pointer", fontWeight: 800 };
const btnSellSubmit: CSSProperties = { border: 0, borderRadius: 12, background: "#ef4444", color: "#fff7f7", padding: "14px 16px", cursor: "pointer", fontWeight: 800 };
const th: CSSProperties = { padding: "12px 14px", fontWeight: 500 };
const td: CSSProperties = { padding: "12px 14px" };
const bookHead: CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, color: "#60727f", fontSize: 12, padding: "0 8px 8px" };
