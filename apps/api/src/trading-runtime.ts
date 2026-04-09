import type { FastifyBaseLogger } from "fastify";
import type { AnyEventEnvelope, CancelOrderInput, CreateOrderInput, MarketTick, TradingSymbolConfig } from "@stratium/shared";
import { TradingEngine, createInitialTradingState, replayEvents } from "@stratium/trading-core";
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
}

const createSessionId = (accountId: string): string => `session-${accountId}`;

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
    const runtime = this.getRequiredRuntime(accountId);
    return replayEvents(runtime.eventStore, { sessionId: runtime.sessionId }).state;
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
        await this.options.repository.persistState(runtime.engine.getState(), []);
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
      await this.options.repository.persistState(runtime.engine.getState(), []);
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
    const persistedEvents = await this.options.repository.loadEvents(sessionId);
    const engineOptions = {
      sessionId,
      accountId,
      symbolConfig: this.symbolConfig ?? undefined
    };
    const slot: AccountRuntimeSlot = {
      accountId,
      sessionId,
      engine: persistedEvents.length > 0
        ? new TradingEngine(replayEvents(persistedEvents, engineOptions).state, engineOptions)
        : new TradingEngine(createInitialTradingState(engineOptions), engineOptions),
      eventStore: [...persistedEvents],
      persistQueue: Promise.resolve()
    };

    this.accountRuntimes.set(accountId, slot);

    if (this.bootstrapReady && persistedEvents.length === 0) {
      await this.options.repository.persistState(slot.engine.getState(), []);
    }

    return slot;
  }

  private async persistEvents(runtime: AccountRuntimeSlot, events: AnyEventEnvelope[]): Promise<void> {
    for (const event of events) {
      runtime.eventStore.push(event);
    }

    runtime.persistQueue = runtime.persistQueue
      .then(async () => {
        if (!this.bootstrapReady) {
          return;
        }

        await this.options.repository.persistState(runtime.engine.getState(), events);
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
}
