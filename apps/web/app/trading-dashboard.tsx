"use client";

import { useEffect, useMemo, useState } from "react";
import type { AccountView, EventEnvelope, OrderView, PositionView } from "@stratium/shared";

interface DashboardState {
  account: AccountView | null;
  orders: OrderView[];
  position: PositionView | null;
  latestTick: Record<string, unknown> | null;
  events: EventEnvelope<unknown>[];
}

const initialState: DashboardState = {
  account: null,
  orders: [],
  position: null,
  latestTick: null,
  events: []
};

const formatNumber = (value: number | undefined | null): string => {
  if (value === undefined || value === null) {
    return "-";
  }

  return Number(value).toFixed(4);
};

export function TradingDashboard({ apiBaseUrl }: { apiBaseUrl: string }) {
  const [state, setState] = useState<DashboardState>(initialState);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string>("");
  const [orderForm, setOrderForm] = useState({
    accountId: "paper-account-1",
    symbol: "BTC-USD",
    side: "buy",
    orderType: "market",
    quantity: "1",
    limitPrice: "100"
  });
  const [tickForm, setTickForm] = useState({
    symbol: "BTC-USD",
    bid: "100",
    ask: "101",
    last: "100.5",
    spread: "1",
    volatilityTag: "normal"
  });

  const replaySummary = useMemo(() => {
    const latestEvent = state.events[state.events.length - 1];

    return latestEvent
      ? `sequence ${latestEvent.sequence} / ${latestEvent.eventType}`
      : "no events yet";
  }, [state.events]);

  useEffect(() => {
    void refreshState();

    const wsBaseUrl = apiBaseUrl.replace(/^http/, "ws");
    const socket = new WebSocket(`${wsBaseUrl}/ws`);

    socket.addEventListener("message", (event) => {
      const payload = JSON.parse(event.data) as {
        state?: {
          account?: AccountView;
          orders?: OrderView[];
          position?: PositionView;
          latestTick?: Record<string, unknown>;
        };
        events?: EventEnvelope<unknown>[];
      };

      if (payload.state) {
        setState((current) => ({
          account: payload.state?.account ?? current.account,
          orders: payload.state?.orders ?? current.orders,
          position: payload.state?.position ?? current.position,
          latestTick: payload.state?.latestTick ?? current.latestTick,
          events: payload.events ?? current.events
        }));
      }
    });

    return () => {
      socket.close();
    };
  }, [apiBaseUrl]);

  const refreshState = async () => {
    setLoading(true);

    try {
      const response = await fetch(`${apiBaseUrl}/api/state`, {
        cache: "no-store"
      });
      const payload = await response.json() as {
        account: AccountView;
        orders: OrderView[];
        position: PositionView;
        latestTick: Record<string, unknown> | null;
        events: EventEnvelope<unknown>[];
      };

      setState({
        account: payload.account,
        orders: payload.orders,
        position: payload.position,
        latestTick: payload.latestTick,
        events: payload.events
      });
      setMessage("");
    } catch {
      setMessage("Failed to fetch API state.");
    } finally {
      setLoading(false);
    }
  };

  const submitTick = async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/market-ticks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          symbol: tickForm.symbol,
          bid: Number(tickForm.bid),
          ask: Number(tickForm.ask),
          last: Number(tickForm.last),
          spread: Number(tickForm.spread),
          tickTime: new Date().toISOString(),
          volatilityTag: tickForm.volatilityTag
        })
      });

      if (!response.ok) {
        setMessage("Failed to submit market tick.");
        return;
      }

      setMessage("Market tick submitted.");
    } catch {
      setMessage("Failed to submit market tick.");
    }
  };

  const submitOrder = async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          accountId: orderForm.accountId,
          symbol: orderForm.symbol,
          side: orderForm.side,
          orderType: orderForm.orderType,
          quantity: Number(orderForm.quantity),
          limitPrice: orderForm.orderType === "limit" ? Number(orderForm.limitPrice) : undefined
        })
      });

      if (!response.ok) {
        setMessage("Failed to submit order.");
        return;
      }

      setMessage("Order submitted.");
    } catch {
      setMessage("Failed to submit order.");
    }
  };

  const cancelOrder = async (orderId: string) => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/orders/cancel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          accountId: "paper-account-1",
          orderId
        })
      });

      if (!response.ok) {
        setMessage("Failed to cancel order.");
        return;
      }

      setMessage(`Order ${orderId} canceled.`);
    } catch {
      setMessage("Failed to cancel order.");
    }
  };

  return (
    <main style={{ minHeight: "100vh", background: "linear-gradient(145deg, #efe2cf 0%, #f7f3ea 45%, #d8e4ec 100%)", color: "#221a14", padding: 24, fontFamily: "\"Iowan Old Style\", Georgia, serif" }}>
      <section style={{ maxWidth: 1280, margin: "0 auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 12, letterSpacing: "0.24em", textTransform: "uppercase", color: "#6e6256" }}>PH1 Prototype</div>
            <h1 style={{ fontSize: 44, margin: "4px 0 8px" }}>Stratium Trading Simulator</h1>
            <p style={{ maxWidth: 720, margin: 0 }}>
              Single-symbol, single-account simulation with event history, replay, market ticks, order entry, and account state inspection.
            </p>
          </div>
          <button onClick={() => void refreshState()} style={buttonStyle("#1f4d4d")} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </header>

        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", marginBottom: 16 }}>
          <Panel title="Replay">
            <Metric label="Latest" value={replaySummary} />
            <Metric label="Events" value={String(state.events.length)} />
          </Panel>
          <Panel title="Account">
            <Metric label="Wallet" value={formatNumber(state.account?.walletBalance)} />
            <Metric label="Available" value={formatNumber(state.account?.availableBalance)} />
            <Metric label="Equity" value={formatNumber(state.account?.equity)} />
            <Metric label="Risk Ratio" value={formatNumber(state.account?.riskRatio)} />
          </Panel>
          <Panel title="Position">
            <Metric label="Side" value={state.position?.side ?? "flat"} />
            <Metric label="Qty" value={formatNumber(state.position?.quantity)} />
            <Metric label="Entry" value={formatNumber(state.position?.averageEntryPrice)} />
            <Metric label="Unrealized" value={formatNumber(state.position?.unrealizedPnl)} />
          </Panel>
          <Panel title="Latest Tick">
            <pre style={preStyle}>{JSON.stringify(state.latestTick, null, 2)}</pre>
          </Panel>
        </div>

        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(300px, 380px) minmax(300px, 380px) 1fr", alignItems: "start" }}>
          <Panel title="Market Tick Input">
            <Field label="Symbol" value={tickForm.symbol} onChange={(value) => setTickForm((current) => ({ ...current, symbol: value }))} />
            <Field label="Bid" value={tickForm.bid} onChange={(value) => setTickForm((current) => ({ ...current, bid: value }))} />
            <Field label="Ask" value={tickForm.ask} onChange={(value) => setTickForm((current) => ({ ...current, ask: value }))} />
            <Field label="Last" value={tickForm.last} onChange={(value) => setTickForm((current) => ({ ...current, last: value }))} />
            <Field label="Spread" value={tickForm.spread} onChange={(value) => setTickForm((current) => ({ ...current, spread: value }))} />
            <Field label="Volatility" value={tickForm.volatilityTag} onChange={(value) => setTickForm((current) => ({ ...current, volatilityTag: value }))} />
            <button onClick={() => void submitTick()} style={buttonStyle("#345c4a")}>Submit Tick</button>
          </Panel>

          <Panel title="Order Entry">
            <Field label="Account" value={orderForm.accountId} onChange={(value) => setOrderForm((current) => ({ ...current, accountId: value }))} />
            <Field label="Symbol" value={orderForm.symbol} onChange={(value) => setOrderForm((current) => ({ ...current, symbol: value }))} />
            <SelectField
              label="Side"
              value={orderForm.side}
              options={["buy", "sell"]}
              onChange={(value) => setOrderForm((current) => ({ ...current, side: value }))}
            />
            <SelectField
              label="Type"
              value={orderForm.orderType}
              options={["market", "limit"]}
              onChange={(value) => setOrderForm((current) => ({ ...current, orderType: value }))}
            />
            <Field label="Quantity" value={orderForm.quantity} onChange={(value) => setOrderForm((current) => ({ ...current, quantity: value }))} />
            <Field
              label="Limit Price"
              value={orderForm.limitPrice}
              disabled={orderForm.orderType !== "limit"}
              onChange={(value) => setOrderForm((current) => ({ ...current, limitPrice: value }))}
            />
            <button onClick={() => void submitOrder()} style={buttonStyle("#7d4b32")}>Submit Order</button>
          </Panel>

          <Panel title="Event Tape">
            <div style={{ display: "grid", gap: 10, maxHeight: 480, overflow: "auto" }}>
              {state.events.length === 0 ? (
                <div style={{ color: "#6e6256" }}>No events yet.</div>
              ) : (
                state.events.slice().reverse().map((event) => (
                  <article key={event.eventId} style={{ border: "1px solid #d3c7b5", borderRadius: 14, padding: 12, background: "#fffdf7" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <strong>{event.eventType}</strong>
                      <span style={{ color: "#6e6256" }}>#{event.sequence}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "#6e6256", marginTop: 4 }}>{event.occurredAt}</div>
                    <pre style={preStyle}>{JSON.stringify(event.payload, null, 2)}</pre>
                  </article>
                ))
              )}
            </div>
          </Panel>
        </div>

        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1.2fr 1fr", marginTop: 16 }}>
          <Panel title="Orders">
            <div style={{ display: "grid", gap: 12 }}>
              {state.orders.length === 0 ? (
                <div style={{ color: "#6e6256" }}>No orders yet.</div>
              ) : state.orders.map((order) => (
                <article key={order.id} style={{ display: "grid", gap: 8, border: "1px solid #d3c7b5", borderRadius: 14, padding: 12, background: "#fffdf7" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <strong>{order.id}</strong>
                    <span>{order.status}</span>
                  </div>
                  <div>{order.side} {order.orderType} {order.quantity} {order.symbol}</div>
                  <div style={{ fontSize: 13, color: "#6e6256" }}>
                    filled {order.filledQuantity} / remaining {order.remainingQuantity}
                  </div>
                  {order.limitPrice !== undefined && <div style={{ fontSize: 13, color: "#6e6256" }}>limit {order.limitPrice}</div>}
                  {(order.status === "ACCEPTED" || order.status === "PARTIALLY_FILLED") && (
                    <button onClick={() => void cancelOrder(order.id)} style={buttonStyle("#8b3d3d")}>Cancel</button>
                  )}
                </article>
              ))}
            </div>
          </Panel>

          <Panel title="Status">
            <pre style={preStyle}>{JSON.stringify({
              message,
              account: state.account,
              position: state.position
            }, null, 2)}</pre>
          </Panel>
        </div>
      </section>
    </main>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ background: "rgba(255, 251, 244, 0.92)", border: "1px solid #d6ccbc", borderRadius: 20, padding: 18, boxShadow: "0 20px 40px rgba(34, 26, 20, 0.08)" }}>
      <h2 style={{ marginTop: 0, marginBottom: 14, fontSize: 24 }}>{title}</h2>
      {children}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "8px 0", borderBottom: "1px solid #e5dccd" }}>
      <span style={{ color: "#6e6256" }}>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Field({
  label,
  value,
  disabled,
  onChange
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label style={{ display: "grid", gap: 6, marginBottom: 12 }}>
      <span style={{ fontSize: 13, color: "#6e6256" }}>{label}</span>
      <input
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        style={inputStyle}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label style={{ display: "grid", gap: 6, marginBottom: 12 }}>
      <span style={{ fontSize: 13, color: "#6e6256" }}>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} style={inputStyle}>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  borderRadius: 12,
  border: "1px solid #cfc3b0",
  padding: "10px 12px",
  background: "#fffdfa",
  color: "#221a14"
};

const preStyle: React.CSSProperties = {
  margin: 0,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fontSize: 12,
  lineHeight: 1.45
};

const buttonStyle = (background: string): React.CSSProperties => ({
  border: 0,
  borderRadius: 999,
  background,
  color: "#fffdf7",
  padding: "12px 16px",
  cursor: "pointer",
  fontWeight: 600
});
