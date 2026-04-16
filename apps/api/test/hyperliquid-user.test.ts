import { describe, expect, it } from "vitest";
import { hyperliquidCompatAddressForAccountId, matchesHyperliquidCompatUser } from "../src/platform/hyperliquid-user";

describe("hyperliquid-user", () => {
  it("derives deterministic compatibility addresses", () => {
    const first = hyperliquidCompatAddressForAccountId("paper-account-1");
    const second = hyperliquidCompatAddressForAccountId("paper-account-1");
    expect(first).toBe(second);
    expect(first.startsWith("0x")).toBe(true);
    expect(first).toHaveLength(42);
  });

  it("matches account ids and compatibility addresses and rejects missing users", () => {
    const accountId = "paper-account-1";
    const address = hyperliquidCompatAddressForAccountId(accountId);
    expect(matchesHyperliquidCompatUser(accountId, accountId)).toBe(true);
    expect(matchesHyperliquidCompatUser(accountId, address.toUpperCase())).toBe(true);
    expect(matchesHyperliquidCompatUser(accountId, undefined)).toBe(false);
    expect(matchesHyperliquidCompatUser(accountId, "0xdeadbeef")).toBe(false);
  });
});
