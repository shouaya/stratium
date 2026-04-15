import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HyperliquidExchangeCompat } from "../src/hyperliquid-exchange";

describe("HyperliquidExchangeCompat", () => {
  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;

  beforeEach(() => {
    vi.useFakeTimers();
    global.setInterval = vi.fn((handler: TimerHandler) => {
      void handler;
      return 123 as unknown as NodeJS.Timeout;
    }) as typeof setInterval;
    global.clearInterval = vi.fn() as typeof clearInterval;
    global.setTimeout = vi.fn((handler: TimerHandler) => {
      void handler;
      return 456 as unknown as NodeJS.Timeout;
    }) as typeof setTimeout;
    global.clearTimeout = vi.fn() as typeof clearTimeout;
  });

  afterEach(() => {
    vi.useRealTimers();
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  });

  const makeRuntime = () => {
    const orders = [{
      id: "ord_1",
      clientOrderId: "0xabc",
      accountId: "paper-account-1",
      symbol: "BTC-USD",
      side: "buy" as const,
      orderType: "limit" as const,
      status: "ACCEPTED",
      quantity: 1,
      filledQuantity: 0,
      remainingQuantity: 1,
      limitPrice: 70000,
      createdAt: "2026-04-10T00:00:00.000Z",
      updatedAt: "2026-04-10T00:00:00.000Z"
    }];

    return {
      orders,
      runtime: {
        getSymbolConfigState: vi.fn(() => ({
          symbol: "BTC-USD",
          coin: "BTC",
          leverage: 10,
          maxLeverage: 20,
          szDecimals: 5
        })),
        getMarketData: vi.fn(() => ({
          markPrice: 70000,
          bestBid: 69999,
          bestAsk: 70001
        })),
        getOrders: vi.fn(() => orders),
        getAccountIds: vi.fn(() => ["paper-account-1"]),
        getOrderByClientOrderId: vi.fn((_accountId: string, cloid: string) =>
          orders.find((entry) => entry.clientOrderId === cloid)
        ),
        submitOrder: vi.fn(async (input: { orderType: string; clientOrderId?: string; side: string; quantity: number; limitPrice?: number }) => {
          const nextId = `ord_${orders.length + 1}`;
          const created = {
            id: nextId,
            clientOrderId: input.clientOrderId,
            accountId: "paper-account-1",
            symbol: "BTC-USD",
            side: input.side as "buy" | "sell",
            orderType: input.orderType as "market" | "limit",
            status: input.orderType === "market" ? "FILLED" : "ACCEPTED",
            quantity: input.quantity,
            filledQuantity: input.orderType === "market" ? input.quantity : 0,
            remainingQuantity: input.orderType === "market" ? 0 : input.quantity,
            averageFillPrice: input.orderType === "market" ? 70000 : undefined,
            limitPrice: input.limitPrice,
            createdAt: "2026-04-10T00:00:00.000Z",
            updatedAt: "2026-04-10T00:00:01.000Z"
          };
          orders.push(created as never);
          return {
            events: [{
              eventType: "OrderRequested",
              payload: { orderId: nextId }
            }]
          };
        }),
        cancelOrder: vi.fn(async ({ orderId }: { orderId: string }) => ({
          events: orderId === "ord_reject"
            ? [{ eventType: "OrderRejected", payload: { reasonMessage: "Cancel rejected" } }]
            : []
        })),
        cancelAllOpenOrders: vi.fn(async () => []),
        getEngineState: vi.fn(() => ({
          position: {
            side: "long" as const,
            quantity: 1
          }
        }))
      }
    };
  };

  it("validates envelope, handles orders, cancel paths, modify paths, and schedule cancel", async () => {
    const compat = new HyperliquidExchangeCompat();
    const { runtime, orders } = makeRuntime();

    await expect(compat.handle(runtime as never, "paper-account-1", {})).rejects.toThrow("Missing nonce");
    await expect(compat.handle(runtime as never, "paper-account-1", { nonce: 1 })).rejects.toThrow("Missing signature");
    await expect(compat.handle(runtime as never, "paper-account-1", {
      nonce: 1,
      signature: { r: "0x1", s: "0x2", v: 27 },
      expiresAfter: Date.now() - 1
    })).rejects.toThrow("Request expired");
    await expect(compat.handle(runtime as never, "paper-account-1", {
      nonce: 1,
      signature: { r: "0x1", s: "0x2", v: 27 }
    })).rejects.toThrow("Missing action");

    const orderResponse = await compat.handle(runtime as never, "paper-account-1", {
      nonce: 2,
      signature: { r: "0x1", s: "0x2", v: 27 },
      action: {
        type: "order",
        orders: [{
          a: 0,
          b: true,
          p: "70000",
          s: "1",
          r: false,
          t: { limit: { tif: "Gtc" } },
          c: "0xnew"
        }, {
          a: 1,
          b: true,
          p: "70000",
          s: "1",
          r: false,
          t: { limit: { tif: "Gtc" } }
        }, {
          a: 0,
          b: true,
          p: "0",
          s: "0",
          r: false,
          t: { limit: { tif: "Gtc" } }
        }, {
          a: 0,
          b: true,
          p: "70000",
          s: "1",
          r: true,
          t: { limit: { tif: "Gtc" } }
        }, {
          a: 0,
          b: true,
          p: "70001",
          s: "1",
          r: false,
          t: { limit: { tif: "Alo" } }
        }, {
          a: 0,
          b: true,
          p: "70000",
          s: "1",
          r: false,
          t: {}
        }]
      } as never
    });
    expect(orderResponse.response.data.statuses).toHaveLength(6);

    const triggerResponse = await compat.handle(runtime as never, "paper-account-1", {
      nonce: 3,
      signature: { r: "0x1", s: "0x2", v: 27 },
      action: {
        type: "order",
        orders: [{
          a: 0,
          b: false,
          p: "69900",
          s: "0.5",
          r: true,
          t: { trigger: { isMarket: false, triggerPx: "69950", tpsl: "sl" } },
          c: "0xtrigger"
        }]
      }
    });
    expect(triggerResponse.response.data.statuses[0]).toMatchObject({
      resting: { cloid: "0xtrigger" }
    });
    await expect(compat.getVirtualOpenOrders("paper-account-1")).resolves.toHaveLength(1);

    const modifyMissing = await compat.handle(runtime as never, "paper-account-1", {
      nonce: 4,
      signature: { r: "0x1", s: "0x2", v: 27 },
      action: {
        type: "modify",
        oid: 999,
        order: {
          a: 0, b: true, p: "70000", s: "1", r: false, t: { limit: { tif: "Gtc" } }
        }
      }
    });
    expect(modifyMissing.response.data.statuses[0]).toEqual({ error: "Order does not exist." });

    orders[0]!.status = "FILLED";
    const modifyClosed = await compat.handle(runtime as never, "paper-account-1", {
      nonce: 5,
      signature: { r: "0x1", s: "0x2", v: 27 },
      action: {
        type: "modify",
        oid: 1,
        order: {
          a: 0, b: true, p: "70000", s: "1", r: false, t: { limit: { tif: "Gtc" } }
        }
      }
    });
    expect(modifyClosed.response.data.statuses[0]).toEqual({ error: "Only active orders can be modified." });

    orders[0]!.status = "ACCEPTED";
    const modifyActive = await compat.handle(runtime as never, "paper-account-1", {
      nonce: 6,
      signature: { r: "0x1", s: "0x2", v: 27 },
      action: {
        type: "modify",
        oid: 1,
        order: {
          a: 0, b: false, p: "70010", s: "1", r: false, t: { limit: { tif: "Gtc" } }
        }
      }
    });
    expect(modifyActive.response.data.statuses[0]).toMatchObject({ resting: { oid: 3 } });

    const modifyTrigger = await compat.handle(runtime as never, "paper-account-1", {
      nonce: 7,
      signature: { r: "0x1", s: "0x2", v: 27 },
      action: {
        type: "modify",
        oid: 1000000001,
        order: {
          a: 0, b: false, p: "69910", s: "0.5", r: false,
          t: { trigger: { isMarket: true, triggerPx: "69940", tpsl: "sl" } }
        }
      }
    });
    expect(modifyTrigger.response.data.statuses[0]).toMatchObject({ resting: { oid: 1000000001 } });

    const cancelResponse = await compat.handle(runtime as never, "paper-account-1", {
      nonce: 8,
      signature: { r: "0x1", s: "0x2", v: 27 },
      action: {
        type: "cancel",
        cancels: [{ a: 1, o: 1 }, { a: 0, o: 1000000001 }, { a: 0, o: 2 }]
      }
    });
    expect(cancelResponse.response.data.statuses).toEqual([
      { error: "Unsupported asset 1" },
      { success: "ok" },
      { success: "ok" }
    ]);

    runtime.getOrderByClientOrderId.mockReturnValueOnce(undefined);
    const cancelByCloid = await compat.handle(runtime as never, "paper-account-1", {
      nonce: 9,
      signature: { r: "0x1", s: "0x2", v: 27 },
      action: {
        type: "cancelByCloid",
        cancels: [
          { asset: 1, cloid: "0xabc" },
          { asset: 0, cloid: "0xmissing" }
        ]
      }
    });
    expect(cancelByCloid.response.data.statuses).toEqual([
      { error: "Unsupported asset 1" },
      { error: "Order does not exist." }
    ]);

    await expect(compat.handle(runtime as never, "paper-account-1", {
      nonce: 10,
      signature: { r: "0x1", s: "0x2", v: 27 },
      action: { type: "scheduleCancel", time: Date.now() + 1000 }
    })).rejects.toThrow("at least 5 seconds");

    const schedule = await compat.handle(runtime as never, "paper-account-1", {
      nonce: 11,
      signature: { r: "0x1", s: "0x2", v: 27 },
      action: { type: "scheduleCancel", time: Date.now() + 6000 }
    });
    expect(schedule.response.data.scheduledTime).toBeTypeOf("number");
    const unschedule = await compat.handle(runtime as never, "paper-account-1", {
      nonce: 12,
      signature: { r: "0x1", s: "0x2", v: 27 },
      action: { type: "scheduleCancel" }
    });
    expect(unschedule.response.data.scheduledTime).toBeNull();

    compat.shutdown();
    expect(global.clearTimeout).toHaveBeenCalled();
    expect(global.clearInterval).toHaveBeenCalled();
  });

  it("processes reduce-only checks, batch modify, trigger processing, and virtual order lookups", async () => {
    const compat = new HyperliquidExchangeCompat();
    const { runtime, orders } = makeRuntime();

    runtime.getEngineState
      .mockReturnValueOnce({ position: null })
      .mockReturnValue({ position: { side: "short", quantity: 0.25 } });

    const reduceOnlyRejected = await compat.handle(runtime as never, "paper-account-1", {
      nonce: 20,
      signature: { r: "0x1", s: "0x2", v: 27 },
      action: {
        type: "order",
        orders: [{
          a: 0,
          b: true,
          p: "70000",
          s: "1",
          r: true,
          t: { limit: { tif: "Gtc" } }
        }]
      }
    });
    expect(reduceOnlyRejected.response.data.statuses[0]).toEqual({
      error: "reduceOnly order requires an open position"
    });

    const triggerPlaced = await compat.handle(runtime as never, "paper-account-1", {
      nonce: 21,
      signature: { r: "0x1", s: "0x2", v: 27 },
      action: {
        type: "order",
        orders: [{
          a: 0,
          b: true,
          p: "70010",
          s: "0.2",
          r: true,
          t: { trigger: { isMarket: true, triggerPx: "69950", tpsl: "tp" } },
          c: "0xtrigger2"
        }]
      }
    });
    const triggerOid = triggerPlaced.response.data.statuses[0]?.resting?.oid;
    await expect(compat.getVirtualOrderStatus("paper-account-1", triggerOid)).resolves.toBeDefined();
    await expect(compat.getVirtualOrderStatus("paper-account-1", "0xtrigger2")).resolves.toBeDefined();
    await expect(compat.getVirtualOrderStatus("paper-account-2", triggerOid)).resolves.toBeUndefined();

    runtime.getMarketData.mockReturnValue({ markPrice: 70000, bestBid: 69999, bestAsk: 70001 });
    await (compat as any).processTriggerOrders(runtime);
    expect(runtime.submitOrder).not.toHaveBeenCalled();

    runtime.getMarketData.mockReturnValue({ markPrice: 69940, bestBid: 69939, bestAsk: 69941 });
    await (compat as any).processTriggerOrders(runtime);
    expect(runtime.submitOrder).toHaveBeenCalled();

    runtime.cancelOrder.mockResolvedValueOnce({
      events: [{ eventType: "OrderRejected", payload: { reasonMessage: "Cancel rejected" } }]
    });
    const batchModify = await compat.handle(runtime as never, "paper-account-1", {
      nonce: 22,
      signature: { r: "0x1", s: "0x2", v: 27 },
      action: {
        type: "batchModify",
        modifies: [{
          oid: 1,
          order: { a: 0, b: true, p: "70020", s: "1", r: false, t: { limit: { tif: "Gtc" } } }
        }]
      }
    });
    expect(batchModify.response.data.statuses[0]).toEqual({ error: "Cancel rejected" });

    runtime.getMarketData.mockReturnValue({ markPrice: null, bestBid: null, bestAsk: null });
    await (compat as any).processTriggerOrders(runtime);

    runtime.cancelOrder.mockResolvedValueOnce({
      events: [{ eventType: "OrderRejected", payload: { reasonMessage: "Cancel rejected" } }]
    });
    const cancelRejected = await compat.handle(runtime as never, "paper-account-1", {
      nonce: 23,
      signature: { r: "0x1", s: "0x2", v: 27 },
      action: {
        type: "cancel",
        cancels: [{ a: 0, o: 0 }]
      }
    });
    expect(cancelRejected.response.data.statuses[0]).toEqual({ error: "Cancel rejected" });
  });

  it("cancels the opposite TP/SL trigger when one side triggers", async () => {
    const compat = new HyperliquidExchangeCompat();
    const { runtime } = makeRuntime();

    runtime.getEngineState.mockReturnValue({ position: { side: "long", quantity: 1 } });

    const tpPlaced = await compat.handle(runtime as never, "paper-account-1", {
      nonce: 24,
      signature: { r: "0x1", s: "0x2", v: 27 },
      action: {
        type: "order",
        grouping: "positionTpsl",
        orders: [{
          a: 0,
          b: false,
          p: "73200",
          s: "1",
          r: true,
          t: { trigger: { isMarket: true, triggerPx: "73200", tpsl: "tp" } },
          c: "0xtp-oco"
        }, {
          a: 0,
          b: false,
          p: "73100",
          s: "1",
          r: true,
          t: { trigger: { isMarket: true, triggerPx: "73100", tpsl: "sl" } },
          c: "0xsl-oco"
        }]
      }
    });
    const tpOid = tpPlaced.response.data.statuses[0]?.resting?.oid as number;
    const slOid = tpPlaced.response.data.statuses[1]?.resting?.oid as number;

    runtime.getMarketData.mockReturnValue({ markPrice: 73092, bestBid: 73091, bestAsk: 73093 });
    await (compat as any).processTriggerOrders(runtime);

    const history = await compat.getVirtualOrderHistory("paper-account-1");
    expect(history.find((order: any) => order.oid === slOid)?.status).toBe("filled");
    expect(history.find((order: any) => order.oid === tpOid)?.status).toBe("canceled");

    compat.shutdown();
  });

  it("covers trigger modify edge cases and resolves orders by cloid and pending oid", async () => {
    const compat = new HyperliquidExchangeCompat();
    const { runtime, orders } = makeRuntime();

    const missingTriggerModify = await compat.handle(runtime as never, "paper-account-1", {
      nonce: 30,
      signature: { r: "0x1", s: "0x2", v: 27 },
      action: {
        type: "modify",
        oid: 1000009999,
        order: {
          a: 0,
          b: false,
          p: "69900",
          s: "0.5",
          r: false,
          t: { trigger: { isMarket: false, triggerPx: "69950", tpsl: "sl" } }
        }
      }
    });
    expect(missingTriggerModify.response.data.statuses[0]).toEqual({ error: "Order does not exist." });

    runtime.getEngineState.mockReturnValueOnce({ position: { side: "long", quantity: 0.25 } });
    const triggerPlaced = await compat.handle(runtime as never, "paper-account-1", {
      nonce: 31,
      signature: { r: "0x1", s: "0x2", v: 27 },
      action: {
        type: "order",
        orders: [{
          a: 0,
          b: false,
          p: "69900",
          s: "0.25",
          r: true,
          t: { trigger: { isMarket: false, triggerPx: "69950", tpsl: "sl" } },
          c: "0xtrigger-resolve"
        }]
      }
    });
    const triggerOid = triggerPlaced.response.data.statuses[0]?.resting?.oid as number;

    const invalidTriggerPayload = await compat.handle(runtime as never, "paper-account-1", {
      nonce: 32,
      signature: { r: "0x1", s: "0x2", v: 27 },
      action: {
        type: "modify",
        oid: triggerOid,
        order: {
          a: 0,
          b: false,
          p: "69910",
          s: "0.25",
          r: false,
          t: { limit: { tif: "Gtc" } }
        }
      }
    });
    expect(invalidTriggerPayload.response.data.statuses[0]).toEqual({
      error: "Trigger order can only be modified with another trigger payload"
    });
    await expect(compat.getVirtualOrderStatus("paper-account-1", triggerOid)).resolves.toMatchObject({
      order: {
        oid: triggerOid,
        triggerCondition: {
          triggerPx: "69950",
          tpsl: "sl"
        }
      },
      status: "triggerPending"
    });

    runtime.getEngineState.mockReturnValueOnce({ position: { side: "long", quantity: 0.25 } });
    const triggerPlacedAgain = await compat.handle(runtime as never, "paper-account-1", {
      nonce: 33,
      signature: { r: "0x1", s: "0x2", v: 27 },
      action: {
        type: "order",
        orders: [{
          a: 0,
          b: false,
          p: "69900",
          s: "0.25",
          r: true,
          t: { trigger: { isMarket: true, triggerPx: "69950", tpsl: "sl" } },
          c: "0xpending-cloid"
        }]
      }
    });
    const pendingOid = triggerPlacedAgain.response.data.statuses[0]?.resting?.oid as number;

    runtime.getOrderByClientOrderId.mockReturnValueOnce(undefined);
    const modifyByPendingCloid = await compat.handle(runtime as never, "paper-account-1", {
      nonce: 34,
      signature: { r: "0x1", s: "0x2", v: 27 },
      action: {
        type: "modify",
        oid: "0xpending-cloid",
        order: {
          a: 0,
          b: false,
          p: "69890",
          s: "0.25",
          r: true,
          t: { trigger: { isMarket: true, triggerPx: "69940", tpsl: "sl" } }
        }
      }
    });
    expect(modifyByPendingCloid.response.data.statuses[0]).toEqual({
      resting: {
        oid: pendingOid,
        cloid: "0xpending-cloid"
      }
    });

    runtime.getEngineState.mockReturnValueOnce({ position: { side: "short", quantity: 0.1 } });
    const reduceOnlyTriggerModify = await compat.handle(runtime as never, "paper-account-1", {
      nonce: 35,
      signature: { r: "0x1", s: "0x2", v: 27 },
      action: {
        type: "modify",
        oid: pendingOid,
        order: {
          a: 0,
          b: false,
          p: "69880",
          s: "0.25",
          r: true,
          t: { trigger: { isMarket: true, triggerPx: "69930", tpsl: "sl" } }
        }
      }
    });
    expect(reduceOnlyTriggerModify.response.data.statuses[0]).toEqual({
      error: "reduceOnly sell order can only reduce a long position"
    });

    orders[0]!.status = "ACCEPTED";
    const modifyByExistingCloid = await compat.handle(runtime as never, "paper-account-1", {
      nonce: 36,
      signature: { r: "0x1", s: "0x2", v: 27 },
      action: {
        type: "modify",
        oid: "0xabc",
        order: {
          a: 0,
          b: true,
          p: "70010",
          s: "1",
          r: false,
          t: { limit: { tif: "Gtc" } }
        }
      }
    });
    expect(modifyByExistingCloid.response.data.statuses[0]).toMatchObject({
      resting: {
        oid: expect.any(Number),
        cloid: "0xabc"
      }
    });

    compat.shutdown();
  });

  it("keeps normalTpsl children waiting until the parent order lifecycle allows activation", async () => {
    const compat = new HyperliquidExchangeCompat();
    const { runtime, orders } = makeRuntime();

    const result = await compat.handle(runtime as never, "paper-account-1", {
      nonce: 37,
      signature: { r: "0x1", s: "0x2", v: 27 },
      action: {
        type: "order",
        grouping: "normalTpsl",
        orders: [{
          a: 0,
          b: true,
          p: "70000",
          s: "1",
          r: false,
          t: { limit: { tif: "Gtc" } },
          c: "0xparent-normal"
        }, {
          a: 0,
          b: false,
          p: "71000",
          s: "1",
          r: true,
          t: { trigger: { isMarket: true, triggerPx: "71000", tpsl: "tp" } },
          c: "0xntp-normal"
        }, {
          a: 0,
          b: false,
          p: "69000",
          s: "1",
          r: true,
          t: { trigger: { isMarket: true, triggerPx: "69000", tpsl: "sl" } },
          c: "0xnsl-normal"
        }]
      }
    });

    expect(result.response.data.statuses).toHaveLength(3);
    await expect(compat.getVirtualOpenOrders("paper-account-1")).resolves.toHaveLength(0);

    const waitingHistory = await compat.getVirtualOrderHistory("paper-account-1");
    expect(waitingHistory.filter((order: any) => order.status === "waitingForParent")).toHaveLength(2);

    orders[orders.length - 1]!.status = "FILLED";
    await (compat as any).processDeferredNormalTpslGroups(runtime);

    const pendingAfterFill = await compat.getVirtualOpenOrders("paper-account-1");
    expect(pendingAfterFill).toHaveLength(2);

    compat.shutdown();
  });

  it("cancels deferred normalTpsl children when the parent order is canceled after a partial fill", async () => {
    const compat = new HyperliquidExchangeCompat();
    const { runtime, orders } = makeRuntime();

    await compat.handle(runtime as never, "paper-account-1", {
      nonce: 38,
      signature: { r: "0x1", s: "0x2", v: 27 },
      action: {
        type: "order",
        grouping: "normalTpsl",
        orders: [{
          a: 0,
          b: true,
          p: "70000",
          s: "1",
          r: false,
          t: { limit: { tif: "Gtc" } },
          c: "0xparent-cancel"
        }, {
          a: 0,
          b: false,
          p: "71000",
          s: "1",
          r: true,
          t: { trigger: { isMarket: true, triggerPx: "71000", tpsl: "tp" } },
          c: "0xntp-cancel"
        }, {
          a: 0,
          b: false,
          p: "69000",
          s: "1",
          r: true,
          t: { trigger: { isMarket: true, triggerPx: "69000", tpsl: "sl" } },
          c: "0xnsl-cancel"
        }]
      }
    });

    orders[orders.length - 1]!.filledQuantity = 0.4;
    orders[orders.length - 1]!.remainingQuantity = 0.6;
    orders[orders.length - 1]!.status = "CANCELED";
    await (compat as any).processDeferredNormalTpslGroups(runtime);

    const openOrders = await compat.getVirtualOpenOrders("paper-account-1");
    expect(openOrders).toHaveLength(0);

    const history = await compat.getVirtualOrderHistory("paper-account-1");
    expect(history.filter((order: any) => order.status === "canceled")).toHaveLength(2);

    compat.shutdown();
  });

  it("auto-cancels pending reduce-only tp/sl orders after the position is closed", async () => {
    const compat = new HyperliquidExchangeCompat();
    const { runtime } = makeRuntime();

    await compat.handle(runtime as never, "paper-account-1", {
      nonce: 39,
      signature: { r: "0x1", s: "0x2", v: 27 },
      action: {
        type: "order",
        grouping: "positionTpsl",
        orders: [{
          a: 0,
          b: false,
          p: "72000",
          s: "1",
          r: true,
          t: { trigger: { isMarket: true, triggerPx: "72000", tpsl: "tp" } },
          c: "0xtp-flat-cancel"
        }]
      }
    });

    runtime.getEngineState.mockReturnValue({ position: { side: "flat", quantity: 0 } });
    await (compat as any).processInvalidReduceOnlyOrders(runtime);

    const openOrders = await compat.getVirtualOpenOrders("paper-account-1");
    expect(openOrders).toHaveLength(0);

    const history = await compat.getVirtualOrderHistory("paper-account-1");
    expect(history.find((order: any) => order.cloid === "0xtp-flat-cancel")?.status).toBe("canceled");

    compat.shutdown();
  });

  it("auto-cancels triggered reduce-only resting orders after the position is closed", async () => {
    const compat = new HyperliquidExchangeCompat();
    const { runtime, orders } = makeRuntime();

    runtime.cancelOrder.mockImplementation(async ({ orderId }: { orderId: string }) => {
      const target = orders.find((entry) => entry.id === orderId);
      if (target) {
        target.status = "CANCELED";
      }
      return { events: [] };
    });

    await compat.handle(runtime as never, "paper-account-1", {
      nonce: 40,
      signature: { r: "0x1", s: "0x2", v: 27 },
      action: {
        type: "order",
        grouping: "positionTpsl",
        orders: [{
          a: 0,
          b: false,
          p: "72000",
          s: "1",
          r: true,
          t: { trigger: { isMarket: false, triggerPx: "72000", tpsl: "tp" } },
          c: "0xtp-resting-cancel"
        }]
      }
    });

    runtime.getMarketData.mockReturnValue({ markPrice: 72010, bestBid: 72009, bestAsk: 72011 });
    await (compat as any).processTriggerOrders(runtime);

    const linkedOrder = orders.find((order) => order.clientOrderId === "0xtp-resting-cancel");
    expect(linkedOrder?.status).toBe("ACCEPTED");

    runtime.getEngineState.mockReturnValue({ position: { side: "flat", quantity: 0 } });
    await (compat as any).processInvalidReduceOnlyOrders(runtime);

    expect(linkedOrder?.status).toBe("CANCELED");
    const history = await compat.getVirtualOrderHistory("paper-account-1");
    expect(history.find((order: any) => order.cloid === "0xtp-resting-cancel")?.status).toBe("canceled");

    compat.shutdown();
  });

  it("covers remaining private trigger helper branches", async () => {
    const compat = new HyperliquidExchangeCompat() as any;
    const { runtime } = makeRuntime();

    await expect(compat.createTriggerOrder("paper-account-1", {
      a: 0,
      b: true,
      p: "70000",
      s: "1",
      r: false,
      t: {},
      c: "0xmissing-trigger"
    })).resolves.toEqual({ error: "Trigger order payload missing" });

    const created = await compat.createTriggerOrder("paper-account-1", {
      a: 0,
      b: true,
      p: "not-a-number",
      s: "1",
      r: false,
      t: { trigger: { isMarket: true, triggerPx: "70100", tpsl: "tp" } },
      c: "0xhelper-trigger"
    });
    const oid = created.resting.oid as number;
    await expect(compat.getVirtualOrderStatus("paper-account-1", oid)).resolves.toMatchObject({ order: { limitPx: "70100" } });

    await expect(compat.modifyTriggerOrder(runtime, "paper-account-2", oid, {
      a: 0,
      b: true,
      p: "70000",
      s: "1",
      r: false,
      t: { trigger: { isMarket: true, triggerPx: "70110", tpsl: "tp" } }
    })).resolves.toEqual({ error: "Order does not exist." });

    compat.shutdown();
  });

  it("evaluates tp/sl trigger directions correctly for long and short exits", () => {
    const compat = new HyperliquidExchangeCompat() as any;

    expect(compat.shouldTriggerOrder({
      isBuy: false,
      tpsl: "tp",
      triggerPx: 71000
    }, 70000)).toBe(false);
    expect(compat.shouldTriggerOrder({
      isBuy: false,
      tpsl: "tp",
      triggerPx: 71000
    }, 71000)).toBe(true);

    expect(compat.shouldTriggerOrder({
      isBuy: false,
      tpsl: "sl",
      triggerPx: 69000
    }, 70000)).toBe(false);
    expect(compat.shouldTriggerOrder({
      isBuy: false,
      tpsl: "sl",
      triggerPx: 69000
    }, 68999)).toBe(true);

    expect(compat.shouldTriggerOrder({
      isBuy: true,
      tpsl: "tp",
      triggerPx: 69000
    }, 70000)).toBe(false);
    expect(compat.shouldTriggerOrder({
      isBuy: true,
      tpsl: "tp",
      triggerPx: 69000
    }, 68999)).toBe(true);

    expect(compat.shouldTriggerOrder({
      isBuy: true,
      tpsl: "sl",
      triggerPx: 71000
    }, 70000)).toBe(false);
    expect(compat.shouldTriggerOrder({
      isBuy: true,
      tpsl: "sl",
      triggerPx: 71000
    }, 71000)).toBe(true);

    compat.shutdown();
  });

  it("covers helper branches for trigger history, deferred groups, and reduce-only validation", async () => {
    const compat = new HyperliquidExchangeCompat();
    const { runtime } = makeRuntime();
    const compatAny = compat as never;

    expect(compatAny.shouldTriggerOrder({
      tpsl: "tp",
      isBuy: true,
      triggerPx: 100
    }, 99)).toBe(true);
    expect(compatAny.shouldTriggerOrder({
      tpsl: "tp",
      isBuy: false,
      triggerPx: 100
    }, 101)).toBe(true);
    expect(compatAny.shouldTriggerOrder({
      tpsl: "sl",
      isBuy: true,
      triggerPx: 100
    }, 101)).toBe(true);
    expect(compatAny.shouldTriggerOrder({
      tpsl: "sl",
      isBuy: false,
      triggerPx: 100
    }, 99)).toBe(true);

    runtime.getEngineState.mockReturnValue({ position: null });
    expect(compatAny.validateReduceOnly(runtime, "paper-account-1", true, 1)).toBe("reduceOnly order requires an open position");
    runtime.getEngineState.mockReturnValue({ position: { side: "long", quantity: 1 } });
    expect(compatAny.validateReduceOnly(runtime, "paper-account-1", true, 1)).toBe("reduceOnly buy order can only reduce a short position");
    runtime.getEngineState.mockReturnValue({ position: { side: "short", quantity: 1 } });
    expect(compatAny.validateReduceOnly(runtime, "paper-account-1", false, 1)).toBe("reduceOnly sell order can only reduce a long position");
    runtime.getEngineState.mockReturnValue({ position: { side: "long", quantity: 0.5 } });
    expect(compatAny.validateReduceOnly(runtime, "paper-account-1", false, 1)).toBe("reduceOnly size exceeds current position");
    expect(compatAny.validateReduceOnly(runtime, "paper-account-1", false, 0.25)).toBeNull();

    expect(await compatAny.createTriggerOrder("paper-account-1", {
      a: 0,
      b: false,
      p: "0",
      s: "1",
      r: false,
      t: {}
    })).toEqual({ error: "Trigger order payload missing" });

    compatAny.fallbackTriggerOrderHistory.set(1000000010, {
      oid: 1000000010,
      accountId: "paper-account-1",
      asset: 0,
      isBuy: false,
      triggerPx: 69950,
      actualTriggerPx: 69940,
      isMarket: true,
      tpsl: "sl",
      size: 0.5,
      reduceOnly: true,
      cloid: "0xhistory-triggered",
      status: "triggered",
      createdAt: 1000,
      updatedAt: 2000
    });
    compatAny.fallbackTriggerOrderHistory.set(1000000011, {
      oid: 1000000011,
      accountId: "paper-account-1",
      asset: 0,
      isBuy: false,
      triggerPx: 70010,
      isMarket: false,
      tpsl: "tp",
      size: 0.5,
      reduceOnly: true,
      cloid: "0xhistory-waiting",
      status: "waitingForParent",
      createdAt: 1001,
      updatedAt: 2001
    });
    compatAny.triggerGroupByOid.set(1000000010, {
      groupId: "group-1",
      grouping: "positionTpsl",
      childOids: [1000000010, 1000000011]
    });
    compatAny.triggerGroupByOid.set(1000000011, {
      groupId: "group-1",
      grouping: "positionTpsl",
      childOids: [1000000010, 1000000011]
    });

    const history = await compat.getVirtualOrderHistory("paper-account-1");
    expect(history).toEqual(expect.arrayContaining([
      expect.objectContaining({
        oid: 1000000010,
        grouping: "positionTpsl",
        triggerCondition: {
          triggerPx: "69940",
          isMarket: true,
          tpsl: "sl"
        }
      }),
      expect.objectContaining({
        oid: 1000000011,
        triggerCondition: {
          triggerPx: "",
          isMarket: false,
          tpsl: "tp"
        }
      })
    ]));

    compatAny.fallbackTriggerOrderHistory.set(1000000020, {
      oid: 1000000020,
      accountId: "paper-account-1",
      asset: 0,
      isBuy: false,
      triggerPx: 69900,
      isMarket: false,
      tpsl: "sl",
      size: 0.5,
      reduceOnly: true,
      cloid: "0xwaiting",
      status: "waitingForParent",
      createdAt: 1000,
      updatedAt: 1000
    });
    compatAny.fallbackTriggerOrderHistory.set(1000000021, {
      oid: 1000000021,
      accountId: "paper-account-1",
      asset: 0,
      isBuy: false,
      triggerPx: 70100,
      isMarket: false,
      tpsl: "tp",
      size: 0.5,
      reduceOnly: true,
      cloid: "0xother-status",
      status: "triggerPending",
      createdAt: 1000,
      updatedAt: 1000
    });

    await compatAny.activateDeferredNormalTpslGroup({
      groupId: "group-activate",
      accountId: "paper-account-1",
      parentOrderId: "ord_parent",
      childOids: [1000000020, 1000000021, 1000000099]
    }, 1.25);
    expect(compatAny.fallbackTriggerOrderHistory.get(1000000020)?.status).toBe("triggerPending");
    expect(compatAny.fallbackTriggerOrderHistory.get(1000000020)?.size).toBe(1.25);

    compatAny.fallbackTriggerOrderHistory.set(1000000022, {
      oid: 1000000022,
      accountId: "paper-account-1",
      asset: 0,
      isBuy: false,
      triggerPx: 69800,
      isMarket: false,
      tpsl: "sl",
      size: 0.5,
      reduceOnly: true,
      cloid: "0xcancel-waiting",
      status: "waitingForParent",
      createdAt: 1000,
      updatedAt: 1000
    });
    await compatAny.cancelDeferredNormalTpslGroup({
      groupId: "group-cancel",
      accountId: "paper-account-1",
      parentOrderId: "ord_parent",
      childOids: [1000000022, 1000000098]
    });
    expect(compatAny.fallbackTriggerOrderHistory.get(1000000022)?.status).toBe("canceled");

    compat.shutdown();
  });
});
