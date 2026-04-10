import type { AnyEventEnvelope, OrderView } from "@stratium/shared";

export interface HyperliquidPrivateSocketLike {
  send(message: string): void;
  on?(event: "close" | "message", listener: (...args: unknown[]) => void): void;
}

type SubscriptionType = "orderUpdates" | "userFills" | "userEvents";

interface SocketSubscription {
  type: SubscriptionType;
  user: string;
}

interface SocketState {
  socket: HyperliquidPrivateSocketLike;
  accountId: string;
  subscriptions: SocketSubscription[];
}

interface PrivateWsRuntime {
  getOrders(accountId: string): OrderView[];
  getFillHistoryEvents(accountId: string): AnyEventEnvelope[];
  getEventStore(accountId: string): AnyEventEnvelope[];
}

const isActiveOrder = (order: OrderView) =>
  order.status === "NEW" || order.status === "ACCEPTED" || order.status === "PARTIALLY_FILLED";

const mapOrderUpdate = (order: OrderView) => ({
  order: {
    coin: order.symbol.split("-")[0] ?? order.symbol,
    side: order.side === "buy" ? "B" : "A",
    limitPx: String(order.limitPrice ?? order.averageFillPrice ?? 0),
    sz: String(order.quantity),
    oid: Number(order.id.replace(/^ord_/, "")),
    timestamp: new Date(order.createdAt).getTime(),
    origSz: String(order.quantity),
    cloid: order.clientOrderId
  },
  status: order.status,
  statusTimestamp: new Date(order.updatedAt).getTime()
});

const mapFill = (event: AnyEventEnvelope) => {
  const payload = event.payload as {
    orderId: string;
    fillId: string;
    fillPrice: number;
    fillQuantity: number;
    fee: number;
    filledAt: string;
  };

  return {
    coin: event.symbol.split("-")[0] ?? event.symbol,
    px: String(payload.fillPrice),
    sz: String(payload.fillQuantity),
    side: "side" in payload ? String((payload as { side?: string }).side ?? "") : undefined,
    time: new Date(payload.filledAt).getTime(),
    startPosition: "0",
    dir: "unknown",
    closedPnl: "0",
    hash: "0x0000000000000000000000000000000000000000000000000000000000000000",
    oid: Number(payload.orderId.replace(/^ord_/, "")),
    crossed: false,
    fee: String(payload.fee),
    tid: Number(payload.fillId.replace(/^fill_/, "")) || 0,
    cloid: undefined
  };
};

const mapUserEvent = (event: AnyEventEnvelope) => ({
  eventType: event.eventType,
  eventId: event.eventId,
  symbol: event.symbol,
  occurredAt: event.occurredAt,
  payload: event.payload
});

export class HyperliquidPrivateWsHub {
  private readonly sockets = new Map<HyperliquidPrivateSocketLike, SocketState>();

  constructor(private readonly runtime: PrivateWsRuntime) {}

  addSocket(socket: HyperliquidPrivateSocketLike, accountId: string): void {
    const state: SocketState = {
      socket,
      accountId,
      subscriptions: []
    };

    this.sockets.set(socket, state);
    socket.on?.("close", () => {
      this.sockets.delete(socket);
    });
  }

  handleMessage(socket: HyperliquidPrivateSocketLike, raw: string): void {
    const state = this.sockets.get(socket);
    if (!state) {
      return;
    }

    const message = JSON.parse(raw) as {
      method?: string;
      subscription?: {
        type?: SubscriptionType;
        user?: string;
      };
    };

    if (message.method !== "subscribe" || !message.subscription?.type || !message.subscription.user) {
      return;
    }

    const subscription: SocketSubscription = {
      type: message.subscription.type,
      user: message.subscription.user
    };

    state.subscriptions = [
      ...state.subscriptions.filter((entry) => !(entry.type === subscription.type && entry.user === subscription.user)),
      subscription
    ];

    this.sendSnapshot(state, subscription);
  }

  broadcast(accountId: string | undefined, events: AnyEventEnvelope[]): void {
    if (!accountId) {
      return;
    }

    for (const state of this.sockets.values()) {
      if (state.accountId !== accountId) {
        continue;
      }

      for (const subscription of state.subscriptions) {
        this.sendEventBatch(state, subscription, events);
      }
    }
  }

  private sendSnapshot(state: SocketState, subscription: SocketSubscription) {
    if (subscription.type === "orderUpdates") {
      const data = this.runtime.getOrders(state.accountId)
        .filter(isActiveOrder)
        .map(mapOrderUpdate);
      state.socket.send(JSON.stringify({ channel: "orderUpdates", data }));
      return;
    }

    if (subscription.type === "userFills") {
      const data = this.runtime.getFillHistoryEvents(state.accountId).map(mapFill);
      state.socket.send(JSON.stringify({ channel: "userFills", data }));
      return;
    }

    if (subscription.type === "userEvents") {
      const data = this.runtime.getEventStore(state.accountId)
        .filter((event) => event.eventType !== "MarketTickReceived")
        .map(mapUserEvent);
      state.socket.send(JSON.stringify({ channel: "userEvents", data }));
    }
  }

  private sendEventBatch(state: SocketState, subscription: SocketSubscription, events: AnyEventEnvelope[]) {
    if (events.length === 0) {
      return;
    }

    if (subscription.type === "orderUpdates") {
      const touchedOrderIds = new Set(
        events
          .map((event) => ("orderId" in (event.payload as object) ? (event.payload as { orderId?: string }).orderId : undefined))
          .filter((value): value is string => Boolean(value))
      );
      const data = this.runtime.getOrders(state.accountId)
        .filter((order) => touchedOrderIds.has(order.id))
        .map(mapOrderUpdate);
      if (data.length > 0) {
        state.socket.send(JSON.stringify({ channel: "orderUpdates", data }));
      }
      return;
    }

    if (subscription.type === "userFills") {
      const data = events
        .filter((event) => event.eventType === "OrderFilled" || event.eventType === "OrderPartiallyFilled")
        .map(mapFill);
      if (data.length > 0) {
        state.socket.send(JSON.stringify({ channel: "userFills", data }));
      }
      return;
    }

    if (subscription.type === "userEvents") {
      const data = events
        .filter((event) => event.eventType !== "MarketTickReceived")
        .map(mapUserEvent);
      if (data.length > 0) {
        state.socket.send(JSON.stringify({ channel: "userEvents", data }));
      }
    }
  }
}
