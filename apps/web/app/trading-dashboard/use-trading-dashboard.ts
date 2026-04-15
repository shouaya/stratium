"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AnyEventEnvelope } from "@stratium/shared";
import type { CandlestickData, HistogramData, UTCTimestamp } from "lightweight-charts";
import { buildWebSocketUrl } from "../api-base-url";
import { filterCandlesToRecent24Hours } from "../market-window";
import { getUiText } from "../i18n";
import { fetchDashboardSnapshot, fetchOrderActivity, submitSignedExchangeRequest, updateLeverageRequest } from "./api";
import { calculateMarginPreview, createAdvancedOrdersBody, createAdvancedTriggerWireOrder, createCancelOrderBody, createClosePositionBody, createModifyTriggerOrderBody, createOcoOrdersBody, createSimpleOrderBody, hasInsufficientMargin } from "./model";
import type { AdvancedOrderForm, DashboardViewProps, EnrichedTick, FrontendOpenOrder, HistoricalOrder, OcoOrderForm, PersonalFill, State, TickPayload } from "./types";
import { TIMEFRAMES, coinFromSymbol, extractExchangeMessage, fmt, mergeEvents, priceDigitsForSymbol, toOid } from "./utils";

const ORDER_ACTIVITY_REFRESH_EVENT_TYPES = new Set<AnyEventEnvelope["eventType"]>([
  "OrderAccepted",
  "OrderRejected",
  "OrderCanceled",
  "OrderFilled",
  "OrderPartiallyFilled"
]);

export const useTradingDashboard = ({ apiBaseUrl, authToken, locale, onLogout, viewer }: DashboardViewProps) => {
  const ui = getUiText(locale);
  const t = ui.trader;
  const [state, setState] = useState<State>({ account: null, orders: [], position: null, latestTick: null, events: [] });
  const [message, setMessage] = useState("");
  const [fillHistoryEvents, setFillHistoryEvents] = useState<AnyEventEnvelope[]>([]);
  const [botCredentials, setBotCredentials] = useState<any>(null);
  const [tab, setTab] = useState<"market" | "limit">("market");
  const [bookTab, setBookTab] = useState<"book" | "trades">("book");
  const [accountTab, setAccountTab] = useState<"positions" | "openOrders" | "orderHistory" | "fills">("positions");
  const [tradePanelOpen, setTradePanelOpen] = useState(false);
  const [positionTpslPanelOpen, setPositionTpslPanelOpen] = useState(false);
  const [ocoPanelOpen, setOcoPanelOpen] = useState(false);
  const [editingOcoChildren, setEditingOcoChildren] = useState(false);
  const [timeframe, setTimeframe] = useState<"1m" | "5m" | "15m" | "1h">("1m");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [orderForm, setOrderForm] = useState({ symbol: "BTC-USD", quantity: "1", limitPrice: "100" });
  const [frontendOpenOrders, setFrontendOpenOrders] = useState<FrontendOpenOrder[]>([]);
  const [historicalOrders, setHistoricalOrders] = useState<HistoricalOrder[]>([]);
  const [orderHistoryPage, setOrderHistoryPage] = useState(1);
  const [fillsPage, setFillsPage] = useState(1);
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
  const [ocoForm, setOcoForm] = useState<OcoOrderForm>({
    side: "buy",
    parentOrderType: "market",
    quantity: "1",
    limitPrice: "",
    takeProfitEnabled: true,
    takeProfitTriggerPrice: "",
    takeProfitExecution: "market",
    takeProfitLimitPrice: "",
    stopLossEnabled: true,
    stopLossTriggerPrice: "",
    stopLossExecution: "market",
    stopLossLimitPrice: ""
  });
  const [leverageDraft, setLeverageDraft] = useState(10);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activityRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  const openOrderRows = useMemo(() => {
    const standardOrders = activeOrders.map((order) => ({
      id: order.id,
      cancelOid: toOid(order.id),
      side: order.side,
      type: order.orderType,
      quantity: order.quantity,
      filledQuantity: order.filledQuantity,
      status: order.status
    }));

    const triggerOrders = frontendOpenOrders
      .filter((order) => Boolean(order.triggerCondition))
      .map((order) => ({
        id: String(order.oid),
        cancelOid: order.oid,
        side: order.side === "B" ? "buy" : "sell",
        type: order.grouping === "normalTpsl"
          ? `OCO ${order.triggerCondition?.tpsl === "tp" ? t.takeProfitShort : t.stopLossShort}`
          : order.triggerCondition?.tpsl === "tp"
            ? t.takeProfit
            : t.stopLoss,
        quantity: Number(order.origSz),
        filledQuantity: 0,
        status: "triggerPending"
      }));

    return [...standardOrders, ...triggerOrders];
  }, [activeOrders, frontendOpenOrders, t.stopLoss, t.takeProfit, t.takeProfitShort]);

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
    return calculateMarginPreview({
      quantity: quantityValue,
      price,
      leverage,
      availableBalance: state.account?.availableBalance ?? 0
    });
  }, [leverageDraft, limitPriceValue, quantityValue, side, state.account?.availableBalance, state.latestTick?.ask, state.latestTick?.bid, state.symbolConfig?.leverage, tab]);

  const ocoPricingPreview = useMemo(() => {
    const ocoQuantityValue = Number(ocoForm.quantity);
    const marketReferencePrice = ocoForm.side === "buy" ? state.latestTick?.ask : state.latestTick?.bid;
    const parentLimitPrice = Number(ocoForm.limitPrice);
    const price = ocoForm.parentOrderType === "limit" ? parentLimitPrice : marketReferencePrice;
    const leverage = state.symbolConfig?.leverage ?? leverageDraft;
    return calculateMarginPreview({
      quantity: ocoQuantityValue,
      price,
      leverage,
      availableBalance: state.account?.availableBalance ?? 0
    });
  }, [leverageDraft, ocoForm.limitPrice, ocoForm.parentOrderType, ocoForm.quantity, ocoForm.side, state.account?.availableBalance, state.latestTick?.ask, state.latestTick?.bid, state.symbolConfig?.leverage]);

  const orderError = useMemo(() => {
    if (orderValidation) return orderValidation;
    if (hasInsufficientMargin({ preview: pricingPreview, availableBalance: state.account?.availableBalance ?? 0 })) return t.estimatedMarginExceeds;
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
  const latestReferencePrice = side === "buy" ? state.latestTick?.ask : state.latestTick?.bid;
  const ocoReferencePrice = state.market?.markPrice ?? state.latestTick?.last;
  const activeOcoOrders = useMemo(
    () => (Array.isArray(frontendOpenOrders) ? frontendOpenOrders : []).filter((order) =>
      Boolean(order.triggerCondition) && order.grouping === "normalTpsl"
    ),
    [frontendOpenOrders]
  );
  const activePositionTpslOrders = useMemo(
    () => (Array.isArray(frontendOpenOrders) ? frontendOpenOrders : []).filter((order) =>
      Boolean(order.triggerCondition) && (order.grouping === "positionTpsl" || order.cloid?.startsWith("0xtp-") || order.cloid?.startsWith("0xsl-"))
    ),
    [frontendOpenOrders]
  );
  const hasActiveOcoChildren = activeOcoOrders.length > 0;
  const hasPositionTpsl = activePositionTpslOrders.length > 0;
  const ocoTakeProfitOrder = useMemo(() => activeOcoOrders.find((order) => order.triggerCondition?.tpsl === "tp"), [activeOcoOrders]);
  const ocoStopLossOrder = useMemo(() => activeOcoOrders.find((order) => order.triggerCondition?.tpsl === "sl"), [activeOcoOrders]);
  const positionTakeProfitOrder = useMemo(() => activePositionTpslOrders.find((order) => order.triggerCondition?.tpsl === "tp"), [activePositionTpslOrders]);
  const positionStopLossOrder = useMemo(() => activePositionTpslOrders.find((order) => order.triggerCondition?.tpsl === "sl"), [activePositionTpslOrders]);
  const takeProfitOrder = ocoTakeProfitOrder ?? positionTakeProfitOrder;
  const stopLossOrder = ocoStopLossOrder ?? positionStopLossOrder;
  const historyPageSize = 30;

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

  const ocoMarginError = useMemo(() => {
    if (hasInsufficientMargin({ preview: ocoPricingPreview, availableBalance: state.account?.availableBalance ?? 0 })) {
      return t.estimatedMarginExceeds;
    }

    return null;
  }, [ocoPricingPreview, state.account?.availableBalance, t]);

  const ocoOrderError = useMemo(() => {
    if (!ocoForm.quantity.trim()) return t.contractsRequired;

    const ocoQuantityValue = Number(ocoForm.quantity);
    if (!Number.isFinite(ocoQuantityValue)) return t.contractsValidNumber;
    if (ocoQuantityValue <= 0) return t.contractsGreaterThanZero;

    const decimalPart = ocoForm.quantity.trim().includes(".") ? ocoForm.quantity.trim().split(".")[1] ?? "" : "";
    if (decimalPart.length > quantityDecimals) {
      return t.contractsPrecision.replace("{decimals}", String(quantityDecimals)).replace("{coin}", contractCoin);
    }

    if (ocoForm.parentOrderType === "limit") {
      const parentLimitPrice = Number(ocoForm.limitPrice);
      if (!Number.isFinite(parentLimitPrice) || parentLimitPrice <= 0) return t.limitPriceGreaterThanZero;
    }

    if (!ocoForm.takeProfitEnabled && !ocoForm.stopLossEnabled) {
      return t.advancedSelectOne;
    }

    const takeProfitTriggerPrice = Number(ocoForm.takeProfitTriggerPrice);
    const stopLossTriggerPrice = Number(ocoForm.stopLossTriggerPrice);

    if (ocoForm.takeProfitEnabled && (!Number.isFinite(takeProfitTriggerPrice) || takeProfitTriggerPrice <= 0)) return t.takeProfitTriggerRequired;
    if (ocoForm.stopLossEnabled && (!Number.isFinite(stopLossTriggerPrice) || stopLossTriggerPrice <= 0)) return t.stopLossTriggerRequired;

    if (ocoForm.takeProfitEnabled && ocoForm.stopLossEnabled && takeProfitTriggerPrice === stopLossTriggerPrice) {
      return t.ocoDistinctTriggers;
    }

    if (ocoReferencePrice) {
      if (ocoForm.side === "buy") {
        if (ocoForm.takeProfitEnabled && takeProfitTriggerPrice <= ocoReferencePrice) return t.takeProfitLongDirection.replace("{price}", fmt(ocoReferencePrice, priceDigits));
        if (ocoForm.stopLossEnabled && stopLossTriggerPrice >= ocoReferencePrice) return t.stopLossLongDirection.replace("{price}", fmt(ocoReferencePrice, priceDigits));
      }

      if (ocoForm.side === "sell") {
        if (ocoForm.takeProfitEnabled && takeProfitTriggerPrice >= ocoReferencePrice) return t.takeProfitShortDirection.replace("{price}", fmt(ocoReferencePrice, priceDigits));
        if (ocoForm.stopLossEnabled && stopLossTriggerPrice <= ocoReferencePrice) return t.stopLossShortDirection.replace("{price}", fmt(ocoReferencePrice, priceDigits));
      }
    }

    if (ocoForm.takeProfitEnabled && ocoForm.takeProfitExecution === "limit") {
      const takeProfitLimitPrice = Number(ocoForm.takeProfitLimitPrice);
      if (!Number.isFinite(takeProfitLimitPrice) || takeProfitLimitPrice <= 0) return t.takeProfitLimitRequired;
    }

    if (ocoForm.stopLossEnabled && ocoForm.stopLossExecution === "limit") {
      const stopLossLimitPrice = Number(ocoForm.stopLossLimitPrice);
      if (!Number.isFinite(stopLossLimitPrice) || stopLossLimitPrice <= 0) return t.stopLossLimitRequired;
    }

    if (ocoMarginError) return ocoMarginError;

    return null;
  }, [contractCoin, ocoForm, ocoMarginError, ocoReferencePrice, priceDigits, quantityDecimals, t]);

  const ocoCheckItems = useMemo(() => {
    const marketReferencePrice = ocoForm.side === "buy" ? state.latestTick?.ask : state.latestTick?.bid;
    const parentLimitPrice = Number(ocoForm.limitPrice);
    const quantityText = ocoForm.quantity.trim();
    const quantityNumber = Number(ocoForm.quantity);
    const quantityDecimalPart = quantityText.includes(".") ? quantityText.split(".")[1] ?? "" : "";
    const quantityError = !quantityText
      ? t.enterContracts
      : !Number.isFinite(quantityNumber)
        ? t.contractsNumeric
        : quantityNumber <= 0
          ? t.contractsGreaterThanZero
          : quantityDecimalPart.length > quantityDecimals
            ? t.maxDecimals.replace("{decimals}", String(quantityDecimals))
            : null;
    const priceError = ocoForm.parentOrderType !== "limit"
      ? null
      : !ocoForm.limitPrice.trim()
        ? t.enterLimitPrice
        : !Number.isFinite(parentLimitPrice) || parentLimitPrice <= 0
          ? t.priceGreaterThanZero
          : null;

    return [
      { label: t.contracts, ok: !quantityError, detail: quantityError ?? t.precisionOk.replace("{decimals}", String(quantityDecimals)) },
      {
        label: ocoForm.parentOrderType === "limit" ? t.limitPrice : t.referencePrice,
        ok: ocoForm.parentOrderType === "limit" ? !priceError : Boolean(marketReferencePrice),
        detail: ocoForm.parentOrderType === "limit"
          ? priceError ?? t.readyAt.replace("{price}", fmt(parentLimitPrice, priceDigits))
          : marketReferencePrice ? `${ocoForm.side === "buy" ? ui.admin.ask : ui.admin.bid} ${fmt(marketReferencePrice, priceDigits)}` : t.waitingForLiveQuote
      },
      { label: "Margin", ok: Boolean(ocoPricingPreview) && !ocoMarginError, detail: ocoPricingPreview ? t.marginRequired.replace("{amount}", fmt(ocoPricingPreview.estimatedMargin, 2)) : t.noEstimateYet }
    ];
  }, [ocoForm.limitPrice, ocoForm.parentOrderType, ocoForm.quantity, ocoForm.side, ocoMarginError, ocoPricingPreview, priceDigits, quantityDecimals, state.latestTick?.ask, state.latestTick?.bid, t, ui.admin.ask, ui.admin.bid]);

  const ocoMarginUsageRatio = ocoPricingPreview && availableBalance > 0 ? Math.min(ocoPricingPreview.estimatedMargin / availableBalance, 1) : 0;
  const ocoPostTradeAvailableRatio = ocoPricingPreview && state.account?.equity ? Math.max(Math.min((ocoPricingPreview.remainingAvailable / state.account.equity) * 100, 100), -100) : 0;

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
      const closesPosition = signedPositionQuantity !== 0
        && (nextSignedQuantity === 0 || Math.sign(nextSignedQuantity) !== Math.sign(signedPositionQuantity));

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
        realizedPnl,
        closesPosition
      });
    });

    return fills.sort((left, right) => new Date(right.filledAt).getTime() - new Date(left.filledAt).getTime());
  }, [fillHistoryEvents, state.orders]);

  const orderHistoryPageCount = Math.max(1, Math.ceil(historicalOrders.length / historyPageSize));
  const fillsPageCount = Math.max(1, Math.ceil(personalFills.length / historyPageSize));
  const pagedHistoricalOrders = useMemo(
    () => historicalOrders.slice((orderHistoryPage - 1) * historyPageSize, orderHistoryPage * historyPageSize),
    [historicalOrders, orderHistoryPage]
  );
  const pagedPersonalFills = useMemo(
    () => personalFills.slice((fillsPage - 1) * historyPageSize, fillsPage * historyPageSize),
    [fillsPage, personalFills]
  );

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

  useEffect(() => {
    if (!state.position || state.position.side === "flat" || state.position.quantity <= 0) {
      setPositionTpslPanelOpen(false);
    }
  }, [state.position]);

  useEffect(() => {
    setOrderHistoryPage((current) => Math.min(current, orderHistoryPageCount));
  }, [orderHistoryPageCount]);

  useEffect(() => {
    setFillsPage((current) => Math.min(current, fillsPageCount));
  }, [fillsPageCount]);

  const refresh = async () => {
    try {
      const snapshot = await fetchDashboardSnapshot(apiBaseUrl, authToken, locale, viewer.tradingAccountId);
      if (snapshot.stateResponse.status === 401 || snapshot.fillHistoryResponse.status === 401 || snapshot.botCredentialsResponse.status === 401 || snapshot.openOrdersResponse.status === 401 || snapshot.orderHistoryResponse.status === 401) {
        setMessage(ui.trader.sessionExpired);
        onLogout();
        return;
      }
      if (snapshot.stateResponse.status === 503 || snapshot.fillHistoryResponse.status === 503 || snapshot.botCredentialsResponse.status === 503 || snapshot.openOrdersResponse.status === 503 || snapshot.orderHistoryResponse.status === 503) {
        const maintenanceMessage = (snapshot.statePayload as { message?: string })?.message
          ?? (snapshot.fillHistoryPayload as { message?: string })?.message
          ?? ui.trader.maintenanceBanner;
        setState((current) => ({
          ...current,
          platform: current.platform
            ? {
              ...current.platform,
              maintenanceMode: true
            }
            : {
              platformName: "",
              platformAnnouncement: "",
              activeExchange: "hyperliquid",
              activeSymbol: "",
              maintenanceMode: true,
              allowFrontendTrading: false,
              allowManualTicks: false,
              allowSimulatorControl: false
            }
        }));
        setMessage(maintenanceMessage);
        return;
      }
      setState(snapshot.statePayload);
      setFillHistoryEvents(snapshot.fillHistoryPayload.events ?? []);
      setBotCredentials(snapshot.credentialsPayload);
      setFrontendOpenOrders(snapshot.openOrdersPayload);
      setHistoricalOrders(snapshot.orderHistoryPayload);
      setMessage("");
    } catch {
      setMessage(ui.trader.failedLoad);
    }
  };

  const refreshOrderActivity = async () => {
    try {
      const activity = await fetchOrderActivity(apiBaseUrl, authToken, locale, viewer.tradingAccountId);
      if (activity.openOrdersResponse.status === 401 || activity.orderHistoryResponse.status === 401) {
        setMessage(ui.trader.sessionExpired);
        onLogout();
        return;
      }
      if (activity.openOrdersResponse.status === 503 || activity.orderHistoryResponse.status === 503) {
        setMessage(ui.trader.maintenanceBanner);
        return;
      }
      setFrontendOpenOrders(activity.openOrdersPayload);
      setHistoricalOrders(activity.orderHistoryPayload);
    } catch {
      // Keep the current view and let the next refresh retry.
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
          const requiresActivityRefresh = payload.events.some((event) => ORDER_ACTIVITY_REFRESH_EVENT_TYPES.has(event.eventType));
          if (requiresActivityRefresh && !activityRefreshTimerRef.current) {
            activityRefreshTimerRef.current = setTimeout(() => {
              activityRefreshTimerRef.current = null;
              void refreshOrderActivity();
            }, 150);
          }
        }
      });

      const scheduleReconnect = () => {
        if (!active || reconnectTimerRef.current) return;
        setMessage((current) => current || ui.trader.maintenanceBanner);
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
      if (activityRefreshTimerRef.current) {
        clearTimeout(activityRefreshTimerRef.current);
        activityRefreshTimerRef.current = null;
      }
      socket?.close();
    };
  }, [apiBaseUrl, authToken, locale, viewer.tradingAccountId]);

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

  const cancelOrder = async (target: string | number) => {
    if (!botCredentials) {
      setMessage("Bot credentials are not available.");
      return;
    }
    const oid = typeof target === "number" ? target : toOid(target);
    const { response, payload } = await submitSignedExchangeRequest({
      apiBaseUrl,
      authToken,
      locale,
      botCredentials,
      body: createCancelOrderBody({ oid, botCredentials })
    });
    if (response.status === 401) {
      setMessage(ui.trader.sessionExpired);
      onLogout();
      return;
    }
    setMessage(response.ok ? extractExchangeMessage(payload, `Order ${target} canceled.`) : ui.trader.orderRejected);
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
      setPositionTpslPanelOpen(false);
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

  const selectOrderType = (nextTab: "market" | "limit") => {
    setTab(nextTab);
    if (nextTab !== "limit" || !latestReferencePrice || !Number.isFinite(latestReferencePrice)) {
      return;
    }
    setOrderForm((current) => ({
      ...current,
      limitPrice: latestReferencePrice.toFixed(priceDigits)
    }));
  };

  const openPositionTpslPanel = () => {
    if (!state.position || state.position.side === "flat" || state.position.quantity <= 0) {
      setMessage(t.advancedPositionRequired);
      return;
    }
    const managedTakeProfitOrder = hasActiveOcoChildren ? ocoTakeProfitOrder : positionTakeProfitOrder;
    const managedStopLossOrder = hasActiveOcoChildren ? ocoStopLossOrder : positionStopLossOrder;
    const quantityText = fmt(state.position.quantity, quantityDecimals);
    setEditingOcoChildren(hasActiveOcoChildren);
    setAdvancedForm({
      takeProfitEnabled: Boolean(managedTakeProfitOrder),
      takeProfitQuantity: managedTakeProfitOrder?.origSz ?? quantityText,
      takeProfitTriggerPrice: managedTakeProfitOrder?.triggerCondition?.triggerPx ?? "",
      takeProfitExecution: managedTakeProfitOrder?.triggerCondition?.isMarket ? "market" : "limit",
      takeProfitLimitPrice: managedTakeProfitOrder && !managedTakeProfitOrder.triggerCondition?.isMarket ? managedTakeProfitOrder.limitPx : "",
      stopLossEnabled: Boolean(managedStopLossOrder),
      stopLossQuantity: managedStopLossOrder?.origSz ?? quantityText,
      stopLossTriggerPrice: managedStopLossOrder?.triggerCondition?.triggerPx ?? "",
      stopLossExecution: managedStopLossOrder?.triggerCondition?.isMarket ? "market" : "limit",
      stopLossLimitPrice: managedStopLossOrder && !managedStopLossOrder.triggerCondition?.isMarket ? managedStopLossOrder.limitPx : ""
    });
    setOcoPanelOpen(false);
    setPositionTpslPanelOpen(true);
  };

  const openOcoPanel = () => {
    setOcoForm((current) => ({
      ...current,
      side,
      parentOrderType: tab,
      quantity: orderForm.quantity.trim() ? orderForm.quantity : current.quantity,
      limitPrice: tab === "limit"
        ? orderForm.limitPrice
        : latestReferencePrice && Number.isFinite(latestReferencePrice)
          ? latestReferencePrice.toFixed(priceDigits)
          : current.limitPrice
    }));
    setEditingOcoChildren(false);
    setTradePanelOpen(false);
    setPositionTpslPanelOpen(false);
    setOcoPanelOpen(true);
  };

  const cancelPositionTpsl = async (kind: "tp" | "sl") => {
    const target = kind === "tp"
      ? (editingOcoChildren ? ocoTakeProfitOrder : positionTakeProfitOrder)
      : (editingOcoChildren ? ocoStopLossOrder : positionStopLossOrder);
    if (!botCredentials || !target) {
      return;
    }
    const { response, payload } = await submitSignedExchangeRequest({
      apiBaseUrl,
      authToken,
      locale,
      botCredentials,
      body: createCancelOrderBody({ oid: target.oid, botCredentials })
    });
    if (response.status === 401) {
      setMessage(ui.trader.sessionExpired);
      onLogout();
      return;
    }
    setMessage(response.ok ? extractExchangeMessage(payload, `${kind.toUpperCase()} canceled.`) : ui.trader.orderRejected);
    if (response.ok) {
      await refresh();
    }
  };

  const submitPositionTpsl = async () => {
    if (!botCredentials) {
      setMessage("Bot credentials are not available.");
      return;
    }
    if (advancedOrderError || !state.position || state.position.side === "flat") {
      setMessage(advancedOrderError ?? t.advancedPositionRequired);
      return;
    }

    const currentTakeProfitOrder = editingOcoChildren ? ocoTakeProfitOrder : positionTakeProfitOrder;
    const currentStopLossOrder = editingOcoChildren ? ocoStopLossOrder : positionStopLossOrder;

    if (editingOcoChildren) {
      if ((!currentTakeProfitOrder && advancedForm.takeProfitEnabled) || (!currentStopLossOrder && advancedForm.stopLossEnabled)) {
        setMessage(t.ocoChildCreateUnsupported);
        return;
      }
    }

    const requests: Array<Record<string, unknown>> = [];
    const nextTakeProfitOrder = createAdvancedTriggerWireOrder({
      kind: "tp",
      enabled: advancedForm.takeProfitEnabled,
      quantity: advancedForm.takeProfitQuantity,
      triggerPrice: advancedForm.takeProfitTriggerPrice,
      execution: advancedForm.takeProfitExecution,
      limitPrice: advancedForm.takeProfitLimitPrice,
      positionSide: state.position.side,
      clientOrderId: currentTakeProfitOrder?.cloid
    });
    const nextStopLossOrder = createAdvancedTriggerWireOrder({
      kind: "sl",
      enabled: advancedForm.stopLossEnabled,
      quantity: advancedForm.stopLossQuantity,
      triggerPrice: advancedForm.stopLossTriggerPrice,
      execution: advancedForm.stopLossExecution,
      limitPrice: advancedForm.stopLossLimitPrice,
      positionSide: state.position.side,
      clientOrderId: currentStopLossOrder?.cloid
    });

    if (currentTakeProfitOrder && !advancedForm.takeProfitEnabled) {
      requests.push(createCancelOrderBody({ oid: currentTakeProfitOrder.oid, botCredentials }));
    } else if (nextTakeProfitOrder) {
      requests.push(currentTakeProfitOrder
        ? createModifyTriggerOrderBody({ oid: currentTakeProfitOrder.oid, order: nextTakeProfitOrder, botCredentials })
        : {
          action: { type: "order", orders: [nextTakeProfitOrder], grouping: "positionTpsl" },
          nonce: Date.now(),
          vaultAddress: botCredentials.vaultAddress
        });
    }

    if (currentStopLossOrder && !advancedForm.stopLossEnabled) {
      requests.push(createCancelOrderBody({ oid: currentStopLossOrder.oid, botCredentials }));
    } else if (nextStopLossOrder) {
      requests.push(currentStopLossOrder
        ? createModifyTriggerOrderBody({ oid: currentStopLossOrder.oid, order: nextStopLossOrder, botCredentials })
        : {
          action: { type: "order", orders: [nextStopLossOrder], grouping: "positionTpsl" },
          nonce: Date.now() + 1,
          vaultAddress: botCredentials.vaultAddress
        });
    }

    if (requests.length === 0) {
      setMessage(editingOcoChildren ? t.ocoChildCreateUnsupported : t.advancedSelectOne);
      return;
    }

    for (const body of requests) {
      const { response, payload } = await submitSignedExchangeRequest({
        apiBaseUrl,
        authToken,
        locale,
        botCredentials,
        body
      });
      if (response.status === 401) {
        setMessage(ui.trader.sessionExpired);
        onLogout();
        return;
      }
      if (!response.ok) {
        setMessage(ui.trader.orderRejected);
        return;
      }
      const fallbackMessage = editingOcoChildren ? t.ocoChildrenUpdated : t.advancedOrdersPlaced;
      const messageText = extractExchangeMessage(payload, fallbackMessage);
      if (messageText && messageText !== fallbackMessage) {
        setMessage(messageText);
        return;
      }
    }

    setMessage(editingOcoChildren ? t.ocoChildrenUpdated : t.advancedOrdersPlaced);
    await refresh();
    setAccountTab("openOrders");
    setPositionTpslPanelOpen(false);
  };

  const submitOcoOrders = async () => {
    if (!botCredentials) {
      setMessage("Bot credentials are not available.");
      return;
    }

    if (ocoOrderError) {
      setMessage(ocoOrderError);
      return;
    }

    const { response, payload } = await submitSignedExchangeRequest({
      apiBaseUrl,
      authToken,
      locale,
      botCredentials,
      body: createOcoOrdersBody({
        form: ocoForm,
        bestBid: state.latestTick?.bid,
        bestAsk: state.latestTick?.ask,
        botCredentials
      })
    });
    if (response.status === 401) {
      setMessage(ui.trader.sessionExpired);
      onLogout();
      return;
    }

    setMessage(response.ok ? extractExchangeMessage(payload, t.ocoOrdersPlaced) : ui.trader.orderRejected);
    if (response.ok) {
      await refresh();
      setAccountTab("openOrders");
      setOcoPanelOpen(false);
    }
  };

  return {
    ui,
    t,
    authToken,
    timeframes: TIMEFRAMES,
    state,
    message,
    tab,
    setTab,
    selectOrderType,
    bookTab,
    setBookTab,
    accountTab,
    setAccountTab,
    tradePanelOpen,
    setTradePanelOpen,
    positionTpslPanelOpen,
    setPositionTpslPanelOpen,
    ocoPanelOpen,
    setOcoPanelOpen,
    timeframe,
    setTimeframe,
    side,
    setSide,
    orderForm,
    setOrderForm,
    advancedForm,
    setAdvancedForm,
    ocoForm,
    setOcoForm,
    frontendOpenOrders,
    historicalOrders,
    pagedHistoricalOrders,
    orderHistoryPage,
    setOrderHistoryPage,
    orderHistoryPageCount,
    pagedPersonalFills,
    fillsPage,
    setFillsPage,
    fillsPageCount,
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
    openOrderRows,
    quantityFieldError,
    limitPriceFieldError,
    pricingPreview,
    ocoPricingPreview,
    orderError,
    orderCheckItems,
    ocoCheckItems,
    leverageInUse,
    marginUsageRatio,
    postTradeAvailableRatio,
    ocoMarginUsageRatio,
    ocoPostTradeAvailableRatio,
    referenceTriggerPrice,
    advancedOrderError,
    ocoMarginError,
    ocoReferencePrice,
    ocoOrderError,
    activePositionTpslOrders,
    activeOcoOrders,
    hasActiveOcoChildren,
    hasPositionTpsl,
    editingOcoChildren,
    takeProfitOrder,
    stopLossOrder,
    personalFills,
    submitOrder,
    cancelOrder,
    closePosition,
    submitAdvancedOrders,
    submitPositionTpsl,
    submitOcoOrders,
    updateLeverage,
    openPositionTpslPanel,
    openOcoPanel,
    cancelPositionTpsl
  };
};
