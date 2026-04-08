"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { AnyEventEnvelope } from "@stratium/shared";

type TickPayload = {
  bid: number;
  ask: number;
  last: number;
  spread: number;
  tickTime: string;
  volatilityTag?: string;
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

type AdminState = {
  latestTick?: TickPayload & { symbol?: string };
  simulator?: MarketSimulatorState;
  events: AnyEventEnvelope[];
};

const fmt = (n?: number | null, d = 2) => n == null ? "-" : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

export function AdminConsole({ apiBaseUrl }: { apiBaseUrl: string }) {
  const [state, setState] = useState<AdminState>({ events: [] });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [simForm, setSimForm] = useState({ intervalMs: "1200", volatilityBps: "22", driftBps: "0", anchorPrice: "69830" });
  const [tickForm, setTickForm] = useState({ symbol: "BTC-USD", bid: "", ask: "", last: "", spread: "" });

  useEffect(() => {
    void refresh();

    const ws = new WebSocket(`${apiBaseUrl.replace(/^http/, "ws")}/ws`);
    ws.addEventListener("message", (event) => {
      const payload = JSON.parse(event.data) as {
        state?: Partial<AdminState>;
        events?: AnyEventEnvelope[];
        simulator?: MarketSimulatorState;
      };

      if (!payload.state) {
        return;
      }

      setState((current) => ({
        latestTick: payload.state?.latestTick ?? current.latestTick,
        events: payload.events ?? current.events,
        simulator: payload.simulator ?? current.simulator
      }));
    });

    return () => ws.close();
  }, [apiBaseUrl]);

  useEffect(() => {
    if (!state.latestTick) {
      return;
    }

    setTickForm((current) => ({
      symbol: state.latestTick?.symbol ?? current.symbol,
      bid: state.latestTick?.bid.toFixed(2) ?? current.bid,
      ask: state.latestTick?.ask.toFixed(2) ?? current.ask,
      last: state.latestTick?.last.toFixed(2) ?? current.last,
      spread: state.latestTick?.spread.toFixed(2) ?? current.spread
    }));
  }, [state.latestTick?.tickTime]);

  const refresh = async () => {
    const response = await fetch(`${apiBaseUrl}/api/state`, { cache: "no-store" });
    const payload = await response.json() as AdminState;
    setState(payload);

    if (payload.simulator) {
      setSimForm({
        intervalMs: String(payload.simulator.intervalMs),
        volatilityBps: String(payload.simulator.volatilityBps),
        driftBps: String(payload.simulator.driftBps),
        anchorPrice: String(payload.simulator.anchorPrice)
      });
    }
  };

  const updateSimulator = async (action: "start" | "stop") => {
    setBusy(true);

    try {
      const response = await fetch(`${apiBaseUrl}/api/market-simulator/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: action === "start" ? JSON.stringify({
          intervalMs: Number(simForm.intervalMs),
          volatilityBps: Number(simForm.volatilityBps),
          driftBps: Number(simForm.driftBps),
          anchorPrice: Number(simForm.anchorPrice)
        }) : undefined
      });
      const payload = await response.json() as { simulator: MarketSimulatorState };

      setState((current) => ({
        ...current,
        simulator: payload.simulator
      }));
      setMessage(action === "start" ? "Rolling market started." : "Rolling market stopped.");
    } catch {
      setMessage(`Failed to ${action} rolling market.`);
    } finally {
      setBusy(false);
    }
  };

  const submitTick = async () => {
    setBusy(true);

    try {
      const response = await fetch(`${apiBaseUrl}/api/market-ticks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: tickForm.symbol,
          bid: Number(tickForm.bid),
          ask: Number(tickForm.ask),
          last: Number(tickForm.last),
          spread: Number(tickForm.spread),
          tickTime: new Date().toISOString(),
          volatilityTag: "manual"
        })
      });

      const payload = await response.json() as { message?: string };

      if (!response.ok) {
        setMessage(payload.message ?? "Manual tick rejected.");
        return;
      }

      setMessage("Manual tick accepted.");
    } catch {
      setMessage("Failed to submit manual tick.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ minHeight: "100vh", background: "#071116", color: "#dbe7ef", padding: 20, fontFamily: "\"Segoe UI\", sans-serif" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", display: "grid", gap: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28 }}>Admin Market Console</h1>
            <div style={{ marginTop: 6, color: "#7e97a5", fontSize: 13 }}>{message || "Manual market controls and simulator management."}</div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => void refresh()} style={ghostButton}>Refresh</button>
            <Link href="/" style={ghostLink}>Back To Trade</Link>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 420px) minmax(320px, 420px) minmax(0, 1fr)", gap: 16 }}>
          <section style={panel}>
            <div style={panelTitle}>Simulator</div>
            <div style={stack}>
              <Metric label="Status" value={state.simulator?.enabled ? "Running" : "Stopped"} />
              <Metric label="Symbol" value={state.simulator?.symbol ?? "-"} />
              <Metric label="Last Price" value={fmt(state.simulator?.lastPrice, 2)} />
              <Metric label="Tick Count" value={fmt(state.simulator?.tickCount, 0)} />
              <Field label="Tick Interval ms" value={simForm.intervalMs} onChange={(value) => setSimForm((current) => ({ ...current, intervalMs: value }))} />
              <Field label="Volatility bps" value={simForm.volatilityBps} onChange={(value) => setSimForm((current) => ({ ...current, volatilityBps: value }))} />
              <Field label="Drift bps" value={simForm.driftBps} onChange={(value) => setSimForm((current) => ({ ...current, driftBps: value }))} />
              <Field label="Anchor Price" value={simForm.anchorPrice} onChange={(value) => setSimForm((current) => ({ ...current, anchorPrice: value }))} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <button onClick={() => void updateSimulator("start")} style={primaryButton} disabled={busy}>Start</button>
                <button onClick={() => void updateSimulator("stop")} style={ghostButton} disabled={busy}>Stop</button>
              </div>
            </div>
          </section>

          <section style={panel}>
            <div style={panelTitle}>Manual Tick</div>
            <div style={stack}>
              <Metric label="Current Bid" value={fmt(state.latestTick?.bid, 2)} />
              <Metric label="Current Ask" value={fmt(state.latestTick?.ask, 2)} />
              <Metric label="Current Last" value={fmt(state.latestTick?.last, 2)} />
              <Metric label="Current Spread" value={fmt(state.latestTick?.spread, 2)} />
              <Field label="Symbol" value={tickForm.symbol} onChange={(value) => setTickForm((current) => ({ ...current, symbol: value }))} />
              <Field label="Bid" value={tickForm.bid} onChange={(value) => setTickForm((current) => ({ ...current, bid: value }))} />
              <Field label="Ask" value={tickForm.ask} onChange={(value) => setTickForm((current) => ({ ...current, ask: value }))} />
              <Field label="Last" value={tickForm.last} onChange={(value) => setTickForm((current) => ({ ...current, last: value }))} />
              <Field label="Spread" value={tickForm.spread} onChange={(value) => setTickForm((current) => ({ ...current, spread: value }))} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <button
                  onClick={() => setTickForm({
                    symbol: state.latestTick?.symbol ?? tickForm.symbol,
                    bid: state.latestTick?.bid.toFixed(2) ?? tickForm.bid,
                    ask: state.latestTick?.ask.toFixed(2) ?? tickForm.ask,
                    last: state.latestTick?.last.toFixed(2) ?? tickForm.last,
                    spread: state.latestTick?.spread.toFixed(2) ?? tickForm.spread
                  })}
                  style={ghostButton}
                >
                  Use Live Quote
                </button>
                <button onClick={() => void submitTick()} style={primaryButton} disabled={busy}>Push Manual Tick</button>
              </div>
            </div>
          </section>

          <section style={panel}>
            <div style={panelTitle}>Recent Market Events</div>
            <div style={{ display: "grid", gap: 8, maxHeight: 640, overflow: "auto" }}>
              {state.events.slice(-24).reverse().map((event) => (
                <div key={event.eventId} style={{ border: "1px solid #16262f", borderRadius: 10, padding: 10, background: "#0f1b22" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <strong>{event.eventType}</strong>
                    <span style={{ color: "#7e97a5", fontSize: 12 }}>{new Date(event.occurredAt).toLocaleTimeString("en-US", { hour12: false })}</span>
                  </div>
                  <div style={{ marginTop: 6, color: "#7e97a5", fontSize: 12 }}>{event.symbol} · {event.source}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span style={{ color: "#7e97a5", fontSize: 12 }}>{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{ borderRadius: 10, border: "1px solid #22343d", background: "#101b22", color: "#f8fafc", padding: "11px 12px" }}
      />
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ color: "#7e97a5", fontSize: 13 }}>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

const panel: React.CSSProperties = {
  background: "#0b161d",
  border: "1px solid #16262f",
  borderRadius: 14,
  padding: 16
};

const panelTitle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  marginBottom: 14
};

const stack: React.CSSProperties = {
  display: "grid",
  gap: 12
};

const ghostButton: React.CSSProperties = {
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "#253740",
  background: "#111d24",
  color: "#dce7ee",
  padding: "10px 14px",
  borderRadius: 10,
  cursor: "pointer"
};

const primaryButton: React.CSSProperties = {
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "#1f8a65",
  background: "#22c55e",
  color: "#041015",
  padding: "10px 14px",
  borderRadius: 10,
  cursor: "pointer",
  fontWeight: 700
};

const ghostLink: React.CSSProperties = {
  ...ghostButton,
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center"
};
