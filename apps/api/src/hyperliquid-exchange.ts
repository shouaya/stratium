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

type OrderGrouping = "na" | "normalTpsl" | "positionTpsl";

type ExchangeAction =
  | { type: "order"; orders: ExchangeOrderWire[]; grouping?: OrderGrouping }
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

interface TriggerOrderHistoryRecord extends PendingTriggerOrder {
  status: "waitingForParent" | "triggerPending" | "triggered" | "filled" | "canceled";
  actualTriggerPx?: number;
  updatedAt: number;
}

interface TriggerGroupMeta {
  groupId: string;
  grouping: "normalTpsl" | "positionTpsl";
  parentOrderId?: string;
  childOids: number[];
}

interface DeferredNormalTpslGroup {
  groupId: string;
  accountId: string;
  parentOrderId: string;
  childOids: number[];
}

export class HyperliquidExchangeCompat {
  private static readonly TRIGGER_OID_BASE = 1_000_000_000;

  private readonly scheduleTimers = new Map<string, NodeJS.Timeout>();

  private readonly scheduledCancelTimes = new Map<string, number | null>();

  private readonly fallbackPendingTriggerOrders = new Map<number, PendingTriggerOrder>();

  private readonly fallbackTriggerOrderHistory = new Map<number, TriggerOrderHistoryRecord>();

  private readonly triggerGroupByOid = new Map<number, TriggerGroupMeta>();

  private readonly deferredNormalTpslGroups = new Map<string, DeferredNormalTpslGroup>();

  private triggerOrderSequence = 1;

  private triggerLoop?: NodeJS.Timeout;

  private readonly store: {
    getNextTriggerOrderOid(base?: number): Promise<number>;
    upsertTriggerOrderHistory(input: TriggerOrderHistoryRecord): Promise<void>;
    listTriggerOrderHistory(accountId: string): Promise<TriggerOrderHistoryRecord[]>;
    listPendingTriggerOrders(): Promise<PendingTriggerOrder[]>;
    findTriggerOrder(accountId: string, oidOrCloid: number | string): Promise<TriggerOrderHistoryRecord | null>;
  };

  constructor(store?: {
    getNextTriggerOrderOid(base?: number): Promise<number>;
    upsertTriggerOrderHistory(input: TriggerOrderHistoryRecord): Promise<void>;
    listTriggerOrderHistory(accountId: string): Promise<TriggerOrderHistoryRecord[]>;
    listPendingTriggerOrders(): Promise<PendingTriggerOrder[]>;
    findTriggerOrder(accountId: string, oidOrCloid: number | string): Promise<TriggerOrderHistoryRecord | null>;
  }) {
    this.store = store ?? {
      getNextTriggerOrderOid: async (base = HyperliquidExchangeCompat.TRIGGER_OID_BASE) =>
        Math.max(base, ...[...this.fallbackTriggerOrderHistory.keys(), base]) + 1,
      upsertTriggerOrderHistory: async (input) => {
        this.fallbackTriggerOrderHistory.set(input.oid, input);
        if (input.status === "triggerPending") this.fallbackPendingTriggerOrders.set(input.oid, input);
        else this.fallbackPendingTriggerOrders.delete(input.oid);
      },
      listTriggerOrderHistory: async (accountId) => [...this.fallbackTriggerOrderHistory.values()].filter((order) => order.accountId === accountId),
      listPendingTriggerOrders: async () => [...this.fallbackPendingTriggerOrders.values()],
      findTriggerOrder: async (accountId, oidOrCloid) => {
        const order = typeof oidOrCloid === "string" && oidOrCloid.startsWith("0x")
          ? [...this.fallbackTriggerOrderHistory.values()].find((entry) => entry.accountId === accountId && entry.cloid === oidOrCloid)
          : this.fallbackTriggerOrderHistory.get(Number(oidOrCloid));
        return order && order.accountId === accountId ? order : null;
      }
    };
  }

  async handle(runtime: ApiRuntime, accountId: string, request: HyperliquidExchangeRequest) {
    this.bindRuntime(runtime);
    this.validateEnvelope(request);

    const action = request.action;
    if (!action) {
      throw new Error("Missing action");
    }

    switch (action.type) {
      case "order":
        return this.handleOrderAction(runtime, accountId, action.orders, action.grouping ?? "na");
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
  }

  async getVirtualOpenOrders(accountId: string) {
    const pendingOrders = await this.store.listPendingTriggerOrders();
    return pendingOrders
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
        grouping: this.triggerGroupByOid.get(order.oid)?.grouping,
        triggerCondition: {
          triggerPx: String(order.triggerPx),
          isMarket: order.isMarket,
          tpsl: order.tpsl
        }
      }));
  }

  async getVirtualOrderStatus(accountId: string, oidOrCloid: number | string) {
    const order = await this.store.findTriggerOrder(accountId, oidOrCloid);

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

  async getVirtualOrderHistory(accountId: string) {
    const history = await this.store.listTriggerOrderHistory(accountId);
    return history
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map((order) => ({
        coin: "BTC",
        side: order.isBuy ? "B" as const : "A" as const,
        limitPx: String(order.limitPx ?? order.triggerPx),
        sz: String(order.size),
        oid: order.oid,
        timestamp: order.createdAt,
        origSz: String(order.size),
        cloid: order.cloid,
        reduceOnly: order.reduceOnly,
        grouping: this.triggerGroupByOid.get(order.oid)?.grouping,
        status: order.status,
        statusTimestamp: order.updatedAt,
        triggerCondition: {
          triggerPx: order.status === "triggerPending" || order.status === "waitingForParent" ? "" : String(order.actualTriggerPx ?? order.triggerPx),
          isMarket: order.isMarket,
          tpsl: order.tpsl
        }
      }));
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

  private async handleOrderAction(
    runtime: ApiRuntime,
    accountId: string,
    orders: ExchangeOrderWire[],
    grouping: OrderGrouping
  ) {
    if (grouping === "normalTpsl") {
      return this.handleNormalTpslOrder(runtime, accountId, orders);
    }

    if (grouping === "positionTpsl") {
      return this.handlePositionTpslOrder(runtime, accountId, orders);
    }

    return this.handleOrder(runtime, accountId, orders);
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
        if (!order.r) {
          statuses.push({ error: "TP/SL trigger orders must be reduce-only." });
          continue;
        }

        statuses.push(await this.createTriggerOrder(accountId, order, {
          status: "triggerPending"
        }));
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

  private async handlePositionTpslOrder(runtime: ApiRuntime, accountId: string, orders: ExchangeOrderWire[]) {
    if (orders.length === 0 || orders.some((order) => !order.t.trigger)) {
      return buildOkResponse([{ error: "positionTpsl requires trigger orders only." }]);
    }

    const groupId = `positionTpsl-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const statuses = [];

    for (const order of orders) {
      if (!order.r) {
        statuses.push({ error: "positionTpsl orders must be reduce-only." });
        continue;
      }

      statuses.push(await this.createTriggerOrder(accountId, order, {
        status: "triggerPending",
        grouping: "positionTpsl",
        groupId
      }));
    }

    return buildOkResponse(statuses);
  }

  private async handleNormalTpslOrder(runtime: ApiRuntime, accountId: string, orders: ExchangeOrderWire[]) {
    const parentOrders = orders.filter((order) => !order.t.trigger);
    const childOrders = orders.filter((order) => Boolean(order.t.trigger));

    if (parentOrders.length !== 1 || childOrders.length === 0) {
      return buildOkResponse([{ error: "normalTpsl requires one parent order and at least one TP/SL child." }]);
    }

    if (childOrders.some((order) => !order.r)) {
      return buildOkResponse([{ error: "normalTpsl child orders must be reduce-only." }]);
    }

    const parentOrder = parentOrders[0] as ExchangeOrderWire;
    const parentResult = await this.handleOrder(runtime, accountId, [parentOrder]);
    const parentStatus = parentResult.response.data.statuses[0] as { error?: string; resting?: { oid: number; cloid?: string }; filled?: { oid: number } };

    if (parentStatus?.error) {
      return buildOkResponse([parentStatus, ...childOrders.map(() => ({ error: "Parent order was rejected." }))]);
    }

    const parentOid = parentStatus.resting?.oid ?? parentStatus.filled?.oid;
    const parentOrderId = parentOid != null ? orderIdFromOid(parentOid) : undefined;
    const createdParent = parentOrderId
      ? runtime.getOrders(accountId).find((entry) => entry.id === parentOrderId)
      : undefined;

    if (!createdParent) {
      return buildOkResponse([{ error: "Parent order was not created." }]);
    }

    const groupId = `normalTpsl-${createdParent.id}-${Date.now()}`;
    const childStatuses = [];

    for (const childOrder of childOrders) {
      childStatuses.push(await this.createTriggerOrder(accountId, childOrder, {
        status: createdParent.status === "FILLED" ? "triggerPending" : "waitingForParent",
        grouping: "normalTpsl",
        groupId,
        parentOrderId: createdParent.id
      }));
    }

    const waitingForParent = createdParent.status !== "FILLED";
    if (waitingForParent) {
      this.deferredNormalTpslGroups.set(createdParent.id, {
        groupId,
        accountId,
        parentOrderId: createdParent.id,
        childOids: childStatuses
          .map((status) => (status as { resting?: { oid?: number } }).resting?.oid)
          .filter((oid): oid is number => typeof oid === "number")
      });
    }

    return buildOkResponse([parentStatus, ...childStatuses]);
  }

  private async handleModify(runtime: ApiRuntime, accountId: string, oid: number | string, order: ExchangeOrderWire) {
    const target = await this.resolveExistingOrder(runtime, accountId, oid);
    if (!target) {
      return buildOkResponse([{ error: "Order does not exist." }]);
    }

    if ("triggerPx" in target) {
      return buildOkResponse([await this.modifyTriggerOrder(runtime, accountId, target.oid, order)]);
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

      const triggerOrder = await this.store.findTriggerOrder(accountId, cancel.o);
      if (triggerOrder && (triggerOrder.status === "triggerPending" || triggerOrder.status === "waitingForParent")) {
        await this.store.upsertTriggerOrderHistory({
          ...triggerOrder,
          status: "canceled",
          updatedAt: Date.now()
        });
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

      if (!rejected) {
        const deferredGroup = this.deferredNormalTpslGroups.get(orderId);
        if (deferredGroup) {
          await this.cancelDeferredNormalTpslGroup(deferredGroup);
          this.deferredNormalTpslGroups.delete(orderId);
        }
      }

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

      const triggerOrder = await this.store.findTriggerOrder(accountId, cancel.cloid);
      if (triggerOrder && (triggerOrder.status === "triggerPending" || triggerOrder.status === "waitingForParent")) {
        await this.store.upsertTriggerOrderHistory({
          ...triggerOrder,
          status: "canceled",
          updatedAt: Date.now()
        });
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

      if (!rejected) {
        const deferredGroup = this.deferredNormalTpslGroups.get(order.id);
        if (deferredGroup) {
          await this.cancelDeferredNormalTpslGroup(deferredGroup);
          this.deferredNormalTpslGroups.delete(order.id);
        }
      }

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
      void this.store.listPendingTriggerOrders().then((orders) => Promise.all(
        orders
          .filter((order) => order.accountId === accountId)
          .map((order) => this.store.upsertTriggerOrderHistory({
            ...(order as TriggerOrderHistoryRecord),
            status: "canceled",
            updatedAt: Date.now()
          }))
      ));
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
      void this.processInvalidReduceOnlyOrders(runtime);
      void this.processDeferredNormalTpslGroups(runtime);
      void this.processTriggerOrders(runtime);
    }, 500);
  }

  private async processInvalidReduceOnlyOrders(runtime: ApiRuntime) {
    for (const accountId of runtime.getAccountIds()) {
      const pendingOrders = (await this.store.listPendingTriggerOrders()).filter((order) => order.accountId === accountId);
      for (const order of pendingOrders) {
        const currentOrder = await this.store.findTriggerOrder(order.accountId, order.oid);
        if (!currentOrder || currentOrder.status !== "triggerPending") {
          continue;
        }

        const reduceOnlyValidation = order.reduceOnly
          ? this.validateReduceOnly(runtime, order.accountId, order.isBuy, order.size)
          : null;

        if (!reduceOnlyValidation) {
          continue;
        }

        await this.store.upsertTriggerOrderHistory({
          ...currentOrder,
          status: "canceled",
          updatedAt: Date.now()
        });
      }

      const triggerHistory = await this.store.listTriggerOrderHistory(accountId);
      const triggerHistoryByCloid = new Map(
        triggerHistory
          .filter((entry) => entry.cloid && entry.status === "triggered")
          .map((entry) => [entry.cloid as string, entry] as const)
      );

      for (const order of runtime.getOrders(accountId)) {
        if (!isOpenOrder(order) || !order.clientOrderId) {
          continue;
        }

        const linkedTrigger = triggerHistoryByCloid.get(order.clientOrderId);
        if (!linkedTrigger || !linkedTrigger.reduceOnly) {
          continue;
        }

        const reduceOnlyValidation = this.validateReduceOnly(runtime, accountId, linkedTrigger.isBuy, linkedTrigger.size);
        if (!reduceOnlyValidation) {
          continue;
        }

        const result = await runtime.cancelOrder({
          accountId,
          orderId: order.id,
          requestedAt: new Date().toISOString()
        });
        const rejected = result.events.find((event) => event.eventType === "OrderRejected");
        if (rejected) {
          continue;
        }

        await this.store.upsertTriggerOrderHistory({
          ...linkedTrigger,
          status: "canceled",
          updatedAt: Date.now()
        });
      }
    }
  }

  private async processDeferredNormalTpslGroups(runtime: ApiRuntime) {
    for (const [parentOrderId, group] of this.deferredNormalTpslGroups.entries()) {
      const parentOrder = runtime.getOrders(group.accountId).find((entry) => entry.id === parentOrderId);
      if (!parentOrder) {
        continue;
      }

      if (parentOrder.status === "FILLED") {
        await this.activateDeferredNormalTpslGroup(group, parentOrder.quantity);
        this.deferredNormalTpslGroups.delete(parentOrderId);
        continue;
      }

      if (parentOrder.status === "CANCELED" || parentOrder.status === "REJECTED") {
        await this.cancelDeferredNormalTpslGroup(group);
        this.deferredNormalTpslGroups.delete(parentOrderId);
      }
    }
  }

  private async processTriggerOrders(runtime: ApiRuntime) {
    const pendingOrders = await this.store.listPendingTriggerOrders();
    if (pendingOrders.length === 0) {
      return;
    }

    const market = runtime.getMarketData();
    const referencePrice = market.markPrice ?? market.bestBid ?? market.bestAsk;
    if (!referencePrice) {
      return;
    }

    for (const order of pendingOrders) {
      const oid = order.oid;
      const currentOrder = await this.store.findTriggerOrder(order.accountId, oid);
      if (!currentOrder || currentOrder.status !== "triggerPending") {
        continue;
      }
      const shouldTrigger = this.shouldTriggerOrder(order, referencePrice);

      if (!shouldTrigger) {
        continue;
      }

      const reduceOnlyValidation = order.reduceOnly
        ? this.validateReduceOnly(runtime, order.accountId, order.isBuy, order.size)
        : null;

      if (reduceOnlyValidation) {
        await this.store.upsertTriggerOrderHistory({
          ...(await this.store.findTriggerOrder(order.accountId, oid) as TriggerOrderHistoryRecord),
          status: "canceled",
          updatedAt: Date.now()
        });
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

      const history = await this.store.findTriggerOrder(order.accountId, oid);
      if (history) {
        await this.store.upsertTriggerOrderHistory({
          ...history,
          status: order.isMarket ? "filled" : "triggered",
          actualTriggerPx: referencePrice,
          updatedAt: Date.now()
        });
        await this.cancelOpposingTriggerOrders(history);
      }
    }
  }

  private async cancelOpposingTriggerOrders(triggeredOrder: TriggerOrderHistoryRecord) {
    const groupMeta = this.triggerGroupByOid.get(triggeredOrder.oid);
    if (!groupMeta) {
      return;
    }

    await Promise.all(groupMeta.childOids
      .filter((oid) => oid !== triggeredOrder.oid)
      .map(async (oid) => {
        const history = await this.store.findTriggerOrder(triggeredOrder.accountId, oid);
      if (!history || history.status !== "triggerPending") {
        return;
      }

      await this.store.upsertTriggerOrderHistory({
        ...history,
        status: "canceled",
        updatedAt: Date.now()
      });
    }));
  }

  private shouldTriggerOrder(order: PendingTriggerOrder, referencePrice: number) {
    if (order.tpsl === "tp") {
      return order.isBuy
        ? referencePrice <= order.triggerPx
        : referencePrice >= order.triggerPx;
    }

    return order.isBuy
      ? referencePrice >= order.triggerPx
      : referencePrice <= order.triggerPx;
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

  private async activateDeferredNormalTpslGroup(group: DeferredNormalTpslGroup, size: number) {
    for (const oid of group.childOids) {
      const order = await this.store.findTriggerOrder(group.accountId, oid);
      if (!order || order.status !== "waitingForParent") {
        continue;
      }

      await this.store.upsertTriggerOrderHistory({
        ...order,
        size,
        status: "triggerPending",
        updatedAt: Date.now()
      });
    }
  }

  private async cancelDeferredNormalTpslGroup(group: DeferredNormalTpslGroup) {
    for (const oid of group.childOids) {
      const order = await this.store.findTriggerOrder(group.accountId, oid);
      if (!order || order.status !== "waitingForParent") {
        continue;
      }

      await this.store.upsertTriggerOrderHistory({
        ...order,
        status: "canceled",
        updatedAt: Date.now()
      });
    }
  }

  private async createTriggerOrder(
    accountId: string,
    order: ExchangeOrderWire,
    options?: {
      status?: TriggerOrderHistoryRecord["status"];
      grouping?: "normalTpsl" | "positionTpsl";
      groupId?: string;
      parentOrderId?: string;
    }
  ) {
    if (!order.t.trigger) {
      return { error: "Trigger order payload missing" };
    }

    const oid = await this.store.getNextTriggerOrderOid(HyperliquidExchangeCompat.TRIGGER_OID_BASE + this.triggerOrderSequence - 1);
    this.triggerOrderSequence = Math.max(this.triggerOrderSequence + 1, oid - HyperliquidExchangeCompat.TRIGGER_OID_BASE + 1);
    const createdAt = Date.now();
    await this.store.upsertTriggerOrderHistory({
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
      createdAt,
      status: options?.status ?? "triggerPending",
      updatedAt: createdAt
    });

    if (options?.grouping && options.groupId) {
      const existingGroup = this.triggerGroupByOid.get(oid);
      this.triggerGroupByOid.set(oid, {
        groupId: options.groupId,
        grouping: options.grouping,
        parentOrderId: options.parentOrderId,
        childOids: existingGroup?.childOids ?? []
      });
    }

    if (options?.grouping && options.groupId) {
      const siblingOids = [...this.triggerGroupByOid.entries()]
        .filter(([, value]) => value.groupId === options.groupId)
        .map(([triggerOid]) => triggerOid);
      for (const triggerOid of siblingOids) {
        const current = this.triggerGroupByOid.get(triggerOid);
        if (!current) {
          continue;
        }
        this.triggerGroupByOid.set(triggerOid, {
          ...current,
          childOids: siblingOids
        });
      }
    }

    return {
      resting: {
        oid,
        cloid: order.c
      }
    };
  }

  private async modifyTriggerOrder(runtime: ApiRuntime, accountId: string, oid: number, order: ExchangeOrderWire) {
    const existing = await this.store.findTriggerOrder(accountId, oid);
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
      return { error: "Trigger order can only be modified with another trigger payload" };
    }

    await this.store.upsertTriggerOrderHistory({
      ...existing,
      isBuy: order.b,
      triggerPx: Number(order.t.trigger.triggerPx),
      isMarket: order.t.trigger.isMarket,
      tpsl: order.t.trigger.tpsl,
      size: Number(order.s),
      limitPx: Number.isFinite(Number(order.p)) ? Number(order.p) : undefined,
      reduceOnly: order.r,
      cloid: order.c ?? existing.cloid,
      updatedAt: Date.now()
    });

    return {
      resting: {
        oid,
        cloid: order.c ?? existing.cloid
      }
    };
  }

  private async resolveExistingOrder(runtime: ApiRuntime, accountId: string, oid: number | string): Promise<OrderView | PendingTriggerOrder | undefined> {
    if (typeof oid === "string" && oid.startsWith("0x")) {
      return runtime.getOrderByClientOrderId(accountId, oid)
        ?? await this.store.findTriggerOrder(accountId, oid) ?? undefined;
    }

    const numericOid = Number(oid);
    return runtime.getOrders(accountId).find((entry) => entry.id === orderIdFromOid(numericOid))
      ?? await this.store.findTriggerOrder(accountId, numericOid) ?? undefined;
  }
}
