import type { OrderSide, PositionSide, PositionView, TradingSymbolConfig } from "@stratium/shared";
import { round } from "../domain/state";

export interface PositionComputationResult {
  position: PositionView;
  walletBalance: number;
  realizedPnlDelta: number;
  fee: number;
}

export const toSignedQuantity = (side: PositionSide, quantity: number): number => {
  if (side === "long") {
    return quantity;
  }

  if (side === "short") {
    return -quantity;
  }

  return 0;
};

export const toPositionSide = (quantity: number): PositionSide => {
  if (quantity > 0) {
    return "long";
  }

  if (quantity < 0) {
    return "short";
  }

  return "flat";
};

export const computeRealizedPnl = (
  position: PositionView,
  orderSide: OrderSide,
  closedQuantity: number,
  exitPrice: number
): number => {
  if (position.side === "long" && orderSide === "sell") {
    return round((exitPrice - position.averageEntryPrice) * closedQuantity);
  }

  if (position.side === "short" && orderSide === "buy") {
    return round((position.averageEntryPrice - exitPrice) * closedQuantity);
  }

  return 0;
};

export const computeUnrealizedPnl = (
  side: PositionSide,
  quantity: number,
  averageEntryPrice: number,
  markPrice: number
): number => {
  if (side === "long") {
    return round((markPrice - averageEntryPrice) * quantity);
  }

  if (side === "short") {
    return round((averageEntryPrice - markPrice) * quantity);
  }

  return 0;
};

export const computeLiquidationPrice = (
  side: PositionSide,
  quantity: number,
  averageEntryPrice: number,
  walletBalance: number,
  symbolConfig: TradingSymbolConfig
): number => {
  if (side === "flat" || quantity === 0) {
    return 0;
  }

  const rate = symbolConfig.maintenanceMarginRate;

  if (side === "long") {
    const denominator = quantity * (1 - rate);

    return denominator === 0 ? 0 : (quantity * averageEntryPrice - walletBalance) / denominator;
  }

  const denominator = quantity * (1 + rate);

  return denominator === 0 ? 0 : (walletBalance + quantity * averageEntryPrice) / denominator;
};

export const computeNextPosition = (
  previousPosition: PositionView,
  walletBalance: number,
  latestMarkPrice: number | undefined,
  symbolConfig: TradingSymbolConfig,
  orderSide: OrderSide,
  fillQuantity: number,
  fillPrice: number,
  fee: number
): PositionComputationResult => {
  const previousSignedQuantity = toSignedQuantity(previousPosition.side, previousPosition.quantity);
  const fillSignedQuantity = orderSide === "buy" ? fillQuantity : -fillQuantity;
  const nextSignedQuantity = round(previousSignedQuantity + fillSignedQuantity);

  let realizedPnl = previousPosition.realizedPnl;

  if (previousSignedQuantity !== 0 && Math.sign(previousSignedQuantity) !== Math.sign(fillSignedQuantity)) {
    const closingQuantity = Math.min(Math.abs(previousSignedQuantity), Math.abs(fillSignedQuantity));
    realizedPnl = round(realizedPnl + computeRealizedPnl(previousPosition, orderSide, closingQuantity, fillPrice));
  }

  let averageEntryPrice = previousPosition.averageEntryPrice;

  if (nextSignedQuantity === 0) {
    averageEntryPrice = 0;
  } else if (previousSignedQuantity === 0 || Math.sign(previousSignedQuantity) === Math.sign(fillSignedQuantity)) {
    averageEntryPrice = round(
      ((Math.abs(previousSignedQuantity) * previousPosition.averageEntryPrice) + (fillQuantity * fillPrice)) /
      Math.abs(nextSignedQuantity)
    );
  } else if (Math.abs(fillSignedQuantity) > Math.abs(previousSignedQuantity)) {
    averageEntryPrice = fillPrice;
  }

  const nextSide = toPositionSide(nextSignedQuantity);
  const markPrice = latestMarkPrice ?? previousPosition.markPrice;
  const quantity = Math.abs(nextSignedQuantity);
  const unrealizedPnl = computeUnrealizedPnl(nextSide, quantity, averageEntryPrice, markPrice);
  const initialMargin = round(quantity * markPrice / symbolConfig.leverage);
  const maintenanceMargin = round(quantity * markPrice * symbolConfig.maintenanceMarginRate);
  const nextWalletBalance = round(walletBalance + (realizedPnl - previousPosition.realizedPnl) - fee);
  const liquidationPrice = round(
    computeLiquidationPrice(nextSide, quantity, averageEntryPrice, nextWalletBalance, symbolConfig)
  );

  return {
    position: {
      ...previousPosition,
      side: nextSide,
      quantity,
      averageEntryPrice,
      markPrice,
      realizedPnl,
      unrealizedPnl,
      initialMargin,
      maintenanceMargin,
      liquidationPrice
    },
    walletBalance: nextWalletBalance,
    realizedPnlDelta: round(realizedPnl - previousPosition.realizedPnl),
    fee
  };
};
