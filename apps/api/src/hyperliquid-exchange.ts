import type { CreateOrderInput, OrderView } from "@stratium/shared";
import type { ApiRuntime } from "./runtime.js";

type SignatureLike = {
  r?: string;
  s?: string;
  v?: number;
};

type ExchangeOrderWire = {
  a: number;
  b: boolean;
  p: string;
  s: string;
  r: boolean;
  t: {
    limit?: {
      tif: "Alo" | "Ioc" | "Gtc";
    };
    trigger?: {
      isMarket: boolean;
      triggerPx: string;
      tpsl: "tp" | "sl";
    };
  };
  c?: string;
};

type ExchangeAction =
  | { type: "order"; orders: ExchangeOrderWire[]; grouping?: string }
  | { type: "cancel"; cancels: Array<{ a: number; o: number }> }
  | { type: "cancelByCloid"; cancels: Array<{ asset: number; cloid: string }> }
  | { type: "modify"; oid: number | string; order: ExchangeOrderWire }
  | { type: "batchModify"; modifies: Array<{ oid: number | string; order: ExchangeOrderWire }> }
  | { type: "scheduleCancel"; time?: number };

export interface HyperliquidExchangeRequest {
  action?: ExchangeAction;
  nonce?: number;
  signature?: SignatureLike;
  vaultAddress?: string;
  expiresAfter?: number;
}

const oidFromOrderId = (orderId: string): number => {
  const numericPart = orderId.replace(/^ord_/, "");
  const oid = Number(numericPart);
  return Number.isFinite(oid) ? oid : 0;
};

const orderIdFromOid = (oid: number): string => `ord_${oid}`;

const isOpenOrder = (order: OrderView): boolean =>
  order.status === "ACCEPTED" || order.status === "PARTIALLY_FILLED" || order.status === "NEW";

const formatOrderStatus = (order: OrderView) => {
  if (order.status === "REJECTED") {
    return {
      error: order.rejectionMessage ?? "Order rejected"
    };
  }

  if (order.status === "FILLED") {
    return {
      filled: {
        totalSz: String(order.filledQuantity),
        avgPx: String(order.averageFillPrice ?? order.limitPrice ?? 0),
        oid: oidFromOrderId(order.id)
      }
    };
  }

  if (order.status === "CANCELED") {
    return {
      error: "Order was canceled"
    };
  }

  return {
    resting: {
      oid: oidFromOrderId(order.id),
      cloid: order.clientOrderId
    }
  };
};

const buildOkResponse = (statuses: unknown[]) => ({
  status: "ok",
  response: {
    type: "order",
    data: {
      statuses
    }
  }
});

const buildCancelResponse = (statuses: unknown[]) => ({
  status: "ok",
  response: {
    type: "cancel",
    data: {
      statuses
    }
  }
});

const buildScheduleCancelResponse = (scheduledTime: number | null) => ({
  status: "ok",
  response: {
    type: "scheduleCancel",
    data: {
      scheduledTime
    }
  }
});

interface PendingTriggerOrder {
  oid: number;
  accountId: string;
  asset: number;
  isBuy: boolean;
  triggerPx: number;
  isMarket: boolean;
  tpsl: "tp" | "sl";
  size: number;
  limitPx?: number;
  reduceOnly: boolean;
  cloid?: string;
  createdAt: number;
}

export class HyperliquidExchangeCompat {
  private static readonly TRIGGER_OID_BASE = 1_000_000_000;

  private readonly scheduleTimers = new Map<string, NodeJS.Timeout>();

  private readonly scheduledCancelTimes = new Map<string, number | null>();

  private readonly pendingTriggerOrders = new Map<number, PendingTriggerOrder>();

  private triggerOrderSequence = 1;

  private triggerLoop?: NodeJS.Timeout;

  async handle(runtime: ApiRuntime, accountId: string, request: HyperliquidExchangeRequest) {
    this.bindRuntime(runtime);
    this.validateEnvelope(request);

    const action = request.action;
    if (!action) {
      throw new Error("Missing action");
    }

    switch (action.type) {
      case "order":
        return this.handleOrder(runtime, accountId, action.orders);
      case "cancel":
        return this.handleCancel(runtime, accountId, action.cancels);
      case "cancelByCloid":
        return this.handleCancelByCloid(runtime, accountId, action.cancels);
      case "modify":
        return this.handleModify(runtime, accountId, action.oid, action.order);
      case "batchModify":
        return this.handleBatchModify(runtime, accountId, action.modifies);
      case "scheduleCancel":
        return this.handleScheduleCancel(runtime, accountId, action.time);
      default:
        throw new Error(`Unsupported exchange action type ${(action as { type?: string }).type ?? "undefined"}`);
    }
  }

  shutdown() {
    for (const timer of this.scheduleTimers.values()) {
      clearTimeout(timer);
    }
    this.scheduleTimers.clear();
    this.scheduledCancelTimes.clear();
    if (this.triggerLoop) {
      clearInterval(this.triggerLoop);
      this.triggerLoop = undefined;
    }
    this.pendingTriggerOrders.clear();
  }

  getVirtualOpenOrders(accountId: string) {
    return [...this.pendingTriggerOrders.values()]
      .filter((order) => order.accountId === accountId)
      .map((order) => ({
        coin: "BTC",
        side: order.isBuy ? "B" as const : "A" as const,
        limitPx: String(order.limitPx ?? order.triggerPx),
        sz: String(order.size),
        oid: order.oid,
        timestamp: order.createdAt,
        origSz: String(order.size),
        cloid: order.cloid,
        triggerCondition: {
          triggerPx: String(order.triggerPx),
          isMarket: order.isMarket,
          tpsl: order.tpsl
        }
      }));
  }

  getVirtualOrderStatus(accountId: string, oidOrCloid: number | string) {
    const order = typeof oidOrCloid === "string" && oidOrCloid.startsWith("0x")
      ? [...this.pendingTriggerOrders.values()].find((entry) => entry.accountId === accountId && entry.cloid === oidOrCloid)
      : this.pendingTriggerOrders.get(Number(oidOrCloid));

    if (!order || order.accountId !== accountId) {
      return undefined;
    }

    return {
      order: {
        coin: "BTC",
        side: order.isBuy ? "B" as const : "A" as const,
        limitPx: String(order.limitPx ?? order.triggerPx),
        sz: String(order.size),
        oid: order.oid,
        timestamp: order.createdAt,
        origSz: String(order.size),
        cloid: order.cloid,
        triggerCondition: {
          triggerPx: String(order.triggerPx),
          isMarket: order.isMarket,
          tpsl: order.tpsl
        }
      },
      status: "triggerPending",
      statusTimestamp: order.createdAt
    };
  }

  private validateEnvelope(request: HyperliquidExchangeRequest) {
    if (!Number.isFinite(request.nonce)) {
      throw new Error("Missing nonce");
    }

    if (!request.signature || typeof request.signature !== "object") {
      throw new Error("Missing signature");
    }

    if (request.expiresAfter != null && request.expiresAfter <= Date.now()) {
      throw new Error("Request expired");
    }
  }

  private async handleOrder(runtime: ApiRuntime, accountId: string, orders: ExchangeOrderWire[]) {
    const symbolConfig = runtime.getSymbolConfigState();
    const market = runtime.getMarketData();
    const statuses = [];

    for (const order of orders) {
      const quantity = Number(order.s);
      const price = Number(order.p);

      if (order.a !== 0) {
        statuses.push({ error: `Unsupported asset ${order.a}` });
        continue;
      }

      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price <= 0) {
        statuses.push({ error: "Invalid order size or price" });
        continue;
      }

      if (order.r) {
        const reduceOnlyValidation = this.validateReduceOnly(runtime, accountId, order.b, quantity);
        if (reduceOnlyValidation) {
          statuses.push({ error: reduceOnlyValidation });
          continue;
        }
      }

      if (order.t.trigger) {
        statuses.push(this.createTriggerOrder(accountId, order));
        continue;
      }

      const tif = order.t.limit?.tif;
      if (!tif) {
        statuses.push({ error: "Only limit-style orders are supported" });
        continue;
      }

      if (tif === "Alo") {
        const wouldCross = order.b
          ? market.bestAsk != null && price >= market.bestAsk
          : market.bestBid != null && price <= market.bestBid;

        if (wouldCross) {
          statuses.push({ error: "Post-only order would cross" });
          continue;
        }
      }

      const input: CreateOrderInput = {
        accountId,
        symbol: symbolConfig.symbol,
        side: order.b ? "buy" : "sell",
        orderType: tif === "Ioc" ? "market" : "limit",
        quantity,
        limitPrice: tif === "Ioc" ? undefined : price,
        clientOrderId: order.c,
        submittedAt: new Date().toISOString()
      };

      const result = await runtime.submitOrder(input);
      const requestedOrderId = result.events.find((event) => event.eventType === "OrderRequested")?.payload.orderId;
      const createdOrder = requestedOrderId
        ? runtime.getOrders(accountId).find((entry) => entry.id === requestedOrderId)
        : undefined;

      statuses.push(createdOrder ? formatOrderStatus(createdOrder) : { error: "Order was not created" });
    }

    return buildOkResponse(statuses);
  }

  private async handleModify(runtime: ApiRuntime, accountId: string, oid: number | string, order: ExchangeOrderWire) {
    const target = this.resolveExistingOrder(runtime, accountId, oid);
    if (!target) {
      return buildOkResponse([{ error: "Order does not exist." }]);
    }

    if ("triggerPx" in target) {
      return buildOkResponse([this.modifyTriggerOrder(runtime, accountId, target.oid, order)]);
    }

    if (!isOpenOrder(target)) {
      return buildOkResponse([{ error: "Only active orders can be modified." }]);
    }

    const cancelResult = await runtime.cancelOrder({
      accountId,
      orderId: target.id,
      requestedAt: new Date().toISOString()
    });
    const rejected = cancelResult.events.find((event) => event.eventType === "OrderRejected");
    if (rejected) {
      return buildOkResponse([{ error: (rejected.payload as { reasonMessage?: string }).reasonMessage ?? "Cancel rejected" }]);
    }

    return this.handleOrder(runtime, accountId, [{
      ...order,
      c: order.c ?? target.clientOrderId
    }]);
  }

  private async handleBatchModify(
    runtime: ApiRuntime,
    accountId: string,
    modifies: Array<{ oid: number | string; order: ExchangeOrderWire }>
  ) {
    const statuses = [];
    for (const modify of modifies) {
      const response = await this.handleModify(runtime, accountId, modify.oid, modify.order);
      const status = (response.response.data.statuses[0] ?? { error: "Unknown modify result" }) as unknown;
      statuses.push(status);
    }
    return buildOkResponse(statuses);
  }

  private async handleCancel(runtime: ApiRuntime, accountId: string, cancels: Array<{ a: number; o: number }>) {
    const statuses = [];

    for (const cancel of cancels) {
      if (cancel.a !== 0) {
        statuses.push({ error: `Unsupported asset ${cancel.a}` });
        continue;
      }

      const triggerOrder = this.pendingTriggerOrders.get(cancel.o);
      if (triggerOrder && triggerOrder.accountId === accountId) {
        this.pendingTriggerOrders.delete(cancel.o);
        statuses.push({ success: "ok" });
        continue;
      }

      const orderId = orderIdFromOid(cancel.o);
      const result = await runtime.cancelOrder({
        accountId,
        orderId,
        requestedAt: new Date().toISOString()
      });
      const rejected = result.events.find((event) => event.eventType === "OrderRejected");

      statuses.push(rejected
        ? { error: (rejected.payload as { reasonMessage?: string }).reasonMessage ?? "Cancel rejected" }
        : { success: "ok" });
    }

    return buildCancelResponse(statuses);
  }

  private async handleCancelByCloid(runtime: ApiRuntime, accountId: string, cancels: Array<{ asset: number; cloid: string }>) {
    const statuses = [];

    for (const cancel of cancels) {
      if (cancel.asset !== 0) {
        statuses.push({ error: `Unsupported asset ${cancel.asset}` });
        continue;
      }

      const triggerOrder = [...this.pendingTriggerOrders.values()].find((entry) => entry.accountId === accountId && entry.cloid === cancel.cloid);
      if (triggerOrder) {
        this.pendingTriggerOrders.delete(triggerOrder.oid);
        statuses.push({ success: "ok" });
        continue;
      }

      const order = runtime.getOrderByClientOrderId(accountId, cancel.cloid);
      if (!order) {
        statuses.push({ error: "Order does not exist." });
        continue;
      }

      const result = await runtime.cancelOrder({
        accountId,
        orderId: order.id,
        requestedAt: new Date().toISOString()
      });
      const rejected = result.events.find((event) => event.eventType === "OrderRejected");
      statuses.push(rejected
        ? { error: (rejected.payload as { reasonMessage?: string }).reasonMessage ?? "Cancel rejected" }
        : { success: "ok" });
    }

    return buildCancelResponse(statuses);
  }

  private async handleScheduleCancel(runtime: ApiRuntime, accountId: string, time?: number) {
    const existing = this.scheduleTimers.get(accountId);
    if (existing) {
      clearTimeout(existing);
      this.scheduleTimers.delete(accountId);
    }

    if (time == null) {
      this.scheduledCancelTimes.set(accountId, null);
      return buildScheduleCancelResponse(null);
    }

    if (time < Date.now() + 5_000) {
      throw new Error("scheduleCancel time must be at least 5 seconds in the future");
    }

    this.scheduledCancelTimes.set(accountId, time);
    const delayMs = Math.max(0, time - Date.now());
    const timer = setTimeout(() => {
      void runtime.cancelAllOpenOrders(accountId, new Date().toISOString());
      for (const [oid, order] of this.pendingTriggerOrders.entries()) {
        if (order.accountId === accountId) {
          this.pendingTriggerOrders.delete(oid);
        }
      }
      this.scheduleTimers.delete(accountId);
      this.scheduledCancelTimes.set(accountId, null);
    }, delayMs);

    this.scheduleTimers.set(accountId, timer);
    return buildScheduleCancelResponse(time);
  }

  private bindRuntime(runtime: ApiRuntime) {
    if (this.triggerLoop) {
      return;
    }

    this.triggerLoop = setInterval(() => {
      void this.processTriggerOrders(runtime);
    }, 500);
  }

  private async processTriggerOrders(runtime: ApiRuntime) {
    if (this.pendingTriggerOrders.size === 0) {
      return;
    }

    const market = runtime.getMarketData();
    const referencePrice = market.markPrice ?? market.bestBid ?? market.bestAsk;
    if (!referencePrice) {
      return;
    }

    for (const [oid, order] of [...this.pendingTriggerOrders.entries()]) {
      const shouldTrigger = order.isBuy
        ? referencePrice >= order.triggerPx
        : referencePrice <= order.triggerPx;

      if (!shouldTrigger) {
        continue;
      }

      const reduceOnlyValidation = order.reduceOnly
        ? this.validateReduceOnly(runtime, order.accountId, order.isBuy, order.size)
        : null;

      if (reduceOnlyValidation) {
        this.pendingTriggerOrders.delete(oid);
        continue;
      }

      await this.handleOrder(runtime, order.accountId, [{
        a: order.asset,
        b: order.isBuy,
        p: String(order.limitPx ?? order.triggerPx),
        s: String(order.size),
        r: order.reduceOnly,
        t: order.isMarket
          ? { limit: { tif: "Ioc" } }
          : { limit: { tif: "Gtc" } },
        c: order.cloid
      }]);

      this.pendingTriggerOrders.delete(oid);
    }
  }

  private validateReduceOnly(runtime: ApiRuntime, accountId: string, isBuy: boolean, quantity: number) {
    const position = runtime.getEngineState(accountId).position;
    if (!position || position.side === "flat" || position.quantity <= 0) {
      return "reduceOnly order requires an open position";
    }

    if (isBuy && position.side !== "short") {
      return "reduceOnly buy order can only reduce a short position";
    }

    if (!isBuy && position.side !== "long") {
      return "reduceOnly sell order can only reduce a long position";
    }

    if (quantity > Math.abs(position.quantity)) {
      return "reduceOnly size exceeds current position";
    }

    return null;
  }

  private createTriggerOrder(accountId: string, order: ExchangeOrderWire) {
    if (!order.t.trigger) {
      return { error: "Trigger order payload missing" };
    }

    const oid = HyperliquidExchangeCompat.TRIGGER_OID_BASE + this.triggerOrderSequence;
    this.triggerOrderSequence += 1;
    this.pendingTriggerOrders.set(oid, {
      oid,
      accountId,
      asset: order.a,
      isBuy: order.b,
      triggerPx: Number(order.t.trigger.triggerPx),
      isMarket: order.t.trigger.isMarket,
      tpsl: order.t.trigger.tpsl,
      size: Number(order.s),
      limitPx: Number.isFinite(Number(order.p)) ? Number(order.p) : undefined,
      reduceOnly: order.r,
      cloid: order.c,
      createdAt: Date.now()
    });

    return {
      resting: {
        oid,
        cloid: order.c
      }
    };
  }

  private modifyTriggerOrder(runtime: ApiRuntime, accountId: string, oid: number, order: ExchangeOrderWire) {
    const existing = this.pendingTriggerOrders.get(oid);
    if (!existing || existing.accountId !== accountId) {
      return { error: "Order does not exist." };
    }

    if (order.r) {
      const reduceOnlyValidation = this.validateReduceOnly(runtime, accountId, order.b, Number(order.s));
      if (reduceOnlyValidation) {
        return { error: reduceOnlyValidation };
      }
    }

    if (!order.t.trigger) {
      this.pendingTriggerOrders.delete(oid);
      return { error: "Trigger order can only be modified with another trigger payload" };
    }

    this.pendingTriggerOrders.set(oid, {
      ...existing,
      isBuy: order.b,
      triggerPx: Number(order.t.trigger.triggerPx),
      isMarket: order.t.trigger.isMarket,
      tpsl: order.t.trigger.tpsl,
      size: Number(order.s),
      limitPx: Number.isFinite(Number(order.p)) ? Number(order.p) : undefined,
      reduceOnly: order.r,
      cloid: order.c ?? existing.cloid
    });

    return {
      resting: {
        oid,
        cloid: order.c ?? existing.cloid
      }
    };
  }

  private resolveExistingOrder(runtime: ApiRuntime, accountId: string, oid: number | string): OrderView | PendingTriggerOrder | undefined {
    if (typeof oid === "string" && oid.startsWith("0x")) {
      return runtime.getOrderByClientOrderId(accountId, oid)
        ?? [...this.pendingTriggerOrders.values()].find((entry) => entry.accountId === accountId && entry.cloid === oid);
    }

    const numericOid = Number(oid);
    return runtime.getOrders(accountId).find((entry) => entry.id === orderIdFromOid(numericOid))
      ?? this.pendingTriggerOrders.get(numericOid);
  }
}
