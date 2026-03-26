import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import type { CancelOrderInput, CreateOrderInput, EventEnvelope, MarketTick } from "@stratium/shared";
import { TradingEngine, createInitialTradingState, replayEvents } from "@stratium/trading-core";
import { TradingRepository } from "./repository";

const app = Fastify({
  logger: true
});

const repository = new TradingRepository();
let engine = new TradingEngine(createInitialTradingState());
const eventStore: EventEnvelope<unknown>[] = [];
const sockets = new Set<{ send: (message: string) => void }>();

const persistEvents = async (events: EventEnvelope<unknown>[]) => {
  eventStore.push(...events);
  await repository.persistState(engine.getState(), events);

  if (events.length === 0) {
    return;
  }

  const message = JSON.stringify({
    type: "events",
    events,
    state: engine.getState()
  });

  for (const socket of sockets) {
    socket.send(message);
  }
};

const bootstrapEngine = async () => {
  await repository.connect();
  const persistedEvents = await repository.loadEvents("session-1");

  if (persistedEvents.length > 0) {
    eventStore.push(...persistedEvents);
    engine = new TradingEngine(replayEvents(persistedEvents, {
      sessionId: "session-1"
    }).state);
    return;
  }

  await repository.persistState(engine.getState(), []);
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
  events: eventStore
}));

app.get("/api/account", async () => engine.getState().account);

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
  }).state
}));

app.post("/api/market-ticks", async (request, reply) => {
  const tick = request.body as MarketTick;
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
      events: eventStore
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
  await repository.close();
  await app.close();
};

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});
