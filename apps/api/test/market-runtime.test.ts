import { describe, expect, it } from "vitest";
import { filterRecentCandles } from "../src/market-runtime";

describe("filterRecentCandles", () => {
  it("keeps only candles inside the most recent 24-hour window", () => {
    const now = Date.parse("2026-04-09T12:00:00.000Z");
    const candles = [
      { id: "old", openTime: Date.parse("2026-04-08T11:59:59.000Z") },
      { id: "edge", openTime: Date.parse("2026-04-08T12:00:00.000Z") },
      { id: "recent", openTime: Date.parse("2026-04-09T11:00:00.000Z") }
    ];

    expect(filterRecentCandles(candles, now)).toEqual([
      { id: "edge", openTime: Date.parse("2026-04-08T12:00:00.000Z") },
      { id: "recent", openTime: Date.parse("2026-04-09T11:00:00.000Z") }
    ]);
  });
});
