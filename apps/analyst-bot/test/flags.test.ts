import { describe, expect, it } from "vitest";
import { loadAnalystBotConfig } from "../src/config/config.js";
import { parseCliFlags } from "../src/config/flags.js";

describe("analyst-bot config flags", () => {
  it("parses CLI flags and overlays environment defaults", () => {
    const flags = parseCliFlags([
      "--once",
      "--api-url", "http://localhost:6100",
      "--mcp-url", "http://localhost:4600/mcp",
      "--account", "admin",
      "--password", "admin123456",
      "--bot-id", "local-analyst",
      "--review-interval-ms", "900000",
      "--max-bots", "3",
      "--codex-args", "exec --color never",
      "--codex-prompt-mode", "stdin"
    ]);
    const config = loadAnalystBotConfig(flags, {});

    expect(config).toMatchObject({
      apiBaseUrl: "http://localhost:6100",
      analystMcpUrl: "http://localhost:4600/mcp",
      account: "admin",
      password: "admin123456",
      botId: "local-analyst",
      once: true,
      reviewIntervalMs: 900_000,
      maxBots: 3,
      codexPromptMode: "stdin"
    });
    expect(config.codexArgs).toEqual(["exec", "--color", "never"]);
  });
});
