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
      "--wake-interval-ms", "300000",
      "--position-review-ms", "60000",
      "--open-order-review-ms", "120000",
      "--post-execution-review-ms", "15000",
      "--risk-retry-ms", "30000",
      "--signal-review-ms", "30000",
      "--codex-bin", "codex",
      "--codex-args", "exec --sandbox read-only",
      "--codex-prompt-mode", "stdin",
      "--codex-session-mode", "fresh",
      "--codex-session-max-wakes", "12",
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
      wakeIntervalMs: "300000",
      positionReviewMs: "60000",
      openOrderReviewMs: "120000",
      postExecutionReviewMs: "15000",
      riskRetryMs: "30000",
      signalReviewMs: "30000",
      codexBin: "codex",
      codexArgs: "exec --sandbox read-only",
      codexPromptMode: "stdin",
      codexSessionMode: "fresh",
      codexSessionMaxWakes: "12",
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
      wakeIntervalMs: 300_000,
      wakePolicy: {
        heartbeatIntervalMs: 300_000,
        positionReviewIntervalMs: 60_000,
        openOrderReviewIntervalMs: 120_000,
        postExecutionReviewIntervalMs: 15_000,
        riskRetryIntervalMs: 30_000,
        signalReviewIntervalMs: 30_000
      },
      apiBaseUrl: "http://localhost:6100",
      traderMcpUrl: "http://localhost:4600/mcp",
      codexBin: "codex",
      codexArgs: ["exec", "--sandbox", "read-only", "--ignore-rules", "--color", "never"],
      codexPromptMode: "stdin",
      codexTimeoutMs: 180_000,
      codexSessionMode: "resume",
      codexSessionMaxWakes: 40
    });
  });
});
