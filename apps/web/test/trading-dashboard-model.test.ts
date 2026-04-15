import { describe, expect, it, vi } from "vitest";
import {
  calculateMarginPreview,
  createAdvancedOrdersBody,
  createAdvancedTriggerWireOrder,
  createCancelOrderBody,
  createClosePositionBody,
  createModifyTriggerOrderBody,
  createOcoOrdersBody,
  createSimpleOrderBody,
  hasInsufficientMargin
} from "../app/trading-dashboard/model";

describe("trading dashboard OCO model helpers", () => {
  const botCredentials = {
    accountId: "paper-account-1",
    vaultAddress: "0xvault",
    signerAddress: "0xsigner",
    apiSecret: "secret"
  };

  it("builds simple orders for limit sells and market buys", () => {
    const limitSell = createSimpleOrderBody({
      side: "sell",
      tab: "limit",
      quantity: "2",
      limitPrice: "69900",
      bestBid: 69880,
      bestAsk: 69920,
      botCredentials
    });
    expect(limitSell.action.orders[0]).toMatchObject({
      b: false,
      p: "69900",
      s: "2",
      t: { limit: { tif: "Gtc" } }
    });

    const marketBuy = createSimpleOrderBody({
      side: "buy",
      tab: "market",
      quantity: "3",
      limitPrice: "",
      bestBid: 69880,
      bestAsk: 69920,
      botCredentials
    });
    expect(marketBuy.action.orders[0]).toMatchObject({
      b: true,
      p: "69920",
      s: "3",
      t: { limit: { tif: "Ioc" } }
    });

    const marketBuyWithoutAsk = createSimpleOrderBody({
      side: "buy",
      tab: "market",
      quantity: "1",
      limitPrice: "",
      bestBid: 69880,
      botCredentials
    });
    expect(marketBuyWithoutAsk.action.orders[0]?.p).toBe("0");

    const marketSellWithoutBid = createSimpleOrderBody({
      side: "sell",
      tab: "market",
      quantity: "1",
      limitPrice: "",
      bestAsk: 69920,
      botCredentials
    });
    expect(marketSellWithoutBid.action.orders[0]?.p).toBe("0");
  });

  it("builds Hyperliquid normalTpsl payloads with a parent order followed by reduce-only tp/sl children", () => {
    const body = createOcoOrdersBody({
      form: {
        side: "buy",
        parentOrderType: "market",
        quantity: "1",
        limitPrice: "",
        takeProfitEnabled: true,
        takeProfitTriggerPrice: "72000",
        takeProfitExecution: "market",
        takeProfitLimitPrice: "",
        stopLossEnabled: true,
        stopLossTriggerPrice: "70000",
        stopLossExecution: "limit",
        stopLossLimitPrice: "69950"
      },
      bestBid: 71000,
      bestAsk: 71020,
      botCredentials
    });

    expect(body.action.grouping).toBe("normalTpsl");
    expect(body.action.orders).toHaveLength(3);
    expect(body.action.orders[0]).toMatchObject({
      b: true,
      p: "71020",
      s: "1",
      r: false,
      t: { limit: { tif: "Ioc" } }
    });
    expect(body.action.orders[1]).toMatchObject({
      b: false,
      r: true,
      t: { trigger: { isMarket: true, triggerPx: "72000", tpsl: "tp" } }
    });
    expect(body.action.orders[2]).toMatchObject({
      b: false,
      p: "69950",
      r: true,
      t: { trigger: { isMarket: false, triggerPx: "70000", tpsl: "sl" } }
    });
  });

  it("uses the same margin calculation for simple and OCO parent orders when price, size, and leverage match", () => {
    const simpleBody = createSimpleOrderBody({
      side: "buy",
      tab: "market",
      quantity: "1",
      limitPrice: "",
      bestBid: 71000,
      bestAsk: 71020,
      botCredentials
    });
    const ocoBody = createOcoOrdersBody({
      form: {
        side: "buy",
        parentOrderType: "market",
        quantity: "1",
        limitPrice: "",
        takeProfitEnabled: true,
        takeProfitTriggerPrice: "72000",
        takeProfitExecution: "market",
        takeProfitLimitPrice: "",
        stopLossEnabled: false,
        stopLossTriggerPrice: "",
        stopLossExecution: "market",
        stopLossLimitPrice: ""
      },
      bestBid: 71000,
      bestAsk: 71020,
      botCredentials
    });

    const simpleParentPrice = Number(simpleBody.action.orders[0]?.p);
    const ocoParentPrice = Number(ocoBody.action.orders[0]?.p);

    const simplePreview = calculateMarginPreview({
      quantity: 1,
      price: simpleParentPrice,
      leverage: 10,
      availableBalance: 10000
    });
    const ocoPreview = calculateMarginPreview({
      quantity: 1,
      price: ocoParentPrice,
      leverage: 10,
      availableBalance: 10000
    });

    expect(simplePreview).toEqual(ocoPreview);
    expect(simplePreview).toMatchObject({
      referencePrice: 71020,
      notional: 71020,
      estimatedMargin: 7102,
      remainingAvailable: 2898
    });
  });

  it("flags insufficient margin only from the margin preview itself", () => {
    const sufficientPreview = calculateMarginPreview({
      quantity: 1,
      price: 71020,
      leverage: 10,
      availableBalance: 10000
    });
    const insufficientPreview = calculateMarginPreview({
      quantity: 1,
      price: 71020,
      leverage: 10,
      availableBalance: 7000
    });

    expect(hasInsufficientMargin({ preview: sufficientPreview, availableBalance: 10000 })).toBe(false);
    expect(hasInsufficientMargin({ preview: insufficientPreview, availableBalance: 7000 })).toBe(true);
    expect(hasInsufficientMargin({ preview: null, availableBalance: 7000 })).toBe(false);
  });

  it("returns null margin preview for invalid quantity, price, or leverage", () => {
    expect(calculateMarginPreview({
      quantity: 0,
      price: 100,
      leverage: 10,
      availableBalance: 1000
    })).toBeNull();
    expect(calculateMarginPreview({
      quantity: 1,
      price: 0,
      leverage: 10,
      availableBalance: 1000
    })).toBeNull();
    expect(calculateMarginPreview({
      quantity: 1,
      price: 100,
      leverage: 0,
      availableBalance: 1000
    })).toBeNull();
  });

  it("builds cancel and close-position payloads from the live book", () => {
    expect(createCancelOrderBody({
      oid: 123,
      botCredentials
    })).toMatchObject({
      action: {
        type: "cancel",
        cancels: [{ a: 0, o: 123 }]
      },
      vaultAddress: "0xvault"
    });

    expect(createClosePositionBody({
      side: "sell",
      quantity: 2,
      bestBid: 70990,
      bestAsk: 71010,
      botCredentials
    })).toMatchObject({
      action: {
        type: "order",
        orders: [{
          b: false,
          p: "70990",
          s: "2",
          t: { limit: { tif: "Ioc" } }
        }]
      }
    });

    expect(createClosePositionBody({
      side: "buy",
      quantity: 1,
      bestBid: 70990,
      bestAsk: 71010,
      botCredentials
    })).toMatchObject({
      action: {
        orders: [{
          b: true,
          p: "71010",
          s: "1"
        }]
      }
    });

    expect(createClosePositionBody({
      side: "buy",
      quantity: 1,
      botCredentials
    }).action.orders[0]?.p).toBe("0");
    expect(createClosePositionBody({
      side: "sell",
      quantity: 1,
      botCredentials
    }).action.orders[0]?.p).toBe("0");
  });

  it("builds advanced tp/sl payloads and trigger wire orders", () => {
    const advanced = createAdvancedOrdersBody({
      positionSide: "long",
      botCredentials,
      form: {
        takeProfitEnabled: true,
        takeProfitQuantity: "1",
        takeProfitTriggerPrice: "72000",
        takeProfitExecution: "limit",
        takeProfitLimitPrice: "71990",
        stopLossEnabled: true,
        stopLossQuantity: "1",
        stopLossTriggerPrice: "70000",
        stopLossExecution: "market",
        stopLossLimitPrice: ""
      }
    });

    expect(advanced.action.grouping).toBe("positionTpsl");
    expect(advanced.action.orders).toHaveLength(2);
    expect(advanced.action.orders[0]).toMatchObject({
      b: false,
      r: true,
      p: "71990",
      t: { trigger: { isMarket: false, triggerPx: "72000", tpsl: "tp" } }
    });
    expect(advanced.action.orders[1]).toMatchObject({
      b: false,
      r: true,
      p: "70000",
      t: { trigger: { isMarket: true, triggerPx: "70000", tpsl: "sl" } }
    });

    expect(createAdvancedTriggerWireOrder({
      kind: "tp",
      enabled: false,
      quantity: "1",
      triggerPrice: "72000",
      execution: "market",
      limitPrice: "",
      positionSide: "short"
    })).toBeNull();

    expect(createAdvancedTriggerWireOrder({
      kind: "sl",
      enabled: true,
      quantity: "2",
      triggerPrice: "68000",
      execution: "limit",
      limitPrice: "67990",
      positionSide: "short",
      clientOrderId: "custom-sl"
    })).toMatchObject({
      b: true,
      p: "67990",
      s: "2",
      c: "custom-sl",
      t: {
        trigger: {
          isMarket: false,
          triggerPx: "68000",
          tpsl: "sl"
        }
      }
    });
  });

  it("covers short-side advanced orders and autogenerated trigger client ids", () => {
    vi.spyOn(Date, "now").mockReturnValue(0x1234);
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    const advanced = createAdvancedOrdersBody({
      positionSide: "short",
      botCredentials,
      form: {
        takeProfitEnabled: false,
        takeProfitQuantity: "",
        takeProfitTriggerPrice: "",
        takeProfitExecution: "market",
        takeProfitLimitPrice: "",
        stopLossEnabled: true,
        stopLossQuantity: "2",
        stopLossTriggerPrice: "71000",
        stopLossExecution: "limit",
        stopLossLimitPrice: "71010"
      }
    });

    expect(advanced.action.orders).toEqual([
      expect.objectContaining({
        b: true,
        p: "71010",
        c: "0xsl-1234-8"
      })
    ]);

    const generatedTrigger = createAdvancedTriggerWireOrder({
      kind: "tp",
      enabled: true,
      quantity: "1",
      triggerPrice: "68000",
      execution: "market",
      limitPrice: "",
      positionSide: "long"
    });

    expect(generatedTrigger).toMatchObject({
      b: false,
      p: "68000",
      c: "0xtp-1234-8",
      t: {
        trigger: {
          isMarket: true,
          triggerPx: "68000",
          tpsl: "tp"
        }
      }
    });

    vi.restoreAllMocks();
  });

  it("covers market execution branches in advanced orders", () => {
    const advanced = createAdvancedOrdersBody({
      positionSide: "long",
      botCredentials,
      form: {
        takeProfitEnabled: true,
        takeProfitQuantity: "1",
        takeProfitTriggerPrice: "72000",
        takeProfitExecution: "market",
        takeProfitLimitPrice: "",
        stopLossEnabled: true,
        stopLossQuantity: "1",
        stopLossTriggerPrice: "70000",
        stopLossExecution: "market",
        stopLossLimitPrice: ""
      }
    });

    expect(advanced.action.orders[0]).toMatchObject({
      p: "72000",
      t: { trigger: { isMarket: true } }
    });
    expect(advanced.action.orders[1]).toMatchObject({
      p: "70000",
      t: { trigger: { isMarket: true } }
    });
  });

  it("covers parent limit OCO without child orders and sell-side market fallback", () => {
    const ocoLimitOnly = createOcoOrdersBody({
      form: {
        side: "sell",
        parentOrderType: "limit",
        quantity: "2",
        limitPrice: "70500",
        takeProfitEnabled: false,
        takeProfitTriggerPrice: "",
        takeProfitExecution: "market",
        takeProfitLimitPrice: "",
        stopLossEnabled: false,
        stopLossTriggerPrice: "",
        stopLossExecution: "market",
        stopLossLimitPrice: ""
      },
      bestBid: 70490,
      bestAsk: 70510,
      botCredentials
    });

    expect(ocoLimitOnly.action.orders).toHaveLength(1);
    expect(ocoLimitOnly.action.orders[0]).toMatchObject({
      b: false,
      p: "70500",
      t: { limit: { tif: "Gtc" } }
    });

    const ocoMarketSell = createOcoOrdersBody({
      form: {
        side: "sell",
        parentOrderType: "market",
        quantity: "1",
        limitPrice: "",
        takeProfitEnabled: true,
        takeProfitTriggerPrice: "69000",
        takeProfitExecution: "limit",
        takeProfitLimitPrice: "68990",
        stopLossEnabled: true,
        stopLossTriggerPrice: "71000",
        stopLossExecution: "market",
        stopLossLimitPrice: ""
      },
      bestBid: 70000,
      bestAsk: 70010,
      botCredentials
    });

    expect(ocoMarketSell.action.orders[0]).toMatchObject({
      b: false,
      p: "70000",
      t: { limit: { tif: "Ioc" } }
    });
    expect(ocoMarketSell.action.orders[1]).toMatchObject({
      b: true,
      p: "68990"
    });
    expect(ocoMarketSell.action.orders[2]).toMatchObject({
      b: true,
      p: "71000"
    });

    const ocoMarketBuyWithoutAsk = createOcoOrdersBody({
      form: {
        side: "buy",
        parentOrderType: "market",
        quantity: "1",
        limitPrice: "",
        takeProfitEnabled: false,
        takeProfitTriggerPrice: "",
        takeProfitExecution: "market",
        takeProfitLimitPrice: "",
        stopLossEnabled: false,
        stopLossTriggerPrice: "",
        stopLossExecution: "market",
        stopLossLimitPrice: ""
      },
      bestBid: 70000,
      botCredentials
    });
    expect(ocoMarketBuyWithoutAsk.action.orders[0]?.p).toBe("0");

    const ocoMarketSellWithoutBid = createOcoOrdersBody({
      form: {
        side: "sell",
        parentOrderType: "market",
        quantity: "1",
        limitPrice: "",
        takeProfitEnabled: false,
        takeProfitTriggerPrice: "",
        takeProfitExecution: "market",
        takeProfitLimitPrice: "",
        stopLossEnabled: false,
        stopLossTriggerPrice: "",
        stopLossExecution: "market",
        stopLossLimitPrice: ""
      },
      bestAsk: 70010,
      botCredentials
    });
    expect(ocoMarketSellWithoutBid.action.orders[0]?.p).toBe("0");
  });

  it("builds modify payloads for existing trigger orders", () => {
    const triggerOrder = createAdvancedTriggerWireOrder({
      kind: "tp",
      enabled: true,
      quantity: "1",
      triggerPrice: "73000",
      execution: "market",
      limitPrice: "",
      positionSide: "long",
      clientOrderId: "tp-1"
    });

    expect(createModifyTriggerOrderBody({
      oid: 55,
      order: triggerOrder,
      botCredentials
    })).toMatchObject({
      action: {
        type: "modify",
        oid: 55,
        order: triggerOrder
      },
      vaultAddress: "0xvault"
    });
  });
});
