import { describe, expect, it } from "vitest";
import type { AccountView, PositionView } from "@stratium/shared";
import { DEFAULT_SYMBOL_CONFIG } from "../../src/domain/state";
import { refreshAccountState } from "../../src/rules/account-math";

const account: AccountView = {
  accountId: "paper-account-1",
  walletBalance: 1000,
  availableBalance: 1000,
  positionMargin: 0,
  orderMargin: 0,
  equity: 1000,
  realizedPnl: 0,
  unrealizedPnl: 0,
  riskRatio: 0
};

const longPosition: PositionView = {
  symbol: "BTC-USD",
  side: "long",
  quantity: 2,
  averageEntryPrice: 100,
  markPrice: 100,
  realizedPnl: 0,
  unrealizedPnl: 0,
  initialMargin: 0,
  maintenanceMargin: 0,
  liquidationPrice: 0
};

describe("account math", () => {
  it("refreshes balances and risk metrics using latest mark price", () => {
    const next = refreshAccountState(account, longPosition, 110, DEFAULT_SYMBOL_CONFIG);

    expect(next.position.markPrice).toBe(110);
    expect(next.position.unrealizedPnl).toBe(20);
    expect(next.account.equity).toBe(1020);
    expect(next.account.positionMargin).toBe(22);
    expect(next.account.availableBalance).toBe(998);
    expect(next.account.riskRatio).toBeCloseTo(0.01078431, 8);
  });

  it("caps risk ratio at 1 when equity is zero or negative", () => {
    const stressed = refreshAccountState(
      { ...account, walletBalance: -50 },
      { ...longPosition, markPrice: 100, averageEntryPrice: 200, quantity: 1 },
      undefined,
      DEFAULT_SYMBOL_CONFIG
    );

    expect(stressed.position.markPrice).toBe(100);
    expect(stressed.account.equity).toBe(-150);
    expect(stressed.account.riskRatio).toBe(1);
  });
});
