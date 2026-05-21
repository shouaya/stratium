import { describe, expect, it, vi } from "vitest";
import { runAnalystCycle } from "../src/runtime/analystCycle.js";
import type { AnalystBotConfig, AnalystPlan, AnalystPlanner } from "../src/types.js";
import type { AnalystMcpClient } from "../src/infra/analystMcpClient.js";

const config: AnalystBotConfig = {
  apiBaseUrl: "http://localhost:6100",
  analystMcpUrl: "http://localhost:4600/mcp",
  account: "admin",
  password: "admin123456",
  botId: "local-analyst",
  once: true,
  reviewIntervalMs: 1_800_000,
  maxBots: 2,
  codexBin: "codex",
  codexArgs: ["exec"],
  codexPromptMode: "stdin",
  codexTimeoutMs: 180_000
};

describe("runAnalystCycle", () => {
  it("loads context and writes global and targeted strategy memos", async () => {
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
    const mcpClient: AnalystMcpClient = {
      listToolNames: vi.fn(async () => []),
      close: vi.fn(async () => undefined),
      callTool: vi.fn(async (name, args) => {
        calls.push({ name, args });
        if (name === "stratium_analyst_get_language") {
          return { raw: { language: "zh", instruction: "Use Simplified Chinese." } };
        }
        if (name === "stratium_analyst_list_bots") {
          return { raw: { profiles: [{ botId: "local-demo-trader", accountId: "paper-account-1" }] } };
        }
        if (name === "stratium_analyst_get_all_bot_reviews") {
          return { raw: { reviews: [] } };
        }
        if (name === "stratium_analyst_list_memos") {
          return { raw: { memories: [] } };
        }
        if (name === "stratium_analyst_get_bot_review") {
          return { raw: { review: { botId: "local-demo-trader" } } };
        }
        if (name === "stratium_analyst_get_bot_wakes") {
          return { raw: { wakes: [] } };
        }
        if (name === "stratium_analyst_get_bot_memories") {
          return { raw: { memories: [] } };
        }
        return { raw: { status: "recorded" } };
      })
    };
    const planner: AnalystPlanner = {
      plan: vi.fn(async (): Promise<AnalystPlan> => ({
        schemaVersion: "stratium.analyst-review.v1",
        language: "zh",
        globalReview: {
          value: "全局复盘",
          importance: 0.9
        },
        strategyMemos: [{
          targetBotId: "local-demo-trader",
          value: "降低交易频率",
          importance: 0.9
        }]
      }))
    };

    const result = await runAnalystCycle({ config, mcpClient, planner });

    expect(result).toMatchObject({
      status: "completed",
      globalReviewWritten: true,
      strategyMemosWritten: 1,
      language: "zh"
    });
    expect(calls.some((call) => call.name === "stratium_analyst_write_global_review")).toBe(true);
    expect(calls.some((call) => call.name === "stratium_analyst_write_strategy_memo" && call.args?.targetBotId === "local-demo-trader")).toBe(true);
  });
});
