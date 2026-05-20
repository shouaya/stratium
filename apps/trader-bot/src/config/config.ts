import type { AiTraderMode } from "@stratium/shared";
import type { TraderBotCliFlags } from "./flags.js";
import type { TraderBotCodexSessionMode, TraderBotConfig, TraderBotPlannerKind, TraderBotRunnerConfig } from "../types.js";

const readNumber = (value: string | undefined, fallback: number): number => {
  if (value == null || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const readBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value == null || value.trim() === "") {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
};

const splitArgs = (value: string): string[] =>
  value.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, "")) ?? [];

export const loadConfigFromEnv = (env: NodeJS.ProcessEnv = process.env): TraderBotConfig => {
  const activeSymbol = env.STRATIUM_TRADER_BOT_SYMBOL ?? "BTC-USD";
  const allowedSymbols = (env.STRATIUM_TRADER_BOT_ALLOWED_SYMBOLS ?? activeSymbol)
    .split(",")
    .map((symbol) => symbol.trim())
    .filter(Boolean);

  return {
    botId: env.STRATIUM_TRADER_BOT_ID ?? "local-shadow-trader",
    mode: env.STRATIUM_TRADER_BOT_MODE === "paper_execute" ? "paper_execute" : env.STRATIUM_TRADER_BOT_MODE === "observe" ? "observe" : "shadow",
    planner: parsePlanner(env.STRATIUM_TRADER_BOT_PLANNER, "codex"),
    runtimeTarget: "stratium_native",
    activeSymbol,
    wakeIntervalMs: readNumber(env.STRATIUM_TRADER_BOT_WAKE_INTERVAL_MS, 300_000),
    riskPolicy: {
      allowedSymbols,
      maxActionsPerWake: readNumber(env.STRATIUM_TRADER_BOT_MAX_ACTIONS_PER_WAKE, 3),
      maxOrderNotional: readNumber(env.STRATIUM_TRADER_BOT_MAX_ORDER_NOTIONAL, 100),
      maxPositionNotional: readNumber(env.STRATIUM_TRADER_BOT_MAX_POSITION_NOTIONAL, 500),
      requireInvalidationPrice: readBoolean(env.STRATIUM_TRADER_BOT_REQUIRE_INVALIDATION_PRICE, true),
      allowOpeningOrders: readBoolean(env.STRATIUM_TRADER_BOT_ALLOW_OPENING_ORDERS, true)
    }
  };
};

const parseMode = (value: string | undefined, fallback: AiTraderMode): AiTraderMode => {
  if (value === "disabled" || value === "observe" || value === "shadow" || value === "approval" || value === "paper_execute" || value === "reduce_only") {
    return value;
  }
  return fallback;
};

const parsePlanner = (value: string | undefined, fallback: TraderBotPlannerKind): TraderBotPlannerKind => {
  if (value === "dry-run" || value === "baseline" || value === "codex") {
    return value;
  }
  return fallback;
};

const parseCodexPromptMode = (value: string | undefined): TraderBotRunnerConfig["codexPromptMode"] =>
  value === "arg" ? "arg" : "stdin";

const parseCodexSessionMode = (value: string | undefined): TraderBotCodexSessionMode =>
  value === "fresh" ? "fresh" : "resume";

export const loadRunnerConfig = (
  flags: TraderBotCliFlags,
  env: NodeJS.ProcessEnv = process.env
): TraderBotRunnerConfig => {
  const base = loadConfigFromEnv({
    ...env,
    STRATIUM_TRADER_BOT_ID: flags.botId ?? env.STRATIUM_TRADER_BOT_ID,
    STRATIUM_TRADER_BOT_MODE: flags.mode ?? env.STRATIUM_TRADER_BOT_MODE,
    STRATIUM_TRADER_BOT_PLANNER: flags.planner ?? env.STRATIUM_TRADER_BOT_PLANNER,
    STRATIUM_TRADER_BOT_SYMBOL: flags.symbol ?? env.STRATIUM_TRADER_BOT_SYMBOL
  });
  const account = flags.account ?? env.STRATIUM_TRADER_BOT_ACCOUNT ?? env.STRATIUM_FRONTEND_USERNAME ?? "";
  const password = flags.password ?? env.STRATIUM_TRADER_BOT_PASSWORD ?? env.STRATIUM_FRONTEND_PASSWORD ?? "";
  const codexArgs = flags.codexArgs
    ?? env.STRATIUM_TRADER_BOT_CODEX_ARGS
    ?? env.CODEX_CLI_ARGS
    ?? "exec --sandbox read-only --ignore-rules --color never";
  const codexTimeoutMs = readNumber(
    flags.codexTimeoutMs ?? env.STRATIUM_TRADER_BOT_CODEX_TIMEOUT_MS,
    readNumber(env.CODEX_CLI_TIMEOUT_MS, 180_000)
  );
  const codexSessionMaxWakes = readNumber(
    flags.codexSessionMaxWakes ?? env.STRATIUM_TRADER_BOT_CODEX_SESSION_MAX_WAKES,
    readNumber(env.CODEX_SESSION_MAX_WAKES, 40)
  );

  return {
    ...base,
    mode: parseMode(flags.mode ?? env.STRATIUM_TRADER_BOT_MODE, base.mode),
    planner: parsePlanner(flags.planner ?? env.STRATIUM_TRADER_BOT_PLANNER, base.planner),
    botId: flags.botId ?? base.botId,
    activeSymbol: flags.symbol ?? base.activeSymbol,
    apiBaseUrl: flags.apiUrl ?? env.STRATIUM_API_PUBLIC_BASE_URL ?? "http://localhost:6100",
    traderMcpUrl: flags.mcpUrl ?? env.STRATIUM_TRADER_MCP_URL ?? "http://localhost:4600/mcp",
    account,
    password,
    once: flags.once,
    codexBin: flags.codexBin ?? env.STRATIUM_TRADER_BOT_CODEX_BIN ?? env.CODEX_CLI_BIN ?? "codex",
    codexArgs: splitArgs(codexArgs),
    codexPromptMode: parseCodexPromptMode(flags.codexPromptMode ?? env.STRATIUM_TRADER_BOT_CODEX_PROMPT_MODE ?? env.CODEX_CLI_PROMPT_MODE),
    codexTimeoutMs,
    codexSessionMode: parseCodexSessionMode(flags.codexSessionMode ?? env.STRATIUM_TRADER_BOT_CODEX_SESSION_MODE ?? env.CODEX_SESSION_MODE),
    codexSessionMaxWakes: Math.max(1, Math.floor(codexSessionMaxWakes))
  };
};

export const assertRunnerConfig = (config: TraderBotRunnerConfig): void => {
  if (!config.account.trim()) {
    throw new Error("Missing trader bot account. Pass --email/--account or set STRATIUM_TRADER_BOT_ACCOUNT.");
  }
  if (!config.password.trim()) {
    throw new Error("Missing trader bot password. Pass --password or set STRATIUM_TRADER_BOT_PASSWORD.");
  }
  if (!config.botId.trim()) {
    throw new Error("Missing trader bot id. Pass --bot-id or set STRATIUM_TRADER_BOT_ID.");
  }
};
