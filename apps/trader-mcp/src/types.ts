export interface StratiumBotCredentials {
  accountId: string;
  vaultAddress: string;
  signerAddress: string;
  apiSecret: string;
}

export type OrderGrouping = "na" | "normalTpsl" | "positionTpsl";

export interface PlaceOrderInput {
  asset?: number;
  isBuy: boolean;
  price: string;
  size: string;
  reduceOnly?: boolean;
  tif?: "Gtc" | "Ioc";
  cloid?: string;
  grouping?: OrderGrouping;
  trigger?: {
    isMarket: boolean;
    triggerPx: string;
    tpsl: "tp" | "sl";
  };
}

export interface ModifyOrderInput {
  oid: number;
  asset?: number;
  isBuy: boolean;
  price: string;
  size: string;
  reduceOnly?: boolean;
  tif?: "Gtc" | "Ioc";
  cloid?: string;
  trigger?: {
    isMarket: boolean;
    triggerPx: string;
    tpsl: "tp" | "sl";
  };
}

export interface BatchModifyOrderInput extends ModifyOrderInput {}

export interface TraderMcpRuntimeConfig {
  apiBaseUrl: string;
  host?: string;
  port?: number;
  mcpPath?: string;
  corsOrigin?: string;
  frontendUsername?: string;
  frontendPassword?: string;
  frontendRole?: "frontend";
  botCredentials?: StratiumBotCredentials;
}
