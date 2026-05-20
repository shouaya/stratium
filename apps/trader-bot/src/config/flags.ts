export type TraderBotCliFlags = {
  apiUrl?: string;
  mcpUrl?: string;
  account?: string;
  password?: string;
  botId?: string;
  mode?: string;
  planner?: string;
  symbol?: string;
  wakeIntervalMs?: string;
  positionReviewMs?: string;
  openOrderReviewMs?: string;
  postExecutionReviewMs?: string;
  riskRetryMs?: string;
  signalReviewMs?: string;
  codexBin?: string;
  codexArgs?: string;
  codexPromptMode?: string;
  codexTimeoutMs?: string;
  codexSessionMode?: string;
  codexSessionMaxWakes?: string;
  once: boolean;
};

const FLAG_ALIASES: Record<string, keyof Omit<TraderBotCliFlags, "once">> = {
  "--api-url": "apiUrl",
  "--mcp-url": "mcpUrl",
  "--account": "account",
  "--email": "account",
  "--username": "account",
  "--password": "password",
  "--bot-id": "botId",
  "--mode": "mode",
  "--planner": "planner",
  "--symbol": "symbol",
  "--wake-interval-ms": "wakeIntervalMs",
  "--position-review-ms": "positionReviewMs",
  "--open-order-review-ms": "openOrderReviewMs",
  "--post-execution-review-ms": "postExecutionReviewMs",
  "--risk-retry-ms": "riskRetryMs",
  "--signal-review-ms": "signalReviewMs",
  "--codex-bin": "codexBin",
  "--codex-args": "codexArgs",
  "--codex-prompt-mode": "codexPromptMode",
  "--codex-timeout-ms": "codexTimeoutMs",
  "--codex-session-mode": "codexSessionMode",
  "--codex-session-max-wakes": "codexSessionMaxWakes"
};

export const parseCliFlags = (argv: string[] = process.argv.slice(2)): TraderBotCliFlags => {
  const flags: TraderBotCliFlags = {
    once: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];
    if (entry === "--once") {
      flags.once = true;
      continue;
    }

    const [rawKey, inlineValue] = entry.includes("=") ? entry.split(/=(.*)/s, 2) : [entry, undefined];
    const mapped = FLAG_ALIASES[rawKey];
    if (!mapped) {
      continue;
    }

    const value = inlineValue ?? argv[index + 1];
    if (inlineValue == null) {
      index += 1;
    }
    if (value != null) {
      flags[mapped] = value;
    }
  }

  return flags;
};
