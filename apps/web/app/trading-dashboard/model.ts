import type { AdvancedOrderForm, BotCredentials } from "./types";

export const createClientOrderId = (prefix: string): string =>
  `0x${prefix}-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;

export const createSimpleOrderBody = (input: {
  side: "buy" | "sell";
  tab: "market" | "limit";
  quantity: string;
  limitPrice: string;
  bestBid?: number;
  bestAsk?: number;
  botCredentials: BotCredentials;
}) => ({
  action: {
    type: "order" as const,
    orders: [{
      a: 0,
      b: input.side === "buy",
      p: String(input.tab === "limit" ? Number(input.limitPrice) : (input.side === "buy" ? input.bestAsk ?? 0 : input.bestBid ?? 0)),
      s: String(Number(input.quantity)),
      r: false,
      t: {
        limit: {
          tif: input.tab === "limit" ? "Gtc" as const : "Ioc" as const
        }
      }
    }],
    grouping: "na"
  },
  nonce: Date.now(),
  vaultAddress: input.botCredentials.vaultAddress
});

export const createCancelOrderBody = (input: {
  oid: number;
  botCredentials: BotCredentials;
}) => ({
  action: {
    type: "cancel" as const,
    cancels: [{
      a: 0,
      o: input.oid
    }]
  },
  nonce: Date.now(),
  vaultAddress: input.botCredentials.vaultAddress
});

export const createClosePositionBody = (input: {
  side: "buy" | "sell";
  quantity: number;
  bestBid?: number;
  bestAsk?: number;
  botCredentials: BotCredentials;
}) => ({
  action: {
    type: "order" as const,
    orders: [{
      a: 0,
      b: input.side === "buy",
      p: String(input.side === "buy" ? input.bestAsk ?? 0 : input.bestBid ?? 0),
      s: String(input.quantity),
      r: false,
      t: {
        limit: {
          tif: "Ioc" as const
        }
      }
    }],
    grouping: "na"
  },
  nonce: Date.now(),
  vaultAddress: input.botCredentials.vaultAddress
});

export const createAdvancedOrdersBody = (input: {
  form: AdvancedOrderForm;
  positionSide: "long" | "short";
  botCredentials: BotCredentials;
}) => {
  const exitIsBuy = input.positionSide === "short";
  const orders = [];

  if (input.form.takeProfitEnabled) {
    orders.push({
      a: 0,
      b: exitIsBuy,
      p: String(
        input.form.takeProfitExecution === "limit"
          ? Number(input.form.takeProfitLimitPrice)
          : Number(input.form.takeProfitTriggerPrice)
      ),
      s: String(Number(input.form.takeProfitQuantity)),
      r: true,
      t: {
        trigger: {
          isMarket: input.form.takeProfitExecution === "market",
          triggerPx: String(Number(input.form.takeProfitTriggerPrice)),
          tpsl: "tp" as const
        }
      },
      c: createClientOrderId("tp")
    });
  }

  if (input.form.stopLossEnabled) {
    orders.push({
      a: 0,
      b: exitIsBuy,
      p: String(
        input.form.stopLossExecution === "limit"
          ? Number(input.form.stopLossLimitPrice)
          : Number(input.form.stopLossTriggerPrice)
      ),
      s: String(Number(input.form.stopLossQuantity)),
      r: true,
      t: {
        trigger: {
          isMarket: input.form.stopLossExecution === "market",
          triggerPx: String(Number(input.form.stopLossTriggerPrice)),
          tpsl: "sl" as const
        }
      },
      c: createClientOrderId("sl")
    });
  }

  return {
    action: {
      type: "order" as const,
      orders,
      grouping: "na"
    },
    nonce: Date.now(),
    vaultAddress: input.botCredentials.vaultAddress
  };
};
