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

  it("normalizes numeric strings from model output", () => {
    const plan = parsePlan({
      schemaVersion: "stratium.ai-trader-plan.v1",
      summary: "probe",
      candidates: [
        {
          id: "probe",
          thesis: "small executable test",
          confidence: "0.6",
          expectedReward: "0.01",
          actions: [
            {
              type: "place_order",
              symbol: "BTC-USD",
              side: "buy",
              orderType: "market",
              quantity: "0.0002",
              invalidationPrice: "76000",
              takeProfitPrice: "77000",
              reason: "model emitted numbers as strings"
            }
          ]
        } as never
      ]
    });

    expect(plan.candidates[0]).toMatchObject({
      confidence: 0.6,
      expectedReward: 0.01
    });
    expect(plan.candidates[0].actions[0]).toMatchObject({
      type: "place_order",
      quantity: 0.0002,
      invalidationPrice: 76000,
      takeProfitPrice: 77000
    });
  });

  it("fills a missing action reason from the candidate thesis", () => {
    const plan = parsePlan({
      schemaVersion: "stratium.ai-trader-plan.v1",
      summary: "probe",
      candidates: [
        {
          id: "probe",
          thesis: "Take a tiny bounded simulator probe.",
          confidence: 0.6,
          actions: [
            {
              type: "place_order",
              symbol: "BTC-USD",
              side: "buy",
              orderType: "market",
              quantity: 0.0002,
              invalidationPrice: 76000
            }
          ]
        } as never
      ]
    });

    expect(plan.candidates[0].actions[0]).toMatchObject({
      type: "place_order",
      reason: "Planner omitted action reason; using candidate thesis: Take a tiny bounded simulator probe."
    });
  });

  it("treats cancel_order without an id target as observe instead of a validation failure", () => {
    const plan = parsePlan({
      schemaVersion: "stratium.ai-trader-plan.v1",
      summary: "cancel stale order",
      candidates: [
        {
          id: "cancel",
          thesis: "Cancel stale order if present.",
          confidence: 0.6,
          actions: [
            {
              type: "cancel_order",
              symbol: "BTC-USD",
              orderId: "",
              clientOrderId: "",
              reason: "model emitted empty identifiers"
            }
          ]
        } as never
      ]
    });

    expect(plan.candidates[0].actions[0]).toMatchObject({
      type: "observe",
      reason: "Planner requested cancel_order without orderId/clientOrderId; observing instead. Original reason: model emitted empty identifiers"
    });
  });

  it("keeps cancel_order when a client order id is present and order id is blank", () => {
    const plan = parsePlan({
      schemaVersion: "stratium.ai-trader-plan.v1",
      summary: "cancel stale order",
      candidates: [
        {
          id: "cancel",
          thesis: "Cancel stale order.",
          confidence: 0.6,
          actions: [
            {
              type: "cancel_order",
              symbol: "BTC-USD",
              orderId: "",
              clientOrderId: "ai-123",
              reason: "cancel stale order"
            }
          ]
        } as never
      ]
    });

    expect(plan.candidates[0].actions[0]).toMatchObject({
      type: "cancel_order",
      symbol: "BTC-USD",
      clientOrderId: "ai-123"
    });
  });

  it("normalizes numeric order ids and ignores malformed optional ids", () => {
    const withNumericOrderId = parsePlan({
      schemaVersion: "stratium.ai-trader-plan.v1",
      summary: "cancel stale order",
      candidates: [
        {
          id: "cancel",
          thesis: "Cancel stale order.",
          confidence: 0.6,
          actions: [
            {
              type: "cancel_order",
              symbol: "BTC-USD",
              orderId: 12345,
              reason: "cancel stale order"
            }
          ]
        } as never
      ]
    });
    expect(withNumericOrderId.candidates[0].actions[0]).toMatchObject({
      type: "cancel_order",
      orderId: "12345"
    });

    const malformedIds = parsePlan({
      schemaVersion: "stratium.ai-trader-plan.v1",
      summary: "cancel stale order",
      candidates: [
        {
          id: "cancel",
          thesis: "Cancel stale order.",
          confidence: 0.6,
          actions: [
            {
              type: "cancel_order",
              symbol: "BTC-USD",
              orderId: {},
              clientOrderId: [],
              reason: "malformed ids"
            }
          ]
        } as never
      ]
    });
    expect(malformedIds.candidates[0].actions[0]).toMatchObject({
      type: "observe"
    });
  });

  it("normalizes model timeInForce casing and aliases", () => {
    const plan = parsePlan({
      schemaVersion: "stratium.ai-trader-plan.v1",
      summary: "probe",
      candidates: [
        {
          id: "probe",
          thesis: "small executable test",
          confidence: 0.6,
          actions: [
            {
              type: "place_order",
              symbol: "BTC-USD",
              side: "buy",
              orderType: "limit",
              quantity: 0.0002,
              price: 76000,
              invalidationPrice: 75500,
              timeInForce: "Ioc",
              reason: "model emitted MCP-style time in force"
            }
          ]
        } as never
      ]
    });

    expect(plan.candidates[0].actions[0]).toMatchObject({
      type: "place_order",
      timeInForce: "IOC"
    });
  });

  it("ignores unsupported timeInForce instead of failing the plan", () => {
    const plan = parsePlan({
      schemaVersion: "stratium.ai-trader-plan.v1",
      summary: "probe",
      candidates: [
        {
          id: "probe",
          thesis: "small executable test",
          confidence: 0.6,
          actions: [
            {
              type: "place_order",
              symbol: "BTC-USD",
              side: "buy",
              orderType: "limit",
              quantity: 0.0002,
              price: 76000,
              invalidationPrice: 75500,
              timeInForce: "FOK",
              reason: "unsupported time in force"
            }
          ]
        } as never
      ]
    });

    expect(plan.candidates[0].actions[0]).toMatchObject({
      type: "place_order",
      quantity: 0.0002
    });
    expect(plan.candidates[0].actions[0]).not.toHaveProperty("timeInForce");
  });

  it("fills missing executable action symbols from the provided default symbol", () => {
    const plan = parsePlan({
      schemaVersion: "stratium.ai-trader-plan.v1",
      summary: "probe",
      candidates: [
        {
          id: "probe",
          thesis: "small executable test",
          confidence: 0.6,
          actions: [
            {
              type: "place_order",
              side: "buy",
              orderType: "market",
              quantity: 0.0002,
              invalidationPrice: 76000,
              reason: "model omitted symbol"
            }
          ]
        } as never
      ]
    }, { defaultSymbol: "BTC-USD" });

    expect(plan.candidates[0].actions[0]).toMatchObject({
      type: "place_order",
      symbol: "BTC-USD"
    });
  });
});
