export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit";
export type OrderStatus =
  | "NEW"
  | "ACCEPTED"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELED"
  | "REJECTED";

export type RejectionCode =
  | "INVALID_SYMBOL"
  | "INVALID_QUANTITY"
  | "INVALID_PRICE"
  | "INSUFFICIENT_MARGIN"
  | "ACCOUNT_NOT_FOUND"
  | "ACCOUNT_DISABLED"
  | "INVALID_ORDER_STATE"
  | "MISSING_MARKET_TICK"
  | "ORDER_NOT_FOUND";

export type LiquidityRole = "maker" | "taker";
