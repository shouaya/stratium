"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { AccountView, EventEnvelope, OrderView, PositionView } from "@stratium/shared";
import type { CandlestickData, HistogramData, UTCTimestamp } from "lightweight-charts";
import { CandlestickChart } from "./candlestick-chart";

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
  events: EventEnvelope<unknown>[];
  simulator?: MarketSimulatorState;
  market?: MarketState;
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
const clock = (s?: string) => s ? new Date(s).toLocaleTimeString("en-US", { hour12: false }) : "--:--:--";
const priceDigitsForSymbol = (symbol?: string | null) => symbol?.startsWith("BTC-") ? 0 : 4;
const ghostLinkStyle: React.CSSProperties = {
  border: "1px solid #253740",
  background: "#111d24",
  color: "#dce7ee",
  padding: "10px 14px",
  borderRadius: 10,
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center"
};

const mergeEvents = (currentEvents: EventEnvelope<unknown>[], nextEvents: EventEnvelope<unknown>[] = []) => {
  if (nextEvents.length === 0) {
    return currentEvents;
  }

  const merged = new Map(currentEvents.map((event) => [event.eventId, event]));

  for (const event of nextEvents) {
    merged.set(event.eventId, event);
  }

  return [...merged.values()].sort((left, right) => left.sequence - right.sequence);
};

export function TradingDashboard({ apiBaseUrl }: { apiBaseUrl: string }) {
  const [state, setState] = useState<State>({ account: null, orders: [], position: null, latestTick: null, events: [] });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState<"market" | "limit">("market");
  const [bookTab, setBookTab] = useState<"book" | "trades">("book");
  const [timeframe, setTimeframe] = useState<TimeframeId>("1m");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [orderForm, setOrderForm] = useState({ accountId: "paper-account-1", symbol: "BTC-USD", quantity: "1", limitPrice: "100" });
  const priceDigits = useMemo(() => priceDigitsForSymbol(orderForm.symbol), [orderForm.symbol]);
  const selectedTimeframe = useMemo(
    () => TIMEFRAMES.find((entry) => entry.id === timeframe) ?? TIMEFRAMES[0],
    [timeframe]
  );

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
  const candles = useMemo(() => {
    if (state.market && state.market.candles.length > 0) {
      const map = new Map<number, CandlestickData<UTCTimestamp>>();

      for (const candle of state.market.candles) {
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
  }, [selectedTimeframe.bucketMs, ticks]);
  const volume = useMemo(() => {
    if (state.market && state.market.candles.length > 0) {
      const map = new Map<number, HistogramData<UTCTimestamp>>();

      for (const candle of state.market.candles) {
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
  }, [selectedTimeframe.bucketMs, ticks]);
  const stats = useMemo(() => {
    if (state.market?.assetCtx) {
      const reference = state.market.assetCtx.prevDayPrice ?? state.market.candles[0]?.open;
      const last = state.market.assetCtx.markPrice ?? state.market.markPrice ?? state.latestTick?.last;
      const change = last && reference ? ((last - reference) / reference) * 100 : undefined;
      const candleHigh = state.market.candles.length > 0 ? Math.max(...state.market.candles.map((candle) => candle.high)) : undefined;
      const candleLow = state.market.candles.length > 0 ? Math.min(...state.market.candles.map((candle) => candle.low)) : undefined;

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
  }, [ticks]);
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

  useEffect(() => {
    void refresh();
    const ws = new WebSocket(`${apiBaseUrl.replace(/^http/, "ws")}/ws`);
    ws.addEventListener("message", (event) => {
      const payload = JSON.parse(event.data) as { state?: Partial<State>; events?: EventEnvelope<unknown>[]; simulator?: MarketSimulatorState; market?: MarketState };
      if (payload.state) {
        const nextState = payload.state;
        setState((cur) => ({
          account: nextState.account ?? cur.account,
          orders: nextState.orders ?? cur.orders,
          position: nextState.position ?? cur.position,
          latestTick: nextState.latestTick ?? cur.latestTick,
          events: mergeEvents(cur.events, payload.events),
          simulator: payload.simulator ?? cur.simulator,
          market: payload.market ?? cur.market
        }));
      }
    });
    return () => ws.close();
  }, [apiBaseUrl]);

  const refresh = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/state`, { cache: "no-store" });
      const payload = await response.json() as State;
      setState(payload);
      setMessage("");
    } catch {
      setMessage("Failed to fetch API state.");
    } finally {
      setLoading(false);
    }
  };

  const submitOrder = async () => {
    const response = await fetch(`${apiBaseUrl}/api/orders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: orderForm.accountId, symbol: orderForm.symbol, side, orderType: tab, quantity: Number(orderForm.quantity), limitPrice: tab === "limit" ? Number(orderForm.limitPrice) : undefined }) });
    setMessage(response.ok ? "Order submitted." : "Failed to submit order.");
  };

  const cancelOrder = async (orderId: string) => {
    const response = await fetch(`${apiBaseUrl}/api/orders/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: orderForm.accountId, orderId }) });
    setMessage(response.ok ? `Order ${orderId} canceled.` : "Failed to cancel order.");
  };

  return (
    <main style={{ minHeight: "100vh", background: "#071116", color: "#dbe7ef", padding: 8, fontFamily: "\"Segoe UI\", sans-serif" }}>
      <div style={{ display: "grid", gap: 8 }}>
        <div style={box("12px 16px")}>
          <div style={{ display: "grid", gridTemplateColumns: "260px 1fr auto", gap: 16, alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 30, fontWeight: 700 }}>{orderForm.symbol}</div>
              <div style={{ color: "#7e97a5", fontSize: 12 }}>PH1 simulated perpetual market</div>
            </div>
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
              <Metric label="Price" value={fmt(stats.last, priceDigits)} strong />
              <Metric label="24h Change" value={`${fmt(stats.change, 2)}%`} tone={stats.change && stats.change < 0 ? "down" : "up"} />
              <Metric label="24h Low" value={fmt(stats.low, priceDigits)} />
              <Metric label="24h High" value={fmt(stats.high, priceDigits)} />
              <Metric label="Mark" value={fmt(state.market?.assetCtx?.markPrice ?? state.market?.markPrice, priceDigits)} />
              <Metric label="Oracle" value={fmt(state.market?.assetCtx?.oraclePrice, priceDigits)} />
              <Metric label="Funding" value={state.market?.assetCtx?.fundingRate != null ? `${fmt(state.market.assetCtx.fundingRate * 100, 4)}%` : "-"} />
              <Metric label="OI" value={fmt(state.market?.assetCtx?.openInterest, 3)} />
              <Metric label="24h Volume" value={fmt(state.market?.assetCtx?.dayNotionalVolume, 2)} />
              <Metric label="Clock" value={clock(state.latestTick?.tickTime)} />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Link href="/admin" style={ghostLinkStyle}>Admin UI</Link>
              <button onClick={() => void refresh()} style={btnGhost}>{loading ? "Syncing" : "Refresh"}</button>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.8fr) minmax(300px,360px) minmax(300px,360px)", gap: 8 }}>
          <div style={{ display: "grid", gap: 8 }}>
            <div style={box()}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid #16262f", color: "#7e97a5", fontSize: 12 }}>
                <div style={{ display: "flex", gap: 10 }}>
                  {TIMEFRAMES.map((entry) => (
                    <button key={entry.id} onClick={() => setTimeframe(entry.id)} style={chipButton(timeframe === entry.id)} title={entry.hint}>
                      {entry.label}
                    </button>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 12 }}><span>Indicators</span><span>Drawing</span><span>Layout</span></div>
              </div>
              <div style={{ padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 700 }}>{orderForm.symbol} Perp</div>
                    <div style={{ color: "#7e97a5", fontSize: 12 }}>{message || `Ready · ${selectedTimeframe.label} mode · ${state.market?.connected ? "Hyperliquid" : "Synthetic fallback"}`}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ color: stats.change && stats.change < 0 ? "#f87171" : "#2dd4bf", fontSize: 22, fontWeight: 700 }}>{fmt(stats.last, priceDigits)}</div>
                    <div style={{ color: "#7e97a5", fontSize: 12 }}>
                      Spread {fmt(state.latestTick?.spread, 4)} · {state.market?.connected ? "Hyperliquid live" : state.simulator?.enabled ? "simulator live" : "paused"} · {selectedTimeframe.hint}
                    </div>
                  </div>
                </div>
                <CandlestickChart data={candles} volumeData={volume} dark priceDigits={priceDigits} />
              </div>
            </div>

            <div style={box()}>
              <div style={{ display: "flex", gap: 4, padding: "0 10px", borderBottom: "1px solid #16262f" }}>
                <TabButton active label="Balances" />
                <TabButton active={false} label="Positions" />
                <TabButton active label="Open Orders" />
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: "#7e97a5", textAlign: "left" }}>
                      <th style={th}>Order</th><th style={th}>Side</th><th style={th}>Type</th><th style={th}>Qty</th><th style={th}>Filled</th><th style={th}>Status</th><th style={th}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.orders.length === 0 ? <tr><td colSpan={7} style={{ padding: 18, color: "#60727f", textAlign: "center" }}>No orders yet.</td></tr> : state.orders.map((order) => (
                      <tr key={order.id} style={{ borderTop: "1px solid #13212a" }}>
                        <td style={td}>{order.id}</td>
                        <td style={{ ...td, color: order.side === "buy" ? "#2dd4bf" : "#f87171" }}>{order.side}</td>
                        <td style={td}>{order.orderType}</td>
                        <td style={td}>{fmt(order.quantity)}</td>
                        <td style={td}>{fmt(order.filledQuantity)}</td>
                        <td style={td}>{order.status}</td>
                        <td style={td}>{order.status === "ACCEPTED" || order.status === "PARTIALLY_FILLED" ? <button onClick={() => void cancelOrder(order.id)} style={btnInline}>Cancel</button> : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div style={box()}>
            <div style={{ display: "flex", gap: 2, padding: 10, borderBottom: "1px solid #16262f" }}>
              <button onClick={() => setBookTab("book")} style={bookTab === "book" ? tabActive : tabIdle}>Order Book</button>
              <button onClick={() => setBookTab("trades")} style={bookTab === "trades" ? tabActive : tabIdle}>Trades</button>
            </div>
            {bookTab === "book" ? (
              <div style={{ padding: 14 }}>
                <div style={bookHead}><span>Price</span><span>Size</span><span>Total</span></div>
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
                <div style={{ display: "flex", justifyContent: "space-between", margin: "10px 0", padding: "8px 10px", borderRadius: 8, background: "#10222c" }}><span>Spread</span><strong>{fmt(state.latestTick?.spread, 4)}</strong></div>
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
                <div style={bookHead}><span>Time</span><span>Price</span><span>Size</span></div>
                {trades.length === 0 ? <div style={{ color: "#60727f" }}>No trades yet.</div> : trades.map((trade) => {
                  return <div key={trade.id} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, opacity: trade.source === "tape" ? 0.84 : 1 }}><span>{clock(trade.time)}</span><strong style={{ color: trade.side === "sell" ? "#f87171" : "#2dd4bf" }}>{fmt(trade.price, priceDigits)}</strong><span>{fmt(trade.size, 4)}</span></div>;
                })}
              </div>
            )}
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <div style={box()}>
              <div style={{ display: "flex", gap: 2, padding: 10, borderBottom: "1px solid #16262f" }}>
                <button onClick={() => setTab("market")} style={tab === "market" ? tabActive : tabIdle}>Market</button>
                <button onClick={() => setTab("limit")} style={tab === "limit" ? tabActive : tabIdle}>Limit</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, padding: "0 14px 14px" }}>
                <button onClick={() => setSide("buy")} style={side === "buy" ? btnBuyActive : btnSide}>Buy</button>
                <button onClick={() => setSide("sell")} style={side === "sell" ? btnSellActive : btnSide}>Sell</button>
              </div>
              <div style={{ padding: "0 14px 14px", display: "grid", gap: 12 }}>
                <Line label="Available" value={`${fmt(state.account?.availableBalance, 2)} USDT`} />
                <Line label="Rolling Market" value={state.simulator?.enabled ? `Running · ${state.simulator.intervalMs}ms` : "Stopped"} />
                <Line label="Mark Price" value={fmt(state.market?.assetCtx?.markPrice ?? state.market?.markPrice, priceDigits)} />
                <Line label="Oracle Price" value={fmt(state.market?.assetCtx?.oraclePrice, priceDigits)} />
                <Line label="Funding" value={state.market?.assetCtx?.fundingRate != null ? `${fmt(state.market.assetCtx.fundingRate * 100, 4)}%` : "-"} />
                <Line label="24h Notional" value={fmt(state.market?.assetCtx?.dayNotionalVolume, 2)} />
                <Field label="Account" value={orderForm.accountId} onChange={(v) => setOrderForm((s) => ({ ...s, accountId: v }))} />
                <Field label="Symbol" value={orderForm.symbol} onChange={(v) => setOrderForm((s) => ({ ...s, symbol: v }))} />
                <Field label="Size" value={orderForm.quantity} onChange={(v) => setOrderForm((s) => ({ ...s, quantity: v }))} />
                {tab === "limit" && <Field label="Limit Price" value={orderForm.limitPrice} onChange={(v) => setOrderForm((s) => ({ ...s, limitPrice: v }))} />}
                <button onClick={() => void submitOrder()} style={side === "buy" ? btnBuySubmit : btnSellSubmit}>{side === "buy" ? "Buy" : "Sell"} {orderForm.symbol}</button>
                <Link href="/admin" style={ghostLinkStyle}>Open Admin Controls</Link>
              </div>
            </div>

            <div style={box()}>
              <div style={{ padding: "12px 14px", borderBottom: "1px solid #16262f", fontWeight: 700 }}>Account Equity</div>
              <div style={{ padding: 14, display: "grid", gap: 10 }}>
                <Line label="Wallet" value={`${fmt(state.account?.walletBalance, 2)} USDT`} />
                <Line label="Equity" value={`${fmt(state.account?.equity, 2)} USDT`} />
                <Line label="Position Margin" value={`${fmt(state.account?.positionMargin, 2)} USDT`} />
                <Line label="Position" value={state.position?.side ?? "flat"} />
                <Line label="Entry Price" value={fmt(state.position?.averageEntryPrice, 4)} />
                <Line label="Unrealized" value={`${fmt(state.position?.unrealizedPnl, 4)} USDT`} />
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

function Field({ label, value, onChange, compact }: { label: string; value: string; onChange: (value: string) => void; compact?: boolean }) {
  return <label style={{ display: "grid", gap: 6 }}><span style={{ color: "#7e97a5", fontSize: 12 }}>{label}</span><input value={value} onChange={(e) => onChange(e.target.value)} style={{ borderRadius: 10, border: "1px solid #22343d", background: "#101b22", color: "#f8fafc", padding: compact ? "9px 10px" : "11px 12px" }} /></label>;
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

function TabButton({ label, active }: { label: string; active: boolean }) {
  return <button style={{ border: 0, background: "transparent", color: active ? "#f8fafc" : "#7e97a5", padding: "12px 10px", borderBottom: active ? "2px solid #2dd4bf" : "2px solid transparent" }}>{label}</button>;
}

const box = (padding?: string): React.CSSProperties => ({ background: "#0b161d", border: "1px solid #16262f", borderRadius: 12, overflow: "hidden", padding });
const chipButton = (active?: boolean): React.CSSProperties => ({ color: active ? "#f8fafc" : "#7e97a5", background: active ? "#15252d" : "transparent", border: active ? "1px solid #23414d" : "1px solid transparent", padding: "5px 8px", borderRadius: 8, cursor: "pointer" });
const tabIdle: React.CSSProperties = {
  border: 0,
  background: "transparent",
  color: "#7e97a5",
  padding: "8px 12px",
  borderBottomWidth: 2,
  borderBottomStyle: "solid",
  borderBottomColor: "transparent"
};
const tabActive: React.CSSProperties = { ...tabIdle, color: "#f8fafc", borderBottomColor: "#2dd4bf" };
const btnGhost: React.CSSProperties = { border: "1px solid #253740", background: "#111d24", color: "#dce7ee", padding: "10px 14px", borderRadius: 10, cursor: "pointer" };
const btnInline: React.CSSProperties = { border: "1px solid #394d56", background: "#122028", color: "#dce7ee", borderRadius: 8, padding: "6px 10px", cursor: "pointer" };
const btnSide: React.CSSProperties = {
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
const btnBuyActive: React.CSSProperties = { ...btnSide, background: "#1e6b5f", borderColor: "#1e6b5f", color: "#f8fafc" };
const btnSellActive: React.CSSProperties = { ...btnSide, background: "#7f3d38", borderColor: "#7f3d38", color: "#f8fafc" };
const btnBuySubmit: React.CSSProperties = { border: 0, borderRadius: 12, background: "#22c55e", color: "#041015", padding: "14px 16px", cursor: "pointer", fontWeight: 800 };
const btnSellSubmit: React.CSSProperties = { border: 0, borderRadius: 12, background: "#ef4444", color: "#fff7f7", padding: "14px 16px", cursor: "pointer", fontWeight: 800 };
const th: React.CSSProperties = { padding: "12px 14px", fontWeight: 500 };
const td: React.CSSProperties = { padding: "12px 14px" };
const bookHead: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, color: "#60727f", fontSize: 12, padding: "0 8px 8px" };
