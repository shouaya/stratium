import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AiTraderPlan, AiTraderPlanAction, AiTraderPlanCandidate } from "@stratium/shared";
import { runProcess } from "../infra/processRunner.js";
import type { TraderBotPlanner, TraderBotPlannerContext, TraderBotProgressLogger, TraderBotRunnerConfig } from "../types.js";
import { parsePlan } from "./planParser.js";
import { buildPrompt } from "./promptBuilder.js";

type CodexPlannerConfig = Pick<
  TraderBotRunnerConfig,
  | "apiBaseUrl"
  | "traderMcpUrl"
  | "botId"
  | "activeSymbol"
  | "codexBin"
  | "codexArgs"
  | "codexPromptMode"
  | "codexTimeoutMs"
  | "codexSessionMode"
  | "codexSessionMaxWakes"
>;

type CodexSessionState = {
  previousSessionId: string;
  previousWakeCount: number;
  resumeSessionId: string;
  freshReason: string;
  maxWakes: number;
};

const isExecBase = (base: string[]) => base[0] === "exec" || base[0] === "e";

const codexOutputFlags = (base: string[], outputPath: string): string[] => {
  if (!isExecBase(base)) {
    return [];
  }

  const flags: string[] = [];
  if (!base.includes("--json")) {
    flags.push("--json");
  }
  if (!base.includes("--output-last-message") && !base.includes("-o")) {
    flags.push("--output-last-message", outputPath);
  }
  return flags;
};

const codexArgs = (config: CodexPlannerConfig, prompt: string, sessionId: string, outputPath: string): string[] => {
  const base = config.codexArgs.length > 0 ? config.codexArgs : ["exec"];
  const promptArg = config.codexPromptMode === "arg" ? prompt : "-";
  if (!isExecBase(base)) {
    return sessionId ? [...base, "resume", sessionId, promptArg] : [...base, promptArg];
  }
  if (sessionId) {
    return [
      base[0],
      "resume",
      ...codexOutputFlags(base, outputPath),
      ...base.slice(1),
      sessionId,
      promptArg
    ];
  }
  return [
    base[0],
    ...codexOutputFlags(base, outputPath),
    ...base.slice(1),
    promptArg
  ];
};

const codexStdin = (config: CodexPlannerConfig, prompt: string): string =>
  config.codexPromptMode === "stdin" ? prompt : "";

const codexEnv = (config: CodexPlannerConfig): NodeJS.ProcessEnv => ({
  NO_COLOR: "1",
  STRATIUM_API_PUBLIC_BASE_URL: config.apiBaseUrl,
  STRATIUM_TRADER_MCP_URL: config.traderMcpUrl,
  STRATIUM_TRADER_BOT_ID: config.botId,
  STRATIUM_TRADER_BOT_SYMBOL: config.activeSymbol
});

const CODEX_SESSION_ID_MEMORY = "runtime/codex_session/id";
const CODEX_SESSION_MODE_MEMORY = "runtime/codex_session/mode";
const CODEX_SESSION_WAKE_COUNT_MEMORY = "runtime/codex_session/wake_count";
const CODEX_SESSION_MAX_WAKES_MEMORY = "runtime/codex_session/max_wakes";
const CODEX_SESSION_FRESH_REASON_MEMORY = "runtime/codex_session/fresh_reason";
const CODEX_SESSION_UPDATED_AT_MEMORY = "runtime/codex_session/updated_at";
const CODEX_SESSION_PROMPT_CHARS_MEMORY = "runtime/codex_session/prompt_chars";
const CODEX_SESSION_PROMPT_TOKENS_MEMORY = "runtime/codex_session/prompt_approx_tokens";
const CODEX_SESSION_SUMMARY_MEMORY = "runtime/codex_session/summary";
const LAST_WAKE_SUMMARY_MEMORY = "runtime/last_wake_summary";

const readFinalMessage = async (outputPath: string): Promise<string> => {
  try {
    return await fs.readFile(outputPath, "utf8");
  } catch {
    return "";
  }
};

const looksLikePlanText = (value: string): boolean =>
  value.includes("stratium.ai-trader-plan.v1") && value.includes("candidates");

const findPlanText = (value: unknown): string => {
  if (typeof value === "string") {
    return looksLikePlanText(value) ? value : "";
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findPlanText(child);
      if (found) {
        return found;
      }
    }
    return "";
  }
  if (typeof value !== "object" || value == null) {
    return "";
  }

  const record = value as Record<string, unknown>;
  for (const key of ["final_message", "last_message", "message", "content", "text", "delta"]) {
    const found = findPlanText(record[key]);
    if (found) {
      return found;
    }
  }
  for (const child of Object.values(record)) {
    const found = findPlanText(child);
    if (found) {
      return found;
    }
  }
  return "";
};

const extractFinalMessageFromJsonl = (stdout: string): string => {
  const lines = stdout.split(/\r?\n/).filter((line) => line.trim() !== "").reverse();
  for (const line of lines) {
    try {
      const found = findPlanText(JSON.parse(line));
      if (found) {
        return found;
      }
    } catch {
      if (looksLikePlanText(line)) {
        return line;
      }
    }
  }
  return "";
};

const memoryValue = (context: TraderBotPlannerContext, key: string): string => {
  for (let index = context.memories.length - 1; index >= 0; index -= 1) {
    const memory = context.memories[index];
    if (memory.key === key) {
      return memory.value;
    }
  }
  return "";
};

const upsertMemory = (
  context: TraderBotPlannerContext,
  memory: TraderBotPlannerContext["memories"][number]
): void => {
  const existingIndex = context.memories.findIndex((entry) => entry.key === memory.key);
  if (existingIndex >= 0) {
    context.memories[existingIndex] = memory;
    return;
  }
  context.memories.push(memory);
};

const normalizedSessionId = (value: unknown): string => {
  const text = String(value ?? "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text) ? text : "";
};

const nonNegativeInteger = (value: unknown): number => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
};

const codexSessionState = (config: CodexPlannerConfig, context: TraderBotPlannerContext): CodexSessionState => {
  const previousSessionId = normalizedSessionId(memoryValue(context, CODEX_SESSION_ID_MEMORY));
  const previousWakeCount = nonNegativeInteger(memoryValue(context, CODEX_SESSION_WAKE_COUNT_MEMORY));
  const maxWakes = Math.max(1, Math.floor(config.codexSessionMaxWakes || 1));

  if (config.codexSessionMode === "fresh") {
    return {
      previousSessionId,
      previousWakeCount,
      resumeSessionId: "",
      freshReason: "configured_fresh",
      maxWakes
    };
  }

  if (!previousSessionId) {
    return {
      previousSessionId,
      previousWakeCount,
      resumeSessionId: "",
      freshReason: "missing_session",
      maxWakes
    };
  }

  if (previousWakeCount >= maxWakes) {
    return {
      previousSessionId,
      previousWakeCount,
      resumeSessionId: "",
      freshReason: "max_wakes",
      maxWakes
    };
  }

  return {
    previousSessionId,
    previousWakeCount,
    resumeSessionId: previousSessionId,
    freshReason: "",
    maxWakes
  };
};

const truncateMemory = (value: string, maxLength = 4_000): string =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;

const prepareSessionRolloverSummary = (
  context: TraderBotPlannerContext,
  sessionState: CodexSessionState
): void => {
  if (sessionState.freshReason !== "max_wakes" || !sessionState.previousSessionId) {
    return;
  }

  const lastWakeSummary = memoryValue(context, LAST_WAKE_SUMMARY_MEMORY) || "No prior wake summary was persisted.";
  upsertMemory(context, {
    key: CODEX_SESSION_SUMMARY_MEMORY,
    value: truncateMemory([
      `Previous Codex session ${sessionState.previousSessionId} reached ${sessionState.previousWakeCount}/${sessionState.maxWakes} wakes and is being rolled into a fresh session.`,
      `Carry forward this concise prior state: ${lastWakeSummary}`
    ].join("\n")),
    importance: 0.98,
    updatedAt: context.now,
    source: "reflection"
  });
};

const recordCodexSessionMemories = (
  context: TraderBotPlannerContext,
  input: {
    sessionId: string;
    mode: "resume" | "fresh";
    wakeCount: number;
    maxWakes: number;
    freshReason: string;
    prompt: string;
  }
): void => {
  if (!input.sessionId) {
    return;
  }

  const updatedAt = new Date().toISOString();
  const memories: TraderBotPlannerContext["memories"] = [
    {
      key: CODEX_SESSION_ID_MEMORY,
      value: input.sessionId,
      importance: 1,
      updatedAt,
      source: "runtime"
    },
    {
      key: CODEX_SESSION_MODE_MEMORY,
      value: input.mode,
      importance: 0.9,
      updatedAt,
      source: "runtime"
    },
    {
      key: CODEX_SESSION_WAKE_COUNT_MEMORY,
      value: String(input.wakeCount),
      importance: 0.95,
      updatedAt,
      source: "runtime"
    },
    {
      key: CODEX_SESSION_MAX_WAKES_MEMORY,
      value: String(input.maxWakes),
      importance: 0.8,
      updatedAt,
      source: "runtime"
    },
    {
      key: CODEX_SESSION_FRESH_REASON_MEMORY,
      value: input.freshReason,
      importance: 0.7,
      updatedAt,
      source: "runtime"
    },
    {
      key: CODEX_SESSION_UPDATED_AT_MEMORY,
      value: updatedAt,
      importance: 0.7,
      updatedAt,
      source: "runtime"
    },
    {
      key: CODEX_SESSION_PROMPT_CHARS_MEMORY,
      value: String(input.prompt.length),
      importance: 0.4,
      updatedAt,
      source: "runtime"
    },
    {
      key: CODEX_SESSION_PROMPT_TOKENS_MEMORY,
      value: String(Math.ceil(input.prompt.length / 4)),
      importance: 0.4,
      updatedAt,
      source: "runtime"
    }
  ];

  for (const memory of memories) {
    upsertMemory(context, memory);
  }
};

const extractSessionId = (stdout: string, stderr: string): string => {
  const keys = ["session_id", "sessionId", "thread_id", "threadId", "id"];
  for (const line of `${stdout}\n${stderr}`.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }

    try {
      const found = findSessionId(JSON.parse(trimmed), keys);
      if (found) {
        return found;
      }
    } catch {
      // Codex may also emit non-JSON status lines.
    }
  }
  return "";
};

const findSessionId = (value: unknown, keys: string[]): string => {
  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const found = normalizedSessionId(record[key]);
    if (found) {
      return found;
    }
  }

  for (const child of Object.values(record)) {
    const found = findSessionId(child, keys);
    if (found) {
      return found;
    }
  }
  return "";
};

const latestCodexSessionId = async (startedAt: Date): Promise<string> => {
  try {
    const file = path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "session_index.jsonl");
    const content = await fs.readFile(file, "utf8");
    const cutoff = startedAt.getTime();
    let latest: { id: string; updatedAt: number } | null = null;
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      const parsed = JSON.parse(line);
      const id = normalizedSessionId(parsed.id);
      const updatedAt = new Date(parsed.updated_at || 0).getTime();
      if (!id || !Number.isFinite(updatedAt) || updatedAt < cutoff) {
        continue;
      }
      if (!latest || updatedAt > latest.updatedAt) {
        latest = { id, updatedAt };
      }
    }
    return latest?.id || "";
  } catch {
    return "";
  }
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const runCodexProcess = async (
  config: CodexPlannerConfig,
  prompt: string,
  sessionId: string,
  outputPath: string
) => {
  const output = await runProcess({
    command: config.codexBin,
    args: codexArgs(config, prompt, sessionId, outputPath),
    stdin: codexStdin(config, prompt),
    env: codexEnv(config),
    timeoutMs: config.codexTimeoutMs
  });

  return {
    ...output,
    finalMessage: (await readFinalMessage(outputPath)).trim()
  };
};

const runCodex = async (
  config: CodexPlannerConfig,
  prompt: string,
  sessionState: CodexSessionState,
  outputPath: string,
  log: TraderBotProgressLogger
) => {
  if (config.codexSessionMode === "resume" && sessionState.resumeSessionId) {
    try {
      return {
        output: await runCodexProcess(config, prompt, sessionState.resumeSessionId, outputPath),
        usedResume: true,
        sessionId: sessionState.resumeSessionId
      };
    } catch (error) {
      log(`codex: resume failed session=${sessionState.resumeSessionId}; starting fresh (${errorMessage(error)})`);
    }
  }

  return {
    output: await runCodexProcess(config, prompt, "", outputPath),
    usedResume: false,
    sessionId: ""
  };
};

const roundDown = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  return Math.floor(value * factor) / factor;
};

const openOrdersMemory = (context: TraderBotPlannerContext): string =>
  context.memories.find((memory) => memory.key === "state/open_orders")?.value ?? "[]";

const hasOpenOrders = (context: TraderBotPlannerContext): boolean => {
  try {
    const parsed = JSON.parse(openOrdersMemory(context));
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return true;
  }
};

const tinyProbeQuantity = (context: TraderBotPlannerContext): number => {
  const referencePrice = Math.max(context.market.last, context.market.ask, context.market.bid);
  const notional = Math.min(
    context.config.riskPolicy.maxOrderNotional * 0.2,
    context.config.riskPolicy.maxPositionNotional * 0.08,
    Math.max(0, context.account.availableMargin * 0.008)
  );

  if (!Number.isFinite(referencePrice) || referencePrice <= 0 || !Number.isFinite(notional) || notional <= 0) {
    return 0;
  }
  return roundDown(notional / referencePrice, 5);
};

const observeOnly = (plan: AiTraderPlan): boolean =>
  plan.candidates.every((candidate) => candidate.actions.every((action) => action.type === "observe"));

const activeSimulationCandidate = (context: TraderBotPlannerContext): AiTraderPlanCandidate | undefined => {
  const position = context.account.position;
  if (position && position.side !== "flat" && position.quantity > 0) {
    return {
      id: "codex-active-sim-close-position",
      thesis: `Codex returned observe-only while the simulator already has an open ${position.side} ${position.symbol} position, so close it to create realized feedback before the next experiment.`,
      confidence: 0.64,
      expectedReward: 0.02,
      riskNotes: [
        "Active simulation policy only runs after Codex returns observe-only in paper_execute mode.",
        "The action is reduce-only and must still pass the local risk gate."
      ],
      actions: [{
        type: "close_position",
        symbol: position.symbol,
        reason: "Reset the existing simulation position so the bot receives execution and PnL feedback instead of passively holding."
      }]
    };
  }

  if (hasOpenOrders(context) || !context.config.riskPolicy.allowOpeningOrders) {
    return undefined;
  }

  const quantity = tinyProbeQuantity(context);
  if (quantity <= 0) {
    return undefined;
  }

  const action: AiTraderPlanAction = {
    type: "place_order",
    symbol: context.config.activeSymbol,
    side: "buy",
    orderType: "market",
    quantity,
    reduceOnly: false,
    timeInForce: "IOC",
    invalidationPrice: Number((context.market.last * 0.995).toFixed(2)),
    takeProfitPrice: Number((context.market.last * 1.006).toFixed(2)),
    reason: "Codex returned observe-only; active simulation policy opens a tiny bounded probe to generate training feedback."
  };

  return {
    id: "codex-active-sim-market-probe",
    thesis: `Use a tiny ${context.config.activeSymbol} market probe in the simulator because Codex produced no executable action and the account is flat with no open orders.`,
    confidence: 0.61,
    expectedReward: 0.03,
    riskNotes: [
      "This is an exploration action for Stratium simulation only.",
      "Sizing is bounded below the configured max order and position notional.",
      "The local risk gate can still reject the action."
    ],
    actions: [action]
  };
};

const applyActiveSimulationPolicy = (
  context: TraderBotPlannerContext,
  plan: AiTraderPlan,
  log: TraderBotProgressLogger
): AiTraderPlan => {
  if (context.config.mode !== "paper_execute" || !observeOnly(plan)) {
    return plan;
  }

  const candidate = activeSimulationCandidate(context);
  if (!candidate) {
    return plan;
  }

  log(`codex: observe-only plan converted by active simulation policy candidate=${candidate.id}`);
  return {
    ...plan,
    summary: `${plan.summary} Active simulation policy added ${candidate.actions[0]?.type ?? "action"} feedback.`,
    candidates: [candidate]
  };
};

const observeFallbackPlan = (context: TraderBotPlannerContext, reason: string): AiTraderPlan => ({
  schemaVersion: "stratium.ai-trader-plan.v1",
  summary: "Active simulation safety plan: observe because the Codex output was not safely executable.",
  candidates: [{
    id: "codex-invalid-plan-observe",
    thesis: "The planner output could not be safely parsed, so no trading action should be executed from it.",
    confidence: 0.3,
    expectedReward: 0,
    riskNotes: [
      "Invalid planner output was discarded before risk evaluation.",
      reason
    ],
    actions: [{
      type: "observe",
      reason: `Planner output for ${context.config.activeSymbol} was not safely executable; waiting for the next wake.`
    }]
  }]
});

const activeSimulationFallbackPlan = (
  context: TraderBotPlannerContext,
  reason: string,
  log: TraderBotProgressLogger
): AiTraderPlan => {
  const candidate = context.config.mode === "paper_execute" ? activeSimulationCandidate(context) : undefined;
  if (!candidate) {
    log(`codex: invalid plan (${reason}); using observe fallback`);
    return observeFallbackPlan(context, reason);
  }

  log(`codex: invalid plan (${reason}); converted by active simulation policy candidate=${candidate.id}`);
  return {
    schemaVersion: "stratium.ai-trader-plan.v1",
    summary: "Active simulation safety plan: generated a bounded feedback action after discarding malformed Codex output.",
    candidates: [{
      ...candidate,
      riskNotes: [
        ...(candidate.riskNotes ?? []),
        `Discarded malformed Codex output: ${reason}`
      ]
    }]
  };
};

const parseCodexPlan = (
  context: TraderBotPlannerContext,
  planText: string,
  log: TraderBotProgressLogger
): AiTraderPlan => {
  try {
    return applyActiveSimulationPolicy(context, parsePlan(planText, {
      defaultSymbol: context.config.activeSymbol
    }), log);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return activeSimulationFallbackPlan(context, reason, log);
  }
};

export const createCodexPlanner = (config: CodexPlannerConfig): TraderBotPlanner => ({
  plan: async (context, log: TraderBotProgressLogger = () => undefined) => {
    const sessionState = codexSessionState(config, context);
    prepareSessionRolloverSummary(context, sessionState);
    const prompt = buildPrompt(context);
    const startedAt = new Date(Date.now() - 1_000);
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "stratium-trader-codex-"));
    const outputPath = path.join(outputDir, "last-message.json");

    try {
      log(`codex: invoking bin=${config.codexBin}, promptMode=${config.codexPromptMode}, sessionMode=${config.codexSessionMode}, resumeSession=${sessionState.resumeSessionId || "fresh"}, wakeCount=${sessionState.previousWakeCount}/${sessionState.maxWakes}, timeout=${config.codexTimeoutMs}ms`);
      const run = await runCodex(config, prompt, sessionState, outputPath, log);
      const output = run.output;
      const discoveredSessionId = run.sessionId
        || extractSessionId(output.stdout, output.stderr)
        || await latestCodexSessionId(startedAt);
      const nextSessionId = discoveredSessionId || (run.usedResume ? sessionState.previousSessionId : "");
      const nextWakeCount = nextSessionId
        ? run.usedResume && nextSessionId === sessionState.previousSessionId
          ? sessionState.previousWakeCount + 1
          : 1
        : 0;
      const planText = output.finalMessage || extractFinalMessageFromJsonl(output.stdout) || output.stdout;
      log(`codex: returned final=${planText.length} chars, stdout=${output.stdout.length} chars, stderr=${output.stderr.length} chars, session=${nextSessionId || "unknown"}, sessionMode=${run.usedResume ? "resume" : "fresh"}, wakeCount=${nextWakeCount}/${sessionState.maxWakes}`);
      const plan = parseCodexPlan(context, planText, log);
      recordCodexSessionMemories(context, {
        sessionId: nextSessionId,
        mode: run.usedResume ? "resume" : "fresh",
        wakeCount: nextWakeCount,
        maxWakes: sessionState.maxWakes,
        freshReason: run.usedResume ? "" : sessionState.freshReason || "new_session",
        prompt
      });
      return plan;
    } finally {
      await fs.rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
});

export const codexPlannerInternals = {
  codexArgs,
  codexOutputFlags,
  codexStdin,
  codexSessionState,
  extractSessionId,
  extractFinalMessageFromJsonl,
  parseCodexPlan
};
