import type { AnalystLanguage, AnalystPlan } from "../types.js";

const VALID_LANGUAGES = new Set(["zh", "ja", "en"]);

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

const clampImportance = (value: unknown, fallback: number): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, parsed));
};

const extractJsonText = (value: string): string => {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced) {
    return fenced;
  }

  const firstBrace = value.indexOf("{");
  const lastBrace = value.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return value.slice(firstBrace, lastBrace + 1);
  }

  return value;
};

export const parseAnalystPlan = (value: string | unknown): AnalystPlan => {
  const parsed = typeof value === "string" ? JSON.parse(extractJsonText(value)) : value;
  const record = asRecord(parsed);

  if (!record || record.schemaVersion !== "stratium.analyst-review.v1") {
    throw new Error("Analyst plan must use schemaVersion stratium.analyst-review.v1.");
  }

  const language = VALID_LANGUAGES.has(String(record.language)) ? record.language as AnalystLanguage : "en";
  const globalReview = asRecord(record.globalReview);
  const globalValue = typeof globalReview?.value === "string" ? globalReview.value.trim() : "";
  const strategyMemos = (Array.isArray(record.strategyMemos) ? record.strategyMemos : [])
    .flatMap((entry) => {
      const memo = asRecord(entry);
      const valueText = typeof memo?.value === "string" ? memo.value.trim() : "";
      if (!valueText) {
        return [];
      }
      return [{
        targetBotId: typeof memo?.targetBotId === "string" && memo.targetBotId.trim()
          ? memo.targetBotId.trim()
          : undefined,
        value: valueText,
        importance: clampImportance(memo?.importance, 0.85)
      }];
    })
    .slice(0, 20);

  if (!globalValue && strategyMemos.length === 0) {
    throw new Error("Analyst plan must contain globalReview.value or at least one strategy memo.");
  }

  return {
    schemaVersion: "stratium.analyst-review.v1",
    language,
    globalReview: globalValue
      ? {
          value: globalValue,
          importance: clampImportance(globalReview?.importance, 0.85)
        }
      : undefined,
    strategyMemos,
    observations: (Array.isArray(record.observations) ? record.observations : [])
      .filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
      .slice(0, 20),
    nextReviewAfterMs: typeof record.nextReviewAfterMs === "number" && Number.isFinite(record.nextReviewAfterMs)
      ? Math.max(60_000, Math.floor(record.nextReviewAfterMs))
      : undefined
  };
};
