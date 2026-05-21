import type { TraderBotPlannerContext } from "../types.js";

type AiTraderLanguage = "zh" | "ja" | "en";

const AI_TRADER_DEFAULT_LANGUAGE: AiTraderLanguage = "en";
const AI_TRADER_LANGUAGE_MEMORY_KEY = "platform/ai_language";

const normalizeAiTraderLanguage = (value: unknown): AiTraderLanguage =>
  value === "zh" || value === "ja" || value === "en" ? value : AI_TRADER_DEFAULT_LANGUAGE;

export const TRADER_LANGUAGE_LABELS: Record<AiTraderLanguage, string> = {
  zh: "Simplified Chinese (中文)",
  ja: "Japanese (日本語)",
  en: "English"
};

export const TRADER_LANGUAGE_INSTRUCTIONS: Record<AiTraderLanguage, string> = {
  zh: "Write every natural-language value in Simplified Chinese. Keep JSON keys, action types, enum values, ids, symbols, and numbers exactly schema-compatible.",
  ja: "Write every natural-language value in Japanese. Keep JSON keys, action types, enum values, ids, symbols, and numbers exactly schema-compatible.",
  en: "Write every natural-language value in English. Keep JSON keys, action types, enum values, ids, symbols, and numbers exactly schema-compatible."
};

export const resolveTraderBotLanguage = (context: TraderBotPlannerContext): AiTraderLanguage =>
  normalizeAiTraderLanguage(
    context.memories.find((memory) => memory.key === AI_TRADER_LANGUAGE_MEMORY_KEY)?.value
      ?? process.env.STRATIUM_TRADER_BOT_LANGUAGE
      ?? process.env.STRATIUM_AI_LANGUAGE
      ?? AI_TRADER_DEFAULT_LANGUAGE
  );

export const responseExampleText = (language: AiTraderLanguage) => {
  if (language === "zh") {
    return {
      summary: "简短总结",
      thesis: "为什么这个计划合理",
      riskNote: "主要风险",
      reason: "为什么现在不交易更好"
    };
  }

  if (language === "ja") {
    return {
      summary: "短い要約",
      thesis: "この計画が妥当な理由",
      riskNote: "主なリスク",
      reason: "今は取引しない方がよい理由"
    };
  }

  return {
    summary: "short summary",
    thesis: "why this plan is reasonable",
    riskNote: "main risk",
    reason: "why no trade is best"
  };
};
