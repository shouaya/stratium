import { describe, expect, it } from "vitest";
import {
  coinFromSymbol,
  extractExchangeMessage,
  fmt,
  getLocaleText,
  mergeEvents,
  priceDigitsForSymbol,
  toOid
} from "../app/trading-dashboard/utils";

describe("trading dashboard utils", () => {
  it("formats prices and symbol metadata helpers", () => {
    expect(fmt(12.34567, 2)).toBe("12.35");
    expect(fmt(undefined, 2)).toBe("-");
    expect(priceDigitsForSymbol("BTC-USD")).toBe(0);
    expect(priceDigitsForSymbol("ETH-USD")).toBe(4);
    expect(coinFromSymbol("SOL-USD")).toBe("SOL");
    expect(coinFromSymbol("SUI/USD")).toBe("SUI");
    expect(coinFromSymbol("HYPE")).toBe("HYPE");
    expect(coinFromSymbol(undefined)).toBe("BTC");
  });

  it("merges events by id and keeps them sequence sorted", () => {
    const current = [
      { eventId: "evt-1", sequence: 1, eventType: "OrderAccepted" },
      { eventId: "evt-3", sequence: 3, eventType: "OrderFilled" }
    ] as any[];
    const next = [
      { eventId: "evt-2", sequence: 2, eventType: "OrderRejected" },
      { eventId: "evt-3", sequence: 4, eventType: "OrderFilled" }
    ] as any[];

    expect(mergeEvents(current, next)).toEqual([
      { eventId: "evt-1", sequence: 1, eventType: "OrderAccepted" },
      { eventId: "evt-2", sequence: 2, eventType: "OrderRejected" },
      { eventId: "evt-3", sequence: 4, eventType: "OrderFilled" }
    ]);
    expect(mergeEvents(current, [])).toBe(current);
  });

  it("extracts exchange messages, resolves locale text, and parses oids", () => {
    expect(extractExchangeMessage({
      response: {
        data: {
          statuses: [{ error: "bad request" }]
        }
      }
    }, "ok")).toBe("bad request");
    expect(extractExchangeMessage({
      response: {
        data: {
          statuses: [{ success: "ok" }]
        }
      }
    }, "fallback")).toBe("fallback");

    expect(getLocaleText("zh", "中文", "日本語", "English")).toBe("中文");
    expect(getLocaleText("ja", "中文", "日本語", "English")).toBe("日本語");
    expect(getLocaleText("en", "中文", "日本語", "English")).toBe("English");

    expect(toOid("ord_42")).toBe(42);
    expect(toOid("manual")).toBe(0);
  });
});
