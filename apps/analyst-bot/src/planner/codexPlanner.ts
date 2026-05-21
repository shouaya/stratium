import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runProcess } from "../infra/processRunner.js";
import type { AnalystBotConfig, AnalystContext, AnalystPlanner, AnalystProgressLogger } from "../types.js";
import { parseAnalystPlan } from "./planParser.js";
import { buildAnalystPrompt } from "./promptBuilder.js";

type CodexConfig = Pick<
  AnalystBotConfig,
  "apiBaseUrl" | "analystMcpUrl" | "botId" | "codexBin" | "codexArgs" | "codexPromptMode" | "codexTimeoutMs"
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

const codexArgs = (config: CodexConfig, prompt: string, outputPath: string): string[] => {
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

const codexStdin = (config: CodexConfig, prompt: string): string =>
  config.codexPromptMode === "stdin" ? prompt : "";

const codexEnv = (config: CodexConfig): NodeJS.ProcessEnv => ({
  NO_COLOR: "1",
  STRATIUM_API_PUBLIC_BASE_URL: config.apiBaseUrl,
  STRATIUM_ANALYST_MCP_URL: config.analystMcpUrl,
  STRATIUM_ANALYST_BOT_ID: config.botId
});

const readFinalMessage = async (outputPath: string): Promise<string> => {
  try {
    return await fs.readFile(outputPath, "utf8");
  } catch {
    return "";
  }
};

const findAnalystPlanText = (value: unknown): string => {
  if (typeof value === "string") {
    return value.includes("stratium.analyst-review.v1") ? value : "";
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findAnalystPlanText(child);
      if (found) {
        return found;
      }
    }
    return "";
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  const record = value as Record<string, unknown>;
  for (const key of ["final_message", "last_message", "message", "content", "text", "delta"]) {
    const found = findAnalystPlanText(record[key]);
    if (found) {
      return found;
    }
  }
  for (const child of Object.values(record)) {
    const found = findAnalystPlanText(child);
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
      const found = findAnalystPlanText(JSON.parse(line));
      if (found) {
        return found;
      }
    } catch {
      if (line.includes("stratium.analyst-review.v1")) {
        return line;
      }
    }
  }
  return "";
};

export const createCodexAnalystPlanner = (config: CodexConfig): AnalystPlanner => ({
  plan: async (context: AnalystContext, log: AnalystProgressLogger = () => undefined) => {
    const prompt = buildAnalystPrompt(context);
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "stratium-analyst-codex-"));
    const outputPath = path.join(outputDir, "last-message.json");

    try {
      log(`codex: invoking bin=${config.codexBin}, promptMode=${config.codexPromptMode}, timeout=${config.codexTimeoutMs}ms`);
      const output = await runProcess({
        command: config.codexBin,
        args: codexArgs(config, prompt, outputPath),
        stdin: codexStdin(config, prompt),
        env: codexEnv(config),
        timeoutMs: config.codexTimeoutMs
      });
      const finalMessage = (await readFinalMessage(outputPath)).trim()
        || extractFinalMessageFromJsonl(output.stdout)
        || output.stdout;
      log(`codex: returned final=${finalMessage.length} chars, stdout=${output.stdout.length} chars, stderr=${output.stderr.length} chars`);
      return parseAnalystPlan(finalMessage);
    } finally {
      await fs.rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
});
