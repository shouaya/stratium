import type { FastifyInstance } from "fastify";
import type { CancelOrderInput, CreateOrderInput, MarketTick } from "@stratium/shared";
import type { ApiRuntime, MarketSimulatorState } from "./runtime";

export const registerRoutes = async (app: FastifyInstance, runtime: ApiRuntime): Promise<void> => {
  app.get("/health", async () => ({
    status: "ok"
  }));

  app.get("/api/state", async () => runtime.getStatePayload());

  app.get("/api/market-history", async (request) => {
    const query = request.query as { limit?: string };
    const limit = Number(query.limit ?? 200);

    return runtime.getMarketHistory(limit);
  });

  app.get("/api/market-volume", async (request) => {
    const query = request.query as { limit?: string; interval?: string; coin?: string };
    const limit = Number(query.limit ?? 500);
    const interval = query.interval ?? runtime.getHyperliquidCandleInterval();
    const coin = query.coin ?? runtime.getHyperliquidCoin();

    return runtime.getMarketVolume(limit, interval, coin);
  });

  app.get("/api/account", async () => runtime.getEngineState().account);
  app.get("/api/orders", async () => runtime.getEngineState().orders);
  app.get("/api/positions", async () => runtime.getEngineState().position);
  app.get("/api/events", async () => ({
    sessionId: runtime.getEngineState().simulationSessionId,
    events: runtime.getEventStore()
  }));
  app.get("/api/replay/:sessionId", async (request) => runtime.getReplayPayload(
    (request.params as { sessionId: string }).sessionId
  ));
  app.get("/api/market-simulator", async () => runtime.getMarketSimulatorState());

  app.post("/api/leverage", async (request, reply) => {
    const payload = request.body as { symbol?: string; leverage?: number };
    const symbolConfigState = runtime.getSymbolConfigState();
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

    await runtime.updateLeverage(symbol, leverage);

    return reply.code(202).send({
      status: "updated",
      symbolConfig: runtime.getSymbolConfigState(),
      account: runtime.getEngineState().account,
      position: runtime.getEngineState().position
    });
  });

  app.post("/api/market-simulator/start", async (request, reply) => {
    const payload = (request.body as Partial<Pick<MarketSimulatorState, "intervalMs" | "driftBps" | "volatilityBps" | "anchorPrice">>) ?? {};
    const simulator = runtime.startMarketSimulator(payload);

    return reply.code(202).send({
      status: "started",
      simulator
    });
  });

  app.post("/api/market-simulator/stop", async (_request, reply) => {
    const simulator = runtime.stopMarketSimulator();

    return reply.code(202).send({
      status: "stopped",
      simulator
    });
  });

  app.post("/api/market-ticks", async (request, reply) => {
    const tick = request.body as MarketTick;
    const result = await runtime.ingestManualTick(tick);

    if (!result.ok) {
      return reply.code(400).send({
        status: "rejected",
        message: result.message
      });
    }

    return reply.code(202).send(result.result);
  });

  app.post("/api/orders", async (request, reply) => {
    const input = request.body as CreateOrderInput;
    const result = await runtime.submitOrder(input);

    return reply.code(202).send(result);
  });

  app.post("/api/orders/cancel", async (request, reply) => {
    const input = request.body as CancelOrderInput;
    const result = await runtime.cancelOrder(input);

    return reply.code(202).send(result);
  });

  app.post("/api/orders/:id/cancel", async (request, reply) => {
    const params = request.params as { id: string };
    const input = request.body as Partial<CancelOrderInput>;
    const result = await runtime.cancelOrder({
      accountId: input.accountId ?? runtime.getEngineState().account.accountId,
      orderId: params.id,
      requestedAt: input.requestedAt
    });

    return reply.code(202).send(result);
  });

  app.register(async (instance) => {
    instance.get("/ws", { websocket: true }, (socket) => {
      runtime.addSocket(socket);
    });
  });
};
