"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AnyEventEnvelope } from "@stratium/shared";
import type { CandlestickData, HistogramData, UTCTimestamp } from "lightweight-charts";
import { buildWebSocketUrl } from "../api-base-url";
import { filterCandlesToRecent24Hours } from "../market-window";
import { getUiText } from "../i18n";
import { fetchDashboardSnapshot, submitSignedExchangeRequest, updateLeverageRequest } from "./api";
import { createAdvancedOrdersBody, createCancelOrderBody, createClosePositionBody, createSimpleOrderBody } from "./model";
import type { AdvancedOrderForm, DashboardViewProps, EnrichedTick, PersonalFill, State, TickPayload } from "./types";
import { TIMEFRAMES, coinFromSymbol, extractExchangeMessage, fmt, mergeEvents, priceDigitsForSymbol, toOid } from "./utils";

export const useTradingDashboard = ({ apiBaseUrl, authToken, locale, onLogout }: DashboardViewProps) => {
  const ui = getUiText(locale);
  const t = ui.trader;
  const [state, setState] = useState<State>({ account: null, orders: [], position: null, latestTick: null, events: [] });
  const [message, setMessage] = useState("");
  const [fillHistoryEvents, setFillHistoryEvents] = useState<AnyEventEnvelope[]>([]);
  const [botCredentials, setBotCredentials] = useState<any>(null);
  const [tab, setTab] = useState<"market" | "limit">("market");
  const [orderPanelMode, setOrderPanelMode] = useState<"simple" | "advanced">("simple");
  const [bookTab, setBookTab] = useState<"book" | "trades">("book");
  const [accountTab, setAccountTab] = useState<"positions" | "openOrders" | "fills">("positions");
  const [tradePanelOpen, setTradePanelOpen] = useState(false);
  const [timeframe, setTimeframe] = useState<"1m" | "5m" | "15m" | "1h">("1m");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [orderForm, setOrderForm] = useState({ symbol: "BTC-USD", quantity: "1", limitPrice: "100" });
  const [advancedForm, setAdvancedForm] = useState<AdvancedOrderForm>({
    takeProfitEnabled: false,
    takeProfitQuantity: "",
    takeProfitTriggerPrice: "",
    takeProfitExecution: "market",
    takeProfitLimitPrice: "",
    stopLossEnabled: false,
    stopLossQuantity: "",
    stopLossTriggerPrice: "",
    stopLossExecution: "market",
    stopLossLimitPrice: ""
  });
  const [leverageDraft, setLeverageDraft] = useState(10);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const priceDigits = useMemo(() => priceDigitsForSymbol(orderForm.symbol), [orderForm.symbol]);
  const contractCoin = useMemo(() => state.market?.coin ?? coinFromSymbol(orderForm.symbol), [orderForm.symbol, state.market?.coin]);
  const quantityDecimals = state.symbolConfig?.szDecimals ?? 4;
  const selectedTimeframe = useMemo(() => TIMEFRAMES.find((entry) => entry.id === timeframe) ?? TIMEFRAMES[0], [timeframe]);
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
      if (previousLast && Math.abs(tick.last - previousLast) / previousLast > 0.05) {
        continue;
      }

      const priceMoveRatio = previousLast ? Math.abs(tick.last - previousLast) / previousLast : 0;
      const spreadRatio = tick.last > 0 ? tick.spread / tick.last : 0;
      const baseVolume = 0.12 + Math.min(priceMoveRatio * 60, 0.22) + Math.min(spreadRatio * 220, 0.08);
      const smoothedVolume = Number((previousVolume * 0.72 + baseVolume * 0.28).toFixed(4));

      acceptedTicks.push({
        ...tick,
        syntheticVolume: smoothedVolume,
        aggressorSide: previousLast && tick.last < previousLast ? "sell" : "buy"
      });

      previousLast = tick.last;
      previousVolume = smoothedVolume;
    }

    return acceptedTicks;
  }, [state.events]);

  const recentMarketCandles = useMemo(() => state.market ? filterCandlesToRecent24Hours(state.market.candles) : [], [state.market]);

  const candles = useMemo(() => {
    if (recentMarketCandles.length > 0) {
      const map = new Map<number, CandlestickData<UTCTimestamp>>();
      for (const candle of recentMarketCandles) {
        const bucket = Math.floor(candle.openTime / selectedTimeframe.bucketMs) * (selectedTimeframe.bucketMs / 1000) as UTCTimestamp;
        const existing = map.get(bucket);
        map.set(bucket, existing ? { time: bucket, open: existing.open, high: Math.max(existing.high, candle.high), low: Math.min(existing.low, candle.low), close: candle.close } : { time: bucket, open: candle.open, high: candle.high, low: candle.low, close: candle.close });
      }
      return [...map.values()].sort((left, right) => Number(left.time) - Number(right.time));
    }

    const map = new Map<number, CandlestickData<UTCTimestamp>>();
    for (const tick of ticks) {
      const bucket = Math.floor(new Date(tick.tickTime).getTime() / selectedTimeframe.bucketMs) * (selectedTimeframe.bucketMs / 1000) as UTCTimestamp;
      const current = map.get(bucket);
      map.set(bucket, current ? { ...current, high: Math.max(current.high, tick.last), low: Math.min(current.low, tick.last), close: tick.last } : { time: bucket, open: tick.last, high: tick.last, low: tick.last, close: tick.last });
    }
    return [...map.values()].sort((left, right) => Number(left.time) - Number(right.time));
  }, [recentMarketCandles, selectedTimeframe.bucketMs, ticks]);

  const volume = useMemo(() => {
    if (recentMarketCandles.length > 0) {
      const map = new Map<number, HistogramData<UTCTimestamp>>();
      for (const candle of recentMarketCandles) {
        const bucket = Math.floor(candle.openTime / selectedTimeframe.bucketMs) * (selectedTimeframe.bucketMs / 1000) as UTCTimestamp;
        const existing = map.get(bucket);
        const value = Number((((existing?.value as number | undefined) ?? 0) + candle.volume).toFixed(4));
        map.set(bucket, { time: bucket, value, color: candle.close >= candle.open ? "#2dd4bf88" : "#f8717188" });
      }
      return [...map.values()].sort((left, right) => Number(left.time) - Number(right.time));
    }

    const map = new Map<number, HistogramData<UTCTimestamp>>();
    for (const tick of ticks) {
      const bucket = Math.floor(new Date(tick.tickTime).getTime() / selectedTimeframe.bucketMs) * (selectedTimeframe.bucketMs / 1000) as UTCTimestamp;
      const current = map.get(bucket);
      const next = Number((((current?.value as number | undefined) ?? 0) + tick.syntheticVolume).toFixed(4));
      map.set(bucket, { time: bucket, value: next, color: tick.aggressorSide === "buy" ? "#2dd4bf88" : "#f8717188" });
    }
    return [...map.values()].sort((left, right) => Number(left.time) - Number(right.time));
  }, [recentMarketCandles, selectedTimeframe.bucketMs, ticks]);

  const stats = useMemo(() => {
    if (state.market?.assetCtx) {
      const reference = state.market.assetCtx.prevDayPrice ?? recentMarketCandles[0]?.open;
      const last = state.market.assetCtx.markPrice ?? state.market.markPrice ?? state.latestTick?.last;
      return {
        last,
        change: last && reference ? ((last - reference) / reference) * 100 : undefined,
        low: recentMarketCandles.length > 0 ? Math.min(...recentMarketCandles.map((candle) => candle.low)) : undefined,
        high: recentMarketCandles.length > 0 ? Math.max(...recentMarketCandles.map((candle) => candle.high)) : undefined
      };
    }

    if (!ticks.length) {
      return { last: undefined, change: undefined, low: undefined, high: undefined };
    }

    const prices = ticks.map((tick) => tick.last);
    const first = prices[0] ?? 0;
    const last = prices[prices.length - 1];
    return { last, change: first ? ((last - first) / first) * 100 : 0, low: Math.min(...prices), high: Math.max(...prices) };
  }, [recentMarketCandles, state.latestTick?.last, state.market?.assetCtx, state.market?.markPrice, ticks]);

  const syntheticBook = useMemo(() => {
    const mid = state.latestTick?.last ?? 100;
    const step = Math.max((state.latestTick?.spread ?? 1) / 2, 0.001);
    return {
      asks: Array.from({ length: 8 }, (_, index) => ({ price: Number((mid + step * (8 - index)).toFixed(4)), size: Number((0.25 + index * 0.08).toFixed(4)) })),
      bids: Array.from({ length: 8 }, (_, index) => ({ price: Number((mid - step * (index + 1)).toFixed(4)), size: Number((0.22 + index * 0.09).toFixed(4)) }))
    };
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
    const asks = [...book.asks].sort((left, right) => right.price - left.price).map((level) => {
      askRunningTotal += level.size;
      return { ...level, total: Number(askRunningTotal.toFixed(4)) };
    });

    let bidRunningTotal = 0;
    const bids = [...book.bids].sort((left, right) => right.price - left.price).map((level) => {
      bidRunningTotal += level.size;
      return { ...level, total: Number(bidRunningTotal.toFixed(4)) };
    });

    return { asks, bids, maxAskTotal: Math.max(...asks.map((level) => level.total), 0), maxBidTotal: Math.max(...bids.map((level) => level.total), 0) };
  }, [book]);

  const trades = useMemo(() => {
    if (state.market && state.market.trades.length > 0) {
      return state.market.trades.map((trade) => ({ id: trade.id, time: new Date(trade.time).toISOString(), price: trade.price, size: trade.size, side: trade.side, source: "market" as const }));
    }

    const fillTrades = state.events
      .filter((event) => event.eventType === "OrderFilled" || event.eventType === "OrderPartiallyFilled")
      .slice()
      .reverse()
      .map((event) => {
        const payload = event.payload as { fillPrice: number; fillQuantity: number; orderId: string };
        const order = state.orders.find((entry) => entry.id === payload.orderId);
        return { id: event.eventId, time: event.occurredAt, price: payload.fillPrice, size: payload.fillQuantity, side: order?.side ?? "buy", source: "fill" as const };
      });
    const tapeTrades = ticks.slice(-24).reverse().map((tick, index) => ({ id: `tick-${tick.tickTime}-${index}`, time: tick.tickTime, price: tick.last, size: Number((tick.syntheticVolume * (0.92 + index * 0.025)).toFixed(4)), side: tick.aggressorSide, source: "tape" as const }));
    return [...fillTrades, ...tapeTrades].sort((left, right) => new Date(right.time).getTime() - new Date(left.time).getTime()).slice(0, 24);
  }, [state.events, state.market, state.orders, ticks]);

  const activeOrders = useMemo(() => state.orders.filter((order) => order.status === "ACCEPTED" || order.status === "PARTIALLY_FILLED"), [state.orders]);

  const orderValidation = useMemo(() => {
    if (!orderForm.quantity.trim()) return t.contractsRequired;
    if (!Number.isFinite(quantityValue)) return t.contractsValidNumber;
    if (quantityValue <= 0) return t.contractsGreaterThanZero;
    const decimalPart = orderForm.quantity.trim().includes(".") ? orderForm.quantity.trim().split(".")[1] ?? "" : "";
    if (decimalPart.length > quantityDecimals) return t.contractsPrecision.replace("{decimals}", String(quantityDecimals)).replace("{coin}", contractCoin);
    if (tab === "limit") {
      if (!orderForm.limitPrice.trim()) return t.limitPriceRequired;
      if (!Number.isFinite(limitPriceValue) || limitPriceValue <= 0) return t.limitPriceGreaterThanZero;
    }
    return null;
  }, [contractCoin, limitPriceValue, orderForm.limitPrice, orderForm.quantity, quantityDecimals, quantityValue, t, tab]);

  const quantityFieldError = useMemo(() => {
    if (!orderForm.quantity.trim()) return t.enterContracts;
    if (!Number.isFinite(quantityValue)) return t.contractsNumeric;
    if (quantityValue <= 0) return t.contractsGreaterThanZero;
    const decimalPart = orderForm.quantity.trim().includes(".") ? orderForm.quantity.trim().split(".")[1] ?? "" : "";
    if (decimalPart.length > quantityDecimals) return t.maxDecimals.replace("{decimals}", String(quantityDecimals));
    return null;
  }, [orderForm.quantity, quantityDecimals, quantityValue, t]);

  const limitPriceFieldError = useMemo(() => {
    if (tab !== "limit") return null;
    if (!orderForm.limitPrice.trim()) return t.enterLimitPrice;
    if (!Number.isFinite(limitPriceValue) || limitPriceValue <= 0) return t.priceGreaterThanZero;
    return null;
  }, [limitPriceValue, orderForm.limitPrice, t, tab]);

  const pricingPreview = useMemo(() => {
    const marketReferencePrice = side === "buy" ? state.latestTick?.ask : state.latestTick?.bid;
    const price = tab === "limit" ? limitPriceValue : marketReferencePrice;
    const leverage = state.symbolConfig?.leverage ?? leverageDraft;
    if (!Number.isFinite(quantityValue) || quantityValue <= 0 || !price || !Number.isFinite(price) || leverage <= 0) return null;
    const notional = quantityValue * price;
    const estimatedMargin = notional / leverage;
    return { referencePrice: price, notional, estimatedMargin, remainingAvailable: (state.account?.availableBalance ?? 0) - estimatedMargin };
  }, [leverageDraft, limitPriceValue, quantityValue, side, state.account?.availableBalance, state.latestTick?.ask, state.latestTick?.bid, state.symbolConfig?.leverage, tab]);

  const orderError = useMemo(() => {
    if (orderValidation) return orderValidation;
    if (pricingPreview && pricingPreview.estimatedMargin > (state.account?.availableBalance ?? 0)) return t.estimatedMarginExceeds;
    return null;
  }, [orderValidation, pricingPreview, state.account?.availableBalance, t]);

  const orderCheckItems = useMemo(() => {
    const marketReferencePrice = side === "buy" ? state.latestTick?.ask : state.latestTick?.bid;
    return [
      { label: t.contracts, ok: !quantityFieldError, detail: quantityFieldError ?? t.precisionOk.replace("{decimals}", String(quantityDecimals)) },
      {
        label: tab === "limit" ? t.limitPrice : t.referencePrice,
        ok: tab === "limit" ? !limitPriceFieldError : Boolean(marketReferencePrice),
        detail: tab === "limit"
          ? limitPriceFieldError ?? t.readyAt.replace("{price}", fmt(limitPriceValue, priceDigits))
          : marketReferencePrice ? `${side === "buy" ? ui.admin.ask : ui.admin.bid} ${fmt(marketReferencePrice, priceDigits)}` : t.waitingForLiveQuote
      },
      { label: "Margin", ok: Boolean(pricingPreview) && !orderError, detail: pricingPreview ? t.marginRequired.replace("{amount}", fmt(pricingPreview.estimatedMargin, 2)) : t.noEstimateYet }
    ];
  }, [limitPriceFieldError, limitPriceValue, orderError, priceDigits, pricingPreview, quantityDecimals, quantityFieldError, side, state.latestTick?.ask, state.latestTick?.bid, t, tab, ui.admin.ask, ui.admin.bid]);

  const leverageInUse = state.symbolConfig?.leverage ?? leverageDraft;
  const marginUsageRatio = pricingPreview && availableBalance > 0 ? Math.min(pricingPreview.estimatedMargin / availableBalance, 1) : 0;
  const postTradeAvailableRatio = pricingPreview && state.account?.equity ? Math.max(Math.min((pricingPreview.remainingAvailable / state.account.equity) * 100, 100), -100) : 0;
  const referenceTriggerPrice = state.market?.markPrice ?? state.latestTick?.last;

  const advancedOrderError = useMemo(() => {
    const position = state.position;
    if (!position || position.side === "flat" || position.quantity <= 0) return t.advancedPositionRequired;
    if (!advancedForm.takeProfitEnabled && !advancedForm.stopLossEnabled) return t.advancedSelectOne;
    const validateTrigger = (
      enabled: boolean,
      quantityText: string,
      triggerPriceValue: number,
      executionMode: "market" | "limit",
      limitPriceText: string,
      kind: "tp" | "sl"
    ) => {
      if (!enabled) return null;
      const quantityValue = Number(quantityText);
      if (!Number.isFinite(quantityValue) || quantityValue <= 0) {
        return kind === "tp" ? t.takeProfitQuantityRequired : t.stopLossQuantityRequired;
      }
      if (quantityValue > position.quantity) {
        return (kind === "tp" ? t.takeProfitQuantityTooLarge : t.stopLossQuantityTooLarge).replace("{quantity}", fmt(position.quantity, quantityDecimals));
      }
      if (!Number.isFinite(triggerPriceValue) || triggerPriceValue <= 0) return kind === "tp" ? t.takeProfitTriggerRequired : t.stopLossTriggerRequired;
      if (executionMode === "limit") {
        const triggerLimitPriceValue = Number(limitPriceText);
        if (!Number.isFinite(triggerLimitPriceValue) || triggerLimitPriceValue <= 0) return kind === "tp" ? t.takeProfitLimitRequired : t.stopLossLimitRequired;
      }
      if (!referenceTriggerPrice) return null;
      if (position.side === "long") {
        if (kind === "tp" && triggerPriceValue <= referenceTriggerPrice) return t.takeProfitLongDirection.replace("{price}", fmt(referenceTriggerPrice, priceDigits));
        if (kind === "sl" && triggerPriceValue >= referenceTriggerPrice) return t.stopLossLongDirection.replace("{price}", fmt(referenceTriggerPrice, priceDigits));
      }
      if (position.side === "short") {
        if (kind === "tp" && triggerPriceValue >= referenceTriggerPrice) return t.takeProfitShortDirection.replace("{price}", fmt(referenceTriggerPrice, priceDigits));
        if (kind === "sl" && triggerPriceValue <= referenceTriggerPrice) return t.stopLossShortDirection.replace("{price}", fmt(referenceTriggerPrice, priceDigits));
      }
      return null;
    };

    return validateTrigger(advancedForm.takeProfitEnabled, advancedForm.takeProfitQuantity, Number(advancedForm.takeProfitTriggerPrice), advancedForm.takeProfitExecution, advancedForm.takeProfitLimitPrice, "tp")
      ?? validateTrigger(advancedForm.stopLossEnabled, advancedForm.stopLossQuantity, Number(advancedForm.stopLossTriggerPrice), advancedForm.stopLossExecution, advancedForm.stopLossLimitPrice, "sl");
  }, [advancedForm, priceDigits, quantityDecimals, referenceTriggerPrice, state.position, t]);

  const personalFills = useMemo<PersonalFill[]>(() => {
    let runningPositionSide: "long" | "short" | "flat" = "flat";
    let runningQuantity = 0;
    let runningAverageEntryPrice = 0;
    const fills: PersonalFill[] = [];

    fillHistoryEvents.filter((event) => event.eventType === "OrderFilled" || event.eventType === "OrderPartiallyFilled").sort((left, right) => left.sequence - right.sequence).forEach((event) => {
      const payload = event.payload as { orderId: string; fillId: string; fillPrice: number; fillQuantity: number; slippage: number; fee: number; feeRate: number; liquidityRole: "maker" | "taker"; filledAt: string };
      const order = state.orders.find((entry) => entry.id === payload.orderId);
      const orderSide = order?.side ?? "buy";
      const notional = payload.fillPrice * payload.fillQuantity;
      const resolvedFeeRate = Number.isFinite(payload.feeRate) && payload.feeRate > 0 ? payload.feeRate : notional > 0 ? Number((payload.fee / notional).toFixed(8)) : 0;
      const resolvedLiquidityRole = payload.liquidityRole ?? (order?.orderType === "limit" ? "maker" : "taker");
      const entryPrice = runningAverageEntryPrice;
      let realizedPnl = 0;
      const signedPositionQuantity = runningPositionSide === "long" ? runningQuantity : runningPositionSide === "short" ? -runningQuantity : 0;
      const signedFillQuantity = orderSide === "buy" ? payload.fillQuantity : -payload.fillQuantity;
      const nextSignedQuantity = signedPositionQuantity + signedFillQuantity;
      const isClosingFill = signedPositionQuantity !== 0 && Math.sign(signedPositionQuantity) !== Math.sign(signedFillQuantity);

      if (isClosingFill) {
        const closingQuantity = Math.min(Math.abs(signedPositionQuantity), Math.abs(signedFillQuantity));
        if (runningPositionSide === "long" && orderSide === "sell") realizedPnl = Number(((payload.fillPrice - runningAverageEntryPrice) * closingQuantity).toFixed(8));
        else if (runningPositionSide === "short" && orderSide === "buy") realizedPnl = Number(((runningAverageEntryPrice - payload.fillPrice) * closingQuantity).toFixed(8));
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
    });

    return fills.sort((left, right) => new Date(right.filledAt).getTime() - new Date(left.filledAt).getTime());
  }, [fillHistoryEvents, state.orders]);

  useEffect(() => {
    if (state.symbolConfig?.leverage) {
      setLeverageDraft(state.symbolConfig.leverage);
    }
  }, [state.symbolConfig?.leverage]);

  useEffect(() => {
    if (state.symbolConfig?.symbol && state.symbolConfig.symbol !== orderForm.symbol) {
      setOrderForm((current) => ({ ...current, symbol: state.symbolConfig?.symbol ?? current.symbol }));
    }
  }, [orderForm.symbol, state.symbolConfig?.symbol]);

  const refresh = async () => {
    try {
      const snapshot = await fetchDashboardSnapshot(apiBaseUrl, authToken, locale);
      if (snapshot.stateResponse.status === 401 || snapshot.fillHistoryResponse.status === 401 || snapshot.botCredentialsResponse.status === 401) {
        setMessage(ui.trader.sessionExpired);
        onLogout();
        return;
      }
      setState(snapshot.statePayload);
      setFillHistoryEvents(snapshot.fillHistoryPayload.events ?? []);
      setBotCredentials(snapshot.credentialsPayload);
      setMessage("");
    } catch {
      setMessage(ui.trader.failedLoad);
    }
  };

  useEffect(() => {
    void refresh();
    let active = true;
    let socket: WebSocket | null = null;

    const connect = () => {
      if (!active) return;
      socket = new WebSocket(buildWebSocketUrl(apiBaseUrl, authToken));
      socket.addEventListener("message", (event) => {
        const payload = JSON.parse(event.data) as { state?: Partial<State>; events?: AnyEventEnvelope[]; simulator?: State["simulator"]; market?: State["market"]; symbolConfig?: State["symbolConfig"]; platform?: State["platform"] };
        if (!payload.state) return;

        const nextState = payload.state;
        setState((current) => ({
          account: nextState.account ?? current.account,
          orders: nextState.orders ?? current.orders,
          position: nextState.position ?? current.position,
          latestTick: nextState.latestTick ?? current.latestTick,
          events: mergeEvents(current.events, payload.events),
          simulator: payload.simulator ?? current.simulator,
          market: payload.market ?? current.market,
          symbolConfig: payload.symbolConfig ?? current.symbolConfig,
          platform: payload.platform ?? current.platform
        }));

        if (payload.events?.length) {
          const fillEvents = payload.events.filter((event) => event.eventType === "OrderFilled" || event.eventType === "OrderPartiallyFilled");
          setFillHistoryEvents((current) => mergeEvents(current, fillEvents));
        }
      });

      const scheduleReconnect = () => {
        if (!active || reconnectTimerRef.current) return;
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
  }, [apiBaseUrl, authToken, locale]);

  const submitOrder = async () => {
    if (!botCredentials) {
      setMessage("Bot credentials are not available.");
      return;
    }
    const { response, payload } = await submitSignedExchangeRequest({
      apiBaseUrl,
      authToken,
      locale,
      botCredentials,
      body: createSimpleOrderBody({ side, tab, quantity: orderForm.quantity, limitPrice: orderForm.limitPrice, bestBid: state.latestTick?.bid, bestAsk: state.latestTick?.ask, botCredentials })
    });
    if (response.status === 401) {
      setMessage(ui.trader.sessionExpired);
      onLogout();
      return;
    }
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
    const { response, payload } = await submitSignedExchangeRequest({
      apiBaseUrl,
      authToken,
      locale,
      botCredentials,
      body: createCancelOrderBody({ oid: toOid(orderId), botCredentials })
    });
    if (response.status === 401) {
      setMessage(ui.trader.sessionExpired);
      onLogout();
      return;
    }
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
    const { response, payload } = await submitSignedExchangeRequest({
      apiBaseUrl,
      authToken,
      locale,
      botCredentials,
      body: createClosePositionBody({ side: state.position.side === "long" ? "sell" : "buy", quantity: state.position.quantity, bestBid: state.latestTick?.bid, bestAsk: state.latestTick?.ask, botCredentials })
    });
    if (response.status === 401) {
      setMessage(ui.trader.sessionExpired);
      onLogout();
      return;
    }
    setMessage(response.ok ? extractExchangeMessage(payload, "Position close order submitted.") : ui.trader.orderRejected);
    if (response.ok) {
      await refresh();
      setAccountTab("positions");
    }
  };

  const submitAdvancedOrders = async () => {
    if (!botCredentials) {
      setMessage("Bot credentials are not available.");
      return;
    }
    if (advancedOrderError || !state.position || state.position.side === "flat") {
      setMessage(advancedOrderError ?? t.advancedPositionRequired);
      return;
    }
    const { response, payload } = await submitSignedExchangeRequest({
      apiBaseUrl,
      authToken,
      locale,
      botCredentials,
      body: createAdvancedOrdersBody({ form: advancedForm, positionSide: state.position.side, botCredentials })
    });
    if (response.status === 401) {
      setMessage(ui.trader.sessionExpired);
      onLogout();
      return;
    }
    setMessage(response.ok ? extractExchangeMessage(payload, t.advancedOrdersPlaced) : ui.trader.orderRejected);
    if (response.ok) {
      await refresh();
      setAccountTab("openOrders");
    }
  };

  const updateLeverage = async () => {
    const { response, payload } = await updateLeverageRequest({ apiBaseUrl, authToken, locale, symbol: state.symbolConfig?.symbol ?? orderForm.symbol, leverage: leverageDraft });
    if (!response.ok) {
      setMessage(payload.message ?? ui.trader.failedLoad);
      return;
    }
    setMessage(`Leverage updated to ${payload.symbolConfig?.leverage ?? leverageDraft}x.`);
    await refresh();
  };

  return {
    ui,
    t,
    timeframes: TIMEFRAMES,
    state,
    message,
    tab,
    setTab,
    orderPanelMode,
    setOrderPanelMode,
    bookTab,
    setBookTab,
    accountTab,
    setAccountTab,
    tradePanelOpen,
    setTradePanelOpen,
    timeframe,
    setTimeframe,
    side,
    setSide,
    orderForm,
    setOrderForm,
    advancedForm,
    setAdvancedForm,
    leverageDraft,
    setLeverageDraft,
    priceDigits,
    contractCoin,
    quantityDecimals,
    selectedTimeframe,
    availableBalance,
    candles,
    volume,
    stats,
    bookWithDepth,
    trades,
    activeOrders,
    quantityFieldError,
    limitPriceFieldError,
    pricingPreview,
    orderError,
    orderCheckItems,
    leverageInUse,
    marginUsageRatio,
    postTradeAvailableRatio,
    referenceTriggerPrice,
    advancedOrderError,
    personalFills,
    submitOrder,
    cancelOrder,
    closePosition,
    submitAdvancedOrders,
    updateLeverage
  };
};
