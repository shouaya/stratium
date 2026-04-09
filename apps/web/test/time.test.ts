import { describe, expect, it } from "vitest";
import { formatTokyoDateTime, formatTokyoTime } from "../app/time";

describe("Tokyo time formatting", () => {
  it("formats timestamps in Asia/Tokyo for full date time", () => {
    expect(formatTokyoDateTime("2026-04-09T00:00:00.000Z")).toBe("04/09/2026, 09:00:00");
  });

  it("formats timestamps in Asia/Tokyo for clock output", () => {
    expect(formatTokyoTime("2026-04-09T00:00:00.000Z")).toBe("09:00:00");
  });

  it("returns fallback placeholders for empty input", () => {
    expect(formatTokyoDateTime()).toBe("--");
    expect(formatTokyoTime()).toBe("--:--:--");
  });
});
