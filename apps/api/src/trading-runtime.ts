import type { FastifyBaseLogger } from "fastify";
import type { AnyEventEnvelope, CancelOrderInput, CreateOrderInput, MarketTick, OrderView, TradingSymbolConfig } from "@stratium/shared";
import { TradingEngine, createInitialTradingState, replayEventsFromState } from "@stratium/trading-core";
import type { SymbolConfigState } from "./market-runtime.js";
import { TradingRepository } from "./repository.js";

const validateManualTick = (
  tick: MarketTick,
  referenceTick: MarketTick | undefined,
  expectedSymbol: string
): string | null => {
  if (tick.symbol !== expectedSymbol) {
    return "Manual tick symbol does not match the active market symbol.";
  }

  if (![tick.bid, tick.ask, tick.last, tick.spread].every((value) => Number.isFinite(value) && value > 0)) {
    return "Manual tick requires positive bid, ask, last, and spread values.";
  }

  if (tick.bid >= tick.ask) {
    return "Manual tick requires bid lower than ask.";
  }

  const impliedSpread = Number((tick.ask - tick.bid).toFixed(8));

  if (Math.abs(impliedSpread - tick.spread) > Math.max(0.01, impliedSpread * 0.2)) {
    return "Manual tick spread does not match bid/ask.";
  }

  if (tick.last < tick.bid || tick.last > tick.ask) {
    return "Manual tick last price must stay between bid and ask.";
  }

  if (referenceTick) {
    const divergence = Math.abs(tick.last - referenceTick.last) / referenceTick.last;

    if (divergence > 0.05) {
      return "Manual tick last price is too far from the current market.";
    }
  }

  return null;
};

interface BootstrapTradingRuntimeInput {
  frontendAccountIds: string[];
  persistedSymbolConfig: TradingSymbolConfig | null;
}

interface TradingRuntimeOptions {
  logger: FastifyBaseLogger;
  repository: TradingRepository;
  onEvents: (accountId: string, events: AnyEventEnvelope[]) => void;
}

interface AccountRuntimeSlot {
  accountId: string;
  sessionId: string;
  engine: TradingEngine;
  eventStore: AnyEventEnvelope[];
  persistQueue: Promise<void>;
  lastSnapshotMinuteKey: string | null;
}

interface PositionReplaySegment {
  fillIds: Set<string>;
  orderIds: Set<string>;
  fillEvents: AnyEventEnvelope[];
}

interface PositionReplayResolution {
  fills: AnyEventEnvelope[];
  events: AnyEventEnvelope[];
  marketEvents: AnyEventEnvelope[];
  replayableEvents?: AnyEventEnvelope[];
  state?: ReturnType<TradingEngine["getState"]>;
}

const createSessionId = (accountId: string): string => `session-${accountId}`;
const BOOTSTRAP_SNAPSHOT_MINUTE_KEY = "bootstrap";
const toMinuteKey = (value: string): string => value.slice(0, 16);
const resolveSnapshotMinuteKey = (
  state: ReturnType<TradingEngine["getState"]>,
  events: AnyEventEnvelope[]
): string | null => {
  const timestamp = events[events.length - 1]?.occurredAt ?? state.latestTick?.tickTime;

  return timestamp ? toMinuteKey(timestamp) : null;
};
const eventsToSorted = (events: AnyEventEnvelope[]): AnyEventEnvelope[] =>
  [...events].sort((left, right) => left.sequence - right.sequence);

export class TradingRuntime {
  private static readonly DEFAULT_RECENT_EVENT_LIMIT = 500;
  private static readonly DEFAULT_RECENT_TICK_LIMIT = 240;

  private readonly accountRuntimes = new Map<string, AccountRuntimeSlot>();

  private bootstrapReady = false;

  private symbolConfig: TradingSymbolConfig | null = null;

  constructor(private readonly options: TradingRuntimeOptions) {}

  getAccountIds(): string[] {
    return [...this.accountRuntimes.keys()];
  }

  getPrimaryAccountId(): string | null {
    return this.accountRuntimes.keys().next().value ?? null;
  }

  getEngine(accountId?: string) {
    return this.getRequiredRuntime(accountId).engine;
  }

  getEngineState(accountId?: string) {
    return this.getRequiredRuntime(accountId).engine.getState();
  }

  getEventStore(accountId?: string) {
    return this.getRequiredRuntime(accountId).eventStore;
  }

  getFillHistoryEvents(accountId?: string) {
    return this.getRequiredRuntime(accountId).eventStore.filter(
      (event) => event.eventType === "OrderFilled" || event.eventType === "OrderPartiallyFilled"
    );
  }

  getRecentEventStore(accountId?: string, limit = TradingRuntime.DEFAULT_RECENT_EVENT_LIMIT) {
    const eventStore = this.getRequiredRuntime(accountId).eventStore;

    if (limit <= 0 || eventStore.length <= limit) {
      return eventStore;
    }

    const marketTicks = eventStore
      .filter((event) => event.eventType === "MarketTickReceived")
      .slice(-Math.min(limit, TradingRuntime.DEFAULT_RECENT_TICK_LIMIT));
    const nonMarketEvents = eventStore.filter((event) => event.eventType !== "MarketTickReceived");
    const merged = [...nonMarketEvents, ...marketTicks].sort((left, right) => left.sequence - right.sequence);

    if (merged.length <= limit) {
      return merged;
    }

    return merged.slice(-limit);
  }

  getReplayState(accountId: string) {
    return this.getRequiredRuntime(accountId).engine.getState();
  }

  async getReplayData(accountId: string, sessionId: string): Promise<{
    initialState: ReturnType<typeof createInitialTradingState>;
    state: ReturnType<TradingEngine["getState"]>;
    events: AnyEventEnvelope[];
  }> {
    const runtime = this.getRequiredRuntime(accountId);

    if (runtime.sessionId !== sessionId) {
      throw new Error(`Replay session ${sessionId} is not available for account ${accountId}.`);
    }

    const persistedSnapshot = await this.options.repository.loadSimulationSnapshot(sessionId);
    const persistedEvents = await this.options.repository.loadEvents(sessionId, persistedSnapshot?.lastSequence);
    const engineOptions = {
      sessionId,
      accountId,
      symbolConfig: this.symbolConfig ?? undefined
    };
    const initialState = persistedSnapshot?.state ?? createInitialTradingState(engineOptions);
    const replay = replayEventsFromState(initialState, persistedEvents);

    return {
      initialState,
      state: replay.state,
      events: replay.events
    };
  }

  async getPositionReplayData(accountId: string, fillId: string): Promise<{
    sessionId: string;
    fills: AnyEventEnvelope[];
    events: AnyEventEnvelope[];
    marketEvents: AnyEventEnvelope[];
    state: ReturnType<TradingEngine["getState"]>;
  }> {
    const runtime = this.getRequiredRuntime(accountId);
    const engineOptions = {
      sessionId: runtime.sessionId,
      accountId,
      symbolConfig: this.symbolConfig ?? undefined
    };
    const replay = await this.getReplayData(accountId, runtime.sessionId);
    const persistedReplay = this.resolvePositionReplay(eventsToSorted(replay.events), fillId);

    if (persistedReplay) {
      return {
        sessionId: runtime.sessionId,
        fills: persistedReplay.fills,
        events: persistedReplay.events,
        marketEvents: persistedReplay.marketEvents,
        state: replayEventsFromState(replay.initialState, persistedReplay.replayableEvents ?? []).state
      };
    }

    const liveReplay = this.resolvePositionReplay(eventsToSorted(runtime.eventStore), fillId);

    if (liveReplay) {
      return {
        sessionId: runtime.sessionId,
        fills: liveReplay.fills,
        events: liveReplay.events,
        marketEvents: liveReplay.marketEvents,
        state: replayEventsFromState(
          createInitialTradingState(engineOptions),
          liveReplay.replayableEvents ?? []
        ).state
      };
    }

    const persistedHistoryReplay = await this.resolvePersistedPositionReplay(accountId, fillId);

    if (!persistedHistoryReplay) {
      throw new Error(`Completed position replay not found for fill ${fillId}.`);
    }

    return {
      sessionId: runtime.sessionId,
      fills: persistedHistoryReplay.fills,
      events: persistedHistoryReplay.events,
      marketEvents: persistedHistoryReplay.marketEvents,
      state: persistedHistoryReplay.state ?? runtime.engine.getState()
    };
  }

  private resolvePositionReplay(
    events: AnyEventEnvelope[],
    fillId: string,
    orderSideMap = new Map<string, OrderView["side"]>()
  ): PositionReplayResolution | null {
    const orderMap = new Map(
      events
        .filter((event) => event.eventType === "OrderRequested")
        .map((event) => [event.payload.orderId, event.payload])
    );
    const fillEvents = events.filter((event) => event.eventType === "OrderFilled" || event.eventType === "OrderPartiallyFilled");

    let signedPositionQuantity = 0;
    let activeSegment: PositionReplaySegment | null = null;
    const segments: PositionReplaySegment[] = [];

    for (const event of fillEvents) {
      const payload = event.payload;
      const order = orderMap.get(payload.orderId);
      const orderSide = order?.side ?? orderSideMap.get(payload.orderId) ?? "buy";
      const signedFillQuantity = orderSide === "buy"
        ? payload.fillQuantity
        : -payload.fillQuantity;
      const nextSignedQuantity = signedPositionQuantity + signedFillQuantity;
      const closesPosition = signedPositionQuantity !== 0
        && (nextSignedQuantity === 0 || Math.sign(nextSignedQuantity) !== Math.sign(signedPositionQuantity));

      if (!activeSegment && nextSignedQuantity !== 0) {
        activeSegment = {
          fillIds: new Set<string>(),
          orderIds: new Set<string>(),
          fillEvents: []
        };
      }

      if (activeSegment) {
        activeSegment.fillIds.add(payload.fillId);
        activeSegment.orderIds.add(payload.orderId);
        activeSegment.fillEvents.push(event);
      }

      signedPositionQuantity = nextSignedQuantity;

      if (activeSegment && closesPosition) {
        segments.push(activeSegment);
        activeSegment = nextSignedQuantity === 0 ? null : {
          fillIds: new Set<string>([payload.fillId]),
          orderIds: new Set<string>([payload.orderId]),
          fillEvents: [event]
        };
      }
    }

    const segment = segments.find((entry) => entry.fillIds.has(fillId));

    if (!segment) {
      return null;
    }

    const relatedOrderEvents = events.filter((event) => {
      if (event.eventType === "MarketTickReceived" || !event.payload || typeof event.payload !== "object") {
        return false;
      }

      return "orderId" in event.payload && segment.orderIds.has((event.payload as { orderId?: string }).orderId ?? "");
    });
    const sequenceFloor = Math.min(
      segment.fillEvents[0]?.sequence ?? Number.MAX_SAFE_INTEGER,
      ...relatedOrderEvents.map((event) => event.sequence)
    );
    const sequenceCeiling = segment.fillEvents[segment.fillEvents.length - 1]?.sequence ?? 0;
    const replayableEvents = events.filter((event) => event.sequence <= sequenceCeiling);

    return {
      fills: segment.fillEvents,
      events: events.filter((event) =>
        event.eventType !== "MarketTickReceived"
        && event.sequence >= sequenceFloor
        && event.sequence <= sequenceCeiling
      ),
      marketEvents: events.filter((event) =>
        event.eventType === "MarketTickReceived"
        && event.sequence >= sequenceFloor
        && event.sequence <= sequenceCeiling
      ),
      replayableEvents
    };
  }

  private async resolvePersistedPositionReplay(accountId: string, fillId: string): Promise<PositionReplayResolution | null> {
    const persistedFillEvents = eventsToSorted(await this.options.repository.listFillHistoryEvents(accountId));
    if (persistedFillEvents.length === 0) {
      return null;
    }

    const persistedOrders = await this.options.repository.listOrderHistoryViews(accountId);
    const replay = this.resolvePositionReplay(
      persistedFillEvents,
      fillId,
      new Map(persistedOrders.map((order) => [order.id, order.side]))
    );

    if (!replay) {
      return null;
    }

    const relatedOrders = persistedOrders.filter((order) =>
      replay.fills.some((event) => (event.payload as { orderId?: string }).orderId === order.id)
    );
    const syntheticOrderEvents = relatedOrders.map((order, index) => this.createSyntheticOrderRequestedEvent(order, index + 1));
    const startAt = syntheticOrderEvents[0]?.occurredAt ?? replay.fills[0]?.occurredAt;
    const endAt = replay.fills[replay.fills.length - 1]?.occurredAt ?? startAt;
    const symbol = replay.fills[0]?.symbol ?? relatedOrders[0]?.symbol;
    const marketEvents = symbol && startAt && endAt
      ? await this.options.repository.listMarketTickEvents(symbol, startAt, endAt)
      : [];
    const timelineEvents = [...syntheticOrderEvents, ...replay.fills].sort((left, right) => {
      const timeDelta = new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime();
      if (timeDelta !== 0) {
        return timeDelta;
      }

      if (left.eventType === right.eventType) {
        return left.sequence - right.sequence;
      }

      return left.eventType === "OrderRequested" ? -1 : 1;
    }).map((event, index) => ({ ...event, sequence: index + 1 })) as AnyEventEnvelope[];

    const engineState = this.getRequiredRuntime(accountId).engine.getState();

    return {
      fills: replay.fills,
      events: timelineEvents,
      marketEvents,
      state: {
        ...engineState,
        position: {
          ...engineState.position,
          side: "flat",
          quantity: 0,
          averageEntryPrice: 0,
          initialMargin: 0,
          maintenanceMargin: 0,
          liquidationPrice: 0
        }
      }
    };
  }

  private createSyntheticOrderRequestedEvent(order: OrderView, sequence: number): AnyEventEnvelope {
    return {
      eventId: `persisted-order-${order.id}`,
      eventType: "OrderRequested",
      occurredAt: order.createdAt,
      sequence,
      simulationSessionId: `persisted-${order.accountId}`,
      accountId: order.accountId,
      symbol: order.symbol,
      source: "replay",
      payload: {
        orderId: order.id,
        clientOrderId: order.clientOrderId,
        side: order.side,
        orderType: order.orderType,
        quantity: order.quantity,
        limitPrice: order.limitPrice,
        submittedAt: order.createdAt
      }
    };
  }

  async bootstrap(input: BootstrapTradingRuntimeInput): Promise<void> {
    this.bootstrapReady = false;
    this.symbolConfig = input.persistedSymbolConfig;

    for (const accountId of input.frontendAccountIds) {
      await this.ensureAccountRuntime(accountId);
    }
  }

  async ensureFrontendAccount(accountId: string): Promise<void> {
    await this.ensureAccountRuntime(accountId);
  }

  async setBootstrapReady(value: boolean): Promise<void> {
    this.bootstrapReady = value;

    if (!value) {
      return;
    }

    await Promise.all(this.getAccountIds().map(async (accountId) => {
      const runtime = this.getRequiredRuntime(accountId);

      if (runtime.eventStore.length === 0) {
        await this.persistState(runtime, []);
      }
    }));
  }

  async flushPersistence(): Promise<void> {
    await Promise.all(
      [...this.accountRuntimes.values()].map((runtime) => runtime.persistQueue.catch(() => undefined))
    );
  }

  async handleLiveTick(tick: MarketTick): Promise<void> {
    await Promise.all(
      [...this.accountRuntimes.values()].map(async (runtime) => {
        const result = runtime.engine.ingestMarketTick(tick);
        await this.persistEvents(runtime, result.events);
      })
    );
  }

  async submitOrder(input: CreateOrderInput) {
    const runtime = await this.ensureAccountRuntime(input.accountId);
    const result = runtime.engine.submitOrder(input);
    await this.persistEvents(runtime, result.events);
    return result;
  }

  async cancelOrder(input: CancelOrderInput) {
    const runtime = await this.ensureAccountRuntime(input.accountId);
    const result = runtime.engine.cancelOrder(input);
    await this.persistEvents(runtime, result.events);
    return result;
  }

  getOrders(accountId: string) {
    return this.getRequiredRuntime(accountId).engine.getState().orders;
  }

  getOrderByClientOrderId(accountId: string, clientOrderId: string) {
    return this.getRequiredRuntime(accountId).engine.getState().orders.find((order) => order.clientOrderId === clientOrderId);
  }

  async cancelAllOpenOrders(accountId: string, requestedAt?: string) {
    const openOrders = this.getRequiredRuntime(accountId).engine.getState().orders
      .filter((order) => order.status === "ACCEPTED" || order.status === "PARTIALLY_FILLED");

    const results = [];
    for (const order of openOrders) {
      results.push(await this.cancelOrder({
        accountId,
        orderId: order.id,
        requestedAt
      }));
    }

    return results;
  }

  async ingestManualTick(
    tick: MarketTick,
    expectedSymbol: string
  ): Promise<
    | { ok: true; result: ReturnType<TradingEngine["ingestMarketTick"]> }
    | { ok: false; message: string }
  > {
    const primaryRuntime = this.getRequiredRuntime();
    const validationError = validateManualTick(tick, primaryRuntime.engine.getState().latestTick, expectedSymbol);

    if (validationError) {
      return {
        ok: false,
        message: validationError
      };
    }

    let primaryResult: ReturnType<TradingEngine["ingestMarketTick"]> | null = null;

    for (const runtime of this.accountRuntimes.values()) {
      const result = runtime.engine.ingestMarketTick(tick);
      await this.persistEvents(runtime, result.events);

      if (!primaryResult) {
        primaryResult = result;
      }
    }

    return {
      ok: true,
      result: primaryResult ?? primaryRuntime.engine.ingestMarketTick(tick)
    };
  }

  async updateLeverage(symbolConfigState: SymbolConfigState, leverage: number): Promise<SymbolConfigState> {
    this.symbolConfig = this.symbolConfig
      ? { ...this.symbolConfig, leverage }
      : { symbol: symbolConfigState.symbol, leverage, maintenanceMarginRate: 0.05, takerFeeRate: 0.0005, makerFeeRate: 0.00015, baseSlippageBps: 5, partialFillEnabled: false };

    for (const runtime of this.accountRuntimes.values()) {
      runtime.engine.setLeverage(leverage);
      await this.persistState(runtime, []);
    }

    await this.options.repository.updateSymbolLeverage(symbolConfigState.symbol, leverage);

    return {
      ...symbolConfigState,
      leverage
    };
  }

  async persistExternalEvents(accountId: string, events: AnyEventEnvelope[]): Promise<void> {
    await this.persistEvents(this.getRequiredRuntime(accountId), events);
  }

  private getRequiredRuntime(accountId?: string): AccountRuntimeSlot {
    const resolvedAccountId = accountId ?? this.getPrimaryAccountId();

    if (!resolvedAccountId) {
      throw new Error("No trading account runtime is available.");
    }

    const runtime = this.accountRuntimes.get(resolvedAccountId);

    if (!runtime) {
      throw new Error(`Trading account runtime ${resolvedAccountId} is not initialized.`);
    }

    return runtime;
  }

  private async ensureAccountRuntime(accountId: string): Promise<AccountRuntimeSlot> {
    const existing = this.accountRuntimes.get(accountId);

    if (existing) {
      return existing;
    }

    const sessionId = createSessionId(accountId);
    const persistedSnapshot = await this.options.repository.loadSimulationSnapshot(sessionId);
    const persistedEvents = await this.options.repository.loadEvents(sessionId, persistedSnapshot?.lastSequence);
    const engineOptions = {
      sessionId,
      accountId,
      symbolConfig: this.symbolConfig ?? undefined
    };
    const initialState = persistedSnapshot?.state ?? createInitialTradingState(engineOptions);
    const slot: AccountRuntimeSlot = {
      accountId,
      sessionId,
      engine: persistedEvents.length > 0
        ? new TradingEngine(replayEventsFromState(initialState, persistedEvents).state, engineOptions)
        : new TradingEngine(initialState, engineOptions),
      eventStore: [...persistedEvents],
      persistQueue: Promise.resolve(),
      lastSnapshotMinuteKey: persistedSnapshot ? toMinuteKey(persistedSnapshot.updatedAt) : null
    };

    this.accountRuntimes.set(accountId, slot);

    if (this.bootstrapReady && persistedEvents.length === 0) {
      await this.persistState(slot, []);
    }

    return slot;
  }

  private async persistEvents(runtime: AccountRuntimeSlot, events: AnyEventEnvelope[]): Promise<void> {
    for (const event of events) {
      runtime.eventStore.push(event);
    }
    this.pruneRuntimeEventStore(runtime);

    runtime.persistQueue = runtime.persistQueue
      .then(async () => {
        if (!this.bootstrapReady) {
          return;
        }

        await this.persistState(runtime, events);
      })
      .catch((error: unknown) => {
        this.options.logger.error({ error, accountId: runtime.accountId }, "Failed to persist trading state");
      });
    await runtime.persistQueue;

    if (events.length === 0) {
      return;
    }

    this.options.onEvents(runtime.accountId, events);
  }

  private async persistState(runtime: AccountRuntimeSlot, events: AnyEventEnvelope[]): Promise<void> {
    const state = runtime.engine.getState();
    const snapshotMinuteKey = resolveSnapshotMinuteKey(state, events) ?? BOOTSTRAP_SNAPSHOT_MINUTE_KEY;
    const persistSnapshot = runtime.lastSnapshotMinuteKey !== snapshotMinuteKey;

    await this.options.repository.persistState(state, events, persistSnapshot);

    if (persistSnapshot) {
      runtime.lastSnapshotMinuteKey = snapshotMinuteKey;
    }
  }

  private pruneRuntimeEventStore(runtime: AccountRuntimeSlot): void {
    const marketTickEvents = runtime.eventStore.filter((event) => event.eventType === "MarketTickReceived");

    if (marketTickEvents.length <= TradingRuntime.DEFAULT_RECENT_TICK_LIMIT) {
      return;
    }

    const retainedTickSequenceFloor = marketTickEvents[marketTickEvents.length - TradingRuntime.DEFAULT_RECENT_TICK_LIMIT]?.sequence ?? 0;

    runtime.eventStore = runtime.eventStore.filter((event) =>
      event.eventType !== "MarketTickReceived" || event.sequence >= retainedTickSequenceFloor
    );
  }
}
