import type { CreateOrderInput, RejectionCode, TradingSymbolConfig } from "@stratium/shared";
import type { TradingEngineState } from "../domain/state.js";
import { round } from "../domain/state.js";
import { getMarketReferencePrice } from "./pricing.js";
import { toSignedQuantity } from "./position-math.js";

export const getIncrementalExposureQuantity = (
  currentState: TradingEngineState,
  side: CreateOrderInput["side"],
  quantity: number
): number => {
  const currentSignedQuantity = toSignedQuantity(currentState.position.side, currentState.position.quantity);
  const incomingSignedQuantity = side === "buy" ? quantity : -quantity;

  if (currentSignedQuantity === 0 || Math.sign(currentSignedQuantity) === Math.sign(incomingSignedQuantity)) {
    return quantity;
  }

  const remainingExposure = Math.abs(incomingSignedQuantity) - Math.abs(currentSignedQuantity);

  return round(Math.max(remainingExposure, 0));
};

export const validateOrder = (
  state: TradingEngineState,
  symbolConfig: TradingSymbolConfig,
  input: CreateOrderInput
): { code: RejectionCode; message: string } | null => {
  if (input.accountId !== state.account.accountId) {
    return {
      code: "ACCOUNT_NOT_FOUND",
      message: "Account does not exist in the current engine context."
    };
  }

  if (input.symbol !== symbolConfig.symbol) {
    return {
      code: "INVALID_SYMBOL",
      message: "Symbol is not configured for PH1."
    };
  }

  if (input.quantity <= 0) {
    return {
      code: "INVALID_QUANTITY",
      message: "Quantity must be greater than zero."
    };
  }

  if (input.orderType === "limit" && (!input.limitPrice || input.limitPrice <= 0)) {
    return {
      code: "INVALID_PRICE",
      message: "Limit orders require a positive limit price."
    };
  }

  if (input.orderType === "market" && !state.latestTick) {
    return {
      code: "MISSING_MARKET_TICK",
      message: "Market orders require a current market tick."
    };
  }

  const referencePrice = input.orderType === "market"
    ? getMarketReferencePrice(state.latestTick, input.side)
    : input.limitPrice ?? 0;
  const estimatedInitialMargin = round(
    (getIncrementalExposureQuantity(state, input.side, input.quantity) * referencePrice) / symbolConfig.leverage
  );

  if (estimatedInitialMargin > state.account.availableBalance) {
    return {
      code: "INSUFFICIENT_MARGIN",
      message: "Estimated required margin exceeds available balance."
    };
  }

  return null;
};
