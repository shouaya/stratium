import { describe, expect, it } from "vitest";
import { parseCliFlags } from "../src/config/flags.js";
import { loadRunnerConfig } from "../src/config/config.js";

describe("trader-bot config flags", () => {
  it("parses witch-style account/password/bot-id startup flags", () => {
    const flags = parseCliFlags([
      "--api-url", "http://localhost:6100",
      "--mcp-url", "http://localhost:4600/mcp",
      "--email", "demo",
      "--password", "demo123456",
      "--bot-id", "sim-bot",
      "--mode", "shadow",
      "--planner", "baseline",
      "--codex-bin", "codex",
      "--codex-args", "exec --sandbox read-only",
      "--codex-prompt-mode", "stdin",
      "--once"
    ]);

    expect(flags).toMatchObject({
      apiUrl: "http://localhost:6100",
      mcpUrl: "http://localhost:4600/mcp",
      account: "demo",
      password: "demo123456",
      botId: "sim-bot",
      mode: "shadow",
      planner: "baseline",
      codexBin: "codex",
      codexArgs: "exec --sandbox read-only",
      codexPromptMode: "stdin",
      once: true
    });
  });

  it("builds runner config from flags", () => {
    const config = loadRunnerConfig(parseCliFlags([
      "--account=demo",
      "--password=demo123456",
      "--bot-id=bot-a",
      "--symbol=ETH-USD"
    ]), {});

    expect(config).toMatchObject({
      account: "demo",
      password: "demo123456",
      botId: "bot-a",
      planner: "codex",
      activeSymbol: "ETH-USD",
      apiBaseUrl: "http://localhost:6100",
      traderMcpUrl: "http://localhost:4600/mcp",
      codexBin: "codex",
      codexArgs: ["exec", "--sandbox", "read-only", "--ephemeral", "--ignore-rules", "--color", "never"],
      codexPromptMode: "stdin",
      codexTimeoutMs: 180_000
    });
  });
});
