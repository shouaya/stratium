"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import type { AiTraderAdminBotProfile, AiTraderAdminDashboardPayload, AiTraderPlanAction, AiTraderReviewSnapshot, AiTraderWakeReport } from "@stratium/shared";
import { authHeaders, type AppLocale, type AuthUser, type PlatformSettings } from "../auth-client";
import { APP_LOCALES, getUiText, LOCALE_LABELS } from "../i18n";
import { formatTokyoDateTime } from "../time";
import { buildApiUrl, buildWebSocketUrl } from "../api-base-url";
import {
  buildActiveSymbolSelectOptions,
  buildCoinSelectOptions,
  buildExchangeSelectOptions,
  filterSymbolsForExchange,
  filterVisibleBatchJobs,
  normalizeBatchFormForSymbolOptions,
  syncBatchFormWithActiveSymbol,
  syncTickFormFromLatestTick,
  updateBatchFormForCoin,
  updateBatchFormForExchange,
  updateBatchFormForSymbol,
  type BatchJobDefinition,
  type SymbolOption,
  type TickPayload
} from "./admin-console-helpers";

type FrontendUser = AuthUser & { role: "frontend" };
type AdminMenu = "dashboard" | "users" | "platform" | "market" | "batch" | "bots";

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

const fmt = (n?: number | null, d = 2) => n == null ? "-" : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const stamp = (value?: string) => formatTokyoDateTime(value);

const MENU_ITEMS: Array<{ id: AdminMenu; label: string; hint: string }> = [
  { id: "dashboard", label: "Dashboard", hint: "Overview and quick actions" },
  { id: "users", label: "User Management", hint: "Issue and edit frontend users" },
  { id: "platform", label: "Platform Settings", hint: "Control trading and admin switches" },
  { id: "market", label: "Market Operations", hint: "Manual tick control" },
  { id: "batch", label: "Batch Jobs", hint: "Run data import and refresh jobs" },
  { id: "bots", label: "Bot Dashboard", hint: "Monitor AI trader state and wakes" }
];

const ADMIN_SECTION_PATHS: Record<AdminMenu, string> = {
  dashboard: "/admin/dashboard",
  users: "/admin/users",
  platform: "/admin/platform",
  market: "/admin/market",
  batch: "/admin/batch",
  bots: "/admin/bots"
};
const INTERVAL_OPTIONS = ["1m", "5m", "15m", "1h"] as const;
const DEFAULT_EXCHANGE = "hyperliquid";
const SIM_INITIAL_EQUITY = 10_000;

type ChartPoint = {
  label: string;
  value: number;
  detail?: string;
};

type BarPoint = {
  label: string;
  value: number;
  tone?: "good" | "bad" | "neutral";
};

const finite = (value?: number | null): value is number =>
  typeof value === "number" && Number.isFinite(value);

const sortWakesAsc = (wakes: AiTraderWakeReport[]) =>
  [...wakes].sort((left, right) =>
    new Date(left.finishedAt).getTime() - new Date(right.finishedAt).getTime()
    || left.wakeId.localeCompare(right.wakeId)
  );

const buildBotPnlPoints = (wakes: AiTraderWakeReport[]): ChartPoint[] =>
  sortWakesAsc(wakes)
    .flatMap((wake) => {
      const equity = wake.accountSnapshot?.equity;
      if (!finite(equity)) {
        return [];
      }

      return [{
        label: stamp(wake.finishedAt),
        value: Number((equity - SIM_INITIAL_EQUITY).toFixed(6)),
        detail: wake.planSummary ?? wake.selectedCandidateId ?? wake.wakeId
      }];
    });

const buildBotActionMix = (wakes: AiTraderWakeReport[]): BarPoint[] => {
  const counts = new Map<string, number>();

  for (const wake of wakes) {
    for (const execution of wake.executionResults) {
      counts.set(execution.actionType, (counts.get(execution.actionType) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
    .map(([label, value]) => ({
      label,
      value,
      tone: label === "observe" ? "neutral" : label.includes("close") || label.includes("reduce") ? "bad" : "good"
    }));
};

const buildBotStatusMix = (review: AiTraderReviewSnapshot | null): BarPoint[] =>
  review
    ? Object.entries(review.orderStats.byStatus)
      .sort((left, right) => right[1] - left[1])
      .map(([label, value]) => ({
        label,
        value,
        tone: label === "FILLED" ? "good" : label === "CANCELED" ? "neutral" : label === "REJECTED" ? "bad" : "neutral"
      }))
    : [];

const actionTone = (status: string): "good" | "bad" | "neutral" =>
  status === "executed" ? "good" : status === "failed" || status === "rejected" ? "bad" : "neutral";

const orderTone = (status: string): "good" | "bad" | "neutral" =>
  status === "FILLED" ? "good" : status === "REJECTED" ? "bad" : "neutral";

const botWinRate = (review: AiTraderReviewSnapshot | null) => {
  const upSteps = review?.rewardStats?.upSteps ?? 0;
  const downSteps = review?.rewardStats?.downSteps ?? 0;
  const flatSteps = review?.rewardStats?.flatSteps ?? 0;
  const decisiveSteps = upSteps + downSteps;

  return {
    upSteps,
    downSteps,
    flatSteps,
    decisiveSteps,
    rate: decisiveSteps > 0 ? (upSteps / decisiveSteps) * 100 : undefined
  };
};

const botHealthTone = (health: AiTraderAdminBotProfile["health"]): "good" | "bad" | "neutral" =>
  health === "running" ? "good" : health === "failed" ? "bad" : "neutral";

const riskTone = (riskState: AiTraderAdminBotProfile["riskState"]): "good" | "bad" | "neutral" =>
  riskState === "normal" ? "good" : riskState === "limited" || riskState === "blocked" ? "bad" : "neutral";

const memorySourceTone = (source?: AiTraderWakeReport["memories"][number]["source"]): "good" | "bad" | "neutral" =>
  source === "reflection" || source === "strategy_package" ? "good" : "neutral";

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
  const [botDashboard, setBotDashboard] = useState<AiTraderAdminDashboardPayload | null>(null);
  const [botWakes, setBotWakes] = useState<AiTraderWakeReport[]>([]);
  const [botReview, setBotReview] = useState<AiTraderReviewSnapshot | null>(null);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
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
  const selectedBot = useMemo(
    () => botDashboard?.profiles.find((profile) => profile.botId === selectedBotId) ?? botDashboard?.profiles[0] ?? null,
    [botDashboard, selectedBotId]
  );
  const selectedBotWake = useMemo(
    () => selectedBot ? botWakes.find((wake) => wake.botId === selectedBot.botId) ?? botWakes[0] ?? null : null,
    [botWakes, selectedBot]
  );
  const botPnlPoints = useMemo(() => buildBotPnlPoints(botWakes), [botWakes]);
  const botActionMix = useMemo(() => buildBotActionMix(botWakes), [botWakes]);
  const botStatusMix = useMemo(() => buildBotStatusMix(botReview), [botReview]);
  const refreshJobId: BatchJobDefinition["id"] = "batch-refresh-hl-day";
  const switchSymbolJobId: BatchJobDefinition["id"] = "batch-switch-active-symbol";
  const visibleJobs = useMemo(
    () => filterVisibleBatchJobs(jobs),
    [jobs]
  );
  const exchangeSelectOptions = useMemo(() => {
    return buildExchangeSelectOptions(symbolOptions, batchForm.exchange);
  }, [batchForm.exchange, symbolOptions]);
  const symbolsForSelectedExchange = useMemo(
    () => filterSymbolsForExchange(symbolOptions, batchForm.exchange),
    [batchForm.exchange, symbolOptions]
  );
  const activeSymbolSelectOptions = useMemo(() => {
    return buildActiveSymbolSelectOptions(symbolsForSelectedExchange, batchForm.coin, batchForm.symbol);
  }, [batchForm.coin, batchForm.symbol, symbolsForSelectedExchange]);
  const coinSelectOptions = useMemo(() => {
    return buildCoinSelectOptions(symbolsForSelectedExchange, batchForm.coin);
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

    setTickForm((current) => syncTickFormFromLatestTick(current, state.latestTick));
  }, [state.latestTick?.tickTime]);

  useEffect(() => {
    if (!settingsForm.activeSymbol) {
      return;
    }

    setBatchForm((current) => syncBatchFormWithActiveSymbol(current, settingsForm, symbolOptions));
  }, [settingsForm.activeExchange, settingsForm.activeSymbol, symbolOptions]);

  useEffect(() => {
    if (symbolOptions.length === 0) {
      return;
    }

    setBatchForm((current) => normalizeBatchFormForSymbolOptions(current, settingsForm, symbolOptions, symbolsForSelectedExchange));
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

  const loadBotWakes = async (botId: string) => {
    const payload = await fetchJson<{ botId: string; wakes: AiTraderWakeReport[] }>(`/api/admin/bots/${encodeURIComponent(botId)}/wakes`);

    if (!payload) {
      return false;
    }

    setBotWakes(payload.wakes);
    return true;
  };

  const loadBotReview = async (botId: string, accountId?: string) => {
    const params = new URLSearchParams({
      limit: "200",
      ...(accountId ? { accountId } : {})
    });
    const payload = await fetchJson<{ botId: string; review: AiTraderReviewSnapshot }>(`/api/admin/bots/${encodeURIComponent(botId)}/review?${params.toString()}`);

    if (!payload) {
      return false;
    }

    setBotReview(payload.review);
    return true;
  };

  const loadSelectedBotAnalytics = async (botId: string, accountId?: string) => {
    const [wakesLoaded, reviewLoaded] = await Promise.all([
      loadBotWakes(botId),
      loadBotReview(botId, accountId)
    ]);

    return wakesLoaded && reviewLoaded;
  };

  const loadBotDashboard = async () => {
    const payload = await fetchJson<AiTraderAdminDashboardPayload>("/api/admin/bots/dashboard");

    if (!payload) {
      return false;
    }

    const nextBotId = selectedBotId && payload.profiles.some((profile) => profile.botId === selectedBotId)
      ? selectedBotId
      : payload.profiles[0]?.botId ?? null;

    setBotDashboard(payload);
    setSelectedBotId(nextBotId);

    if (!nextBotId) {
      setBotWakes([]);
      setBotReview(null);
      return true;
    }

    const nextProfile = payload.profiles.find((profile) => profile.botId === nextBotId);
    return loadSelectedBotAnalytics(nextBotId, nextProfile?.accountId);
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
        case "bots":
          await Promise.all([loadAdminState(), loadBotDashboard()]);
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

  const selectBot = async (botId: string) => {
    setSelectedBotId(botId);
    const profile = botDashboard?.profiles.find((entry) => entry.botId === botId);
    await loadSelectedBotAnalytics(botId, profile?.accountId);
  };

  const menuLabel = (item: AdminMenu) => ({
    dashboard: ui.admin.dashboard,
    users: ui.admin.users,
    platform: ui.admin.platform,
    market: ui.admin.market,
    batch: ui.admin.batch,
    bots: ui.admin.bots
  }[item]);

  const menuHint = (item: AdminMenu) => ({
    dashboard: ui.admin.dashboardHint,
    users: ui.admin.usersHint,
    platform: ui.admin.platformHint,
    market: ui.admin.marketHint,
    batch: ui.admin.batchHint,
    bots: ui.admin.botsHint
  }[item]);

  const botPosition = (profile: AiTraderAdminBotProfile) =>
    `${profile.position.side} ${fmt(profile.position.quantity, 4)} ${profile.position.symbol}`;

  const botScore = (score?: AiTraderWakeReport["score"] | null) =>
    score?.totalScore == null ? "-" : fmt(score.totalScore, 3);

  const botScoreDetail = (score?: AiTraderWakeReport["score"] | null) =>
    score
      ? `${ui.admin.confidence}: ${fmt(score.confidence, 3)} · ${ui.admin.riskState}: ${fmt(score.riskScore, 3)} · ${ui.admin.executionResults}: ${fmt(score.executionScore, 3)}`
      : "-";

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
          <button onClick={() => router.push(ADMIN_SECTION_PATHS.bots)} style={ghostButton}>{ui.admin.bots}</button>
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
            onChange={(value) => setBatchForm((current) => updateBatchFormForExchange(current, symbolOptions, value))}
          />
          <SelectField
            label={ui.admin.activeSymbol}
            value={batchForm.symbol}
            options={activeSymbolSelectOptions}
            onChange={(value) => setBatchForm((current) => updateBatchFormForSymbol(current, symbolOptions, value))}
          />
          <SelectField
            label={ui.admin.coin}
            value={batchForm.coin}
            options={coinSelectOptions}
            onChange={(value) => setBatchForm((current) => updateBatchFormForCoin(current, symbolOptions, value))}
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
          {visibleJobs.some((job) => job.id === refreshJobId) ? "Refresh Hyperliquid Day always uses the latest 24 hours." : ""}
        </div>
      </section>

      <section style={panel}>
        <div style={panelTitle}>{ui.admin.batchJobs}</div>
        <div style={{ display: "grid", gap: 12 }}>
          {visibleJobs.map((job) => (
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

  const renderBots = () => {
    const overview = botDashboard?.overview;
    const profiles = botDashboard?.profiles ?? [];
    const winRate = botWinRate(botReview);
    const winRateTone = winRate.rate == null ? "neutral" : winRate.rate >= 50 ? "good" : "bad";

    return (
      <div style={{ display: "grid", gap: 16 }}>
        <section style={heroPanel}>
          <div>
            <div style={{ color: "#56d7c4", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.18em" }}>{ui.admin.traderMcp}</div>
            <h2 style={{ margin: "10px 0 6px", fontSize: 34 }}>{ui.admin.botDashboard}</h2>
            <div style={{ color: "#8aa0ac", maxWidth: 680 }}>{ui.admin.botsHint}</div>
          </div>
          <button onClick={() => void refreshCurrentSection()} style={primaryButton}>{ui.common.refresh}</button>
        </section>

        <div style={metricGrid}>
          <MetricCard label={ui.admin.totalBots} value={String(overview?.totalBots ?? 0)} detail={`${overview?.enabledBots ?? 0} ${ui.admin.enabledBots.toLowerCase()}`} />
          <MetricCard label={ui.admin.paperExecuteBots} value={String(overview?.paperExecuteBots ?? 0)} detail={`${overview?.shadowBots ?? 0} ${ui.admin.shadowBots.toLowerCase()}`} tone={(overview?.paperExecuteBots ?? 0) > 0 ? "good" : undefined} />
          <MetricCard label={ui.admin.failedWakes24h} value={String(overview?.failedWakes24h ?? 0)} detail={`${overview?.riskRejections24h ?? 0} ${ui.admin.riskRejections24h.toLowerCase()}`} tone={(overview?.failedWakes24h ?? 0) > 0 ? "bad" : "good"} />
          <MetricCard label={ui.admin.simulatedPnl} value={fmt(overview?.totalSimulatedPnl ?? 0, 2)} detail={`${ui.admin.maxDrawdown}: ${fmt(overview?.maxDrawdownPct ?? 0, 2)}%`} tone={(overview?.totalSimulatedPnl ?? 0) >= 0 ? "good" : "bad"} />
        </div>

        {profiles.length === 0 ? (
          <section style={panel}>
            <div style={{ color: "#7e97a5" }}>{ui.admin.noBots}</div>
          </section>
        ) : (
          <div style={{ display: "grid", gap: 16 }}>
            <section style={botTabsPanel}>
              <div style={splitPanelTitle}>
                <div>
                  <div style={panelTitle}>{ui.admin.botProfiles}</div>
                  <div style={subtleText}>Switch the active trader bot; analytics below follow the selected tab.</div>
                </div>
                <span style={pill("neutral")}>{profiles.length} bots</span>
              </div>
              <div style={botTabsScroller}>
                {profiles.map((profile) => {
                  const isSelected = profile.botId === selectedBot?.botId;
                  const healthTone = botHealthTone(profile.health);

                  return (
                    <button
                      key={profile.botId}
                      onClick={() => void selectBot(profile.botId)}
                      style={isSelected ? botTabButtonActive : botTabButton}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "start" }}>
                        <div style={{ minWidth: 0 }}>
                          <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{profile.name}</strong>
                          <div style={{ marginTop: 4, color: "#8ba1ad", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{profile.botId}</div>
                        </div>
                        <span style={pill(healthTone)}>{profile.health}</span>
                      </div>
                      <div style={botTabMetaGrid}>
                        <span>{profile.symbol}</span>
                        <span>{profile.mode}</span>
                        <span>{botPosition(profile)}</span>
                        <span>score {botScore(profile.lastScore)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            <div style={{ display: "grid", gap: 16 }}>
              <section style={panel}>
                <div style={splitPanelTitle}>
                  <div>
                    <div style={panelTitle}>PnL Curve</div>
                    <div style={subtleText}>Equity delta from the simulation baseline across recorded wakes.</div>
                  </div>
                  <span style={pill((botPnlPoints.at(-1)?.value ?? 0) >= 0 ? "good" : "bad")}>
                    {fmt(botPnlPoints.at(-1)?.value ?? 0, 4)}
                  </span>
                </div>
                <div style={pnlCurveGrid}>
                  <div style={winRateCard}>
                    <div>
                      <div style={statusLabel}>Win Rate</div>
                      <div style={{ ...winRateValue, color: toneColor(winRateTone) }}>
                        {winRate.rate == null ? "-" : `${fmt(winRate.rate, 1)}%`}
                      </div>
                    </div>
                    <div style={{ display: "grid", gap: 10 }}>
                      <div style={winRateTrack}>
                        <div style={{ ...winRateFill, width: `${Math.max(0, Math.min(100, winRate.rate ?? 0))}%`, background: toneColor(winRateTone) }} />
                      </div>
                      <div style={winRateStatsGrid}>
                        <span>{winRate.upSteps} win</span>
                        <span>{winRate.downSteps} loss</span>
                        <span>{winRate.flatSteps} flat</span>
                      </div>
                    </div>
                  </div>
                  <LineChart points={botPnlPoints} height={220} />
                </div>
              </section>

              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 16 }}>
                <section style={panel}>
                  <div style={panelTitle}>Order Flow</div>
                  {botReview ? (
                    <div style={stack}>
                      <div style={miniMetricGrid}>
                        <MiniMetric label="Filled" value={String(botReview.orderStats.filled)} tone="good" />
                        <MiniMetric label="Open" value={String(botReview.orderStats.open)} />
                        <MiniMetric label="Canceled" value={String(botReview.orderStats.canceled)} tone="neutral" />
                        <MiniMetric label="Market" value={String(botReview.orderStats.marketFilled)} tone={botReview.orderStats.marketFilled > botReview.orderStats.limitFilled ? "bad" : "neutral"} />
                      </div>
                      {botReview.rewardStats || botReview.costStats ? (
                        <div style={miniMetricGrid}>
                          <MiniMetric label="Net Reward" value={fmt(botReview.rewardStats?.equityDelta, 4)} tone={(botReview.rewardStats?.equityDelta ?? 0) >= 0 ? "good" : "bad"} />
                          <MiniMetric label="Gross PnL" value={fmt(botReview.rewardStats?.grossRealizedPnl, 4)} tone={(botReview.rewardStats?.grossRealizedPnl ?? 0) >= 0 ? "good" : "bad"} />
                          <MiniMetric label="Fees" value={fmt(botReview.costStats?.totalFee, 4)} tone={(botReview.costStats?.totalFee ?? 0) > 0 ? "bad" : "neutral"} />
                          <MiniMetric label="Slip Cost" value={fmt(botReview.costStats?.estimatedSlippageCost, 4)} tone={(botReview.costStats?.estimatedSlippageCost ?? 0) > 0 ? "bad" : "neutral"} />
                        </div>
                      ) : null}
                      {botReview.rewardStats ? (
                        <div style={timelineMeta}>
                          <span>{botReview.rewardStats.upSteps} up steps</span>
                          <span>{botReview.rewardStats.downSteps} down steps</span>
                          <span>{botReview.rewardStats.flatSteps} flat steps</span>
                        </div>
                      ) : null}
                      <BarChart items={botStatusMix} />
                    </div>
                  ) : (
                    <EmptyState text="No review snapshot yet." />
                  )}
                </section>

                <section style={panel}>
                  <div style={panelTitle}>Action Mix</div>
                  {botActionMix.length > 0 ? (
                    <BarChart items={botActionMix} />
                  ) : (
                    <EmptyState text="No execution actions yet." />
                  )}
                </section>
              </div>

              <section style={panel}>
                <div style={splitPanelTitle}>
                  <div>
                    <div style={panelTitle}>{ui.admin.botStatus}</div>
                    <div style={subtleText}>Runtime, exposure, wake cadence, and current risk posture.</div>
                  </div>
                  {selectedBot ? <span style={pill(botHealthTone(selectedBot.health))}>{selectedBot.health}</span> : null}
                </div>
                {selectedBot ? (
                  <div style={stack}>
                    <div style={botStatusHero}>
                      <div style={{ minWidth: 0 }}>
                        <strong style={{ fontSize: 18 }}>{selectedBot.name}</strong>
                        <div style={{ marginTop: 5, color: "#8aa0ac", fontSize: 12 }}>{selectedBot.botId} · {selectedBot.accountId}</div>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        <span style={pill(selectedBot.mode === "paper_execute" ? "good" : "neutral")}>{selectedBot.mode}</span>
                        <span style={pill(riskTone(selectedBot.riskState))}>{selectedBot.riskState}</span>
                      </div>
                    </div>
                    <div style={botKpiGrid}>
                      <MiniMetric label={ui.admin.accountEquity} value={fmt(selectedBot.equity, 2)} tone="good" />
                      <MiniMetric label={ui.admin.dailyPnl} value={fmt(selectedBot.dailyPnl, 2)} tone={(selectedBot.dailyPnl ?? 0) >= 0 ? "good" : "bad"} />
                      <MiniMetric label={ui.admin.drawdown} value={`${fmt(selectedBot.drawdownPct, 2)}%`} tone={(selectedBot.drawdownPct ?? 0) > 0 ? "bad" : "neutral"} />
                      <MiniMetric label={ui.admin.openOrders} value={String(selectedBot.openOrders)} tone={selectedBot.openOrders > 0 ? "neutral" : "good"} />
                    </div>
                    <div style={botStatusGrid}>
                      <div style={botStatusCell}>
                        <div style={statusLabel}>{ui.admin.position}</div>
                        <strong>{botPosition(selectedBot)}</strong>
                      </div>
                      <div style={botStatusCell}>
                        <div style={statusLabel}>{ui.admin.botScore}</div>
                        <strong>{botScore(selectedBot.lastScore)}</strong>
                      </div>
                      <div style={botStatusCell}>
                        <div style={statusLabel}>{ui.admin.lastWake}</div>
                        <strong>{stamp(selectedBot.lastWakeAt ?? undefined)}</strong>
                      </div>
                      <div style={botStatusCell}>
                        <div style={statusLabel}>{ui.admin.nextWake}</div>
                        <strong>{stamp(selectedBot.nextWakeAt ?? undefined)}</strong>
                      </div>
                      <div style={{ ...botStatusCell, gridColumn: "1 / -1" }}>
                        <div style={statusLabel}>{ui.admin.wakeReasons}</div>
                        <div style={chipWrap}>
                          {(selectedBot.lastWakeReasons.length > 0 ? selectedBot.lastWakeReasons : ["-"]).map((reason) => (
                            <span key={reason} style={miniChip}>{reason}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ color: "#7e97a5" }}>{ui.admin.noBots}</div>
                )}
              </section>

              <section style={panel}>
                <div style={splitPanelTitle}>
                  <div>
                    <div style={panelTitle}>{ui.admin.botIntelligence}</div>
                    <div style={subtleText}>Current thesis, selected plan, score, and candidate actions.</div>
                  </div>
                  {selectedBotWake?.score ? <span style={pill((selectedBotWake.score.totalScore ?? 0) >= 0.7 ? "good" : "neutral")}>score {botScore(selectedBotWake.score)}</span> : null}
                </div>
                {selectedBotWake ? (
                  <div style={stack}>
                    <div style={intelligenceHero}>
                      <div>
                        <div style={statusLabel}>{ui.admin.currentStrategy}</div>
                        <strong>{selectedBotWake.strategySnapshot?.name ?? "-"}</strong>
                      </div>
                      <div style={scoreStrip}>
                        <span>{ui.admin.confidence}: {fmt(selectedBotWake.score?.confidence, 3)}</span>
                        <span>{ui.admin.riskState}: {fmt(selectedBotWake.score?.riskScore, 3)}</span>
                        <span>{ui.admin.executionResults}: {fmt(selectedBotWake.score?.executionScore, 3)}</span>
                      </div>
                    </div>
                    <div style={strategyPanel}>
                      <div style={timelineSectionLabel}>{ui.admin.strategySummary}</div>
                      <div style={strategyText}>{selectedBotWake.strategySnapshot?.summary ?? "-"}</div>
                      {selectedBotWake.strategySnapshot?.thesis ? (
                        <div style={thesisBlock}>{selectedBotWake.strategySnapshot.thesis}</div>
                      ) : null}
                    </div>
                    <div style={strategyPanel}>
                      <div style={timelineSectionLabel}>{ui.admin.currentPlan}</div>
                      <div style={strategyText}>{selectedBotWake.planSummary ?? selectedBotWake.plan?.summary ?? "-"}</div>
                    </div>
                    {selectedBotWake.plan?.candidates.length ? (
                      <div style={candidateGrid}>
                        {selectedBotWake.plan.candidates.slice(0, 3).map((candidate) => (
                          <div key={candidate.id} style={candidateCard}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                              <strong>{candidate.id}</strong>
                              <span style={pill(candidate.id === selectedBotWake.selectedCandidateId ? "good" : "neutral")}>
                                {candidate.confidence == null ? "-" : fmt(candidate.confidence, 2)}
                              </span>
                            </div>
                            <div style={{ color: "#b9d0dc", fontSize: 12, lineHeight: 1.45 }}>{compactText(candidate.thesis, 220)}</div>
                            <div style={chipWrap}>
                              {candidate.actions.map((action, index) => (
                                <span key={`${candidate.id}:${index}:${action.type}`} style={miniChip}>{actionTitle(action)}</span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ color: "#7e97a5" }}>{ui.admin.noBotPlan}</div>
                    )}
                  </div>
                ) : (
                  <div style={{ color: "#7e97a5" }}>{ui.admin.noBotPlan}</div>
                )}
              </section>

              <section style={panel}>
                <div style={splitPanelTitle}>
                  <div>
                    <div style={panelTitle}>{ui.admin.botMemories}</div>
                    <div style={subtleText}>Persisted context carried into future wakes.</div>
                  </div>
                  <span style={pill("neutral")}>{selectedBotWake?.memories.length ?? 0} memories</span>
                </div>
                {selectedBotWake?.memories.length ? (
                  <div style={memoryGrid}>
                    {selectedBotWake.memories.slice(0, 10).map((memory) => (
                      <div key={`${memory.key}:${memory.updatedAt ?? ""}`} style={memoryCard}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "start" }}>
                          <div style={{ minWidth: 0 }}>
                            <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{memoryTitle(memory.key)}</strong>
                            <div style={{ color: "#7e97a5", fontSize: 11, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{memory.key}</div>
                          </div>
                          <span style={pill(memorySourceTone(memory.source))}>{memory.source ?? "runtime"}</span>
                        </div>
                        <div style={memoryBody}>{compactJsonMemory(memory.key, memory.value)}</div>
                        <div style={importanceTrack}>
                          <div style={{ ...importanceFill, width: `${Math.max(4, Math.min(100, (memory.importance ?? 0) * 100))}%` }} />
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, color: "#7e97a5", fontSize: 12 }}>
                          <span>{memory.importance == null ? "importance -" : `importance ${fmt(memory.importance, 2)}`}</span>
                          <span>{stamp(memory.updatedAt)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ color: "#7e97a5" }}>{ui.admin.noBotMemories}</div>
                )}
              </section>

              <section style={panel}>
                <div style={panelTitle}>{ui.admin.botWakeTimeline}</div>
                {botWakes.length === 0 ? (
                  <div style={{ color: "#7e97a5" }}>{ui.admin.noBotWakes}</div>
                ) : (
                  <WakeTimeline wakes={botWakes.slice(0, 18)} orders={botReview?.recentOrders ?? []} botScore={botScore} />
                )}
              </section>

              <section style={panel}>
                <div style={splitPanelTitle}>
                  <div>
                    <div style={panelTitle}>Historical Orders</div>
                    <div style={subtleText}>Recent AI orders from the simulation engine.</div>
                  </div>
                  <span style={pill("neutral")}>{botReview?.recentOrders.length ?? 0} rows</span>
                </div>
                {botReview?.recentOrders.length ? (
                  <OrderHistoryTable orders={botReview.recentOrders} />
                ) : (
                  <EmptyState text="No AI order history yet." />
                )}
              </section>
            </div>
          </div>
        )}
      </div>
    );
  };

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
      case "bots":
        return renderBots();
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
                  <strong style={{ display: "block", textAlign: "left" }}>{menuLabel(item.id)}</strong>
                  <span style={{ display: "block", marginTop: 4, color: item.id === currentSection ? "#d9fffb" : "#7e97a5", fontSize: 12, textAlign: "left" }}>{menuHint(item.id)}</span>
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

function EmptyState({ text }: { text: string }) {
  return <div style={{ color: "#7e97a5", padding: "24px 0" }}>{text}</div>;
}

function MiniMetric({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" | "neutral" }) {
  return (
    <div style={miniMetricCard}>
      <div style={{ color: "#7e97a5", fontSize: 11 }}>{label}</div>
      <div style={{ color: toneColor(tone), fontSize: 20, fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function LineChart({ points, height }: { points: ChartPoint[]; height: number }) {
  const width = 720;
  const padding = 34;
  const plotWidth = width - padding * 2;
  const plotHeight = height - padding * 2;
  const values = points.map((point) => point.value);
  const minValue = Math.min(0, ...values);
  const maxValue = Math.max(0, ...values);
  const spread = maxValue - minValue || 1;
  const xFor = (index: number) => padding + (points.length <= 1 ? plotWidth / 2 : (plotWidth * index) / (points.length - 1));
  const yFor = (value: number) => padding + plotHeight - ((value - minValue) / spread) * plotHeight;
  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"} ${xFor(index).toFixed(2)} ${yFor(point.value).toFixed(2)}`).join(" ");
  const zeroY = yFor(0);
  const latest = points.at(-1);

  if (points.length === 0) {
    return <EmptyState text="No PnL points yet." />;
  }

  return (
    <div style={{ width: "100%", height, position: "relative" }}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="PnL curve" style={{ width: "100%", height: "100%", display: "block" }}>
        <rect x={0} y={0} width={width} height={height} rx={8} fill="#091217" />
        {[0, 1, 2, 3].map((line) => {
          const y = padding + (plotHeight * line) / 3;
          return <line key={line} x1={padding} x2={width - padding} y1={y} y2={y} stroke="#152833" strokeWidth={1} />;
        })}
        <line x1={padding} x2={width - padding} y1={zeroY} y2={zeroY} stroke="#3b4a53" strokeWidth={1.2} strokeDasharray="5 6" />
        <path d={linePath} fill="none" stroke={latest && latest.value >= 0 ? "#5ee08b" : "#fb7185"} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((point, index) => {
          if (points.length > 40 && index % Math.ceil(points.length / 28) !== 0 && index !== points.length - 1) {
            return null;
          }
          return <circle key={`${point.label}:${index}`} cx={xFor(index)} cy={yFor(point.value)} r={2.5} fill={point.value >= 0 ? "#86efac" : "#fda4af"} />;
        })}
        <text x={padding} y={22} fill="#8aa0ac" fontSize={12}>max {fmt(maxValue, 4)}</text>
        <text x={padding} y={height - 10} fill="#8aa0ac" fontSize={12}>min {fmt(minValue, 4)}</text>
        <text x={width - padding} y={22} textAnchor="end" fill="#dbe7ef" fontSize={12}>{latest?.label ?? "-"}</text>
      </svg>
      {latest ? <div style={chartCaption}>{latest.detail}</div> : null}
    </div>
  );
}

function BarChart({ items }: { items: BarPoint[] }) {
  const maxValue = Math.max(1, ...items.map((item) => item.value));

  if (items.length === 0) {
    return <EmptyState text="No chart data yet." />;
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {items.map((item) => (
        <div key={item.label} style={{ display: "grid", gridTemplateColumns: "110px minmax(0, 1fr) 48px", alignItems: "center", gap: 10 }}>
          <span style={{ color: "#8aa0ac", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis" }}>{item.label}</span>
          <div style={barTrack}>
            <div style={{ ...barFill, width: `${Math.max(3, (item.value / maxValue) * 100)}%`, background: toneColor(item.tone) }} />
          </div>
          <strong style={{ textAlign: "right", fontSize: 12 }}>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

const TIMELINE_MEMORY_KEYS = [
  "global_review/latest",
  "strategy_memo/all/latest",
  "reflection/trade_review/latest",
  "runtime/last_wake_summary",
  "state/open_orders",
  "runtime/market_signal_state",
  "runtime/codex_session/summary"
];

const compactText = (value: string, maxLength = 180): string => {
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length > maxLength ? `${singleLine.slice(0, maxLength)}...` : singleLine;
};

const compactJsonMemory = (key: string, value: string): string => {
  try {
    const parsed = JSON.parse(value) as unknown;

    if (key === "state/open_orders" && Array.isArray(parsed)) {
      if (parsed.length === 0) {
        return "No open orders.";
      }

      return parsed.slice(0, 3).map((order) => {
        const record = order && typeof order === "object" ? order as Record<string, unknown> : {};
        return `${record.side ?? "?"} ${record.sz ?? record.origSz ?? "?"} @ ${record.limitPx ?? "market"} oid=${record.oid ?? record.cloid ?? "?"}`;
      }).join("; ");
    }

    if (key === "runtime/market_signal_state" && parsed && typeof parsed === "object") {
      const signal = parsed as Record<string, unknown>;
      return `last=${signal.last ?? "-"} rsi=${signal.rsi ?? "-"} atr=${signal.atr ?? "-"} return5m=${signal.return5mPct ?? "-"}`;
    }

    if (key === "runtime/last_wake_summary" && parsed && typeof parsed === "object") {
      const summary = parsed as Record<string, unknown>;
      return compactText(`${summary.planSummary ?? "no prior plan"} | position=${JSON.stringify(summary.position ?? null)} | executions=${summary.executionSummary ?? "-"}`);
    }

    return compactText(JSON.stringify(parsed));
  } catch {
    return compactText(value);
  }
};

const memoryTitle = (key: string): string => {
  if (key === "reflection/trade_review/latest") {
    return "review memory";
  }
  if (key === "global_review/latest") {
    return "analyst global";
  }
  if (key === "strategy_memo/all/latest") {
    return "analyst memo";
  }
  if (key.startsWith("strategy_memo/")) {
    return "target memo";
  }
  if (key === "runtime/last_wake_summary") {
    return "previous wake";
  }
  if (key === "state/open_orders") {
    return "open orders";
  }
  if (key === "runtime/market_signal_state") {
    return "market signal";
  }
  if (key === "runtime/codex_session/summary") {
    return "session summary";
  }
  return key;
};

const selectTimelineMemories = (wake: AiTraderWakeReport) => {
  const selected = new Map<string, AiTraderWakeReport["memories"][number]>();
  for (const memory of wake.memories) {
    if (memory.key.startsWith("strategy_memo/") && memory.key !== "strategy_memo/all/latest") {
      selected.set(memory.key, memory);
    }
  }

  for (const memory of TIMELINE_MEMORY_KEYS
    .flatMap((key) => {
      const memory = wake.memories.find((entry) => entry.key === key);
      return memory ? [memory] : [];
    })) {
    selected.set(memory.key, memory);
  }

  return [...selected.values()].slice(0, 6);
};

const selectedActions = (wake: AiTraderWakeReport): AiTraderPlanAction[] =>
  wake.plan?.candidates.find((candidate) => candidate.id === wake.selectedCandidateId)?.actions
  ?? wake.plan?.candidates[0]?.actions
  ?? [];

const actionTitle = (action: AiTraderPlanAction): string => {
  if (action.type === "place_order") {
    return `${action.side} ${action.orderType} ${action.quantity} ${action.symbol}${action.price == null ? "" : ` @ ${fmt(action.price, 2)}`}${action.reduceOnly ? " reduce-only" : ""}`;
  }

  if (action.type === "cancel_order") {
    return `cancel ${action.symbol} ${action.orderId ?? action.clientOrderId ?? ""}`.trim();
  }

  if (action.type === "reduce_position" || action.type === "close_position") {
    return `${action.type.replace("_", " ")} ${action.symbol}${action.quantity == null ? "" : ` ${action.quantity}`}`;
  }

  return "observe";
};

const actionDetail = (action: AiTraderPlanAction): string => {
  if (action.type === "place_order") {
    return [
      action.reason,
      action.invalidationPrice == null ? undefined : `invalidation ${fmt(action.invalidationPrice, 2)}`,
      action.takeProfitPrice == null ? undefined : `take profit ${fmt(action.takeProfitPrice, 2)}`,
      action.timeInForce == null ? undefined : `TIF ${action.timeInForce}`
    ].filter(Boolean).join(" | ");
  }

  return action.reason;
};

type TimelineOrder = AiTraderReviewSnapshot["recentOrders"][number];

const toMs = (value?: string): number | undefined => {
  const parsed = new Date(value ?? "").getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
};

const normalizedOrderRefs = (order: TimelineOrder): string[] => {
  const refs = [order.id, order.clientOrderId].filter((value): value is string => Boolean(value));
  const numericId = order.id.match(/ord_(\d+)$/)?.[1];
  return numericId ? [...refs, numericId] : refs;
};

const cloidPart = (value: string | undefined, maxLength = 24): string =>
  (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength);

const orderHasWakeCloid = (wake: AiTraderWakeReport, order: TimelineOrder): boolean => {
  const clientOrderId = order.clientOrderId ?? "";
  if (!clientOrderId) {
    return false;
  }

  const botPart = cloidPart(wake.botId);
  const wakePart = cloidPart(wake.wakeId);
  return Boolean(botPart && wakePart)
    && (
      clientOrderId.startsWith(`ai-${botPart}-${wakePart}-`)
      || clientOrderId.startsWith(`ai-reduce-${botPart}-${wakePart}-`)
    );
};

const actionOrderRefs = (actions: AiTraderPlanAction[]): string[] =>
  actions.flatMap((action) => {
    if (action.type !== "cancel_order") {
      return [];
    }

    return [action.orderId, action.clientOrderId].filter((value): value is string => Boolean(value));
  });

const ordersForWake = (
  wake: AiTraderWakeReport,
  orders: TimelineOrder[],
  actions: AiTraderPlanAction[]
): TimelineOrder[] => {
  const startedAt = toMs(wake.startedAt);
  const finishedAt = toMs(wake.finishedAt);
  const startWindow = startedAt == null ? undefined : startedAt - 2_000;
  const endWindow = finishedAt == null ? undefined : finishedAt + 8_000;
  const refs = new Set(actionOrderRefs(actions));
  const matched = new Map<string, TimelineOrder>();

  for (const order of orders) {
    const orderRefs = normalizedOrderRefs(order);
    const matchedByRef = orderRefs.some((ref) => refs.has(ref));
    const matchedByWakeCloid = orderHasWakeCloid(wake, order);
    const createdAt = toMs(order.createdAt);
    const updatedAt = toMs(order.updatedAt);
    const matchedByTime = startWindow !== undefined && endWindow !== undefined
      && (
        (createdAt !== undefined && createdAt >= startWindow && createdAt <= endWindow)
        || (updatedAt !== undefined && updatedAt >= startWindow && updatedAt <= endWindow)
      );

    if (matchedByRef || matchedByWakeCloid || matchedByTime) {
      matched.set(order.id, order);
    }
  }

  return [...matched.values()]
    .sort((left, right) => (toMs(left.updatedAt) ?? 0) - (toMs(right.updatedAt) ?? 0))
    .slice(0, 8);
};

function WakeTimeline({
  wakes,
  orders,
  botScore
}: {
  wakes: AiTraderWakeReport[];
  orders: TimelineOrder[];
  botScore: (score?: AiTraderWakeReport["score"] | null) => string;
}) {
  const timeline = [...wakes].reverse();

  return (
    <div style={{ display: "grid", gap: 0 }}>
      {timeline.map((wake, index) => {
        const firstExecution = wake.executionResults[0];
        const tone = wake.status === "failed" ? "bad" : firstExecution ? actionTone(firstExecution.status) : "neutral";
        const memories = selectTimelineMemories(wake);
        const actions = selectedActions(wake);
        const linkedOrders = ordersForWake(wake, orders, actions);

        return (
          <div key={wake.wakeId} style={timelineRow}>
            <div style={timelineRail}>
              <span style={{ ...timelineDot, background: toneColor(tone) }} />
              {index < timeline.length - 1 ? <span style={timelineLine} /> : null}
            </div>
            <div style={timelineContent}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <strong>{wake.reasons.join(", ") || wake.status}</strong>
                <span style={{ color: "#8aa0ac", fontSize: 12 }}>{stamp(wake.finishedAt)}</span>
              </div>
              {memories.length > 0 ? (
                <div style={timelineMemoryGrid}>
                  {memories.map((memory) => (
                    <div key={`${wake.wakeId}:${memory.key}`} style={timelineMemoryCard}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                        <div style={{ color: "#56d7c4", fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>{memoryTitle(memory.key)}</div>
                        <span style={pill(memorySourceTone(memory.source))}>{memory.source ?? "runtime"}</span>
                      </div>
                      <div style={{ color: "#b9d0dc", fontSize: 12, lineHeight: 1.45, marginTop: 4 }}>{compactJsonMemory(memory.key, memory.value)}</div>
                      {memory.updatedAt ? <div style={{ color: "#69818e", fontSize: 11, marginTop: 6 }}>{stamp(memory.updatedAt)}</div> : null}
                    </div>
                  ))}
                </div>
              ) : null}
              <div style={timelineWakeCard}>
                <div style={timelineSectionLabel}>Wake</div>
                <div style={{ color: "#dbe7ef", fontSize: 13, lineHeight: 1.5 }}>{wake.planSummary ?? wake.plan?.summary ?? "-"}</div>
                <div style={timelineMeta}>
                  <span>score {botScore(wake.score)}</span>
                  <span>candidate {wake.selectedCandidateId ?? "-"}</span>
                  <span>approved {wake.approvedActions}</span>
                  <span>rejected {wake.rejectedActions}</span>
                </div>
              </div>
              <div style={timelineActionsList}>
                <div style={timelineSectionLabel}>Actions</div>
                {(actions.length > 0 ? actions : [{ type: "observe", reason: "No selected action was persisted." } satisfies AiTraderPlanAction]).map((action, actionIndex) => {
                  const execution = wake.executionResults[actionIndex];
                  const executionTone = execution ? actionTone(execution.status) : "neutral";

                  return (
                    <div key={`${wake.wakeId}:action:${actionIndex}`} style={timelineActionCard}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                        <strong>{actionTitle(action)}</strong>
                        <span style={pill(executionTone)}>{execution?.status ?? "planned"}</span>
                      </div>
                      <div style={{ color: "#9eb4c0", fontSize: 12, lineHeight: 1.45 }}>{actionDetail(action)}</div>
                      {execution?.message ? <div style={{ color: "#7e97a5", fontSize: 12 }}>{execution.message}</div> : null}
                    </div>
                  );
                })}
              </div>
              {linkedOrders.length > 0 ? (
                <div style={timelineOrdersList}>
                  <div style={timelineSectionLabel}>Orders</div>
                  <div style={timelineOrderGrid}>
                    {linkedOrders.map((order) => (
                      <div key={`${wake.wakeId}:order:${order.id}`} style={timelineOrderCard}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                          <strong style={{ color: order.side === "buy" ? "#86efac" : "#fca5a5" }}>
                            {order.side} {order.orderType}
                          </strong>
                          <span style={pill(orderTone(order.status))}>{order.status}</span>
                        </div>
                        <div style={timelineOrderMeta}>
                          <span>qty {fmt(order.quantity, 6)}</span>
                          <span>filled {fmt(order.filledQuantity, 6)}</span>
                          <span>{order.limitPrice == null ? "market" : `limit ${fmt(order.limitPrice, 2)}`}</span>
                          <span>{order.averageFillPrice == null ? "no avg fill" : `avg ${fmt(order.averageFillPrice, 2)}`}</span>
                        </div>
                        <div style={{ color: "#7e97a5", fontSize: 12 }}>
                          {order.clientOrderId ?? order.id} · {stamp(order.updatedAt)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <div style={timelineMeta}>
                <span>{wake.wakeId}</span>
                <span>{wake.executionResults.map((entry) => `${entry.actionType}:${entry.status}`).join(", ") || "no execution"}</span>
              </div>
              {wake.errors.length > 0 ? <pre style={consoleBlockError}>{wake.errors.join("\n")}</pre> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OrderHistoryTable({ orders }: { orders: AiTraderReviewSnapshot["recentOrders"] }) {
  return (
    <div style={{ overflowX: "auto", border: "1px solid #16262f", borderRadius: 12 }}>
      <table style={ordersTable}>
        <thead>
          <tr>
            <th style={tableHeader}>Updated</th>
            <th style={tableHeader}>Side</th>
            <th style={tableHeader}>Type</th>
            <th style={tableHeader}>Status</th>
            <th style={tableHeader}>Qty</th>
            <th style={tableHeader}>Limit</th>
            <th style={tableHeader}>Avg Fill</th>
            <th style={tableHeader}>Client Order</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id}>
              <td style={tableCell}>{stamp(order.updatedAt)}</td>
              <td style={{ ...tableCell, color: order.side === "buy" ? "#86efac" : "#fca5a5", fontWeight: 700 }}>{order.side}</td>
              <td style={tableCell}>{order.orderType}</td>
              <td style={tableCell}><span style={pill(orderTone(order.status))}>{order.status}</span></td>
              <td style={tableCell}>{fmt(order.quantity, 6)}</td>
              <td style={tableCell}>{order.limitPrice == null ? "-" : fmt(order.limitPrice, 2)}</td>
              <td style={tableCell}>{order.averageFillPrice == null ? "-" : fmt(order.averageFillPrice, 2)}</td>
              <td style={tableCell}>{order.clientOrderId ?? order.id}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const toneColor = (tone?: "good" | "bad" | "neutral") =>
  tone === "good" ? "#86efac" : tone === "bad" ? "#fca5a5" : "#facc15";

const pill = (tone?: "good" | "bad" | "neutral"): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 24,
  padding: "3px 8px",
  borderRadius: 999,
  border: `1px solid ${tone === "good" ? "#1f8a65" : tone === "bad" ? "#7f1d1d" : "#665d1e"}`,
  background: tone === "good" ? "rgba(34, 197, 94, 0.14)" : tone === "bad" ? "rgba(248, 113, 113, 0.12)" : "rgba(250, 204, 21, 0.1)",
  color: toneColor(tone),
  fontSize: 12,
  fontWeight: 700,
  whiteSpace: "nowrap"
});

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

const splitPanelTitle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "start",
  gap: 12,
  marginBottom: 14
};

const subtleText: CSSProperties = {
  color: "#7e97a5",
  fontSize: 12,
  lineHeight: 1.5
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

const miniMetricGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  gap: 8
};

const miniMetricCard: CSSProperties = {
  border: "1px solid #16262f",
  borderRadius: 10,
  padding: "10px 12px",
  background: "#091217"
};

const pnlCurveGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "220px minmax(0, 1fr)",
  gap: 12,
  alignItems: "stretch"
};

const winRateCard: CSSProperties = {
  border: "1px solid #1b3b42",
  borderRadius: 12,
  background: "linear-gradient(180deg, #0d1a21, #091217)",
  padding: 14,
  minHeight: 220,
  display: "grid",
  alignContent: "space-between",
  gap: 14
};

const winRateValue: CSSProperties = {
  marginTop: 10,
  fontSize: 34,
  fontWeight: 800,
  lineHeight: 1
};

const winRateTrack: CSSProperties = {
  height: 8,
  background: "#071116",
  border: "1px solid #16262f",
  borderRadius: 999,
  overflow: "hidden"
};

const winRateFill: CSSProperties = {
  height: "100%",
  borderRadius: 999
};

const winRateStatsGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: 5,
  color: "#8aa0ac",
  fontSize: 12
};

const userCard: CSSProperties = {
  border: "1px solid #16262f",
  borderRadius: 12,
  padding: 14,
  background: "#0d1a21",
  display: "grid",
  gap: 10
};

const botTabsPanel: CSSProperties = {
  ...panel,
  paddingBottom: 12
};

const botTabsScroller: CSSProperties = {
  display: "flex",
  gap: 10,
  overflowX: "auto",
  paddingBottom: 4,
  scrollbarWidth: "thin"
};

const botTabButton: CSSProperties = {
  flex: "0 0 280px",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "#16262f",
  borderRadius: 10,
  background: "#0d1a21",
  color: "#dbe7ef",
  cursor: "pointer",
  display: "grid",
  gap: 10,
  padding: 12,
  textAlign: "left"
};

const botTabButtonActive: CSSProperties = {
  ...botTabButton,
  borderColor: "#1f8a65",
  background: "linear-gradient(135deg, rgba(31, 138, 101, 0.2), rgba(9, 26, 27, 0.98))",
  boxShadow: "inset 0 -2px 0 #22c55e"
};

const botTabMetaGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 6,
  color: "#8aa0ac",
  fontSize: 12
};

const botStatusHero: CSSProperties = {
  border: "1px solid #1b3b42",
  borderRadius: 12,
  padding: 14,
  background: "linear-gradient(135deg, rgba(16, 44, 48, 0.94), rgba(8, 20, 25, 0.98))",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12
};

const botKpiGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  gap: 8
};

const botStatusGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  gap: 10
};

const botStatusCell: CSSProperties = {
  border: "1px solid #16262f",
  borderRadius: 10,
  background: "#091217",
  padding: 12,
  display: "grid",
  gap: 6,
  minHeight: 72
};

const statusLabel: CSSProperties = {
  color: "#7e97a5",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.08em"
};

const chipWrap: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6
};

const miniChip: CSSProperties = {
  border: "1px solid #1b3b42",
  borderRadius: 999,
  background: "#091217",
  color: "#b9d0dc",
  padding: "4px 8px",
  fontSize: 11,
  whiteSpace: "nowrap"
};

const intelligenceHero: CSSProperties = {
  border: "1px solid #1b3b42",
  borderRadius: 12,
  padding: 14,
  background: "linear-gradient(135deg, rgba(15, 43, 48, 0.92), rgba(9, 18, 23, 0.98))",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "end",
  gap: 12
};

const scoreStrip: CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  justifyContent: "flex-end",
  color: "#8aa0ac",
  fontSize: 12
};

const strategyPanel: CSSProperties = {
  border: "1px solid #18313a",
  borderRadius: 10,
  background: "#091217",
  padding: 12,
  display: "grid",
  gap: 8
};

const strategyText: CSSProperties = {
  color: "#dbe7ef",
  fontSize: 13,
  lineHeight: 1.55
};

const thesisBlock: CSSProperties = {
  borderLeft: "2px solid #22c55e",
  paddingLeft: 10,
  color: "#9eb4c0",
  fontSize: 12,
  lineHeight: 1.5
};

const candidateGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 10
};

const candidateCard: CSSProperties = {
  border: "1px solid #18313a",
  borderRadius: 10,
  background: "#0d1a21",
  padding: 12,
  display: "grid",
  gap: 8,
  alignContent: "start"
};

const memoryGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 10
};

const memoryCard: CSSProperties = {
  border: "1px solid #18313a",
  borderRadius: 10,
  background: "linear-gradient(180deg, #0d1a21, #091217)",
  padding: 12,
  display: "grid",
  gap: 10,
  alignContent: "start",
  minHeight: 150
};

const memoryBody: CSSProperties = {
  color: "#b9d0dc",
  fontSize: 12,
  lineHeight: 1.5,
  overflowWrap: "anywhere"
};

const importanceTrack: CSSProperties = {
  height: 6,
  background: "#071116",
  borderRadius: 999,
  overflow: "hidden",
  border: "1px solid #16262f"
};

const importanceFill: CSSProperties = {
  height: "100%",
  background: "linear-gradient(90deg, #22c55e, #56d7c4)"
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

const chartCaption: CSSProperties = {
  position: "absolute",
  right: 12,
  bottom: 10,
  maxWidth: "62%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "#8aa0ac",
  fontSize: 12
};

const barTrack: CSSProperties = {
  height: 10,
  background: "#091217",
  border: "1px solid #16262f",
  borderRadius: 999,
  overflow: "hidden"
};

const barFill: CSSProperties = {
  height: "100%",
  borderRadius: 999
};

const timelineRow: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "28px minmax(0, 1fr)",
  gap: 10
};

const timelineRail: CSSProperties = {
  position: "relative",
  display: "flex",
  justifyContent: "center"
};

const timelineDot: CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: 999,
  marginTop: 5,
  zIndex: 1
};

const timelineLine: CSSProperties = {
  position: "absolute",
  top: 18,
  bottom: 0,
  width: 1,
  background: "#21333d"
};

const timelineContent: CSSProperties = {
  padding: "0 0 18px",
  display: "grid",
  gap: 8
};

const timelineMemoryGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 8
};

const timelineMemoryCard: CSSProperties = {
  border: "1px solid #18313a",
  borderRadius: 8,
  background: "#091217",
  padding: 10,
  minHeight: 76
};

const timelineWakeCard: CSSProperties = {
  border: "1px solid #1a313a",
  borderRadius: 8,
  background: "#0d1a21",
  padding: 10,
  display: "grid",
  gap: 6
};

const timelineActionsList: CSSProperties = {
  display: "grid",
  gap: 8
};

const timelineOrdersList: CSSProperties = {
  display: "grid",
  gap: 8
};

const timelineActionCard: CSSProperties = {
  border: "1px solid #18313a",
  borderRadius: 8,
  background: "#091217",
  padding: 10,
  display: "grid",
  gap: 6
};

const timelineOrderGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 8
};

const timelineOrderCard: CSSProperties = {
  border: "1px solid #1b3b42",
  borderRadius: 8,
  background: "#071419",
  padding: 10,
  display: "grid",
  gap: 7
};

const timelineOrderMeta: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 5,
  color: "#9eb4c0",
  fontSize: 12
};

const timelineSectionLabel: CSSProperties = {
  color: "#56d7c4",
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.08em"
};

const timelineMeta: CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  color: "#7e97a5",
  fontSize: 12
};

const ordersTable: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  minWidth: 940,
  background: "#091217"
};

const tableHeader: CSSProperties = {
  color: "#8aa0ac",
  textAlign: "left",
  fontSize: 11,
  textTransform: "uppercase",
  padding: "10px 12px",
  borderBottom: "1px solid #16262f",
  whiteSpace: "nowrap"
};

const tableCell: CSSProperties = {
  color: "#dbe7ef",
  fontSize: 12,
  padding: "10px 12px",
  borderBottom: "1px solid #10212a",
  whiteSpace: "nowrap"
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
