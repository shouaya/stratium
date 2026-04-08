import type { FastifyBaseLogger } from "fastify";
import type { AnyEventEnvelope, CancelOrderInput, CreateOrderInput, MarketTick, TradingSymbolConfig } from "@stratium/shared";
import { TradingEngine, createInitialTradingState, replayEvents } from "@stratium/trading-core";
import type { SymbolConfigState } from "./market-runtime";
import { TradingRepository } from "./repository";

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
  sessionId: string;
  persistedEvents: AnyEventEnvelope[];
  persistedSymbolConfig: TradingSymbolConfig | null;
}

interface TradingRuntimeOptions {
  logger: FastifyBaseLogger;
  repository: TradingRepository;
  onEvents: (events: AnyEventEnvelope[]) => void;
}

export class TradingRuntime {
  private engine = new TradingEngine(createInitialTradingState());

  private readonly eventStore: AnyEventEnvelope[] = [];

  private bootstrapReady = false;

  private persistQueue: Promise<void> = Promise.resolve();

  constructor(private readonly options: TradingRuntimeOptions) {}

  getEngine() {
    return this.engine;
  }

  getEngineState() {
    return this.engine.getState();
  }

  getEventStore() {
    return this.eventStore;
  }

  getReplayState(sessionId: string) {
    return replayEvents(this.eventStore, { sessionId }).state;
  }

  async bootstrap(input: BootstrapTradingRuntimeInput): Promise<void> {
    this.eventStore.length = 0;
    const engineOptions: { sessionId: string; symbolConfig?: TradingSymbolConfig } = {
      sessionId: input.sessionId,
      symbolConfig: input.persistedSymbolConfig ?? undefined
    };

    if (input.persistedEvents.length > 0) {
      for (const event of input.persistedEvents) {
        this.eventStore.push(event);
      }

      this.engine = new TradingEngine(replayEvents(input.persistedEvents, engineOptions).state, engineOptions);
      return;
    }

    this.engine = new TradingEngine(createInitialTradingState(engineOptions), engineOptions);
    await this.options.repository.persistState(this.engine.getState(), []);
  }

  setBootstrapReady(value: boolean): void {
    this.bootstrapReady = value;
  }

  async flushPersistence(): Promise<void> {
    await this.persistQueue.catch(() => undefined);
  }

  async handleLiveTick(tick: MarketTick): Promise<void> {
    const result = this.engine.ingestMarketTick(tick);
    await this.persistEvents(result.events);
  }

  async submitOrder(input: CreateOrderInput) {
    const result = this.engine.submitOrder(input);
    await this.persistEvents(result.events);
    return result;
  }

  async cancelOrder(input: CancelOrderInput) {
    const result = this.engine.cancelOrder(input);
    await this.persistEvents(result.events);
    return result;
  }

  async ingestManualTick(
    tick: MarketTick,
    expectedSymbol: string
  ): Promise<
    | { ok: true; result: ReturnType<TradingEngine["ingestMarketTick"]> }
    | { ok: false; message: string }
  > {
    const validationError = validateManualTick(tick, this.engine.getState().latestTick, expectedSymbol);

    if (validationError) {
      return {
        ok: false,
        message: validationError
      };
    }

    const result = this.engine.ingestMarketTick(tick);
    await this.persistEvents(result.events);

    return {
      ok: true,
      result
    };
  }

  async updateLeverage(symbolConfigState: SymbolConfigState, leverage: number): Promise<SymbolConfigState> {
    this.engine.setLeverage(leverage);
    await this.options.repository.updateSymbolLeverage(symbolConfigState.symbol, leverage);
    await this.options.repository.persistState(this.engine.getState(), []);

    return {
      ...symbolConfigState,
      leverage
    };
  }

  async persistExternalEvents(events: AnyEventEnvelope[]): Promise<void> {
    await this.persistEvents(events);
  }

  private async persistEvents(events: AnyEventEnvelope[]): Promise<void> {
    for (const event of events) {
      this.eventStore.push(event);
    }

    this.persistQueue = this.persistQueue
      .then(async () => {
        if (!this.bootstrapReady) {
          return;
        }

        await this.options.repository.persistState(this.engine.getState(), events);
      })
      .catch((error: unknown) => {
        this.options.logger.error({ error }, "Failed to persist trading state");
      });
    await this.persistQueue;

    if (events.length === 0) {
      return;
    }

    this.options.onEvents(events);
  }
}
