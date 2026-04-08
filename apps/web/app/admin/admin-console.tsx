"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { AnyEventEnvelope } from "@stratium/shared";
import { authHeaders, type AuthUser, type PlatformSettings } from "../auth-client";

type TickPayload = {
  bid: number;
  ask: number;
  last: number;
  spread: number;
  tickTime: string;
  volatilityTag?: string;
  symbol?: string;
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

type FrontendUser = AuthUser & { role: "frontend" };

type AdminState = {
  latestTick?: TickPayload;
  simulator?: MarketSimulatorState;
  events: AnyEventEnvelope[];
  platform?: PlatformSettings;
};

const fmt = (n?: number | null, d = 2) => n == null ? "-" : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

export function AdminConsole({
  apiBaseUrl,
  authToken,
  viewer,
  onLogout
}: {
  apiBaseUrl: string;
  authToken: string;
  viewer: AuthUser;
  onLogout: () => void;
}) {
  const [state, setState] = useState<AdminState>({ events: [] });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState<FrontendUser[]>([]);
  const [simForm, setSimForm] = useState({ intervalMs: "1200", volatilityBps: "22", driftBps: "0", anchorPrice: "69830" });
  const [tickForm, setTickForm] = useState({ symbol: "BTC-USD", bid: "", ask: "", last: "", spread: "" });
  const [newUserForm, setNewUserForm] = useState({ username: "", displayName: "", password: "", tradingAccountId: "paper-account-1" });
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editUserForm, setEditUserForm] = useState({ displayName: "", password: "", tradingAccountId: "paper-account-1", isActive: true });
  const [settingsForm, setSettingsForm] = useState<PlatformSettings>({
    platformName: "Stratium Demo",
    platformAnnouncement: "",
    allowFrontendTrading: true,
    allowManualTicks: true,
    allowSimulatorControl: true
  });

  useEffect(() => {
    void refresh();

    const ws = new WebSocket(`${apiBaseUrl.replace(/^http/, "ws")}/ws?token=${encodeURIComponent(authToken)}`);
    ws.addEventListener("message", (event) => {
      const payload = JSON.parse(event.data) as {
        state?: { latestTick?: TickPayload };
        events?: AnyEventEnvelope[];
        simulator?: MarketSimulatorState;
        platform?: PlatformSettings;
      };

      if (!payload.state) {
        return;
      }

      setState((current) => ({
        latestTick: payload.state?.latestTick ?? current.latestTick,
        events: payload.events ?? current.events,
        simulator: payload.simulator ?? current.simulator,
        platform: payload.platform ?? current.platform
      }));

      if (payload.platform) {
        setSettingsForm(payload.platform);
      }
    });

    return () => ws.close();
  }, [apiBaseUrl, authToken]);

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
    try {
      const [stateResponse, usersResponse, settingsResponse] = await Promise.all([
        fetch(`${apiBaseUrl}/api/admin/state`, { headers: authHeaders(authToken), cache: "no-store" }),
        fetch(`${apiBaseUrl}/api/admin/users`, { headers: authHeaders(authToken), cache: "no-store" }),
        fetch(`${apiBaseUrl}/api/admin/platform-settings`, { headers: authHeaders(authToken), cache: "no-store" })
      ]);

      if ([stateResponse, usersResponse, settingsResponse].some((response) => response.status === 401)) {
        setMessage("Session expired.");
        onLogout();
        return;
      }

      const statePayload = await stateResponse.json() as AdminState;
      const usersPayload = await usersResponse.json() as { users: FrontendUser[] };
      const settingsPayload = await settingsResponse.json() as PlatformSettings;

      setState(statePayload);
      setUsers(usersPayload.users);
      setSettingsForm(settingsPayload);
      setMessage("");
    } catch {
      setMessage("Failed to load admin data.");
    }
  };

  const updateSimulator = async (action: "start" | "stop") => {
    setBusy(true);

    try {
      const response = await fetch(`${apiBaseUrl}/api/market-simulator/${action}`, {
        method: "POST",
        headers: authHeaders(authToken, { "Content-Type": "application/json" }),
        body: action === "start" ? JSON.stringify({
          intervalMs: Number(simForm.intervalMs),
          volatilityBps: Number(simForm.volatilityBps),
          driftBps: Number(simForm.driftBps),
          anchorPrice: Number(simForm.anchorPrice)
        }) : undefined
      });
      const payload = await response.json().catch(() => ({})) as { simulator?: MarketSimulatorState; message?: string };

      if (!response.ok) {
        setMessage(payload.message ?? `Failed to ${action} rolling market.`);
        return;
      }

      setState((current) => ({
        ...current,
        simulator: payload.simulator ?? current.simulator
      }));
      setMessage(action === "start" ? "Rolling market started." : "Rolling market stopped.");
    } finally {
      setBusy(false);
    }
  };

  const submitTick = async () => {
    setBusy(true);

    try {
      const response = await fetch(`${apiBaseUrl}/api/market-ticks`, {
        method: "POST",
        headers: authHeaders(authToken, { "Content-Type": "application/json" }),
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

      const payload = await response.json().catch(() => ({})) as { message?: string };
      setMessage(response.ok ? "Manual tick accepted." : payload.message ?? "Manual tick rejected.");
    } finally {
      setBusy(false);
    }
  };

  const createUser = async () => {
    setBusy(true);

    try {
      const response = await fetch(`${apiBaseUrl}/api/admin/users`, {
        method: "POST",
        headers: authHeaders(authToken, { "Content-Type": "application/json" }),
        body: JSON.stringify(newUserForm)
      });
      const payload = await response.json().catch(() => ({})) as { message?: string };

      if (!response.ok) {
        setMessage(payload.message ?? "Failed to create user.");
        return;
      }

      setNewUserForm({ username: "", displayName: "", password: "", tradingAccountId: "paper-account-1" });
      setMessage("Frontend user created.");
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const beginEditUser = (user: FrontendUser) => {
    setEditingUserId(user.id);
    setEditUserForm({
      displayName: user.displayName,
      password: "",
      tradingAccountId: user.tradingAccountId ?? "paper-account-1",
      isActive: user.isActive
    });
  };

  const saveUser = async () => {
    if (!editingUserId) {
      return;
    }

    setBusy(true);

    try {
      const response = await fetch(`${apiBaseUrl}/api/admin/users/${editingUserId}`, {
        method: "PUT",
        headers: authHeaders(authToken, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          displayName: editUserForm.displayName,
          password: editUserForm.password || undefined,
          tradingAccountId: editUserForm.tradingAccountId,
          isActive: editUserForm.isActive
        })
      });
      const payload = await response.json().catch(() => ({})) as { message?: string };

      if (!response.ok) {
        setMessage(payload.message ?? "Failed to update user.");
        return;
      }

      setEditingUserId(null);
      setMessage("Frontend user updated.");
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = async () => {
    setBusy(true);

    try {
      const response = await fetch(`${apiBaseUrl}/api/admin/platform-settings`, {
        method: "PUT",
        headers: authHeaders(authToken, { "Content-Type": "application/json" }),
        body: JSON.stringify(settingsForm)
      });
      const payload = await response.json().catch(() => ({})) as PlatformSettings & { message?: string };

      if (!response.ok) {
        setMessage(payload.message ?? "Failed to update platform settings.");
        return;
      }

      setSettingsForm(payload);
      setMessage("Platform settings updated.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ minHeight: "100vh", background: "#071116", color: "#dbe7ef", padding: 20, fontFamily: "\"Segoe UI\", sans-serif" }}>
      <div style={{ maxWidth: 1440, margin: "0 auto", display: "grid", gap: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 30 }}>{settingsForm.platformName} Admin</h1>
            <div style={{ marginTop: 6, color: "#7e97a5", fontSize: 13 }}>{message || "Issue frontend accounts and control platform behavior."}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ color: "#56d7c4", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.16em" }}>{viewer.displayName}</div>
              <div style={{ color: "#93aab6", fontSize: 12 }}>{viewer.username}</div>
            </div>
            <button onClick={() => void refresh()} style={ghostButton}>Refresh</button>
            <button onClick={onLogout} style={ghostButton}>Logout</button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(360px, 420px) minmax(360px, 420px) minmax(0, 1fr)", gap: 16 }}>
          <section style={panel}>
            <div style={panelTitle}>Frontend Users</div>
            <div style={stack}>
              <Field label="Username" value={newUserForm.username} onChange={(value) => setNewUserForm((current) => ({ ...current, username: value }))} />
              <Field label="Display Name" value={newUserForm.displayName} onChange={(value) => setNewUserForm((current) => ({ ...current, displayName: value }))} />
              <Field label="Password" value={newUserForm.password} type="password" onChange={(value) => setNewUserForm((current) => ({ ...current, password: value }))} />
              <Field label="Trading Account Id" value={newUserForm.tradingAccountId} onChange={(value) => setNewUserForm((current) => ({ ...current, tradingAccountId: value }))} />
              <button onClick={() => void createUser()} style={primaryButton} disabled={busy}>Issue Frontend User</button>
              <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
                {users.map((user) => (
                  <div key={user.id} style={{ border: "1px solid #16262f", borderRadius: 12, padding: 12, background: "#0d1a21", display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <strong>{user.username}</strong>
                      <span style={{ color: user.isActive ? "#86efac" : "#fca5a5" }}>{user.isActive ? "Active" : "Disabled"}</span>
                    </div>
                    <div style={{ color: "#7e97a5", fontSize: 12 }}>{user.displayName} · trading account {user.tradingAccountId ?? "-"}</div>
                    {editingUserId === user.id ? (
                      <div style={{ display: "grid", gap: 8 }}>
                        <Field label="Display Name" value={editUserForm.displayName} onChange={(value) => setEditUserForm((current) => ({ ...current, displayName: value }))} />
                        <Field label="Reset Password" value={editUserForm.password} type="password" onChange={(value) => setEditUserForm((current) => ({ ...current, password: value }))} />
                        <Field label="Trading Account Id" value={editUserForm.tradingAccountId} onChange={(value) => setEditUserForm((current) => ({ ...current, tradingAccountId: value }))} />
                        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                          <input type="checkbox" checked={editUserForm.isActive} onChange={(event) => setEditUserForm((current) => ({ ...current, isActive: event.target.checked }))} />
                          Active
                        </label>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={() => void saveUser()} style={primaryButton}>Save</button>
                          <button onClick={() => setEditingUserId(null)} style={ghostButton}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => beginEditUser(user)} style={ghostButton}>Edit User</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section style={panel}>
            <div style={panelTitle}>Platform Settings</div>
            <div style={stack}>
              <Field label="Platform Name" value={settingsForm.platformName} onChange={(value) => setSettingsForm((current) => ({ ...current, platformName: value }))} />
              <Field label="Announcement" value={settingsForm.platformAnnouncement} onChange={(value) => setSettingsForm((current) => ({ ...current, platformAnnouncement: value }))} />
              <Toggle label="Allow Frontend Trading" checked={settingsForm.allowFrontendTrading} onChange={(checked) => setSettingsForm((current) => ({ ...current, allowFrontendTrading: checked }))} />
              <Toggle label="Allow Manual Ticks" checked={settingsForm.allowManualTicks} onChange={(checked) => setSettingsForm((current) => ({ ...current, allowManualTicks: checked }))} />
              <Toggle label="Allow Simulator Control" checked={settingsForm.allowSimulatorControl} onChange={(checked) => setSettingsForm((current) => ({ ...current, allowSimulatorControl: checked }))} />
              <button onClick={() => void saveSettings()} style={primaryButton} disabled={busy}>Save Platform Settings</button>
            </div>
          </section>

          <section style={panel}>
            <div style={panelTitle}>Market Operations</div>
            <div style={{ display: "grid", gap: 18 }}>
              <div style={{ display: "grid", gap: 12 }}>
                <strong>Simulator</strong>
                <Metric label="Status" value={state.simulator?.enabled ? "Running" : "Stopped"} />
                <Metric label="Last Price" value={fmt(state.simulator?.lastPrice, 2)} />
                <Field label="Tick Interval ms" value={simForm.intervalMs} onChange={(value) => setSimForm((current) => ({ ...current, intervalMs: value }))} />
                <Field label="Volatility bps" value={simForm.volatilityBps} onChange={(value) => setSimForm((current) => ({ ...current, volatilityBps: value }))} />
                <Field label="Drift bps" value={simForm.driftBps} onChange={(value) => setSimForm((current) => ({ ...current, driftBps: value }))} />
                <Field label="Anchor Price" value={simForm.anchorPrice} onChange={(value) => setSimForm((current) => ({ ...current, anchorPrice: value }))} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <button onClick={() => void updateSimulator("start")} style={primaryButton} disabled={busy}>Start</button>
                  <button onClick={() => void updateSimulator("stop")} style={ghostButton} disabled={busy}>Stop</button>
                </div>
              </div>

              <div style={{ display: "grid", gap: 12 }}>
                <strong>Manual Tick</strong>
                <Metric label="Current Bid" value={fmt(state.latestTick?.bid, 2)} />
                <Metric label="Current Ask" value={fmt(state.latestTick?.ask, 2)} />
                <Metric label="Current Last" value={fmt(state.latestTick?.last, 2)} />
                <Field label="Symbol" value={tickForm.symbol} onChange={(value) => setTickForm((current) => ({ ...current, symbol: value }))} />
                <Field label="Bid" value={tickForm.bid} onChange={(value) => setTickForm((current) => ({ ...current, bid: value }))} />
                <Field label="Ask" value={tickForm.ask} onChange={(value) => setTickForm((current) => ({ ...current, ask: value }))} />
                <Field label="Last" value={tickForm.last} onChange={(value) => setTickForm((current) => ({ ...current, last: value }))} />
                <Field label="Spread" value={tickForm.spread} onChange={(value) => setTickForm((current) => ({ ...current, spread: value }))} />
                <button onClick={() => void submitTick()} style={primaryButton} disabled={busy}>Push Manual Tick</button>
              </div>

              <div style={{ display: "grid", gap: 8, maxHeight: 320, overflow: "auto" }}>
                <strong>Recent Events</strong>
                {state.events.slice(-18).reverse().map((event) => (
                  <div key={event.eventId} style={{ border: "1px solid #16262f", borderRadius: 10, padding: 10, background: "#0f1b22" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <strong>{event.eventType}</strong>
                      <span style={{ color: "#7e97a5", fontSize: 12 }}>{new Date(event.occurredAt).toLocaleTimeString("en-US", { hour12: false })}</span>
                    </div>
                    <div style={{ marginTop: 6, color: "#7e97a5", fontSize: 12 }}>{event.symbol} · {event.source}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  type
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span style={{ color: "#7e97a5", fontSize: 12 }}>{label}</span>
      <input
        type={type ?? "text"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{ borderRadius: 10, border: "1px solid #22343d", background: "#101b22", color: "#f8fafc", padding: "11px 12px" }}
      />
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 14px", borderRadius: 10, border: "1px solid #1c2f38", background: "#0f1b22" }}>
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
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

const panel: CSSProperties = {
  background: "#0b161d",
  border: "1px solid #16262f",
  borderRadius: 14,
  padding: 16
};

const panelTitle: CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  marginBottom: 14
};

const stack: CSSProperties = {
  display: "grid",
  gap: 12
};

const ghostButton: CSSProperties = {
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "#253740",
  background: "#111d24",
  color: "#dce7ee",
  padding: "10px 14px",
  borderRadius: 10,
  cursor: "pointer"
};

const primaryButton: CSSProperties = {
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
