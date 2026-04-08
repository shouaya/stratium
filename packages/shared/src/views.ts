import type { OrderSide, OrderStatus, OrderType, RejectionCode } from "./orders";

export type PositionSide = "long" | "short" | "flat";

export interface OrderView {
  id: string;
  accountId: string;
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  status: OrderStatus;
  quantity: number;
  limitPrice?: number;
  filledQuantity: number;
  remainingQuantity: number;
  averageFillPrice?: number;
  rejectionCode?: RejectionCode;
  rejectionMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PositionView {
  symbol: string;
  side: PositionSide;
  quantity: number;
  averageEntryPrice: number;
  markPrice: number;
  realizedPnl: number;
  unrealizedPnl: number;
  initialMargin: number;
  maintenanceMargin: number;
  liquidationPrice: number;
}

export interface AccountView {
  accountId: string;
  walletBalance: number;
  availableBalance: number;
  positionMargin: number;
  orderMargin: number;
  equity: number;
  realizedPnl: number;
  unrealizedPnl: number;
  riskRatio: number;
}
