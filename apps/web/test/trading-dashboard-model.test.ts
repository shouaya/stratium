import { describe, expect, it } from "vitest";
import { calculateMarginPreview, createOcoOrdersBody, createSimpleOrderBody, hasInsufficientMargin } from "../app/trading-dashboard/model";

describe("trading dashboard OCO model helpers", () => {
  const botCredentials = {
    accountId: "paper-account-1",
    vaultAddress: "0xvault",
    signerAddress: "0xsigner",
    apiSecret: "secret"
  };

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
});
