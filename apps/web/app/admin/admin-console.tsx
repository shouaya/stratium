"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import { authHeaders, type AppLocale, type AuthUser, type PlatformSettings } from "../auth-client";
import { APP_LOCALES, getUiText, LOCALE_LABELS } from "../i18n";

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
type AdminMenu = "dashboard" | "users" | "platform" | "market" | "batch";

type BatchJobDefinition = {
  id: "db-bootstrap" | "batch-clear-kline" | "batch-import-hl-day" | "batch-refresh-hl-day";
  label: string;
  description: string;
};

type BatchJobRunResult = {
  ok: boolean;
  command?: string;
  args?: string[];
  stdout?: string;
  stderr?: string;
  code?: number;
  message?: string;
};

type AdminState = {
  latestTick?: TickPayload;
  simulator?: MarketSimulatorState;
  platform?: PlatformSettings;
};

const fmt = (n?: number | null, d = 2) => n == null ? "-" : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const stamp = (value?: string) => value ? new Date(value).toLocaleString("en-US", { hour12: false }) : "--";

const MENU_ITEMS: Array<{ id: AdminMenu; label: string; hint: string }> = [
  { id: "dashboard", label: "Dashboard", hint: "Overview and quick actions" },
  { id: "users", label: "User Management", hint: "Issue and edit frontend users" },
  { id: "platform", label: "Platform Settings", hint: "Control trading and admin switches" },
  { id: "market", label: "Market Operations", hint: "Simulator and manual tick control" },
  { id: "batch", label: "Batch Jobs", hint: "Run data import and refresh jobs" }
];

const ADMIN_SECTION_PATHS: Record<AdminMenu, string> = {
  dashboard: "/admin/dashboard",
  users: "/admin/users",
  platform: "/admin/platform",
  market: "/admin/market",
  batch: "/admin/batch"
};

export function AdminConsole({
  apiBaseUrl,
  authToken,
  viewer,
  locale,
  currentSection,
  onLocaleChange,
  onLogout
}: {
  apiBaseUrl: string;
  authToken: string;
  viewer: AuthUser;
  locale: AppLocale;
  currentSection: AdminMenu;
  onLocaleChange: (locale: AppLocale) => void;
  onLogout: () => void;
}) {
  const router = useRouter();
  const [state, setState] = useState<AdminState>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState<FrontendUser[]>([]);
  const [jobs, setJobs] = useState<BatchJobDefinition[]>([]);
  const [jobResult, setJobResult] = useState<BatchJobRunResult | null>(null);
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
  const [batchForm, setBatchForm] = useState({
    coin: "BTC",
    date: new Date().toISOString().slice(0, 10),
    interval: "1m"
  });
  const ui = getUiText(locale);

  const activeUserCount = useMemo(() => users.filter((user) => user.isActive).length, [users]);

  useEffect(() => {
    void refresh();

    const ws = new WebSocket(`${apiBaseUrl.replace(/^http/, "ws")}/ws?token=${encodeURIComponent(authToken)}`);
    ws.addEventListener("message", (event) => {
      const payload = JSON.parse(event.data) as {
        state?: { latestTick?: TickPayload };
        simulator?: MarketSimulatorState;
        platform?: PlatformSettings;
      };

      if (!payload.state) {
        return;
      }

      setState((current) => ({
        latestTick: payload.state?.latestTick ?? current.latestTick,
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
      const [stateResponse, usersResponse, settingsResponse, jobsResponse] = await Promise.all([
        fetch(`${apiBaseUrl}/api/admin/state`, { headers: authHeaders(authToken, locale), cache: "no-store" }),
        fetch(`${apiBaseUrl}/api/admin/users`, { headers: authHeaders(authToken, locale), cache: "no-store" }),
        fetch(`${apiBaseUrl}/api/admin/platform-settings`, { headers: authHeaders(authToken, locale), cache: "no-store" }),
        fetch(`${apiBaseUrl}/api/admin/batch-jobs`, { headers: authHeaders(authToken, locale), cache: "no-store" })
      ]);

      if ([stateResponse, usersResponse, settingsResponse, jobsResponse].some((response) => response.status === 401)) {
        setMessage(ui.admin.sessionExpired);
        onLogout();
        return;
      }

      const statePayload = await stateResponse.json() as AdminState;
      const usersPayload = await usersResponse.json() as { users: FrontendUser[] };
      const settingsPayload = await settingsResponse.json() as PlatformSettings;
      const jobsPayload = await jobsResponse.json() as { jobs: BatchJobDefinition[] };

      setState(statePayload);
      setUsers(usersPayload.users);
      setSettingsForm(settingsPayload);
      setJobs(jobsPayload.jobs);
      setMessage("");
    } catch {
      setMessage(ui.admin.failedLoadAdminData);
    }
  };

  const updateSimulator = async (action: "start" | "stop") => {
    setBusy(true);

    try {
      const response = await fetch(`${apiBaseUrl}/api/market-simulator/${action}`, {
        method: "POST",
        headers: authHeaders(authToken, locale, { "Content-Type": "application/json" }),
        body: action === "start" ? JSON.stringify({
          intervalMs: Number(simForm.intervalMs),
          volatilityBps: Number(simForm.volatilityBps),
          driftBps: Number(simForm.driftBps),
          anchorPrice: Number(simForm.anchorPrice)
        }) : undefined
      });
      const payload = await response.json().catch(() => ({})) as { simulator?: MarketSimulatorState; message?: string };

      if (!response.ok) {
        setMessage(payload.message ?? ui.admin.failedRolling);
        return;
      }

      setState((current) => ({
        ...current,
        simulator: payload.simulator ?? current.simulator
      }));
      setMessage(action === "start" ? ui.admin.rollingStarted : ui.admin.rollingStopped);
    } finally {
      setBusy(false);
    }
  };

  const submitTick = async () => {
    setBusy(true);

    try {
      const response = await fetch(`${apiBaseUrl}/api/market-ticks`, {
        method: "POST",
        headers: authHeaders(authToken, locale, { "Content-Type": "application/json" }),
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
      setMessage(response.ok ? ui.admin.manualTickAccepted : payload.message ?? ui.admin.manualTickRejected);
    } finally {
      setBusy(false);
    }
  };

  const createUser = async () => {
    setBusy(true);

    try {
      const response = await fetch(`${apiBaseUrl}/api/admin/users`, {
        method: "POST",
        headers: authHeaders(authToken, locale, { "Content-Type": "application/json" }),
        body: JSON.stringify(newUserForm)
      });
      const payload = await response.json().catch(() => ({})) as { message?: string };

      if (!response.ok) {
        setMessage(payload.message ?? ui.admin.failedCreateUser);
        return;
      }

      setNewUserForm({ username: "", displayName: "", password: "", tradingAccountId: "paper-account-1" });
      setMessage(ui.admin.userCreated);
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
        headers: authHeaders(authToken, locale, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          displayName: editUserForm.displayName,
          password: editUserForm.password || undefined,
          tradingAccountId: editUserForm.tradingAccountId,
          isActive: editUserForm.isActive
        })
      });
      const payload = await response.json().catch(() => ({})) as { message?: string };

      if (!response.ok) {
        setMessage(payload.message ?? ui.admin.failedUpdateUser);
        return;
      }

      setEditingUserId(null);
      setMessage(ui.admin.userUpdated);
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
        headers: authHeaders(authToken, locale, { "Content-Type": "application/json" }),
        body: JSON.stringify(settingsForm)
      });
      const payload = await response.json().catch(() => ({})) as PlatformSettings & { message?: string };

      if (!response.ok) {
        setMessage(payload.message ?? ui.admin.failedPlatformUpdated);
        return;
      }

      setSettingsForm(payload);
      setMessage(ui.admin.platformUpdated);
    } finally {
      setBusy(false);
    }
  };

  const runBatchJob = async (jobId: BatchJobDefinition["id"]) => {
    setBusy(true);
    setJobResult(null);

    try {
      const response = await fetch(`${apiBaseUrl}/api/admin/batch-jobs/${jobId}/run`, {
        method: "POST",
        headers: authHeaders(authToken, locale, { "Content-Type": "application/json" }),
        body: JSON.stringify(batchForm)
      });
      const payload = await response.json().catch(() => ({})) as BatchJobRunResult;
      setJobResult(payload);
      setMessage(response.ok && payload.ok ? ui.admin.batchCompleted : payload.message ?? ui.admin.batchFailed);
    } finally {
      setBusy(false);
    }
  };

  const renderDashboard = () => (
    <div style={{ display: "grid", gap: 16 }}>
      <section style={heroPanel}>
        <div>
          <div style={{ color: "#56d7c4", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.18em" }}>{ui.admin.overview}</div>
          <h2 style={{ margin: "10px 0 6px", fontSize: 34 }}>{settingsForm.platformName}</h2>
          <div style={{ color: "#8aa0ac", maxWidth: 640 }}>
            {settingsForm.platformAnnouncement || ui.admin.workspace}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => router.push(ADMIN_SECTION_PATHS.users)} style={primaryButton}>{ui.admin.users}</button>
          <button onClick={() => router.push(ADMIN_SECTION_PATHS.batch)} style={ghostButton}>{ui.admin.batch}</button>
        </div>
      </section>

      <div style={metricGrid}>
        <MetricCard label={ui.admin.frontendUsers} value={String(users.length)} detail={`${activeUserCount} ${ui.admin.activeUsers.toLowerCase()}`} />
        <MetricCard label={ui.admin.trading} value={settingsForm.allowFrontendTrading ? ui.common.active : ui.common.disabled} detail="frontend order switch" tone={settingsForm.allowFrontendTrading ? "good" : "bad"} />
        <MetricCard label={ui.admin.simulator} value={state.simulator?.enabled ? ui.common.active : ui.common.disabled} detail={state.simulator?.enabled ? `${state.simulator.tickCount} ticks` : "market simulator"} tone={state.simulator?.enabled ? "good" : undefined} />
        <MetricCard label={ui.admin.lastPrice} value={fmt(state.latestTick?.last, 2)} detail={stamp(state.latestTick?.tickTime)} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 16 }}>
        <section style={panel}>
          <div style={panelTitle}>{ui.admin.quickStatus}</div>
          <div style={stack}>
            <StatusRow label={ui.admin.announcement} value={settingsForm.platformAnnouncement || "-"} />
            <StatusRow label={ui.admin.allowManualTicks} value={settingsForm.allowManualTicks ? ui.common.active : ui.common.disabled} />
            <StatusRow label={ui.admin.allowSimulatorControl} value={settingsForm.allowSimulatorControl ? ui.common.active : ui.common.disabled} />
            <StatusRow label={`${ui.admin.currentBid} / ${ui.admin.currentAsk}`} value={`${fmt(state.latestTick?.bid, 2)} / ${fmt(state.latestTick?.ask, 2)}`} />
            <StatusRow label={ui.admin.symbol} value={tickForm.symbol} />
          </div>
        </section>

        <section style={panel}>
          <div style={panelTitle}>{ui.admin.quickActions}</div>
          <div style={{ display: "grid", gap: 10 }}>
            <button onClick={() => void updateSimulator(state.simulator?.enabled ? "stop" : "start")} style={primaryButton} disabled={busy}>
              {state.simulator?.enabled ? `${ui.admin.stop} ${ui.admin.simulator}` : `${ui.admin.start} ${ui.admin.simulator}`}
            </button>
            <button onClick={() => router.push(ADMIN_SECTION_PATHS.platform)} style={ghostButton}>{ui.admin.platform}</button>
            <button onClick={() => router.push(ADMIN_SECTION_PATHS.market)} style={ghostButton}>{ui.admin.market}</button>
            <button onClick={() => void runBatchJob("batch-refresh-hl-day")} style={ghostButton} disabled={busy}>Refresh Hyperliquid Day</button>
          </div>
        </section>
      </div>
    </div>
  );

  const renderUsers = () => (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 380px) minmax(0, 1fr)", gap: 16 }}>
      <section style={panel}>
        <div style={panelTitle}>{ui.admin.issueUser}</div>
        <div style={stack}>
          <Field label={ui.login.username} value={newUserForm.username} onChange={(value) => setNewUserForm((current) => ({ ...current, username: value }))} />
          <Field label={ui.admin.displayName} value={newUserForm.displayName} onChange={(value) => setNewUserForm((current) => ({ ...current, displayName: value }))} />
          <Field label={ui.login.password} value={newUserForm.password} type="password" onChange={(value) => setNewUserForm((current) => ({ ...current, password: value }))} />
          <Field label={ui.admin.tradingAccountId} value={newUserForm.tradingAccountId} onChange={(value) => setNewUserForm((current) => ({ ...current, tradingAccountId: value }))} />
          <button onClick={() => void createUser()} style={primaryButton} disabled={busy}>{ui.admin.issueUser}</button>
        </div>
      </section>

      <section style={panel}>
        <div style={panelTitle}>{ui.admin.frontendUsers}</div>
        <div style={{ display: "grid", gap: 12 }}>
          {users.map((user) => (
            <div key={user.id} style={userCard}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <strong>{user.displayName}</strong>
                  <div style={{ marginTop: 4, color: "#8ba1ad", fontSize: 12 }}>{user.username}</div>
                </div>
                <span style={{ color: user.isActive ? "#86efac" : "#fca5a5", fontSize: 12 }}>{user.isActive ? ui.common.active : ui.common.disabled}</span>
              </div>
              <div style={{ color: "#7e97a5", fontSize: 12 }}>{ui.admin.tradingAccountId}: {user.tradingAccountId ?? "-"}</div>
              {editingUserId === user.id ? (
                <div style={{ display: "grid", gap: 8 }}>
                  <Field label={ui.admin.displayName} value={editUserForm.displayName} onChange={(value) => setEditUserForm((current) => ({ ...current, displayName: value }))} />
                  <Field label={ui.admin.resetPassword} value={editUserForm.password} type="password" onChange={(value) => setEditUserForm((current) => ({ ...current, password: value }))} />
                  <Field label={ui.admin.tradingAccountId} value={editUserForm.tradingAccountId} onChange={(value) => setEditUserForm((current) => ({ ...current, tradingAccountId: value }))} />
                  <Toggle label={ui.common.active} checked={editUserForm.isActive} onChange={(checked) => setEditUserForm((current) => ({ ...current, isActive: checked }))} />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => void saveUser()} style={primaryButton}>{ui.common.save}</button>
                    <button onClick={() => setEditingUserId(null)} style={ghostButton}>{ui.common.cancel}</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => beginEditUser(user)} style={ghostButton}>{ui.admin.editUser}</button>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );

  const renderPlatform = () => (
    <section style={panel}>
      <div style={panelTitle}>{ui.admin.platform}</div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 640px)", gap: 12 }}>
        <Field label={ui.admin.platformName} value={settingsForm.platformName} onChange={(value) => setSettingsForm((current) => ({ ...current, platformName: value }))} />
        <Field label={ui.admin.announcement} value={settingsForm.platformAnnouncement} onChange={(value) => setSettingsForm((current) => ({ ...current, platformAnnouncement: value }))} />
        <Toggle label={ui.admin.allowFrontendTrading} checked={settingsForm.allowFrontendTrading} onChange={(checked) => setSettingsForm((current) => ({ ...current, allowFrontendTrading: checked }))} />
        <Toggle label={ui.admin.allowManualTicks} checked={settingsForm.allowManualTicks} onChange={(checked) => setSettingsForm((current) => ({ ...current, allowManualTicks: checked }))} />
        <Toggle label={ui.admin.allowSimulatorControl} checked={settingsForm.allowSimulatorControl} onChange={(checked) => setSettingsForm((current) => ({ ...current, allowSimulatorControl: checked }))} />
        <button onClick={() => void saveSettings()} style={primaryButton} disabled={busy}>{ui.admin.savePlatform}</button>
      </div>
    </section>
  );

  const renderMarket = () => (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 420px) minmax(320px, 420px)", gap: 16 }}>
      <section style={panel}>
        <div style={panelTitle}>{ui.admin.simulator}</div>
        <div style={stack}>
          <StatusRow label={ui.admin.status} value={state.simulator?.enabled ? ui.common.active : ui.common.disabled} />
          <StatusRow label={ui.admin.lastPrice} value={fmt(state.simulator?.lastPrice, 2)} />
          <StatusRow label="Ticks" value={String(state.simulator?.tickCount ?? 0)} />
          <Field label={ui.admin.tickInterval} value={simForm.intervalMs} onChange={(value) => setSimForm((current) => ({ ...current, intervalMs: value }))} />
          <Field label={ui.admin.volatilityBps} value={simForm.volatilityBps} onChange={(value) => setSimForm((current) => ({ ...current, volatilityBps: value }))} />
          <Field label={ui.admin.driftBps} value={simForm.driftBps} onChange={(value) => setSimForm((current) => ({ ...current, driftBps: value }))} />
          <Field label={ui.admin.anchorPrice} value={simForm.anchorPrice} onChange={(value) => setSimForm((current) => ({ ...current, anchorPrice: value }))} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button onClick={() => void updateSimulator("start")} style={primaryButton} disabled={busy}>{ui.admin.start}</button>
            <button onClick={() => void updateSimulator("stop")} style={ghostButton} disabled={busy}>{ui.admin.stop}</button>
          </div>
        </div>
      </section>

      <section style={panel}>
        <div style={panelTitle}>{ui.admin.pushManualTick}</div>
        <div style={stack}>
          <StatusRow label={ui.admin.currentBid} value={fmt(state.latestTick?.bid, 2)} />
          <StatusRow label={ui.admin.currentAsk} value={fmt(state.latestTick?.ask, 2)} />
          <StatusRow label={ui.admin.currentLast} value={fmt(state.latestTick?.last, 2)} />
          <Field label={ui.admin.symbol} value={tickForm.symbol} onChange={(value) => setTickForm((current) => ({ ...current, symbol: value }))} />
          <Field label={ui.admin.bid} value={tickForm.bid} onChange={(value) => setTickForm((current) => ({ ...current, bid: value }))} />
          <Field label={ui.admin.ask} value={tickForm.ask} onChange={(value) => setTickForm((current) => ({ ...current, ask: value }))} />
          <Field label={ui.admin.last} value={tickForm.last} onChange={(value) => setTickForm((current) => ({ ...current, last: value }))} />
          <Field label={ui.admin.spread} value={tickForm.spread} onChange={(value) => setTickForm((current) => ({ ...current, spread: value }))} />
          <button onClick={() => void submitTick()} style={primaryButton} disabled={busy}>{ui.admin.pushManualTick}</button>
        </div>
      </section>
    </div>
  );

  const renderBatchJobs = () => (
    <div style={{ display: "grid", gap: 16 }}>
      <section style={panel}>
        <div style={panelTitle}>{ui.admin.batchInputs}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(180px, 240px))", gap: 12 }}>
          <Field label="Coin" value={batchForm.coin} onChange={(value) => setBatchForm((current) => ({ ...current, coin: value.toUpperCase() }))} />
          <Field label="Date" value={batchForm.date} onChange={(value) => setBatchForm((current) => ({ ...current, date: value }))} />
          <Field label="Interval" value={batchForm.interval} onChange={(value) => setBatchForm((current) => ({ ...current, interval: value }))} />
        </div>
      </section>

      <section style={panel}>
        <div style={panelTitle}>{ui.admin.batchJobs}</div>
        <div style={{ display: "grid", gap: 12 }}>
          {jobs.map((job) => (
            <div key={job.id} style={jobCard}>
              <div>
                <strong>{job.label}</strong>
                <div style={{ marginTop: 6, color: "#8ba1ad", fontSize: 13 }}>{job.description}</div>
              </div>
              <button onClick={() => void runBatchJob(job.id)} style={primaryButton} disabled={busy}>{ui.admin.runJob}</button>
            </div>
          ))}
        </div>
      </section>

      <section style={panel}>
        <div style={panelTitle}>{ui.admin.lastBatchResult}</div>
        {jobResult ? (
          <div style={{ display: "grid", gap: 10 }}>
            <StatusRow label={ui.admin.status} value={jobResult.ok ? ui.common.active : ui.common.disabled} />
            <StatusRow label={ui.admin.command} value={jobResult.command ?? "-"} />
            <StatusRow label={ui.admin.args} value={jobResult.args?.join(" ") ?? "-"} />
            <pre style={consoleBlock}>{jobResult.stdout || "(no stdout)"}</pre>
            {jobResult.stderr ? <pre style={consoleBlockError}>{jobResult.stderr}</pre> : null}
          </div>
        ) : (
          <div style={{ color: "#7e97a5" }}>{ui.admin.noBatchRun}</div>
        )}
      </section>
    </div>
  );

  const content = (() => {
    switch (currentSection) {
      case "users":
        return renderUsers();
      case "platform":
        return renderPlatform();
      case "market":
        return renderMarket();
      case "batch":
        return renderBatchJobs();
      case "dashboard":
      default:
        return renderDashboard();
    }
  })();

  return (
    <main style={{ minHeight: "100vh", background: "#071116", color: "#dbe7ef", padding: 20, fontFamily: "\"Segoe UI\", sans-serif" }}>
      <div style={{ maxWidth: 1480, margin: "0 auto", display: "grid", gap: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
          <div>
            <div style={{ color: "#56d7c4", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.18em" }}>{viewer.displayName}</div>
            <h1 style={{ margin: "8px 0 6px", fontSize: 30 }}>{settingsForm.platformName} {ui.admin.titleSuffix}</h1>
            <div style={{ color: "#7e97a5", fontSize: 13 }}>{message || ui.admin.workspace}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "#7e97a5", fontSize: 11, whiteSpace: "nowrap" }}>{ui.common.language}</span>
              <select value={locale} onChange={(event) => onLocaleChange(event.target.value as AppLocale)} style={selectStyle}>
                {APP_LOCALES.map((entry) => <option key={entry} value={entry}>{LOCALE_LABELS[entry]}</option>)}
              </select>
            </label>
            <button onClick={() => void refresh()} style={ghostButton}>{ui.common.refresh}</button>
            <button onClick={onLogout} style={ghostButton}>{ui.common.logout}</button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "280px minmax(0, 1fr)", gap: 16 }}>
          <aside style={sidebar}>
            <div style={{ color: "#8ea4b0", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.16em" }}>{ui.admin.workspace}</div>
            <div style={{ display: "grid", gap: 8 }}>
              {MENU_ITEMS.map((item) => (
                <button
                  key={item.id}
                  onClick={() => router.push(ADMIN_SECTION_PATHS[item.id])}
                  style={item.id === currentSection ? menuButtonActive : menuButton}
                >
                  <strong style={{ display: "block", textAlign: "left" }}>{item.id === "dashboard" ? ui.admin.dashboard : item.id === "users" ? ui.admin.users : item.id === "platform" ? ui.admin.platform : item.id === "market" ? ui.admin.market : ui.admin.batch}</strong>
                  <span style={{ display: "block", marginTop: 4, color: item.id === currentSection ? "#d9fffb" : "#7e97a5", fontSize: 12, textAlign: "left" }}>{item.id === "dashboard" ? ui.admin.dashboardHint : item.id === "users" ? ui.admin.usersHint : item.id === "platform" ? ui.admin.platformHint : item.id === "market" ? ui.admin.marketHint : ui.admin.batchHint}</span>
                </button>
              ))}
            </div>
          </aside>

          <section style={{ display: "grid", gap: 16 }}>
            {content}
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

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ color: "#7e97a5", fontSize: 13 }}>{label}</span>
      <strong style={{ textAlign: "right" }}>{value}</strong>
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "good" | "bad";
}) {
  return (
    <div style={metricCard}>
      <div style={{ color: "#7e97a5", fontSize: 12 }}>{label}</div>
      <div style={{ marginTop: 8, color: tone === "good" ? "#86efac" : tone === "bad" ? "#fca5a5" : "#f8fafc", fontSize: 28, fontWeight: 700 }}>{value}</div>
      <div style={{ marginTop: 6, color: "#8aa0ac", fontSize: 12 }}>{detail}</div>
    </div>
  );
}

const panel: CSSProperties = {
  background: "#0b161d",
  border: "1px solid #16262f",
  borderRadius: 14,
  padding: 16
};

const heroPanel: CSSProperties = {
  ...panel,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "end",
  gap: 16,
  background: "linear-gradient(135deg, rgba(16, 37, 45, 0.96), rgba(10, 23, 29, 0.96))"
};

const sidebar: CSSProperties = {
  ...panel,
  alignSelf: "start",
  display: "grid",
  gap: 14,
  position: "sticky",
  top: 20
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

const metricGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  gap: 16
};

const metricCard: CSSProperties = {
  background: "#0b161d",
  border: "1px solid #16262f",
  borderRadius: 14,
  padding: 16
};

const userCard: CSSProperties = {
  border: "1px solid #16262f",
  borderRadius: 12,
  padding: 14,
  background: "#0d1a21",
  display: "grid",
  gap: 10
};

const jobCard: CSSProperties = {
  border: "1px solid #16262f",
  borderRadius: 12,
  padding: 14,
  background: "#0d1a21",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 16
};

const consoleBlock: CSSProperties = {
  margin: 0,
  borderRadius: 12,
  background: "#091217",
  border: "1px solid #16262f",
  color: "#b9d0dc",
  padding: 12,
  overflowX: "auto",
  whiteSpace: "pre-wrap",
  fontSize: 12
};

const consoleBlockError: CSSProperties = {
  ...consoleBlock,
  color: "#fecaca",
  border: "1px solid #4b1f25"
};

const menuButton: CSSProperties = {
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "#16262f",
  background: "#0d1a21",
  color: "#f1f7fb",
  padding: "14px 14px 12px",
  borderRadius: 12,
  cursor: "pointer"
};

const menuButtonActive: CSSProperties = {
  ...menuButton,
  borderColor: "#1f8a65",
  background: "linear-gradient(135deg, rgba(26, 107, 95, 0.32), rgba(13, 32, 39, 0.96))"
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

const selectStyle: CSSProperties = {
  borderRadius: 10,
  border: "1px solid #22343d",
  background: "#0f1b22",
  color: "#f8fafc",
  padding: "8px 10px",
  outline: "none"
};
