"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import { authHeaders, type AppLocale, type AuthUser, type PlatformSettings } from "../auth-client";
import { APP_LOCALES, getUiText, LOCALE_LABELS } from "../i18n";
import { formatTokyoDateTime } from "../time";
import { buildApiUrl, buildWebSocketUrl } from "../api-base-url";

type TickPayload = {
  bid: number;
  ask: number;
  last: number;
  spread: number;
  tickTime: string;
  volatilityTag?: string;
  symbol?: string;
};

type FrontendUser = AuthUser & { role: "frontend" };
type AdminMenu = "dashboard" | "users" | "platform" | "market" | "batch";

type BatchJobDefinition = {
  id: "db-bootstrap" | "batch-clear-kline" | "batch-import-hl-day" | "batch-refresh-hl-day" | "batch-switch-active-symbol";
  label: string;
  description: string;
};

type BatchJobRunResult = {
  executionId?: string;
  jobId?: BatchJobDefinition["id"];
  status?: "running" | "success" | "failed";
  startedAt?: string;
  finishedAt?: string;
  ok?: boolean;
  command?: string;
  args?: string[];
  stdout?: string;
  stderr?: string;
  code?: number;
  message?: string;
};

type RunningBatchJob = {
  executionId: string;
  jobId: BatchJobDefinition["id"];
  status: "running" | "success" | "failed";
  startedAt: string;
  finishedAt?: string;
  command?: string;
  args?: string[];
  stdout?: string;
  stderr?: string;
  code?: number;
  ok?: boolean;
  message?: string;
};

type AdminState = {
  latestTick?: TickPayload;
  platform?: PlatformSettings;
  runningBatchJobs?: RunningBatchJob[];
  lastBatchJobExecution?: BatchJobRunResult | null;
};

type SymbolOption = {
  source: string;
  symbol: string;
  coin: string;
  leverage: number;
  maxLeverage: number;
  szDecimals: number;
  quoteAsset: string;
};

const fmt = (n?: number | null, d = 2) => n == null ? "-" : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const stamp = (value?: string) => formatTokyoDateTime(value);

const MENU_ITEMS: Array<{ id: AdminMenu; label: string; hint: string }> = [
  { id: "dashboard", label: "Dashboard", hint: "Overview and quick actions" },
  { id: "users", label: "User Management", hint: "Issue and edit frontend users" },
  { id: "platform", label: "Platform Settings", hint: "Control trading and admin switches" },
  { id: "market", label: "Market Operations", hint: "Manual tick control" },
  { id: "batch", label: "Batch Jobs", hint: "Run data import and refresh jobs" }
];

const ADMIN_SECTION_PATHS: Record<AdminMenu, string> = {
  dashboard: "/admin/dashboard",
  users: "/admin/users",
  platform: "/admin/platform",
  market: "/admin/market",
  batch: "/admin/batch"
};
const INTERVAL_OPTIONS = ["1m", "5m", "15m", "1h"] as const;
const DEFAULT_EXCHANGE = "hyperliquid";

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
  const [symbolOptions, setSymbolOptions] = useState<SymbolOption[]>([]);
  const [jobResult, setJobResult] = useState<BatchJobRunResult | null>(null);
  const [runningJobs, setRunningJobs] = useState<RunningBatchJob[]>([]);
  const [tickForm, setTickForm] = useState({ symbol: "BTC-USD", bid: "", ask: "", last: "", spread: "" });
  const [newUserForm, setNewUserForm] = useState({ username: "", displayName: "", password: "" });
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editUserForm, setEditUserForm] = useState({ displayName: "", password: "", isActive: true });
  const [settingsForm, setSettingsForm] = useState<PlatformSettings>({
    platformName: "Stratium Demo",
    platformAnnouncement: "",
    activeExchange: DEFAULT_EXCHANGE,
    activeSymbol: "BTC-USD",
    maintenanceMode: false,
    allowFrontendTrading: true,
    allowManualTicks: true
  });
  const [batchForm, setBatchForm] = useState({
    exchange: DEFAULT_EXCHANGE,
    symbol: "BTC-USD",
    coin: "BTC",
    date: new Date().toISOString().slice(0, 10),
    interval: "1m"
  });
  const sectionLoadTokenRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsDirtyRef = useRef(false);
  const tickFormDirtyRef = useRef(false);
  const ui = getUiText(locale);

  const activeUserCount = useMemo(() => users.filter((user) => user.isActive).length, [users]);
  const refreshJobId: BatchJobDefinition["id"] = "batch-refresh-hl-day";
  const switchSymbolJobId: BatchJobDefinition["id"] = "batch-switch-active-symbol";
  const exchangeSelectOptions = useMemo(() => {
    const options = [...new Set(symbolOptions.map((entry) => entry.source))]
      .map((value) => ({ value, label: value }));

    if (batchForm.exchange && !options.some((entry) => entry.value === batchForm.exchange)) {
      options.unshift({ value: batchForm.exchange, label: batchForm.exchange });
    }

    return options;
  }, [batchForm.exchange, symbolOptions]);
  const symbolsForSelectedExchange = useMemo(
    () => symbolOptions.filter((entry) => entry.source === batchForm.exchange),
    [batchForm.exchange, symbolOptions]
  );
  const activeSymbolSelectOptions = useMemo(() => {
    const scopedSymbols = symbolsForSelectedExchange.filter((entry) => entry.coin === batchForm.coin);
    const options = (scopedSymbols.length > 0 ? scopedSymbols : symbolsForSelectedExchange)
      .map((entry) => ({ value: entry.symbol, label: entry.symbol }));

    if (batchForm.symbol && !options.some((entry) => entry.value === batchForm.symbol)) {
      options.unshift({ value: batchForm.symbol, label: batchForm.symbol });
    }

    return options;
  }, [batchForm.coin, batchForm.symbol, symbolsForSelectedExchange]);
  const coinSelectOptions = useMemo(() => {
    const options = [...new Set(symbolsForSelectedExchange.map((entry) => entry.coin))]
      .map((value) => ({ value, label: value }));

    if (batchForm.coin && !options.some((entry) => entry.value === batchForm.coin)) {
      options.unshift({ value: batchForm.coin, label: batchForm.coin });
    }

    return options;
  }, [batchForm.coin, symbolsForSelectedExchange]);

  useEffect(() => {
    let active = true;
    let socket: WebSocket | null = null;
    let hasConnected = false;

    const handlePayload = (payload: {
      state?: { latestTick?: TickPayload };
      platform?: PlatformSettings;
      batch?: {
        runningJobs?: RunningBatchJob[];
        lastExecution?: BatchJobRunResult | null;
      };
    }) => {
      if (payload.state) {
        setState((current) => ({
          latestTick: payload.state?.latestTick ?? current.latestTick,
          platform: payload.platform ?? current.platform
        }));
      } else if (payload.platform) {
        setState((current) => ({
          ...current,
          platform: payload.platform ?? current.platform
        }));
      }

      if (payload.platform) {
        if (!settingsDirtyRef.current) {
          setSettingsForm(payload.platform);
        }
      }

      if (payload.batch) {
        setRunningJobs(payload.batch.runningJobs ?? []);
        setJobResult(payload.batch.lastExecution ?? null);
      }
    };

    const scheduleReconnect = () => {
      if (!active || reconnectTimerRef.current) {
        return;
      }

      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, 1000);
    };

    const connect = () => {
      if (!active) {
        return;
      }

      socket = new WebSocket(buildWebSocketUrl(apiBaseUrl, authToken));
      socket.addEventListener("open", () => {
        if (hasConnected) {
          void refreshCurrentSection();
        }

        hasConnected = true;
      });
      socket.addEventListener("message", (event) => {
        handlePayload(JSON.parse(event.data) as Parameters<typeof handlePayload>[0]);
      });

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

  useEffect(() => {
    void refreshCurrentSection();
  }, [currentSection, locale, authToken, apiBaseUrl]);

  useEffect(() => {
    if (!state.latestTick) {
      return;
    }

    if (tickFormDirtyRef.current) {
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

  useEffect(() => {
    if (!settingsForm.activeSymbol) {
      return;
    }

    setBatchForm((current) => {
      const symbolMeta = symbolOptions.find((entry) => entry.symbol === settingsForm.activeSymbol);
      const exchange = settingsForm.activeExchange || symbolMeta?.source || current.exchange;
      const coin = symbolMeta?.coin ?? settingsForm.activeSymbol.replace(/-USD$/i, "");

      if (
        current.exchange === exchange
        && current.symbol === settingsForm.activeSymbol
        && current.coin === coin
      ) {
        return current;
      }

      return {
        ...current,
        exchange,
        symbol: settingsForm.activeSymbol,
        coin
      };
    });
  }, [settingsForm.activeExchange, settingsForm.activeSymbol, symbolOptions]);

  useEffect(() => {
    if (symbolOptions.length === 0) {
      return;
    }

    setBatchForm((current) => {
      const activeSymbolMeta = symbolOptions.find((entry) => entry.symbol === settingsForm.activeSymbol);
      const exchange = symbolsForSelectedExchange.length > 0
        ? current.exchange
        : settingsForm.activeExchange && symbolOptions.some((entry) => entry.source === settingsForm.activeExchange)
          ? settingsForm.activeExchange
          : activeSymbolMeta?.source ?? symbolOptions[0]?.source ?? current.exchange;
      const exchangeSymbols = symbolOptions.filter((entry) => entry.source === exchange);
      const coin = exchangeSymbols.some((entry) => entry.coin === current.coin)
        ? current.coin
        : activeSymbolMeta?.source === exchange
          ? activeSymbolMeta.coin
          : exchangeSymbols[0]?.coin ?? current.coin;
      const coinSymbols = exchangeSymbols.filter((entry) => entry.coin === coin);
      const symbol = coinSymbols.some((entry) => entry.symbol === current.symbol)
        ? current.symbol
        : activeSymbolMeta?.source === exchange && activeSymbolMeta.coin === coin
          ? activeSymbolMeta.symbol
          : coinSymbols[0]?.symbol ?? exchangeSymbols[0]?.symbol ?? current.symbol;

      if (exchange === current.exchange && symbol === current.symbol && coin === current.coin) {
        return current;
      }

      return {
        ...current,
        exchange,
        symbol,
        coin
      };
    });
  }, [settingsForm.activeExchange, settingsForm.activeSymbol, symbolOptions, symbolsForSelectedExchange.length]);

  const fetchJson = async <T,>(path: string): Promise<T | null> => {
      const response = await fetch(buildApiUrl(apiBaseUrl, path), {
      headers: authHeaders(authToken, locale),
      cache: "no-store"
    });

    if (response.status === 401) {
      setMessage(ui.admin.sessionExpired);
      onLogout();
      return null;
    }

    return response.json() as Promise<T>;
  };

  const loadAdminState = async () => {
    const payload = await fetchJson<AdminState>("/api/admin/state");

    if (!payload) {
      return false;
    }

    setState(payload);
    setRunningJobs(payload.runningBatchJobs ?? []);
    setJobResult(payload.lastBatchJobExecution ?? null);
    return true;
  };

  const loadUsers = async () => {
    const payload = await fetchJson<{ users: FrontendUser[] }>("/api/admin/users");

    if (!payload) {
      return false;
    }

    setUsers(payload.users);
    return true;
  };

  const loadPlatformSettings = async () => {
    const payload = await fetchJson<PlatformSettings>("/api/admin/platform-settings");

    if (!payload) {
      return false;
    }

    setSettingsForm(payload);
    settingsDirtyRef.current = false;
    return true;
  };

  const loadBatchJobs = async () => {
    const payload = await fetchJson<{ jobs: BatchJobDefinition[] }>("/api/admin/batch-jobs");

    if (!payload) {
      return false;
    }

    setJobs(payload.jobs);
    return true;
  };

  const loadSymbolOptions = async () => {
    const payload = await fetchJson<{ symbols: SymbolOption[] }>("/api/admin/symbol-configs");

    if (!payload) {
      return false;
    }

    setSymbolOptions(payload.symbols);
    return true;
  };

  const refreshCurrentSection = async () => {
    const loadToken = ++sectionLoadTokenRef.current;

    try {
      switch (currentSection) {
        case "dashboard":
          await Promise.all([loadAdminState(), loadUsers(), loadPlatformSettings(), loadSymbolOptions()]);
          break;
        case "users":
          await loadUsers();
          break;
        case "platform":
          await Promise.all([loadPlatformSettings(), loadSymbolOptions()]);
          break;
        case "market":
          await loadAdminState();
          break;
        case "batch":
          await Promise.all([loadAdminState(), loadBatchJobs(), loadSymbolOptions()]);
          break;
        default:
          await loadAdminState();
          break;
      }

      if (sectionLoadTokenRef.current !== loadToken) {
        return;
      }

      setMessage("");
    } catch {
      setMessage(ui.admin.failedLoadAdminData);
    }
  };

  const submitTick = async () => {
    setBusy(true);

    try {
      const response = await fetch(buildApiUrl(apiBaseUrl, "/api/market-ticks"), {
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
      if (response.ok) {
        tickFormDirtyRef.current = false;
      }
      setMessage(response.ok ? ui.admin.manualTickAccepted : payload.message ?? ui.admin.manualTickRejected);
    } finally {
      setBusy(false);
    }
  };

  const createUser = async () => {
    setBusy(true);

    try {
      const response = await fetch(buildApiUrl(apiBaseUrl, "/api/admin/users"), {
        method: "POST",
        headers: authHeaders(authToken, locale, { "Content-Type": "application/json" }),
        body: JSON.stringify(newUserForm)
      });
      const payload = await response.json().catch(() => ({})) as { message?: string };

      if (!response.ok) {
        setMessage(payload.message ?? ui.admin.failedCreateUser);
        return;
      }

      setNewUserForm({ username: "", displayName: "", password: "" });
      setMessage(ui.admin.userCreated);
      await loadUsers();
    } finally {
      setBusy(false);
    }
  };

  const beginEditUser = (user: FrontendUser) => {
    setEditingUserId(user.id);
    setEditUserForm({
      displayName: user.displayName,
      password: "",
      isActive: user.isActive
    });
  };

  const saveUser = async () => {
    if (!editingUserId) {
      return;
    }

    setBusy(true);

    try {
      const response = await fetch(buildApiUrl(apiBaseUrl, `/api/admin/users/${editingUserId}`), {
        method: "PUT",
        headers: authHeaders(authToken, locale, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          displayName: editUserForm.displayName,
          password: editUserForm.password || undefined,
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
      await loadUsers();
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = async () => {
    setBusy(true);

    try {
      const response = await fetch(buildApiUrl(apiBaseUrl, "/api/admin/platform-settings"), {
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
      settingsDirtyRef.current = false;
      setMessage(ui.admin.platformUpdated);
    } finally {
      setBusy(false);
    }
  };

  const runBatchJob = async (jobId: BatchJobDefinition["id"]) => {
    setBusy(true);
    setJobResult(null);

    try {
      const requestBody = jobId === refreshJobId
        ? {
          coin: batchForm.coin,
          interval: batchForm.interval
        }
        : jobId === switchSymbolJobId
          ? {
            exchange: batchForm.exchange,
            symbol: batchForm.symbol
          }
        : batchForm;
      const response = await fetch(buildApiUrl(apiBaseUrl, `/api/admin/batch-jobs/${jobId}/run`), {
        method: "POST",
        headers: authHeaders(authToken, locale, { "Content-Type": "application/json" }),
        body: JSON.stringify(requestBody)
      });
      const payload = await response.json().catch(() => ({})) as BatchJobRunResult;
      setJobResult(payload);

      if (response.ok && payload.status === "running" && payload.executionId) {
        const executionId = payload.executionId;

        setRunningJobs((current) => [
          ...current.filter((entry) => entry.executionId !== executionId),
          {
            executionId,
            jobId: payload.jobId ?? jobId,
            status: "running",
            startedAt: payload.startedAt ?? new Date().toISOString(),
            finishedAt: payload.finishedAt,
            command: payload.command,
            args: payload.args,
            stdout: payload.stdout,
            stderr: payload.stderr,
            code: payload.code,
            ok: payload.ok,
            message: payload.message
          }
        ]);
        setMessage(ui.admin.batchStarted);
      } else if (response.ok) {
        setMessage(payload.ok === false ? payload.message ?? ui.admin.batchFailed : ui.admin.batchCompleted);
      } else {
        setMessage(payload.message ?? ui.admin.batchFailed);
      }
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
        <MetricCard label={ui.admin.maintenanceMode} value={settingsForm.maintenanceMode ? ui.common.active : ui.common.disabled} detail="frontend access gate" tone={settingsForm.maintenanceMode ? "bad" : "good"} />
        <MetricCard label={ui.admin.lastPrice} value={fmt(state.latestTick?.last, 2)} detail={`${settingsForm.activeExchange}:${settingsForm.activeSymbol} · ${stamp(state.latestTick?.tickTime)}`} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 16 }}>
        <section style={panel}>
          <div style={panelTitle}>{ui.admin.quickStatus}</div>
          <div style={stack}>
            <StatusRow label={ui.admin.announcement} value={settingsForm.platformAnnouncement || "-"} />
            <StatusRow label={ui.admin.activeExchange} value={settingsForm.activeExchange} />
            <StatusRow label={ui.admin.activeSymbol} value={settingsForm.activeSymbol} />
            <StatusRow label={ui.admin.maintenanceMode} value={settingsForm.maintenanceMode ? ui.common.active : ui.common.disabled} />
            <StatusRow label={ui.admin.allowManualTicks} value={settingsForm.allowManualTicks ? ui.common.active : ui.common.disabled} />
            <StatusRow label={`${ui.admin.currentBid} / ${ui.admin.currentAsk}`} value={`${fmt(state.latestTick?.bid, 2)} / ${fmt(state.latestTick?.ask, 2)}`} />
            <StatusRow label={ui.admin.symbol} value={tickForm.symbol} />
          </div>
        </section>

        <section style={panel}>
          <div style={panelTitle}>{ui.admin.quickActions}</div>
          <div style={{ display: "grid", gap: 10 }}>
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
        <Field
          label={ui.admin.platformName}
          value={settingsForm.platformName}
          onChange={(value) => {
            settingsDirtyRef.current = true;
            setSettingsForm((current) => ({ ...current, platformName: value }));
          }}
        />
        <Field
          label={ui.admin.announcement}
          value={settingsForm.platformAnnouncement}
          onChange={(value) => {
            settingsDirtyRef.current = true;
            setSettingsForm((current) => ({ ...current, platformAnnouncement: value }));
          }}
        />
        <Field label={ui.admin.activeExchange} value={settingsForm.activeExchange} onChange={() => undefined} readOnly />
        <Field label={ui.admin.activeSymbol} value={settingsForm.activeSymbol} onChange={() => undefined} readOnly />
        <Toggle
          label={ui.admin.maintenanceMode}
          checked={settingsForm.maintenanceMode}
          onChange={(checked) => {
            settingsDirtyRef.current = true;
            setSettingsForm((current) => ({ ...current, maintenanceMode: checked }));
          }}
        />
        <Toggle
          label={ui.admin.allowFrontendTrading}
          checked={settingsForm.allowFrontendTrading}
          onChange={(checked) => {
            settingsDirtyRef.current = true;
            setSettingsForm((current) => ({ ...current, allowFrontendTrading: checked }));
          }}
        />
        <Toggle
          label={ui.admin.allowManualTicks}
          checked={settingsForm.allowManualTicks}
          onChange={(checked) => {
            settingsDirtyRef.current = true;
            setSettingsForm((current) => ({ ...current, allowManualTicks: checked }));
          }}
        />
        <button onClick={() => void saveSettings()} style={primaryButton} disabled={busy}>{ui.admin.savePlatform}</button>
      </div>
    </section>
  );

  const renderMarket = () => (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 420px)", gap: 16 }}>
      <section style={panel}>
        <div style={panelTitle}>{ui.admin.pushManualTick}</div>
        <div style={stack}>
          <StatusRow label={ui.admin.currentBid} value={fmt(state.latestTick?.bid, 2)} />
          <StatusRow label={ui.admin.currentAsk} value={fmt(state.latestTick?.ask, 2)} />
          <StatusRow label={ui.admin.currentLast} value={fmt(state.latestTick?.last, 2)} />
          <Field
            label={ui.admin.symbol}
            value={tickForm.symbol}
            onChange={(value) => {
              tickFormDirtyRef.current = true;
              setTickForm((current) => ({ ...current, symbol: value }));
            }}
          />
          <Field
            label={ui.admin.bid}
            value={tickForm.bid}
            onChange={(value) => {
              tickFormDirtyRef.current = true;
              setTickForm((current) => ({ ...current, bid: value }));
            }}
          />
          <Field
            label={ui.admin.ask}
            value={tickForm.ask}
            onChange={(value) => {
              tickFormDirtyRef.current = true;
              setTickForm((current) => ({ ...current, ask: value }));
            }}
          />
          <Field
            label={ui.admin.last}
            value={tickForm.last}
            onChange={(value) => {
              tickFormDirtyRef.current = true;
              setTickForm((current) => ({ ...current, last: value }));
            }}
          />
          <Field
            label={ui.admin.spread}
            value={tickForm.spread}
            onChange={(value) => {
              tickFormDirtyRef.current = true;
              setTickForm((current) => ({ ...current, spread: value }));
            }}
          />
          <button onClick={() => void submitTick()} style={primaryButton} disabled={busy}>{ui.admin.pushManualTick}</button>
        </div>
      </section>
    </div>
  );

  const renderBatchJobs = () => (
    <div style={{ display: "grid", gap: 16 }}>
      <section style={panel}>
        <div style={panelTitle}>{ui.admin.batchInputs}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(180px, 240px))", gap: 12 }}>
          <SelectField
            label={ui.admin.exchange}
            value={batchForm.exchange}
            options={exchangeSelectOptions}
            onChange={(value) => setBatchForm((current) => {
              const exchangeSymbols = symbolOptions.filter((entry) => entry.source === value);
              const coin = exchangeSymbols.some((entry) => entry.coin === current.coin)
                ? current.coin
                : exchangeSymbols[0]?.coin ?? current.coin;
              const symbol = exchangeSymbols.find((entry) => entry.coin === coin)?.symbol
                ?? exchangeSymbols[0]?.symbol
                ?? current.symbol;

              return {
                ...current,
                exchange: value,
                coin,
                symbol
              };
            })}
          />
          <SelectField
            label={ui.admin.activeSymbol}
            value={batchForm.symbol}
            options={activeSymbolSelectOptions}
            onChange={(value) => setBatchForm((current) => {
              const symbolMeta = symbolOptions.find((entry) => entry.symbol === value);

              return {
                ...current,
                exchange: symbolMeta?.source ?? current.exchange,
                symbol: value,
                coin: symbolMeta?.coin ?? value.replace(/-USD$/i, "")
              };
            })}
          />
          <SelectField
            label={ui.admin.coin}
            value={batchForm.coin}
            options={coinSelectOptions}
            onChange={(value) => setBatchForm((current) => {
              const coinSymbols = symbolOptions.filter((entry) => entry.source === current.exchange && entry.coin === value);

              return {
                ...current,
                coin: value,
                symbol: coinSymbols.find((entry) => entry.symbol === current.symbol)?.symbol ?? coinSymbols[0]?.symbol ?? current.symbol
              };
            })}
          />
          <SelectField
            label="Refresh Window"
            value="Latest 24h"
            options={[{ value: "Latest 24h", label: "Latest 24h" }]}
            onChange={() => undefined}
            disabled
          />
          <SelectField
            label="Interval"
            value={batchForm.interval}
            options={INTERVAL_OPTIONS.map((value) => ({ value, label: value }))}
            onChange={(value) => setBatchForm((current) => ({ ...current, interval: value }))}
          />
        </div>
        <div style={{ marginTop: 10, color: "#7e97a5", fontSize: 12 }}>
          {jobs.some((job) => job.id === refreshJobId) ? "Refresh Hyperliquid Day always uses the latest 24 hours." : ""}
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
        <div style={panelTitle}>{ui.admin.runningJobs}</div>
        {runningJobs.length === 0 ? (
          <div style={{ color: "#7e97a5" }}>{ui.admin.noRunningJobs}</div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {runningJobs.map((job) => (
              <div key={job.executionId} style={jobCard}>
                <div>
                  <strong>{jobs.find((entry) => entry.id === job.jobId)?.label ?? job.jobId}</strong>
                  <div style={{ marginTop: 6, color: "#8ba1ad", fontSize: 13 }}>{job.executionId}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ color: "#facc15", fontWeight: 700 }}>{ui.admin.running}</div>
                  <div style={{ marginTop: 6, color: "#8ba1ad", fontSize: 12 }}>{stamp(job.startedAt)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={panel}>
        <div style={panelTitle}>{ui.admin.lastBatchResult}</div>
        {jobResult ? (
          <div style={{ display: "grid", gap: 10 }}>
            <StatusRow label={ui.admin.status} value={jobResult.status === "running" ? ui.admin.running : jobResult.ok ? ui.admin.success : ui.admin.failed} />
            <StatusRow label={ui.admin.command} value={jobResult.command ?? "-"} />
            <StatusRow label={ui.admin.args} value={jobResult.args?.join(" ") ?? "-"} />
            <pre style={consoleBlock}>{jobResult.stdout || ui.admin.noStdout}</pre>
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
            <button onClick={() => void refreshCurrentSection()} style={ghostButton}>{ui.common.refresh}</button>
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
  type,
  readOnly
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  readOnly?: boolean;
}) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span style={{ color: "#7e97a5", fontSize: 12 }}>{label}</span>
      <input
        type={type ?? "text"}
        value={value}
        readOnly={readOnly}
        onChange={(event) => onChange(event.target.value)}
        style={{ borderRadius: 10, border: "1px solid #22343d", background: readOnly ? "#0d171d" : "#101b22", color: "#f8fafc", padding: "11px 12px" }}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
  disabled
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span style={{ color: "#7e97a5", fontSize: 12 }}>{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        style={{
          ...selectStyle,
          padding: "11px 12px",
          background: disabled ? "#0d171d" : "#101b22",
          cursor: disabled ? "default" : "pointer"
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
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
