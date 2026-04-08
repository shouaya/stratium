import type { AccountView, PositionView, TradingSymbolConfig } from "@stratium/shared";
import { round } from "../domain/state";
import { computeLiquidationPrice, computeUnrealizedPnl } from "./position-math";

export const refreshAccountState = (
  account: AccountView,
  position: PositionView,
  latestMarkPrice: number | undefined,
  symbolConfig: TradingSymbolConfig
): {
  account: AccountView;
  position: PositionView;
} => {
  const nextPosition = {
    ...position,
    markPrice: latestMarkPrice ?? position.markPrice
  };
  const unrealizedPnl = computeUnrealizedPnl(
    nextPosition.side,
    nextPosition.quantity,
    nextPosition.averageEntryPrice,
    nextPosition.markPrice
  );
  const positionMargin = round(nextPosition.quantity * nextPosition.markPrice / symbolConfig.leverage);
  const maintenanceMargin = round(
    nextPosition.quantity * nextPosition.markPrice * symbolConfig.maintenanceMarginRate
  );
  const equity = round(account.walletBalance + unrealizedPnl);
  const availableBalance = round(equity - positionMargin);
  const riskRatio = equity <= 0 ? 1 : round(maintenanceMargin / equity);
  const liquidationPrice = round(
    computeLiquidationPrice(
      nextPosition.side,
      nextPosition.quantity,
      nextPosition.averageEntryPrice,
      account.walletBalance,
      symbolConfig
    )
  );

  return {
    position: {
      ...nextPosition,
      unrealizedPnl,
      initialMargin: positionMargin,
      maintenanceMargin,
      liquidationPrice
    },
    account: {
      ...account,
      availableBalance,
      positionMargin,
      orderMargin: 0,
      equity,
      unrealizedPnl,
      riskRatio
    }
  };
};
