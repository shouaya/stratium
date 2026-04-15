"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { AnyEventEnvelope, FillPayload, MarketTick } from "@stratium/shared";
import type { CandlestickData, HistogramData, UTCTimestamp } from "lightweight-charts";
import {
  authHeaders,
  clearStoredToken,
  getStoredLocale,
  getStoredToken,
  setStoredLocale,
  type AppLocale,
  type AuthUser,
  type PlatformSettings
} from "./auth-client";
import { buildApiUrl, resolveApiBaseUrl } from "./api-base-url";
import { CandlestickChart } from "./candlestick-chart";
import { APP_LOCALES, LOCALE_LABELS } from "./i18n";
import { formatTokyoDateTime, formatTokyoTime } from "./time";

type PositionReplayPayload = {
  sessionId: string;
  fillId: string;
  fills: AnyEventEnvelope[];
  events: AnyEventEnvelope[];
  marketEvents: AnyEventEnvelope[];
  state: {
    simulationSessionId: string;
    account: {
      equity?: number;
      availableBalance?: number;
    } | null;
    position: {
      side?: string;
      quantity?: number;
      averageEntryPrice?: number;
      unrealizedPnl?: number;
      markPrice?: number;
    } | null;
  };
};

type ReplayTick = MarketTick & {
  eventId: string;
  occurredAt: string;
};

type EventMetric = {
  label: string;
  value: string;
  tone?: "positive" | "negative" | "muted";
};

const apiBaseUrl = resolveApiBaseUrl();

const fmt = (value?: number | null, digits = 2): string =>
  value == null || !Number.isFinite(value)
    ? "--"
    : value.toLocaleString("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });

const fmtSigned = (value?: number | null, digits = 2): string => {
  if (value == null || !Number.isFinite(value)) {
    return "--";
  }

  return `${value >= 0 ? "+" : ""}${fmt(value, digits)}`;
};

const toUnixSeconds = (value: string): UTCTimestamp =>
  Math.floor(new Date(value).getTime() / 1000) as UTCTimestamp;

const toReplayTicks = (events: AnyEventEnvelope[]): ReplayTick[] =>
  events
    .filter((event) => event.eventType === "MarketTickReceived")
    .map((event) => ({
      eventId: event.eventId,
      occurredAt: event.occurredAt,
      symbol: event.symbol,
      ...(event.payload as Omit<MarketTick, "symbol">)
    }))
    .sort((left, right) => new Date(left.tickTime).getTime() - new Date(right.tickTime).getTime());

const buildCandles = (ticks: ReplayTick[]): CandlestickData<UTCTimestamp>[] => {
  const candles = new Map<number, CandlestickData<UTCTimestamp>>();

  for (const tick of ticks) {
    const timestamp = new Date(tick.tickTime).getTime();
    const bucketStartMs = Math.floor(timestamp / 60_000) * 60_000;
    const bucket = Math.floor(bucketStartMs / 1000) as UTCTimestamp;
    const current = candles.get(bucket);

    if (current) {
      candles.set(bucket, {
        time: bucket,
        open: current.open,
        high: Math.max(current.high, tick.last),
        low: Math.min(current.low, tick.last),
        close: tick.last
      });
      continue;
    }

    candles.set(bucket, {
      time: bucket,
      open: tick.last,
      high: tick.last,
      low: tick.last,
      close: tick.last
    });
  }

  return [...candles.values()].sort((left, right) => Number(left.time) - Number(right.time));
};

const buildVolume = (ticks: ReplayTick[]): HistogramData<UTCTimestamp>[] => {
  const volumes = new Map<number, HistogramData<UTCTimestamp>>();
  let previousLast: number | undefined;

  for (const tick of ticks) {
    const timestamp = new Date(tick.tickTime).getTime();
    const bucketStartMs = Math.floor(timestamp / 60_000) * 60_000;
    const bucket = Math.floor(bucketStartMs / 1000) as UTCTimestamp;
    const current = volumes.get(bucket);
    const movement = previousLast ? Math.abs(tick.last - previousLast) : tick.spread;
    const nextValue = Number((((current?.value as number | undefined) ?? 0) + movement).toFixed(4));
    volumes.set(bucket, {
      time: bucket,
      value: nextValue,
      color: previousLast == null || tick.last >= previousLast ? "#2dd4bf88" : "#f8717188"
    });
    previousLast = tick.last;
  }

  return [...volumes.values()].sort((left, right) => Number(left.time) - Number(right.time));
};

const resolveNearestTick = (event: AnyEventEnvelope | null, ticks: ReplayTick[]): ReplayTick | null => {
  if (!event || ticks.length === 0) {
    return null;
  }

  const eventTime = new Date(event.occurredAt).getTime();
  const preceding = [...ticks].reverse().find((tick) => new Date(tick.tickTime).getTime() <= eventTime);

  return preceding ?? ticks[0] ?? null;
};

const buildEventMetrics = (event: AnyEventEnvelope | null, tick: ReplayTick | null): EventMetric[] => {
  if (!event) {
    return [];
  }

  const payload = event.payload as Partial<FillPayload> & {
    orderId?: string;
    side?: string;
    quantity?: number;
    limitPrice?: number;
  };
  const metrics: EventMetric[] = [
    { label: "Event Type", value: event.eventType },
    { label: "Time", value: formatTokyoDateTime(event.occurredAt) },
    { label: "Source", value: event.source }
  ];

  if (payload.orderId) {
    metrics.push({ label: "Order", value: payload.orderId });
  }

  if (payload.fillId) {
    metrics.push({ label: "Fill", value: payload.fillId });
  }

  if (payload.side) {
    metrics.push({
      label: "Side",
      value: payload.side.toUpperCase(),
      tone: payload.side === "buy" ? "positive" : "negative"
    });
  }

  if (typeof payload.fillPrice === "number") {
    metrics.push({ label: "Fill Price", value: fmt(payload.fillPrice, 2) });
  } else if (typeof payload.limitPrice === "number") {
    metrics.push({ label: "Reference Price", value: fmt(payload.limitPrice, 2) });
  }

  if (typeof payload.fillQuantity === "number") {
    metrics.push({ label: "Quantity", value: fmt(payload.fillQuantity, 4) });
  } else if (typeof payload.quantity === "number") {
    metrics.push({ label: "Quantity", value: fmt(payload.quantity, 4) });
  }

  if (typeof payload.fee === "number") {
    metrics.push({
      label: "Fee",
      value: `${fmt(payload.fee, 6)} (${fmt((payload.feeRate ?? 0) * 100, 3)}%)`,
      tone: "muted"
    });
  }

  if (typeof payload.slippage === "number") {
    metrics.push({ label: "Slippage", value: fmt(payload.slippage, 6), tone: "muted" });
  }

  if (tick) {
    metrics.push(
      { label: "Bid / Ask", value: `${fmt(tick.bid, 2)} / ${fmt(tick.ask, 2)}` },
      { label: "Last", value: fmt(tick.last, 2) },
      { label: "Spread", value: fmt(tick.spread, 4), tone: "muted" },
      { label: "Volatility", value: tick.volatilityTag ?? "--", tone: "muted" }
    );
  }

  return metrics;
};

const timelineAccent = (eventType: AnyEventEnvelope["eventType"]): string => {
  if (eventType === "OrderFilled" || eventType === "OrderPartiallyFilled") {
    return "#2dd4bf";
  }

  if (eventType === "PositionClosed") {
    return "#f59e0b";
  }

  if (eventType === "PositionOpened" || eventType === "PositionUpdated") {
    return "#60a5fa";
  }

  return "#8aa1ad";
};

export function PositionReplayPage({ fillId }: { fillId: string }) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [locale, setLocale] = useState<AppLocale>("en");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [replay, setReplay] = useState<PositionReplayPayload | null>(null);
  const [selectedSequence, setSelectedSequence] = useState<number | null>(null);

  useEffect(() => {
    const storedLocale = getStoredLocale();
    setLocale(storedLocale);
    const storedToken = getStoredToken("frontend");

    if (!storedToken) {
      router.replace("/login");
      return;
    }

    void loadReplay(storedToken, storedLocale);
  }, [router, fillId]);

  const loadReplay = async (candidateToken: string, nextLocale = locale) => {
    setBusy(true);
    setError("");

    try {
      const sessionResponse = await fetch(buildApiUrl(apiBaseUrl, "/api/auth/me"), {
        headers: authHeaders(candidateToken, nextLocale),
        cache: "no-store"
      });

      if (!sessionResponse.ok) {
        clearStoredToken("frontend");
        router.replace("/login");
        return;
      }

      const sessionPayload = await sessionResponse.json() as { user: AuthUser; platform: PlatformSettings };

      if (sessionPayload.user.role !== "frontend") {
        clearStoredToken("frontend");
        router.replace("/login");
        return;
      }

      const replayResponse = await fetch(buildApiUrl(apiBaseUrl, `/api/fills/${encodeURIComponent(fillId)}/replay`), {
        headers: authHeaders(candidateToken, nextLocale),
        cache: "no-store"
      });

      if (!replayResponse.ok) {
        const failure = await replayResponse.json().catch(() => ({})) as { message?: string };
        throw new Error(failure.message ?? "Failed to load position replay data.");
      }

      const replayPayload = await replayResponse.json() as PositionReplayPayload;
      setToken(candidateToken);
      setUser(sessionPayload.user);
      setReplay(replayPayload);
      setSelectedSequence(replayPayload.events[0]?.sequence ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load position replay data.");
    } finally {
      setBusy(false);
    }
  };

  const selectedEvent = useMemo(() => (
    replay?.events.find((event) => event.sequence === selectedSequence)
    ?? replay?.events[0]
    ?? null
  ), [replay, selectedSequence]);

  const selectedEventIndex = useMemo(() => (
    replay?.events.findIndex((event) => event.sequence === selectedEvent?.sequence) ?? -1
  ), [replay, selectedEvent]);

  const replayTicks = useMemo(() => toReplayTicks(replay?.marketEvents ?? []), [replay?.marketEvents]);
  const candles = useMemo(() => buildCandles(replayTicks), [replayTicks]);
  const volume = useMemo(() => buildVolume(replayTicks), [replayTicks]);
  const selectedTick = useMemo(() => resolveNearestTick(selectedEvent, replayTicks), [selectedEvent, replayTicks]);
  const eventMetrics = useMemo(() => buildEventMetrics(selectedEvent, selectedTick), [selectedEvent, selectedTick]);

  const lifecycleSummary = useMemo(() => {
    if (!replay) {
      return null;
    }

    const fillPayloads = replay.fills.map((event) => event.payload as FillPayload);
    const firstFill = fillPayloads[0];
    const lastFill = fillPayloads[fillPayloads.length - 1];
    const firstTick = replayTicks[0];
    const lastTick = replayTicks[replayTicks.length - 1];
    const priceLow = replayTicks.length > 0 ? Math.min(...replayTicks.map((tick) => tick.last)) : undefined;
    const priceHigh = replayTicks.length > 0 ? Math.max(...replayTicks.map((tick) => tick.last)) : undefined;
    const elapsedSeconds = firstFill && lastFill
      ? Math.max(0, Math.round((new Date(lastFill.filledAt).getTime() - new Date(firstFill.filledAt).getTime()) / 1000))
      : 0;
    const totalFees = fillPayloads.reduce((sum, payload) => sum + (payload.fee ?? 0), 0);

    return {
      firstFill,
      lastFill,
      firstTick,
      lastTick,
      priceLow,
      priceHigh,
      elapsedSeconds,
      totalFees
    };
  }, [replay, replayTicks]);

  if (!token || !user) {
    return (
      <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "#071116", color: "#dbe7ef", fontFamily: "\"Segoe UI\", sans-serif" }}>
        <div>{busy ? "Loading position replay..." : error || "Login required."}</div>
      </main>
    );
  }

  return (
    <main style={{ minHeight: "100dvh", background: "radial-gradient(circle at top, #15343f 0%, #071116 38%, #061015 100%)", color: "#dbe7ef", fontFamily: "\"Segoe UI\", sans-serif", padding: 16 }}>
      <div style={{ maxWidth: 1480, margin: "0 auto", display: "grid", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 30, fontWeight: 900, lineHeight: 1.05 }}>Position Replay Timeline</div>
            <div style={{ color: "#8aa1ad", fontSize: 13, marginTop: 4 }}>
              Reconstructing the full position lifecycle closed by fill `{fillId}` with event timeline, price path, and market context.
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <select
              value={locale}
              onChange={(event) => {
                const nextLocale = event.target.value as AppLocale;
                setLocale(nextLocale);
                setStoredLocale(nextLocale);
              }}
              style={{ border: "1px solid #394d56", background: "#122028", color: "#dce7ee", borderRadius: 8, padding: "8px 10px" }}
            >
              {APP_LOCALES.map((entry) => <option key={entry} value={entry}>{LOCALE_LABELS[entry]}</option>)}
            </select>
            <button
              onClick={() => router.push("/trade")}
              style={{ border: "1px solid #394d56", background: "#122028", color: "#dce7ee", borderRadius: 8, padding: "8px 12px", cursor: "pointer" }}
            >
              Back To Trade
            </button>
          </div>
        </div>

        {error ? (
          <div style={{ border: "1px solid #5f2f38", background: "#241117", color: "#fcb7c3", borderRadius: 12, padding: 12 }}>
            {error}
          </div>
        ) : null}

        {replay ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
              {[
                ["Session", replay.sessionId],
                ["Selected Fill", replay.fillId],
                ["Lifecycle Events", String(replay.events.length)],
                ["Lifecycle Fills", String(replay.fills.length)],
                ["Market Ticks", String(replay.marketEvents.length)],
                ["Duration", lifecycleSummary ? `${lifecycleSummary.elapsedSeconds}s` : "--"],
                ["Fees", lifecycleSummary ? `${fmt(lifecycleSummary.totalFees, 6)} USDC` : "--"],
                ["Terminal Position", replay.state.position ? `${replay.state.position.side} ${fmt(replay.state.position.quantity, 4)}` : "flat"]
              ].map(([label, value]) => (
                <div key={label} style={{ background: "rgba(11, 22, 29, 0.92)", border: "1px solid #16262f", borderRadius: 14, padding: 12, boxShadow: "0 14px 36px rgba(0,0,0,0.18)" }}>
                  <div style={{ color: "#6f8794", fontSize: 12, marginBottom: 6 }}>{label}</div>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>{value}</div>
                </div>
              ))}
            </div>

            <section style={{ background: "rgba(11, 22, 29, 0.92)", border: "1px solid #16262f", borderRadius: 16, padding: 12, boxShadow: "0 14px 36px rgba(0,0,0,0.18)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                <div>
                  <div style={{ fontWeight: 800 }}>Lifecycle K-Line</div>
                  <div style={{ color: "#7e97a5", fontSize: 12 }}>
                    {replayTicks.length > 0
                      ? `${formatTokyoDateTime(replayTicks[0]?.tickTime)} -> ${formatTokyoDateTime(replayTicks[replayTicks.length - 1]?.tickTime)}`
                      : "No market ticks captured for this replay window."}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, color: "#c7d7df" }}>
                  <span>Open: {lifecycleSummary?.firstTick ? fmt(lifecycleSummary.firstTick.last, 2) : "--"}</span>
                  <span>Close: {lifecycleSummary?.lastTick ? fmt(lifecycleSummary.lastTick.last, 2) : "--"}</span>
                  <span>Low: {fmt(lifecycleSummary?.priceLow, 2)}</span>
                  <span>High: {fmt(lifecycleSummary?.priceHigh, 2)}</span>
                </div>
              </div>
              <div style={{ height: 360 }}>
                {candles.length > 0 ? (
                  <CandlestickChart data={candles} dark priceDigits={2} chartType="line" />
                ) : (
                  <div style={{ height: "100%", display: "grid", placeItems: "center", color: "#7e97a5", border: "1px dashed #233842", borderRadius: 12 }}>
                    This replay window does not have enough tick data to render candles yet.
                  </div>
                )}
              </div>
            </section>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 0.92fr) minmax(0, 1.08fr)", gap: 12 }}>
              <section style={{ background: "rgba(11, 22, 29, 0.92)", border: "1px solid #16262f", borderRadius: 16, overflow: "hidden", boxShadow: "0 14px 36px rgba(0,0,0,0.18)" }}>
                <div style={{ padding: "12px 14px", borderBottom: "1px solid #16262f", fontWeight: 800 }}>Event Timeline</div>
                {replay.events.length > 1 ? (
                  <div style={{ padding: "10px 14px 0" }}>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(replay.events.length - 1, 0)}
                      value={Math.max(selectedEventIndex, 0)}
                      onChange={(event) => {
                        const next = replay.events[Number(event.target.value)];
                        if (next) {
                          setSelectedSequence(next.sequence);
                        }
                      }}
                      style={{ width: "100%" }}
                    />
                  </div>
                ) : null}
                <div style={{ maxHeight: "72dvh", overflow: "auto", padding: 8 }}>
                  {replay.events.length === 0 ? (
                    <div style={{ padding: 14, color: "#7e97a5" }}>No replayable lifecycle events were found.</div>
                  ) : replay.events.map((event, index) => {
                    const active = event.sequence === selectedEvent?.sequence;
                    const payload = event.payload as Partial<FillPayload> & { side?: string; orderId?: string };
                    return (
                      <button
                        key={event.eventId}
                        onClick={() => setSelectedSequence(event.sequence)}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          border: "1px solid",
                          borderColor: active ? "#2c8084" : "#16262f",
                          background: active ? "linear-gradient(135deg, rgba(28, 88, 92, 0.88), rgba(11, 22, 29, 0.95))" : "rgba(8, 17, 22, 0.88)",
                          color: "#dbe7ef",
                          cursor: "pointer",
                          padding: "12px 14px",
                          borderRadius: 12,
                          marginBottom: 8
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                          <div style={{ display: "grid", gap: 5 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <span style={{ width: 10, height: 10, borderRadius: 999, background: timelineAccent(event.eventType), boxShadow: `0 0 18px ${timelineAccent(event.eventType)}` }} />
                              <strong style={{ fontSize: 13 }}>#{index + 1} {event.eventType}</strong>
                              <span style={{ color: "#8aa1ad", fontSize: 12 }}>{event.source}</span>
                            </div>
                            <div style={{ color: "#dce7ee", fontSize: 12 }}>
                              {payload.orderId ? `Order ${payload.orderId}` : "System event"}
                              {payload.fillId ? ` · Fill ${payload.fillId}` : ""}
                              {typeof payload.fillPrice === "number" ? ` · ${fmt(payload.fillPrice, 2)}` : ""}
                              {typeof payload.fillQuantity === "number" ? ` · ${fmt(payload.fillQuantity, 4)} qty` : ""}
                            </div>
                            <div style={{ color: "#8aa1ad", fontSize: 12 }}>
                              {formatTokyoDateTime(event.occurredAt)}
                            </div>
                          </div>
                          <div style={{ color: "#7e97a5", fontSize: 11, textAlign: "right" }}>
                            {selectedEventIndex >= 0 ? `${Math.round(((index + 1) / replay.events.length) * 100)}%` : "--"}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>

              <div style={{ display: "grid", gap: 12 }}>
                <section style={{ background: "rgba(11, 22, 29, 0.92)", border: "1px solid #16262f", borderRadius: 16, overflow: "hidden", boxShadow: "0 14px 36px rgba(0,0,0,0.18)" }}>
                  <div style={{ padding: "12px 14px", borderBottom: "1px solid #16262f", fontWeight: 800 }}>Selected Event Parameters</div>
                  <div style={{ padding: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
                    {eventMetrics.map((metric) => (
                      <div key={metric.label} style={{ background: "#09161c", border: "1px solid #16262f", borderRadius: 12, padding: 12 }}>
                        <div style={{ fontSize: 11, color: "#6f8794", marginBottom: 6 }}>{metric.label}</div>
                        <div style={{
                          fontSize: 15,
                          fontWeight: 800,
                          color: metric.tone === "positive" ? "#2dd4bf" : metric.tone === "negative" ? "#f87171" : metric.tone === "muted" ? "#a8bbc7" : "#dbe7ef"
                        }}>
                          {metric.value}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section style={{ background: "rgba(11, 22, 29, 0.92)", border: "1px solid #16262f", borderRadius: 16, overflow: "hidden", boxShadow: "0 14px 36px rgba(0,0,0,0.18)" }}>
                  <div style={{ padding: "12px 14px", borderBottom: "1px solid #16262f", fontWeight: 800 }}>Lifecycle Fill Ledger</div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ color: "#7e97a5", textAlign: "left" }}>
                          <th style={{ padding: "10px 12px" }}>Time</th>
                          <th style={{ padding: "10px 12px" }}>Fill</th>
                          <th style={{ padding: "10px 12px" }}>Order</th>
                          <th style={{ padding: "10px 12px" }}>Price</th>
                          <th style={{ padding: "10px 12px" }}>Qty</th>
                          <th style={{ padding: "10px 12px" }}>Fee</th>
                          <th style={{ padding: "10px 12px" }}>Role</th>
                        </tr>
                      </thead>
                      <tbody>
                        {replay.fills.map((event) => {
                          const payload = event.payload as FillPayload;
                          return (
                            <tr key={event.eventId} style={{ borderTop: "1px solid #132029" }}>
                              <td style={{ padding: "10px 12px" }}>{formatTokyoTime(payload.filledAt)}</td>
                              <td style={{ padding: "10px 12px" }}>{payload.fillId}</td>
                              <td style={{ padding: "10px 12px" }}>{payload.orderId}</td>
                              <td style={{ padding: "10px 12px" }}>{fmt(payload.fillPrice, 2)}</td>
                              <td style={{ padding: "10px 12px" }}>{fmt(payload.fillQuantity, 4)}</td>
                              <td style={{ padding: "10px 12px" }}>{fmt(payload.fee, 6)}</td>
                              <td style={{ padding: "10px 12px", textTransform: "uppercase", color: payload.liquidityRole === "maker" ? "#22c55e" : "#f59e0b" }}>{payload.liquidityRole}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section style={{ background: "rgba(11, 22, 29, 0.92)", border: "1px solid #16262f", borderRadius: 16, overflow: "hidden", boxShadow: "0 14px 36px rgba(0,0,0,0.18)" }}>
                  <div style={{ padding: "12px 14px", borderBottom: "1px solid #16262f", fontWeight: 800 }}>Replay Outcome</div>
                  <div style={{ padding: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                    <div style={{ background: "#09161c", border: "1px solid #16262f", borderRadius: 12, padding: 12 }}>
                      <div style={{ fontSize: 11, color: "#6f8794", marginBottom: 6 }}>Account Equity</div>
                      <div style={{ fontSize: 16, fontWeight: 800 }}>{fmt(replay.state.account?.equity, 2)}</div>
                    </div>
                    <div style={{ background: "#09161c", border: "1px solid #16262f", borderRadius: 12, padding: 12 }}>
                      <div style={{ fontSize: 11, color: "#6f8794", marginBottom: 6 }}>Available Balance</div>
                      <div style={{ fontSize: 16, fontWeight: 800 }}>{fmt(replay.state.account?.availableBalance, 2)}</div>
                    </div>
                    <div style={{ background: "#09161c", border: "1px solid #16262f", borderRadius: 12, padding: 12 }}>
                      <div style={{ fontSize: 11, color: "#6f8794", marginBottom: 6 }}>Terminal Mark</div>
                      <div style={{ fontSize: 16, fontWeight: 800 }}>{fmt(replay.state.position?.markPrice, 2)}</div>
                    </div>
                    <div style={{ background: "#09161c", border: "1px solid #16262f", borderRadius: 12, padding: 12 }}>
                      <div style={{ fontSize: 11, color: "#6f8794", marginBottom: 6 }}>Unrealized PnL</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: (replay.state.position?.unrealizedPnl ?? 0) >= 0 ? "#2dd4bf" : "#f87171" }}>
                        {fmtSigned(replay.state.position?.unrealizedPnl, 4)}
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}
