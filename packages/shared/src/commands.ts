import type { MarketTick } from "./market";
import type { OrderSide, OrderType } from "./orders";

export interface CreateOrderInput {
  accountId: string;
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  quantity: number;
  limitPrice?: number;
  clientOrderId?: string;
  submittedAt?: string;
}

export interface CancelOrderInput {
  accountId: string;
  orderId: string;
  requestedAt?: string;
}

export type SubmitOrderCommand = CreateOrderInput;
export type CancelOrderCommand = CancelOrderInput;
export type IngestMarketTickCommand = MarketTick;
