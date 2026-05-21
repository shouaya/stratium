import { describe, expect, it } from "vitest";
import { parseAnalystPlan } from "../src/planner/planParser.js";

describe("parseAnalystPlan", () => {
  it("parses fenced JSON and normalizes memos", () => {
    const plan = parseAnalystPlan(`\`\`\`json
{
  "schemaVersion": "stratium.analyst-review.v1",
  "language": "zh",
  "globalReview": {
    "value": "全局复盘",
    "importance": 1.2
  },
  "strategyMemos": [
    {
      "targetBotId": " local-demo-trader ",
      "value": "降低交易频率",
      "importance": 0.9
    }
  ],
  "observations": ["成本偏高"],
  "nextReviewAfterMs": 120000
}
\`\`\``);

    expect(plan.globalReview).toEqual({
      value: "全局复盘",
      importance: 1
    });
    expect(plan.strategyMemos).toEqual([{
      targetBotId: "local-demo-trader",
      value: "降低交易频率",
      importance: 0.9
    }]);
    expect(plan.nextReviewAfterMs).toBe(120_000);
  });

  it("rejects empty analyst output", () => {
    expect(() => parseAnalystPlan({
      schemaVersion: "stratium.analyst-review.v1",
      language: "en",
      strategyMemos: []
    })).toThrow("globalReview.value");
  });
});
