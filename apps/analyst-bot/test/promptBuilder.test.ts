import { describe, expect, it } from "vitest";
import { buildAnalystPrompt } from "../src/planner/promptBuilder.js";
import type { AnalystContext } from "../src/types.js";

const context: AnalystContext = {
  now: "2026-05-21T00:00:00.000Z",
  analystBotId: "local-analyst",
  language: "ja",
  languageInstruction: "Use Japanese for analyst notes and trader plan natural-language fields. Keep JSON keys and enum values in English.",
  dashboard: {
    profiles: [{
      botId: "local-demo-trader",
      dailyPnl: -4.2
    }]
  },
  allBotReviews: {
    reviews: []
  },
  existingMemos: {
    memories: []
  },
  botDetails: [{
    botId: "local-demo-trader",
    accountId: "paper-account-1",
    review: {
      rewardStats: {
        equityDelta: -4.2
      }
    },
    wakes: [],
    memories: []
  }]
};

describe("buildAnalystPrompt", () => {
  it("asks the analyst to return localized strategy memo JSON", () => {
    const prompt = buildAnalystPrompt(context);

    expect(prompt).toContain("Stratium analyst bot");
    expect(prompt).toContain("Use Japanese");
    expect(prompt).toContain("stratium.analyst-review.v1");
    expect(prompt).toContain("local-demo-trader");
    expect(prompt).toContain("戦略調整");
  });
});
