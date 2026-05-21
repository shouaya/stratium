import { z } from "zod";
import type { StratiumHttpClient } from "../core/client.js";
import type { ClientToolDefinition } from "./tool-registry.js";

const limitSchema = z.number().int().positive().max(500).default(200);
const memoImportanceSchema = z.number().min(0).max(1).optional();

export const analystToolDefinitions: ClientToolDefinition[] = [
  {
    name: "stratium_analyst_list_bots",
    title: "Analyst List Bots",
    description: "Return the admin bot dashboard profiles available to an analyst bot, including the configured AI language.",
    run: (client: StratiumHttpClient) => client.getAnalystBots()
  },
  {
    name: "stratium_analyst_get_language",
    title: "Analyst Get Language",
    description: "Return the configured AI language that analyst notes and trader plan text should use.",
    run: (client: StratiumHttpClient) => client.getAnalystLanguage()
  },
  {
    name: "stratium_analyst_get_all_bot_reviews",
    title: "Analyst Get All Bot Reviews",
    description: "Return compact performance reviews for all trader bots.",
    inputSchema: {
      limit: limitSchema
    },
    run: (client, { limit }) => client.getAnalystAllBotReviews(limit)
  },
  {
    name: "stratium_analyst_get_bot_review",
    title: "Analyst Get Bot Review",
    description: "Return a compact performance review for one trader bot.",
    inputSchema: {
      botId: z.string().min(1),
      accountId: z.string().min(1).optional(),
      limit: limitSchema
    },
    run: (client, { botId, accountId, limit }) => client.getAnalystBotReview(botId, accountId, limit)
  },
  {
    name: "stratium_analyst_get_bot_memories",
    title: "Analyst Get Bot Memories",
    description: "Return persisted memories for one trader bot.",
    inputSchema: {
      botId: z.string().min(1),
      accountId: z.string().min(1).optional(),
      limit: limitSchema
    },
    run: (client, { botId, accountId, limit }) => client.getAnalystBotMemories(botId, accountId, limit)
  },
  {
    name: "stratium_analyst_get_bot_wakes",
    title: "Analyst Get Bot Wakes",
    description: "Return recent wake reports for one trader bot.",
    inputSchema: {
      botId: z.string().min(1),
      limit: limitSchema
    },
    run: (client, { botId, limit }) => client.getAnalystBotWakes(botId, limit)
  },
  {
    name: "stratium_analyst_list_memos",
    title: "Analyst List Memos",
    description: "Return global analyst review and strategy memos visible to trader bots.",
    inputSchema: {
      targetBotId: z.string().min(1).optional(),
      limit: limitSchema
    },
    run: (client, { targetBotId, limit }) => client.listAnalystMemos(targetBotId, limit)
  },
  {
    name: "stratium_analyst_write_global_review",
    title: "Analyst Write Global Review",
    description: "Persist the analyst's global review memo for future trader bot wakes. The memo value should use the configured AI language.",
    inputSchema: {
      value: z.string().min(1),
      memoryKey: z.string().min(1).default("global_review/latest"),
      importance: memoImportanceSchema
    },
    run: (client, { value, memoryKey, importance }) =>
      client.writeAnalystMemo({
        memoryKey,
        value,
        importance,
        source: "reflection"
      })
  },
  {
    name: "stratium_analyst_write_strategy_memo",
    title: "Analyst Write Strategy Memo",
    description: "Persist a strategy memo for all trader bots or one target trader bot. The memo value should use the configured AI language.",
    inputSchema: {
      value: z.string().min(1),
      targetBotId: z.string().min(1).optional(),
      memoryKey: z.string().min(1).optional(),
      importance: memoImportanceSchema
    },
    run: (client, { value, targetBotId, memoryKey, importance }) =>
      client.writeAnalystMemo({
        targetBotId,
        memoryKey,
        value,
        importance,
        source: "strategy_package"
      })
  }
];
