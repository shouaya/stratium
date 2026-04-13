import type { AdvancedOrderForm, BotCredentials, OcoOrderForm } from "./types";

export type MarginPreview = {
  referencePrice: number;
  notional: number;
  estimatedMargin: number;
  remainingAvailable: number;
};

export const createClientOrderId = (prefix: string): string =>
  `0x${prefix}-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;

export const calculateMarginPreview = (input: {
  quantity: number;
  price?: number;
  leverage: number;
  availableBalance: number;
}): MarginPreview | null => {
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) return null;
  if (!input.price || !Number.isFinite(input.price) || input.price <= 0) return null;
  if (!Number.isFinite(input.leverage) || input.leverage <= 0) return null;

  const notional = input.quantity * input.price;
  const estimatedMargin = notional / input.leverage;
  return {
    referencePrice: input.price,
    notional,
    estimatedMargin,
    remainingAvailable: input.availableBalance - estimatedMargin
  };
};

export const hasInsufficientMargin = (input: { preview: MarginPreview | null; availableBalance: number }) =>
  Boolean(input.preview && input.preview.estimatedMargin > input.availableBalance);

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
      grouping: "positionTpsl"
    },
    nonce: Date.now(),
    vaultAddress: input.botCredentials.vaultAddress
  };
};

export const createAdvancedTriggerWireOrder = (input: {
  kind: "tp" | "sl";
  enabled: boolean;
  quantity: string;
  triggerPrice: string;
  execution: "market" | "limit";
  limitPrice: string;
  positionSide: "long" | "short";
  clientOrderId?: string;
}) => {
  if (!input.enabled) {
    return null;
  }

  const exitIsBuy = input.positionSide === "short";
  return {
    a: 0,
    b: exitIsBuy,
    p: String(
      input.execution === "limit"
        ? Number(input.limitPrice)
        : Number(input.triggerPrice)
    ),
    s: String(Number(input.quantity)),
    r: true,
    t: {
      trigger: {
        isMarket: input.execution === "market",
        triggerPx: String(Number(input.triggerPrice)),
        tpsl: input.kind
      }
    },
    c: input.clientOrderId ?? createClientOrderId(input.kind)
  };
};

export const createOcoOrdersBody = (input: {
  form: OcoOrderForm;
  bestBid?: number;
  bestAsk?: number;
  botCredentials: BotCredentials;
}) => {
  const exitIsBuy = input.form.side === "sell";
  const orders: Array<Record<string, unknown>> = [{
    a: 0,
    b: input.form.side === "buy",
    p: String(
      input.form.parentOrderType === "limit"
        ? Number(input.form.limitPrice)
        : (input.form.side === "buy" ? input.bestAsk ?? 0 : input.bestBid ?? 0)
    ),
    s: String(Number(input.form.quantity)),
    r: false,
    t: {
      limit: {
        tif: input.form.parentOrderType === "limit" ? "Gtc" as const : "Ioc" as const
      }
    },
    c: createClientOrderId("parent")
  }];

  if (input.form.takeProfitEnabled) {
    orders.push({
      a: 0,
      b: exitIsBuy,
      p: String(
        input.form.takeProfitExecution === "limit"
          ? Number(input.form.takeProfitLimitPrice)
          : Number(input.form.takeProfitTriggerPrice)
      ),
      s: String(Number(input.form.quantity)),
      r: true,
      t: {
        trigger: {
          isMarket: input.form.takeProfitExecution === "market",
          triggerPx: String(Number(input.form.takeProfitTriggerPrice)),
          tpsl: "tp" as const
        }
      },
      c: createClientOrderId("ntp")
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
      s: String(Number(input.form.quantity)),
      r: true,
      t: {
        trigger: {
          isMarket: input.form.stopLossExecution === "market",
          triggerPx: String(Number(input.form.stopLossTriggerPrice)),
          tpsl: "sl" as const
        }
      },
      c: createClientOrderId("nsl")
    });
  }

  return {
    action: {
      type: "order" as const,
      orders,
      grouping: "normalTpsl"
    },
    nonce: Date.now(),
    vaultAddress: input.botCredentials.vaultAddress
  };
};

export const createModifyTriggerOrderBody = (input: {
  oid: number;
  order: ReturnType<typeof createAdvancedTriggerWireOrder>;
  botCredentials: BotCredentials;
}) => ({
  action: {
    type: "modify" as const,
    oid: input.oid,
    order: input.order
  },
  nonce: Date.now(),
  vaultAddress: input.botCredentials.vaultAddress
});
