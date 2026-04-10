import { createHash } from "node:crypto";

export const hyperliquidCompatAddressForAccountId = (accountId: string): string =>
  `0x${createHash("sha256").update(accountId).digest("hex").slice(0, 40)}`;

export const matchesHyperliquidCompatUser = (accountId: string, user: string | undefined): boolean => {
  if (!user) {
    return false;
  }

  return user === accountId || user.toLowerCase() === hyperliquidCompatAddressForAccountId(accountId).toLowerCase();
};
