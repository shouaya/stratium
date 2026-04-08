import type { FastifyBaseLogger } from "fastify";
import type { AnyEventEnvelope, CancelOrderInput, CreateOrderInput, MarketTick, TradingSymbolConfig } from "@stratium/shared";
import { TradingEngine, createInitialTradingState, replayEvents } from "@stratium/trading-core";
import type { HyperliquidMarketSnapshot } from "./hyperliquid-market";
import { HyperliquidMarketClient } from "./hyperliquid-market";
import { TradingRepository } from "./repository";

export interface MarketSimulatorState {
  enabled: boolean;
  symbol: string;
  intervalMs: number;
  driftBps: number;
  volatilityBps: number;
  anchorPrice: number;
  lastPrice: number;
  tickCount: number;
  lastGeneratedAt?: string;
}

export interface SymbolConfigState {
  symbol: string;
  coin: string;
  leverage: number;
  maxLeverage: number;
  szDecimals: number;
  quoteAsset: string;
}

export interface SocketLike {
  send(message: string): void;
  on?(event: "close", listener: () => void): void;
}

const mergeByKey = <T,>(items: T[], keyOf: (item: T) => string): T[] => {
  const map = new Map<string, T>();

  for (const item of items) {
    map.set(keyOf(item), item);
  }

  return [...map.values()];
};

const DEFAULT_MARKET_SIMULATOR_STATE: MarketSimulatorState = {
  enabled: false,
  symbol: "BTC-USD",
  intervalMs: Number(process.env.MARKET_SIMULATOR_INTERVAL_MS ?? 1200),
  driftBps: Number(process.env.MARKET_SIMULATOR_DRIFT_BPS ?? 0),
  volatilityBps: Number(process.env.MARKET_SIMULATOR_VOLATILITY_BPS ?? 22),
  anchorPrice: Number(process.env.MARKET_SIMULATOR_ANCHOR_PRICE ?? 69830),
  lastPrice: Number(process.env.MARKET_SIMULATOR_INITIAL_PRICE ?? 69830),
  tickCount: 0
};

const resolveBootstrapAnchorPrice = (symbol: string, latestPrice: number | undefined): number => {
  if (latestPrice && latestPrice > 0) {
    if (symbol === "BTC-USD" && latestPrice < 1000) {
      return DEFAULT_MARKET_SIMULATOR_STATE.anchorPrice;
    }

    return latestPrice;
  }

  return DEFAULT_MARKET_SIMULATOR_STATE.anchorPrice;
};

const nextVolatilityTag = (moveRatio: number): string => {
  if (moveRatio >= 0.0035) {
    return "spike";
  }

  if (moveRatio >= 0.0015) {
    return "high";
  }

  if (moveRatio >= 0.0006) {
    return "normal";
  }

  return "calm";
};

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

export class ApiRuntime {
  private readonly repository = new TradingRepository();

  private engine = new TradingEngine(createInitialTradingState());

  private readonly eventStore: AnyEventEnvelope[] = [];

  private readonly sockets = new Set<SocketLike>();

  private bootstrapReady = false;

  private persistQueue: Promise<void> = Promise.resolve();

  private marketSimulatorState: MarketSimulatorState = { ...DEFAULT_MARKET_SIMULATOR_STATE };

  private marketSimulatorTimer: NodeJS.Timeout | undefined;

  private marketSimulatorRunning = false;

  private marketData: HyperliquidMarketSnapshot = {
    source: "simulator",
    coin: "BTC",
    connected: false,
    book: {
      bids: [],
      asks: []
    },
    trades: [],
    candles: []
  };

  private marketTickInFlight = false;

  private lastPersistedMarketSignature = "";

  private symbolConfigState: SymbolConfigState;

  private readonly marketSource = process.env.MARKET_SOURCE ?? "hyperliquid";

  private readonly hyperliquidCoin = process.env.HYPERLIQUID_COIN ?? "BTC";

  private readonly hyperliquidCandleInterval = process.env.HYPERLIQUID_CANDLE_INTERVAL ?? "1m";

  private readonly configuredTradingSymbol = process.env.TRADING_SYMBOL ?? `${this.hyperliquidCoin}-USD`;

  private readonly hyperliquidClient: HyperliquidMarketClient;

  constructor(private readonly logger: FastifyBaseLogger) {
    this.symbolConfigState = {
      symbol: this.configuredTradingSymbol,
      coin: this.hyperliquidCoin,
      leverage: 10,
      maxLeverage: 10,
      szDecimals: 5,
      quoteAsset: "USDC"
    };

    this.hyperliquidClient = new HyperliquidMarketClient({
      coin: this.hyperliquidCoin,
      candleInterval: this.hyperliquidCandleInterval,
      onTick: async (tick) => {
        if (this.marketTickInFlight) {
          return;
        }

        this.marketTickInFlight = true;

        try {
          const result = this.engine.ingestMarketTick(tick);
          await this.persistEvents(result.events);
        } finally {
          this.marketTickInFlight = false;
        }
      },
      onSnapshot: (snapshot) => {
        this.handleMarketSnapshot(snapshot);
      }
    });
  }

  getEngineState() {
    return this.engine.getState();
  }

  getEventStore() {
    return this.eventStore;
  }

  getMarketData() {
    return this.marketData;
  }

  getMarketSimulatorState() {
    return this.marketSimulatorState;
  }

  getSymbolConfigState() {
    return this.symbolConfigState;
  }

  getHyperliquidCoin() {
    return this.hyperliquidCoin;
  }

  getHyperliquidCandleInterval() {
    return this.hyperliquidCandleInterval;
  }

  getStatePayload() {
    return {
      sessionId: this.engine.getState().simulationSessionId,
      account: this.engine.getState().account,
      orders: this.engine.getState().orders,
      position: this.engine.getState().position,
      latestTick: this.engine.getState().latestTick,
      events: this.eventStore,
      simulator: this.marketSimulatorState,
      market: this.marketData,
      symbolConfig: this.symbolConfigState
    };
  }

  getReplayPayload(sessionId: string) {
    return {
      sessionId,
      events: this.eventStore,
      state: replayEvents(this.eventStore, {
        sessionId: this.engine.getState().simulationSessionId
      }).state,
      simulator: this.marketSimulatorState,
      market: this.marketData
    };
  }

  async bootstrap(): Promise<void> {
    await this.repository.connect();
    const persistedSymbolConfig = await this.repository.loadSymbolConfig(this.configuredTradingSymbol);
    const persistedSymbolMeta = await this.repository.loadSymbolConfigMeta(this.configuredTradingSymbol);
    const persistedEvents = await this.repository.loadEvents("session-1");
    const persistedMarketSnapshot = await this.repository.loadRecentMarketSnapshot(
      this.hyperliquidCoin,
      this.hyperliquidCandleInterval
    );
    const engineOptions: { sessionId: string; symbolConfig?: TradingSymbolConfig } = {
      sessionId: "session-1",
      symbolConfig: persistedSymbolConfig ?? undefined
    };

    if (persistedEvents.length > 0) {
      for (const event of persistedEvents) {
        this.eventStore.push(event);
      }
      this.engine = new TradingEngine(replayEvents(persistedEvents, {
        sessionId: "session-1",
        symbolConfig: persistedSymbolConfig ?? undefined
      }).state, engineOptions);
    } else {
      this.engine = new TradingEngine(createInitialTradingState(engineOptions), engineOptions);
      await this.repository.persistState(this.engine.getState(), []);
    }

    if (persistedMarketSnapshot) {
      this.marketData = persistedMarketSnapshot;
    }

    if (persistedSymbolMeta) {
      this.symbolConfigState = persistedSymbolMeta;
    } else if (persistedSymbolConfig) {
      this.symbolConfigState = {
        ...this.symbolConfigState,
        leverage: persistedSymbolConfig.leverage
      };
    }

    const bootPrice = resolveBootstrapAnchorPrice(
      this.engine.getState().position.symbol,
      this.engine.getState().latestTick?.last
    );

    this.marketSimulatorState = {
      ...this.marketSimulatorState,
      symbol: this.engine.getState().position.symbol,
      anchorPrice: bootPrice,
      lastPrice: bootPrice
    };

    this.bootstrapReady = true;

    if ((process.env.ENABLE_MARKET_SIMULATOR ?? "true") === "true") {
      if (this.marketSource === "hyperliquid") {
        this.hyperliquidClient.connect();
      } else {
        this.startMarketSimulator();
      }
    }
  }

  async shutdown(): Promise<void> {
    this.bootstrapReady = false;
    this.stopMarketSimulator();
    this.hyperliquidClient.close();
    await this.persistQueue.catch(() => undefined);
    await this.repository.close();
  }

  addSocket(socket: SocketLike): void {
    this.sockets.add(socket);
    socket.send(JSON.stringify({
      type: "bootstrap",
      state: this.engine.getState(),
      events: this.eventStore,
      simulator: this.marketSimulatorState,
      market: this.marketData
    }));
    socket.on?.("close", () => {
      this.removeSocket(socket);
    });
  }

  removeSocket(socket: SocketLike): void {
    this.sockets.delete(socket);
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

  async ingestManualTick(tick: MarketTick): Promise<
    | { ok: true; result: ReturnType<TradingEngine["ingestMarketTick"]> }
    | { ok: false; message: string }
  > {
    const validationError = validateManualTick(
      tick,
      this.engine.getState().latestTick,
      this.marketSimulatorState.symbol
    );

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

  async updateLeverage(symbol: string, leverage: number): Promise<void> {
    this.engine.setLeverage(leverage);
    await this.repository.updateSymbolLeverage(symbol, leverage);
    await this.repository.persistState(this.engine.getState(), []);

    this.symbolConfigState = {
      ...this.symbolConfigState,
      leverage
    };

    this.broadcast();
  }

  async getMarketHistory(limit: number) {
    const persistedMarketSnapshot = await this.repository.loadRecentMarketSnapshot(
      this.hyperliquidCoin,
      this.hyperliquidCandleInterval
    );
    const sourceMarket = persistedMarketSnapshot
      ? {
        ...persistedMarketSnapshot,
        connected: this.marketData.connected,
        bestBid: this.marketData.bestBid ?? persistedMarketSnapshot.bestBid,
        bestAsk: this.marketData.bestAsk ?? persistedMarketSnapshot.bestAsk,
        markPrice: this.marketData.markPrice ?? persistedMarketSnapshot.markPrice,
        book: this.marketData.book.bids.length > 0 || this.marketData.book.asks.length > 0
          ? this.marketData.book
          : persistedMarketSnapshot.book,
        assetCtx: this.marketData.assetCtx ?? persistedMarketSnapshot.assetCtx,
        trades: mergeByKey(
          [...this.marketData.trades, ...persistedMarketSnapshot.trades],
          (trade) => trade.id
        ).sort((left, right) => right.time - left.time),
        candles: mergeByKey(
          [...persistedMarketSnapshot.candles, ...this.marketData.candles],
          (candle) => candle.id
        ).sort((left, right) => left.openTime - right.openTime)
      }
      : this.marketData;
    const candles = sourceMarket.candles.slice(-Math.max(10, Math.min(limit, 500)));
    const trades = sourceMarket.trades.slice(0, Math.max(10, Math.min(limit, 200)));

    return {
      coin: sourceMarket.coin,
      interval: this.hyperliquidCandleInterval,
      candles,
      trades,
      book: sourceMarket.book,
      assetCtx: sourceMarket.assetCtx
    };
  }

  async getMarketVolume(limit: number, interval: string, coin: string) {
    const records = await this.repository.loadRecentVolumeRecords(coin, interval, limit);

    return {
      coin,
      interval,
      records
    };
  }

  startMarketSimulator(
    payload: Partial<Pick<MarketSimulatorState, "intervalMs" | "driftBps" | "volatilityBps" | "anchorPrice">> = {}
  ): MarketSimulatorState {
    this.marketSimulatorState = {
      ...this.marketSimulatorState,
      intervalMs: payload.intervalMs && payload.intervalMs > 100 ? payload.intervalMs : this.marketSimulatorState.intervalMs,
      driftBps: Number.isFinite(payload.driftBps) ? payload.driftBps as number : this.marketSimulatorState.driftBps,
      volatilityBps: Number.isFinite(payload.volatilityBps) ? payload.volatilityBps as number : this.marketSimulatorState.volatilityBps,
      anchorPrice: payload.anchorPrice && payload.anchorPrice > 0 ? payload.anchorPrice : this.marketSimulatorState.anchorPrice
    };

    if (this.marketSimulatorTimer) {
      clearInterval(this.marketSimulatorTimer);
    }

    this.marketSimulatorState = {
      ...this.marketSimulatorState,
      enabled: true,
      lastPrice: resolveBootstrapAnchorPrice(
        this.marketSimulatorState.symbol,
        this.engine.getState().latestTick?.last ?? this.marketSimulatorState.lastPrice
      )
    };

    this.marketSimulatorTimer = setInterval(() => {
      void this.runMarketSimulationTick();
    }, this.marketSimulatorState.intervalMs);

    void this.runMarketSimulationTick();
    this.broadcast();

    return this.marketSimulatorState;
  }

  stopMarketSimulator(): MarketSimulatorState {
    if (this.marketSimulatorTimer) {
      clearInterval(this.marketSimulatorTimer);
      this.marketSimulatorTimer = undefined;
    }

    this.marketSimulatorState = {
      ...this.marketSimulatorState,
      enabled: false
    };

    this.broadcast();

    return this.marketSimulatorState;
  }

  private createSocketPayload(events: AnyEventEnvelope[] = []) {
    return {
      type: "events",
      events,
      state: this.engine.getState(),
      simulator: this.marketSimulatorState,
      market: this.marketData,
      symbolConfig: this.symbolConfigState
    };
  }

  private broadcast(events: AnyEventEnvelope[] = []): void {
    const message = JSON.stringify(this.createSocketPayload(events));

    for (const socket of this.sockets) {
      socket.send(message);
    }
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

        await this.repository.persistState(this.engine.getState(), events);
      })
      .catch((error: unknown) => {
        this.logger.error({ error }, "Failed to persist trading state");
      });
    await this.persistQueue;

    if (events.length === 0) {
      return;
    }

    this.broadcast(events);
  }

  private handleMarketSnapshot(snapshot: HyperliquidMarketSnapshot): void {
    if (snapshot.source === "hyperliquid") {
      const mergedTrades = mergeByKey(
        [...snapshot.trades, ...this.marketData.trades],
        (trade) => trade.id
      )
        .sort((left, right) => right.time - left.time)
        .slice(0, 200);
      const mergedCandles = mergeByKey(
        [...this.marketData.candles, ...snapshot.candles],
        (candle) => candle.id
      )
        .sort((left, right) => left.openTime - right.openTime)
        .slice(-500);

      this.marketData = {
        source: "hyperliquid",
        coin: snapshot.coin,
        connected: snapshot.connected,
        bestBid: snapshot.bestBid ?? this.marketData.bestBid,
        bestAsk: snapshot.bestAsk ?? this.marketData.bestAsk,
        markPrice: snapshot.markPrice ?? this.marketData.markPrice,
        book: snapshot.book.bids.length > 0 || snapshot.book.asks.length > 0
          ? snapshot.book
          : this.marketData.book,
        trades: mergedTrades,
        candles: mergedCandles,
        assetCtx: snapshot.assetCtx ?? this.marketData.assetCtx
      };
    } else {
      this.marketData = snapshot;
    }

    const marketSignature = JSON.stringify({
      bestBid: this.marketData.bestBid,
      bestAsk: this.marketData.bestAsk,
      bookUpdatedAt: this.marketData.book.updatedAt,
      topTradeId: this.marketData.trades[0]?.id,
      latestCandleId: this.marketData.candles[this.marketData.candles.length - 1]?.id,
      assetCtxAt: this.marketData.assetCtx?.capturedAt
    });

    if (this.marketData.source === "hyperliquid" && marketSignature !== this.lastPersistedMarketSignature) {
      this.lastPersistedMarketSignature = marketSignature;
      void this.repository.persistMarketSnapshot(this.marketData).catch((error: unknown) => {
        this.logger.error({ error }, "Failed to persist Hyperliquid market snapshot");
      });
    }

    this.broadcast();
  }

  private buildSyntheticTick(): MarketTick {
    const basePrice = resolveBootstrapAnchorPrice(
      this.marketSimulatorState.symbol,
      this.engine.getState().latestTick?.last ?? this.marketSimulatorState.lastPrice
    );
    const driftRatio = this.marketSimulatorState.driftBps / 10000;
    const volatilityRatio = this.marketSimulatorState.volatilityBps / 10000;
    const meanReversionRatio = (this.marketSimulatorState.anchorPrice - basePrice) / this.marketSimulatorState.anchorPrice * 0.08;
    const randomShock = (Math.random() - 0.5) * 2 * volatilityRatio;
    const rawNextLast = basePrice * (1 + driftRatio + meanReversionRatio + randomShock);
    const nextLast = Number(Math.max(rawNextLast, 1).toFixed(2));
    const spreadRatio = Math.max(volatilityRatio * 0.28, 0.00012);
    const nextSpread = Number(Math.max(nextLast * spreadRatio * (0.65 + Math.random() * 0.9), 0.5).toFixed(2));
    const bid = Number((nextLast - nextSpread / 2).toFixed(2));
    const ask = Number((nextLast + nextSpread / 2).toFixed(2));
    const tickTime = new Date().toISOString();

    this.marketSimulatorState = {
      ...this.marketSimulatorState,
      lastPrice: nextLast,
      tickCount: this.marketSimulatorState.tickCount + 1,
      lastGeneratedAt: tickTime
    };

    this.marketData = {
      source: "simulator",
      coin: this.hyperliquidCoin,
      connected: false,
      bestBid: bid,
      bestAsk: ask,
      markPrice: nextLast,
      book: {
        bids: [],
        asks: [],
        updatedAt: Date.now()
      },
      trades: [],
      candles: []
    };

    return {
      symbol: this.marketSimulatorState.symbol,
      bid,
      ask,
      last: nextLast,
      spread: Number((ask - bid).toFixed(2)),
      tickTime,
      volatilityTag: nextVolatilityTag(Math.abs(nextLast - basePrice) / basePrice)
    };
  }

  private async runMarketSimulationTick(): Promise<void> {
    if (this.marketSimulatorRunning) {
      return;
    }

    this.marketSimulatorRunning = true;

    try {
      const tick = this.buildSyntheticTick();
      const result = this.engine.ingestMarketTick(tick);
      await this.persistEvents(result.events);
    } finally {
      this.marketSimulatorRunning = false;
    }
  }
}
