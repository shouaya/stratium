import type { AnalystBotConfig, AnalystBotProfile, AnalystContext, AnalystLanguage } from "../types.js";
import type { AnalystMcpClient } from "../infra/analystMcpClient.js";
import { toolRaw } from "../infra/analystMcpClient.js";

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

const normalizeLanguage = (value: unknown): AnalystLanguage =>
  value === "zh" || value === "ja" || value === "en" ? value : "en";

const profilesFromDashboard = (dashboard: unknown): AnalystBotProfile[] => {
  const profiles = asRecord(dashboard)?.profiles;
  if (!Array.isArray(profiles)) {
    return [];
  }

  return profiles.flatMap((entry) => {
    const profile = asRecord(entry);
    if (!profile) {
      return [];
    }
    const botId = typeof profile?.botId === "string" ? profile.botId.trim() : "";
    if (!botId) {
      return [];
    }
    return [{
      botId,
      accountId: typeof profile.accountId === "string" ? profile.accountId : undefined,
      symbol: typeof profile.symbol === "string" ? profile.symbol : undefined,
      mode: typeof profile.mode === "string" ? profile.mode : undefined,
      health: typeof profile.health === "string" ? profile.health : undefined,
      riskState: typeof profile.riskState === "string" ? profile.riskState : undefined,
      strategySummary: typeof profile.strategySummary === "string" || profile.strategySummary === null ? profile.strategySummary : undefined,
      planSummary: typeof profile.planSummary === "string" || profile.planSummary === null ? profile.planSummary : undefined,
      equity: typeof profile.equity === "number" ? profile.equity : undefined,
      dailyPnl: typeof profile.dailyPnl === "number" ? profile.dailyPnl : undefined,
      drawdownPct: typeof profile.drawdownPct === "number" ? profile.drawdownPct : undefined,
      openOrders: typeof profile.openOrders === "number" ? profile.openOrders : undefined,
      position: profile.position
    }];
  });
};

export const createAnalystContext = async (input: {
  config: AnalystBotConfig;
  mcpClient: AnalystMcpClient;
  now?: string;
}): Promise<AnalystContext> => {
  const [languageResult, dashboardResult, allBotReviewsResult, memosResult] = await Promise.all([
    input.mcpClient.callTool("stratium_analyst_get_language"),
    input.mcpClient.callTool("stratium_analyst_list_bots"),
    input.mcpClient.callTool("stratium_analyst_get_all_bot_reviews", { limit: 200 }),
    input.mcpClient.callTool("stratium_analyst_list_memos", { limit: 200 })
  ]);
  const languagePayload = asRecord(toolRaw(languageResult));
  const language = normalizeLanguage(languagePayload?.language);
  const languageInstruction = typeof languagePayload?.instruction === "string"
    ? languagePayload.instruction
    : "Use English for analyst notes and trader plan natural-language fields. Keep JSON keys and enum values in English.";
  const dashboard = toolRaw(dashboardResult);
  const profiles = profilesFromDashboard(dashboard).slice(0, input.config.maxBots);
  const botDetails = await Promise.all(profiles.map(async (profile) => {
    const [review, wakes, memories] = await Promise.all([
      input.mcpClient.callTool("stratium_analyst_get_bot_review", {
        botId: profile.botId,
        ...(profile.accountId ? { accountId: profile.accountId } : {}),
        limit: 200
      }).catch((error) => ({ raw: { error: error instanceof Error ? error.message : String(error) } })),
      input.mcpClient.callTool("stratium_analyst_get_bot_wakes", {
        botId: profile.botId,
        limit: 30
      }).catch((error) => ({ raw: { error: error instanceof Error ? error.message : String(error) } })),
      input.mcpClient.callTool("stratium_analyst_get_bot_memories", {
        botId: profile.botId,
        ...(profile.accountId ? { accountId: profile.accountId } : {}),
        limit: 80
      }).catch((error) => ({ raw: { error: error instanceof Error ? error.message : String(error) } }))
    ]);

    return {
      botId: profile.botId,
      accountId: profile.accountId,
      review: toolRaw(review),
      wakes: toolRaw(wakes),
      memories: toolRaw(memories)
    };
  }));

  return {
    now: input.now ?? new Date().toISOString(),
    analystBotId: input.config.botId,
    language,
    languageInstruction,
    dashboard,
    allBotReviews: toolRaw(allBotReviewsResult),
    existingMemos: toolRaw(memosResult),
    botDetails
  };
};
