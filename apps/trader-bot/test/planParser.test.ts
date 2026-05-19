import { describe, expect, it } from "vitest";
import { parsePlan } from "../src/planner/planParser.js";

describe("parsePlan", () => {
  it("parses fenced JSON planner output", () => {
    const plan = parsePlan(`Here is the plan:
\`\`\`json
{
  "schemaVersion": "stratium.ai-trader-plan.v1",
  "summary": "watch the market",
  "candidates": [
    {
      "id": "observe",
      "thesis": "spread is too wide",
      "confidence": 0.7,
      "actions": [
        {
          "type": "observe",
          "reason": "wait for spread to normalize"
        }
      ]
    }
  ]
}
\`\`\``);

    expect(plan.candidates[0].actions[0]).toMatchObject({
      type: "observe",
      reason: "wait for spread to normalize"
    });
  });

  it("rejects unknown action types", () => {
    expect(() => parsePlan({
      schemaVersion: "stratium.ai-trader-plan.v1",
      summary: "bad",
      candidates: [
        {
          id: "bad",
          thesis: "bad action",
          confidence: 0.4,
          actions: [
            {
              type: "teleport",
              reason: "not real"
            } as never
          ]
        }
      ]
    })).toThrow("allowed action type");
  });

  it("rejects confidence outside the allowed range", () => {
    expect(() => parsePlan({
      schemaVersion: "stratium.ai-trader-plan.v1",
      summary: "bad",
      candidates: [
        {
          id: "bad",
          thesis: "overconfident",
          confidence: 2,
          actions: [
            {
              type: "observe",
              reason: "bad confidence"
            }
          ]
        }
      ]
    })).toThrow("confidence");
  });
});
