import type { AnalystBotConfig } from "../types.js";
import type { AnalystBotCliFlags } from "./flags.js";

const readNumber = (value: string | undefined, fallback: number): number => {
  if (value == null || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const splitArgs = (value: string): string[] =>
  value.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, "")) ?? [];

const parsePromptMode = (value: string | undefined): AnalystBotConfig["codexPromptMode"] =>
  value === "arg" ? "arg" : "stdin";

export const loadAnalystBotConfig = (
  flags: AnalystBotCliFlags,
  env: NodeJS.ProcessEnv = process.env
): AnalystBotConfig => {
  const codexArgs = flags.codexArgs
    ?? env.STRATIUM_ANALYST_BOT_CODEX_ARGS
    ?? env.CODEX_CLI_ARGS
    ?? "exec --sandbox read-only --ignore-rules --color never";

  return {
    apiBaseUrl: flags.apiUrl ?? env.STRATIUM_API_PUBLIC_BASE_URL ?? "http://localhost:6100",
    analystMcpUrl: flags.mcpUrl ?? env.STRATIUM_ANALYST_MCP_URL ?? env.STRATIUM_TRADER_MCP_URL ?? "http://localhost:4600/mcp",
    account: flags.account ?? env.STRATIUM_ANALYST_BOT_ACCOUNT ?? env.STRATIUM_ADMIN_USERNAME ?? "admin",
    password: flags.password ?? env.STRATIUM_ANALYST_BOT_PASSWORD ?? env.STRATIUM_ADMIN_PASSWORD ?? "",
    botId: flags.botId ?? env.STRATIUM_ANALYST_BOT_ID ?? "local-analyst-bot",
    once: flags.once,
    reviewIntervalMs: Math.max(60_000, Math.floor(readNumber(
      flags.reviewIntervalMs ?? env.STRATIUM_ANALYST_BOT_REVIEW_INTERVAL_MS,
      1_800_000
    ))),
    maxBots: Math.max(1, Math.floor(readNumber(
      flags.maxBots ?? env.STRATIUM_ANALYST_BOT_MAX_BOTS,
      6
    ))),
    codexBin: flags.codexBin ?? env.STRATIUM_ANALYST_BOT_CODEX_BIN ?? env.CODEX_CLI_BIN ?? "codex",
    codexArgs: splitArgs(codexArgs),
    codexPromptMode: parsePromptMode(flags.codexPromptMode ?? env.STRATIUM_ANALYST_BOT_CODEX_PROMPT_MODE ?? env.CODEX_CLI_PROMPT_MODE),
    codexTimeoutMs: Math.max(10_000, Math.floor(readNumber(
      flags.codexTimeoutMs ?? env.STRATIUM_ANALYST_BOT_CODEX_TIMEOUT_MS,
      readNumber(env.CODEX_CLI_TIMEOUT_MS, 180_000)
    )))
  };
};

export const assertAnalystBotConfig = (config: AnalystBotConfig): void => {
  if (!config.account.trim()) {
    throw new Error("Missing analyst bot account. Pass --account or set STRATIUM_ANALYST_BOT_ACCOUNT.");
  }
  if (!config.password.trim()) {
    throw new Error("Missing analyst bot password. Pass --password or set STRATIUM_ANALYST_BOT_PASSWORD.");
  }
  if (!config.botId.trim()) {
    throw new Error("Missing analyst bot id. Pass --bot-id or set STRATIUM_ANALYST_BOT_ID.");
  }
};
