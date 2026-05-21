import type { AnalystContext, AnalystLanguage } from "../types.js";

const languageName = (language: AnalystLanguage) => {
  if (language === "zh") {
    return "Simplified Chinese";
  }
  if (language === "ja") {
    return "Japanese";
  }
  return "English";
};

const exampleText = (language: AnalystLanguage) => {
  if (language === "zh") {
    return {
      review: "全局复盘：当前 bot 亏损主要来自过度市价成交和手续费，下一阶段应降低交易频率。",
      memo: "策略调整：只在趋势和波动结构清晰时开仓，优先限价，避免连续亏损后继续试单。",
      observation: "市场噪音较高，胜率和成本结构仍需改善。"
    };
  }
  if (language === "ja") {
    return {
      review: "全体レビュー：現在の損失は成行約定の多さと手数料負担が主因で、次の段階では取引頻度を下げるべきです。",
      memo: "戦略調整：トレンドとボラティリティ構造が明確な時だけエントリーし、指値を優先し、連敗後の試行を避けます。",
      observation: "市場ノイズが高く、勝率とコスト構造はまだ改善が必要です。"
    };
  }
  return {
    review: "Global review: current losses are mostly caused by excessive market fills and fees, so the next phase should reduce trading frequency.",
    memo: "Strategy adjustment: enter only when trend and volatility structure are clear, prefer limit orders, and avoid probing after consecutive losses.",
    observation: "Market noise is high; win rate and cost structure still need improvement."
  };
};

const compactJson = (value: unknown, maxLength = 32_000): string => {
  const text = JSON.stringify(value, null, 2);
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}\n...TRUNCATED`;
};

export const buildAnalystPrompt = (context: AnalystContext): string => {
  const examples = exampleText(context.language);
  const compactContext = {
    now: context.now,
    analystBotId: context.analystBotId,
    outputLanguage: {
      code: context.language,
      label: languageName(context.language),
      instruction: context.languageInstruction
    },
    dashboard: context.dashboard,
    allBotReviews: context.allBotReviews,
    existingMemos: context.existingMemos,
    botDetails: context.botDetails
  };

  return [
    "You are the Stratium analyst bot.",
    "Your job is to review multiple simulation trader bots, identify what is hurting or helping performance, and write concise memory memos that the trader bots can use on their next wake.",
    "You cannot place, cancel, or modify orders. You only write review and strategy memory.",
    "Return JSON only. Do not include markdown.",
    context.languageInstruction,
    "Keep JSON keys, schemaVersion, bot ids, symbols, and enum-like values in English.",
    "Focus on PnL curve, win rate, drawdown, action mix, order flow, cost stats, reward stats, recent wakes, current position, open orders, and repeated mistakes.",
    "The globalReview should summarize cross-bot lessons. strategyMemos can target one bot with targetBotId or all bots by omitting targetBotId.",
    "Do not recommend more trading just to create activity. Recommend fewer, higher-quality trades when costs or downSteps dominate.",
    "Context:",
    compactJson(compactContext),
    "Response shape:",
    JSON.stringify({
      schemaVersion: "stratium.analyst-review.v1",
      language: context.language,
      globalReview: {
        value: examples.review,
        importance: 0.9
      },
      strategyMemos: [
        {
          targetBotId: "local-demo-trader",
          value: examples.memo,
          importance: 0.9
        }
      ],
      observations: [examples.observation],
      nextReviewAfterMs: 1_800_000
    }, null, 2)
  ].join("\n\n");
};
