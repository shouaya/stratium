import { describe, expect, it } from "vitest";
import { codexPlannerInternals } from "../src/planner/codexPlanner.js";

const config = {
  apiBaseUrl: "http://localhost:6100",
  traderMcpUrl: "http://localhost:4600/mcp",
  botId: "test-bot",
  activeSymbol: "BTC-USD",
  codexBin: "codex",
  codexArgs: ["exec", "--sandbox", "read-only", "--ephemeral"],
  codexPromptMode: "stdin" as const,
  codexTimeoutMs: 180_000
};

describe("codexPlannerInternals", () => {
  it("builds a non-interactive Codex exec command with stdin prompt mode", () => {
    expect(codexPlannerInternals.codexArgs(config, "prompt-body", "/tmp/last-message.json")).toEqual([
      "exec",
      "--json",
      "--output-last-message",
      "/tmp/last-message.json",
      "--sandbox",
      "read-only",
      "--ephemeral",
      "-"
    ]);
    expect(codexPlannerInternals.codexStdin(config, "prompt-body")).toBe("prompt-body");
  });

  it("extracts the final plan text from Codex JSONL output if the final-message file is unavailable", () => {
    const plan = JSON.stringify({
      schemaVersion: "stratium.ai-trader-plan.v1",
      summary: "observe",
      candidates: [{
        id: "candidate-1",
        thesis: "wait",
        confidence: 0.5,
        actions: [{ type: "observe", reason: "no setup" }]
      }]
    });

    const jsonl = [
      JSON.stringify({ type: "turn_started" }),
      JSON.stringify({ type: "message", message: { content: [{ text: plan }] } })
    ].join("\n");

    expect(codexPlannerInternals.extractFinalMessageFromJsonl(jsonl)).toBe(plan);
  });
});
