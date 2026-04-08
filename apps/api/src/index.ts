import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import type { CancelOrderInput, CreateOrderInput, EventEnvelope, MarketTick, TradingSymbolConfig } from "@stratium/shared";
import { TradingEngine, createInitialTradingState, replayEvents } from "@stratium/trading-core";
import type { HyperliquidMarketSnapshot } from "./hyperliquid-market";
import { HyperliquidMarketClient } from "./hyperliquid-market";
import { TradingRepository } from "./repository";

const app = Fastify({
  logger: true
});

const mergeByKey = <T,>(items: T[], keyOf: (item: T) => string): T[] => {
  const map = new Map<string, T>();

  for (const item of items) {
    map.set(keyOf(item), item);
  }

  return [...map.values()];
};

const repository = new TradingRepository();
let engine = new TradingEngine(createInitialTradingState());
const eventStore: EventEnvelope<unknown>[] = [];
const sockets = new Set<{ send: (message: string) => void }>();
let bootstrapReady = false;
let persistQueue: Promise<void> = Promise.resolve();

interface MarketSimulatorState {
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

interface SymbolConfigState {
  symbol: string;
  coin: string;
  leverage: number;
  maxLeverage: number;
  szDecimals: number;
  quoteAsset: string;
}

const resolveBootstrapAnchorPrice = (symbol: string, latestPrice: number | undefined): number => {
  if (latestPrice && latestPrice > 0) {
    if (symbol === "BTC-USD" && latestPrice < 1000) {
      return DEFAULT_MARKET_SIMULATOR_STATE.anchorPrice;
    }

    return latestPrice;
  }

  return DEFAULT_MARKET_SIMULATOR_STATE.anchorPrice;
};

let marketSimulatorState: MarketSimulatorState = { ...DEFAULT_MARKET_SIMULATOR_STATE };
let marketSimulatorTimer: NodeJS.Timeout | undefined;
let marketSimulatorRunning = false;
let marketData: HyperliquidMarketSnapshot = {
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
let marketTickInFlight = false;
const marketSource = process.env.MARKET_SOURCE ?? "hyperliquid";
const hyperliquidCoin = process.env.HYPERLIQUID_COIN ?? "BTC";
const hyperliquidCandleInterval = process.env.HYPERLIQUID_CANDLE_INTERVAL ?? "1m";
const configuredTradingSymbol = process.env.TRADING_SYMBOL ?? `${hyperliquidCoin}-USD`;
let lastPersistedMarketSignature = "";
let symbolConfigState: SymbolConfigState = {
  symbol: configuredTradingSymbol,
  coin: hyperliquidCoin,
  leverage: 10,
  maxLeverage: 10,
  szDecimals: 5,
  quoteAsset: "USDC"
};
const hyperliquidClient = new HyperliquidMarketClient({
  coin: hyperliquidCoin,
  candleInterval: hyperliquidCandleInterval,
  onTick: async (tick) => {
    if (marketTickInFlight) {
      return;
    }

    marketTickInFlight = true;

    try {
      const result = engine.ingestMarketTick(tick);
      await persistEvents(result.events);
    } finally {
      marketTickInFlight = false;
    }
  },
  onSnapshot: (snapshot) => {
    if (snapshot.source === "hyperliquid") {
      const mergedTrades = mergeByKey(
        [...snapshot.trades, ...marketData.trades],
        (trade) => trade.id
      )
        .sort((left, right) => right.time - left.time)
        .slice(0, 200);
      const mergedCandles = mergeByKey(
        [...marketData.candles, ...snapshot.candles],
        (candle) => candle.id
      )
        .sort((left, right) => left.openTime - right.openTime)
        .slice(-500);

      marketData = {
        source: "hyperliquid",
        coin: snapshot.coin,
        connected: snapshot.connected,
        bestBid: snapshot.bestBid ?? marketData.bestBid,
        bestAsk: snapshot.bestAsk ?? marketData.bestAsk,
        markPrice: snapshot.markPrice ?? marketData.markPrice,
        book: snapshot.book.bids.length > 0 || snapshot.book.asks.length > 0
          ? snapshot.book
          : marketData.book,
        trades: mergedTrades,
        candles: mergedCandles,
        assetCtx: snapshot.assetCtx ?? marketData.assetCtx
      };
    } else {
      marketData = snapshot;
    }

    const marketSignature = JSON.stringify({
      bestBid: marketData.bestBid,
      bestAsk: marketData.bestAsk,
      bookUpdatedAt: marketData.book.updatedAt,
      topTradeId: marketData.trades[0]?.id,
      latestCandleId: marketData.candles[marketData.candles.length - 1]?.id,
      assetCtxAt: marketData.assetCtx?.capturedAt
    });

    if (marketData.source === "hyperliquid" && marketSignature !== lastPersistedMarketSignature) {
      lastPersistedMarketSignature = marketSignature;
      void repository.persistMarketSnapshot(marketData).catch((error: unknown) => {
        app.log.error({ error }, "Failed to persist Hyperliquid market snapshot");
      });
    }

    broadcast();
  }
});

const createSocketPayload = (events: EventEnvelope<unknown>[] = []) => ({
  type: "events",
  events,
  state: engine.getState(),
  simulator: marketSimulatorState,
  market: marketData,
  symbolConfig: symbolConfigState
});

const broadcast = (events: EventEnvelope<unknown>[] = []) => {
  const message = JSON.stringify(createSocketPayload(events));

  for (const socket of sockets) {
    socket.send(message);
  }
};

const persistEvents = async (events: EventEnvelope<unknown>[]) => {
  for (const event of events) {
    eventStore.push(event);
  }
  persistQueue = persistQueue
    .then(async () => {
      if (!bootstrapReady) {
        return;
      }

      await repository.persistState(engine.getState(), events);
    })
    .catch((error: unknown) => {
      app.log.error({ error }, "Failed to persist trading state");
    });
  await persistQueue;

  if (events.length === 0) {
    return;
  }

  broadcast(events);
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

const buildSyntheticTick = (): MarketTick => {
  const basePrice = resolveBootstrapAnchorPrice(
    marketSimulatorState.symbol,
    engine.getState().latestTick?.last ?? marketSimulatorState.lastPrice
  );
  const driftRatio = marketSimulatorState.driftBps / 10000;
  const volatilityRatio = marketSimulatorState.volatilityBps / 10000;
  const meanReversionRatio = (marketSimulatorState.anchorPrice - basePrice) / marketSimulatorState.anchorPrice * 0.08;
  const randomShock = (Math.random() - 0.5) * 2 * volatilityRatio;
  const rawNextLast = basePrice * (1 + driftRatio + meanReversionRatio + randomShock);
  const nextLast = Number(Math.max(rawNextLast, 1).toFixed(2));
  const spreadRatio = Math.max(volatilityRatio * 0.28, 0.00012);
  const nextSpread = Number(Math.max(nextLast * spreadRatio * (0.65 + Math.random() * 0.9), 0.5).toFixed(2));
  const bid = Number((nextLast - nextSpread / 2).toFixed(2));
  const ask = Number((nextLast + nextSpread / 2).toFixed(2));
  const tickTime = new Date().toISOString();

  marketSimulatorState = {
    ...marketSimulatorState,
    lastPrice: nextLast,
    tickCount: marketSimulatorState.tickCount + 1,
    lastGeneratedAt: tickTime
  };

  marketData = {
    source: "simulator",
    coin: hyperliquidCoin,
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
    symbol: marketSimulatorState.symbol,
    bid,
    ask,
    last: nextLast,
    spread: Number((ask - bid).toFixed(2)),
    tickTime,
    volatilityTag: nextVolatilityTag(Math.abs(nextLast - basePrice) / basePrice)
  };
};

const runMarketSimulationTick = async () => {
  if (marketSimulatorRunning) {
    return;
  }

  marketSimulatorRunning = true;

  try {
    const tick = buildSyntheticTick();
    const result = engine.ingestMarketTick(tick);
    await persistEvents(result.events);
  } finally {
    marketSimulatorRunning = false;
  }
};

const stopMarketSimulator = () => {
  if (marketSimulatorTimer) {
    clearInterval(marketSimulatorTimer);
    marketSimulatorTimer = undefined;
  }

  marketSimulatorState = {
    ...marketSimulatorState,
    enabled: false
  };

  broadcast();
};

const startMarketSimulator = () => {
  if (marketSimulatorTimer) {
    clearInterval(marketSimulatorTimer);
  }

  marketSimulatorState = {
    ...marketSimulatorState,
    enabled: true,
    lastPrice: resolveBootstrapAnchorPrice(
      marketSimulatorState.symbol,
      engine.getState().latestTick?.last ?? marketSimulatorState.lastPrice
    )
  };

  marketSimulatorTimer = setInterval(() => {
    void runMarketSimulationTick();
  }, marketSimulatorState.intervalMs);

  void runMarketSimulationTick();
  broadcast();
};

const bootstrapEngine = async () => {
  await repository.connect();
  const persistedSymbolConfig = await repository.loadSymbolConfig(configuredTradingSymbol);
  const persistedSymbolMeta = await repository.loadSymbolConfigMeta(configuredTradingSymbol);
  const persistedEvents = await repository.loadEvents("session-1");
  const persistedMarketSnapshot = await repository.loadRecentMarketSnapshot(hyperliquidCoin, hyperliquidCandleInterval);
  const engineOptions: { sessionId: string; symbolConfig?: TradingSymbolConfig } = {
    sessionId: "session-1",
    symbolConfig: persistedSymbolConfig ?? undefined
  };

  if (persistedEvents.length > 0) {
    for (const event of persistedEvents) {
      eventStore.push(event);
    }
    engine = new TradingEngine(replayEvents(persistedEvents, {
      sessionId: "session-1",
      symbolConfig: persistedSymbolConfig ?? undefined
    }).state, engineOptions);
  } else {
    engine = new TradingEngine(createInitialTradingState(engineOptions), engineOptions);
    await repository.persistState(engine.getState(), []);
  }

  if (persistedMarketSnapshot) {
    marketData = persistedMarketSnapshot;
  }

  if (persistedSymbolMeta) {
    symbolConfigState = persistedSymbolMeta;
  } else if (persistedSymbolConfig) {
    symbolConfigState = {
      ...symbolConfigState,
      leverage: persistedSymbolConfig.leverage
    };
  }

  const bootPrice = resolveBootstrapAnchorPrice(
    engine.getState().position.symbol,
    engine.getState().latestTick?.last
  );

  marketSimulatorState = {
    ...marketSimulatorState,
    symbol: engine.getState().position.symbol,
    anchorPrice: bootPrice,
    lastPrice: bootPrice
  };

  bootstrapReady = true;

  if ((process.env.ENABLE_MARKET_SIMULATOR ?? "true") === "true") {
    if (marketSource === "hyperliquid") {
      hyperliquidClient.connect();
    } else {
      startMarketSimulator();
    }
  }
};

await app.register(cors, {
  origin: true
});

await app.register(websocket);

app.get("/health", async () => ({
  status: "ok"
}));

app.get("/api/state", async () => ({
  sessionId: engine.getState().simulationSessionId,
  account: engine.getState().account,
  orders: engine.getState().orders,
  position: engine.getState().position,
  latestTick: engine.getState().latestTick,
  events: eventStore,
  simulator: marketSimulatorState,
  market: marketData,
  symbolConfig: symbolConfigState
}));

app.get("/api/market-history", async (request) => {
  const query = request.query as { limit?: string };
  const limit = Number(query.limit ?? 200);
  const persistedMarketSnapshot = await repository.loadRecentMarketSnapshot(hyperliquidCoin, hyperliquidCandleInterval);
  const sourceMarket = persistedMarketSnapshot
    ? {
      ...persistedMarketSnapshot,
      connected: marketData.connected,
      bestBid: marketData.bestBid ?? persistedMarketSnapshot.bestBid,
      bestAsk: marketData.bestAsk ?? persistedMarketSnapshot.bestAsk,
      markPrice: marketData.markPrice ?? persistedMarketSnapshot.markPrice,
      book: marketData.book.bids.length > 0 || marketData.book.asks.length > 0 ? marketData.book : persistedMarketSnapshot.book,
      assetCtx: marketData.assetCtx ?? persistedMarketSnapshot.assetCtx,
      trades: mergeByKey(
        [...marketData.trades, ...persistedMarketSnapshot.trades],
        (trade) => trade.id
      ).sort((left, right) => right.time - left.time),
      candles: mergeByKey(
        [...persistedMarketSnapshot.candles, ...marketData.candles],
        (candle) => candle.id
      ).sort((left, right) => left.openTime - right.openTime)
    }
    : marketData;
  const candles = sourceMarket.candles.slice(-Math.max(10, Math.min(limit, 500)));
  const trades = sourceMarket.trades.slice(0, Math.max(10, Math.min(limit, 200)));

  return {
    coin: sourceMarket.coin,
    interval: hyperliquidCandleInterval,
    candles,
    trades,
    book: sourceMarket.book,
    assetCtx: sourceMarket.assetCtx
  };
});

app.get("/api/market-volume", async (request) => {
  const query = request.query as { limit?: string; interval?: string; coin?: string };
  const limit = Number(query.limit ?? 500);
  const interval = query.interval ?? hyperliquidCandleInterval;
  const coin = query.coin ?? hyperliquidCoin;
  const records = await repository.loadRecentVolumeRecords(coin, interval, limit);

  return {
    coin,
    interval,
    records
  };
});

app.get("/api/account", async () => engine.getState().account);

app.post("/api/leverage", async (request, reply) => {
  const payload = request.body as { symbol?: string; leverage?: number };
  const symbol = payload.symbol ?? symbolConfigState.symbol;
  const requestedLeverage = Number(payload.leverage);

  if (!Number.isFinite(requestedLeverage)) {
    return reply.code(400).send({
      status: "rejected",
      message: "Leverage must be a number."
    });
  }

  const leverage = Math.floor(requestedLeverage);

  if (leverage < 1) {
    return reply.code(400).send({
      status: "rejected",
      message: "Leverage must be at least 1x."
    });
  }

  if (symbol !== symbolConfigState.symbol) {
    return reply.code(400).send({
      status: "rejected",
      message: "Leverage can only be updated for the active trading symbol."
    });
  }

  if (leverage > symbolConfigState.maxLeverage) {
    return reply.code(400).send({
      status: "rejected",
      message: `Leverage exceeds max ${symbolConfigState.maxLeverage}x for ${symbol}.`
    });
  }

  engine.setLeverage(leverage);
  await repository.updateSymbolLeverage(symbol, leverage);
  await repository.persistState(engine.getState(), []);

  symbolConfigState = {
    ...symbolConfigState,
    leverage
  };

  broadcast();

  return reply.code(202).send({
    status: "updated",
    symbolConfig: symbolConfigState,
    account: engine.getState().account,
    position: engine.getState().position
  });
});

app.get("/api/orders", async () => engine.getState().orders);

app.get("/api/positions", async () => engine.getState().position);

app.get("/api/events", async () => ({
  sessionId: engine.getState().simulationSessionId,
  events: eventStore
}));

app.get("/api/replay/:sessionId", async (request) => ({
  sessionId: (request.params as { sessionId: string }).sessionId,
  events: eventStore,
  state: replayEvents(eventStore, {
    sessionId: engine.getState().simulationSessionId
  }).state,
  simulator: marketSimulatorState,
  market: marketData
}));

app.get("/api/market-simulator", async () => marketSimulatorState);

app.post("/api/market-simulator/start", async (request, reply) => {
  const payload = (request.body as Partial<Pick<MarketSimulatorState, "intervalMs" | "driftBps" | "volatilityBps" | "anchorPrice">>) ?? {};

  marketSimulatorState = {
    ...marketSimulatorState,
    intervalMs: payload.intervalMs && payload.intervalMs > 100 ? payload.intervalMs : marketSimulatorState.intervalMs,
    driftBps: Number.isFinite(payload.driftBps) ? payload.driftBps as number : marketSimulatorState.driftBps,
    volatilityBps: Number.isFinite(payload.volatilityBps) ? payload.volatilityBps as number : marketSimulatorState.volatilityBps,
    anchorPrice: payload.anchorPrice && payload.anchorPrice > 0 ? payload.anchorPrice : marketSimulatorState.anchorPrice
  };

  startMarketSimulator();

  return reply.code(202).send({
    status: "started",
    simulator: marketSimulatorState
  });
});

app.post("/api/market-simulator/stop", async (_request, reply) => {
  stopMarketSimulator();

  return reply.code(202).send({
    status: "stopped",
    simulator: marketSimulatorState
  });
});

app.post("/api/market-ticks", async (request, reply) => {
  const tick = request.body as MarketTick;
  const validationError = validateManualTick(
    tick,
    engine.getState().latestTick,
    marketSimulatorState.symbol
  );

  if (validationError) {
    return reply.code(400).send({
      status: "rejected",
      message: validationError
    });
  }

  const result = engine.ingestMarketTick(tick);
  await persistEvents(result.events);

  return reply.code(202).send(result);
});

app.post("/api/orders", async (request, reply) => {
  const input = request.body as CreateOrderInput;
  const result = engine.submitOrder(input);
  await persistEvents(result.events);

  return reply.code(202).send(result);
});

app.post("/api/orders/cancel", async (request, reply) => {
  const input = request.body as CancelOrderInput;
  const result = engine.cancelOrder(input);
  await persistEvents(result.events);

  return reply.code(202).send(result);
});

app.post("/api/orders/:id/cancel", async (request, reply) => {
  const params = request.params as { id: string };
  const input = request.body as Partial<CancelOrderInput>;
  const result = engine.cancelOrder({
    accountId: input.accountId ?? engine.getState().account.accountId,
    orderId: params.id,
    requestedAt: input.requestedAt
  });
  await persistEvents(result.events);

  return reply.code(202).send(result);
});

app.register(async (instance) => {
  instance.get("/ws", { websocket: true }, (socket) => {
    sockets.add(socket);
    socket.send(JSON.stringify({
      type: "bootstrap",
      state: engine.getState(),
      events: eventStore,
      simulator: marketSimulatorState,
      market: marketData
    }));

    socket.on("close", () => {
      sockets.delete(socket);
    });
  });
});

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

await bootstrapEngine();
await app.listen({
  port,
  host
});

const shutdown = async () => {
  bootstrapReady = false;
  stopMarketSimulator();
  hyperliquidClient.close();
  await persistQueue.catch(() => undefined);
  await repository.close();
  await app.close();
};

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});
