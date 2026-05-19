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
>;

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

const codexArgs = (config: CodexPlannerConfig, prompt: string, outputPath: string): string[] => {
  const base = config.codexArgs.length > 0 ? config.codexArgs : ["exec"];
  const promptArg = config.codexPromptMode === "arg" ? prompt : "-";
  if (!isExecBase(base)) {
    return [...base, promptArg];
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
    candidates: [candidate, ...plan.candidates]
  };
};

export const createCodexPlanner = (config: CodexPlannerConfig): TraderBotPlanner => ({
  plan: async (context, log: TraderBotProgressLogger = () => undefined) => {
    const prompt = buildPrompt(context);
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "stratium-trader-codex-"));
    const outputPath = path.join(outputDir, "last-message.json");

    try {
      const args = codexArgs(config, prompt, outputPath);
      log(`codex: invoking bin=${config.codexBin}, promptMode=${config.codexPromptMode}, timeout=${config.codexTimeoutMs}ms`);
      const output = await runProcess({
        command: config.codexBin,
        args,
        stdin: codexStdin(config, prompt),
        env: codexEnv(config),
        timeoutMs: config.codexTimeoutMs
      });
      const finalMessage = (await readFinalMessage(outputPath)).trim();
      const planText = finalMessage || extractFinalMessageFromJsonl(output.stdout) || output.stdout;
      log(`codex: returned final=${planText.length} chars, stdout=${output.stdout.length} chars, stderr=${output.stderr.length} chars`);
      return applyActiveSimulationPolicy(context, parsePlan(planText), log);
    } finally {
      await fs.rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
});

export const codexPlannerInternals = {
  codexArgs,
  codexOutputFlags,
  codexStdin,
  extractFinalMessageFromJsonl
};
