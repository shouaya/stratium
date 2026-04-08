import type { FastifyInstance } from "fastify";
import type { CancelOrderInput, CreateOrderInput, MarketTick } from "@stratium/shared";
import type { ApiRuntime, MarketSimulatorState } from "./runtime";

export const registerRoutes = async (app: FastifyInstance, runtime: ApiRuntime): Promise<void> => {
  const getToken = (request: { headers: { authorization?: string | string[] | undefined }; query?: unknown }): string | undefined => {
    const authorization = Array.isArray(request.headers.authorization)
      ? request.headers.authorization[0]
      : request.headers.authorization;

    if (authorization?.startsWith("Bearer ")) {
      return authorization.slice("Bearer ".length).trim();
    }

    return typeof request.query === "object" && request.query !== null && "token" in request.query
      ? (request.query as { token?: string }).token
      : undefined;
  };

  const requireRole = (
    request: { headers: { authorization?: string | string[] | undefined }; query?: unknown },
    reply: { code(code: number): { send(payload: unknown): unknown } },
    role: "frontend" | "admin"
  ) => {
    const session = runtime.getSession(getToken(request));

    if (!session || session.user.role !== role) {
      reply.code(401).send({
        status: "unauthorized",
        message: `Login required for ${role}.`
      });
      return null;
    }

    return session;
  };

  app.get("/health", async () => ({
    status: "ok"
  }));

  app.post("/api/auth/login", async (request, reply) => {
    const payload = request.body as { username?: string; password?: string; role?: "frontend" | "admin" };

    if (!payload.username || !payload.password || !payload.role) {
      return reply.code(400).send({
        status: "rejected",
        message: "username, password, and role are required."
      });
    }

    try {
      const session = await runtime.login(payload.username, payload.password, payload.role);
      return reply.code(200).send({
        status: "ok",
        token: session.token,
        user: session.user,
        platform: runtime.getPlatformSettings()
      });
    } catch (error) {
      return reply.code(401).send({
        status: "unauthorized",
        message: error instanceof Error ? error.message : "Login failed."
      });
    }
  });

  app.get("/api/auth/me", async (request, reply) => {
    const session = runtime.getSession(getToken(request));

    if (!session) {
      return reply.code(401).send({
        status: "unauthorized",
        message: "Login required."
      });
    }

    return {
      user: session.user,
      platform: runtime.getPlatformSettings()
    };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    runtime.logout(getToken(request));
    return reply.code(204).send();
  });

  app.get("/api/state", async (request, reply) => {
    const session = requireRole(request, reply, "frontend");
    if (!session) {
      return;
    }

    return runtime.getStatePayload();
  });

  app.get("/api/market-history", async (request, reply) => {
    const session = runtime.getSession(getToken(request));
    if (!session) {
      return reply.code(401).send({ status: "unauthorized", message: "Login required." });
    }

    const query = request.query as { limit?: string };
    const limit = Number(query.limit ?? 200);

    return runtime.getMarketHistory(limit);
  });

  app.get("/api/market-volume", async (request, reply) => {
    const session = runtime.getSession(getToken(request));
    if (!session) {
      return reply.code(401).send({ status: "unauthorized", message: "Login required." });
    }

    const query = request.query as { limit?: string; interval?: string; coin?: string };
    const limit = Number(query.limit ?? 500);
    const interval = query.interval ?? runtime.getHyperliquidCandleInterval();
    const coin = query.coin ?? runtime.getHyperliquidCoin();

    return runtime.getMarketVolume(limit, interval, coin);
  });

  app.get("/api/account", async (request, reply) => {
    if (!requireRole(request, reply, "frontend")) {
      return;
    }
    return runtime.getEngineState().account;
  });
  app.get("/api/orders", async (request, reply) => {
    if (!requireRole(request, reply, "frontend")) {
      return;
    }
    return runtime.getEngineState().orders;
  });
  app.get("/api/positions", async (request, reply) => {
    if (!requireRole(request, reply, "frontend")) {
      return;
    }
    return runtime.getEngineState().position;
  });
  app.get("/api/events", async (request, reply) => {
    if (!requireRole(request, reply, "frontend")) {
      return;
    }

    return {
      sessionId: runtime.getEngineState().simulationSessionId,
      events: runtime.getEventStore()
    };
  });
  app.get("/api/replay/:sessionId", async (request, reply) => {
    if (!requireRole(request, reply, "frontend")) {
      return;
    }
    return runtime.getReplayPayload((request.params as { sessionId: string }).sessionId);
  });
  app.get("/api/market-simulator", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) {
      return;
    }
    return runtime.getMarketSimulatorState();
  });

  app.get("/api/admin/users", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) {
      return;
    }

    return {
      users: await runtime.listFrontendUsers()
    };
  });

  app.get("/api/admin/state", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) {
      return;
    }

    return runtime.getAdminStatePayload();
  });

  app.post("/api/admin/users", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) {
      return;
    }

    const payload = request.body as {
      username?: string;
      password?: string;
      displayName?: string;
      tradingAccountId?: string | null;
    };

    if (!payload.username || !payload.password || !payload.displayName) {
      return reply.code(400).send({
        status: "rejected",
        message: "username, password, and displayName are required."
      });
    }

    const user = await runtime.createFrontendUser({
      username: payload.username,
      password: payload.password,
      displayName: payload.displayName,
      tradingAccountId: payload.tradingAccountId
    });

    return reply.code(201).send({
      status: "created",
      user
    });
  });

  app.put("/api/admin/users/:id", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) {
      return;
    }

    const params = request.params as { id: string };
    const payload = request.body as {
      password?: string;
      displayName?: string;
      tradingAccountId?: string | null;
      isActive?: boolean;
    };

    const user = await runtime.updateFrontendUser(params.id, payload);

    return {
      status: "updated",
      user
    };
  });

  app.get("/api/admin/platform-settings", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) {
      return;
    }

    return runtime.getPlatformSettings();
  });

  app.put("/api/admin/platform-settings", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) {
      return;
    }

    const payload = request.body as {
      platformName?: string;
      platformAnnouncement?: string;
      allowFrontendTrading?: boolean;
      allowManualTicks?: boolean;
      allowSimulatorControl?: boolean;
    };

    return runtime.updatePlatformSettings({
      platformName: payload.platformName?.trim() || "Stratium Demo",
      platformAnnouncement: payload.platformAnnouncement?.trim() ?? "",
      allowFrontendTrading: payload.allowFrontendTrading ?? true,
      allowManualTicks: payload.allowManualTicks ?? true,
      allowSimulatorControl: payload.allowSimulatorControl ?? true
    });
  });

  app.post("/api/leverage", async (request, reply) => {
    const session = requireRole(request, reply, "frontend");
    if (!session) {
      return;
    }
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
    if (!requireRole(request, reply, "admin")) {
      return;
    }

    if (!runtime.getPlatformSettings().allowSimulatorControl) {
      return reply.code(403).send({
        status: "rejected",
        message: "Simulator control is disabled by platform settings."
      });
    }

    const payload = (request.body as Partial<Pick<MarketSimulatorState, "intervalMs" | "driftBps" | "volatilityBps" | "anchorPrice">>) ?? {};
    const simulator = runtime.startMarketSimulator(payload);

    return reply.code(202).send({
      status: "started",
      simulator
    });
  });

  app.post("/api/market-simulator/stop", async (_request, reply) => {
    const request = _request;
    if (!requireRole(request, reply, "admin")) {
      return;
    }

    if (!runtime.getPlatformSettings().allowSimulatorControl) {
      return reply.code(403).send({
        status: "rejected",
        message: "Simulator control is disabled by platform settings."
      });
    }

    const simulator = runtime.stopMarketSimulator();

    return reply.code(202).send({
      status: "stopped",
      simulator
    });
  });

  app.post("/api/market-ticks", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) {
      return;
    }

    if (!runtime.getPlatformSettings().allowManualTicks) {
      return reply.code(403).send({
        status: "rejected",
        message: "Manual ticks are disabled by platform settings."
      });
    }

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
    const session = requireRole(request, reply, "frontend");
    if (!session) {
      return;
    }

    if (!runtime.getPlatformSettings().allowFrontendTrading) {
      return reply.code(403).send({
        status: "rejected",
        message: "Trading is disabled by platform settings."
      });
    }

    const input = request.body as CreateOrderInput;
    const result = await runtime.submitOrder({
      ...input,
      accountId: session.user.tradingAccountId ?? runtime.getEngineState().account.accountId
    });

    return reply.code(202).send(result);
  });

  app.post("/api/orders/cancel", async (request, reply) => {
    const session = requireRole(request, reply, "frontend");
    if (!session) {
      return;
    }

    const input = request.body as CancelOrderInput;
    const result = await runtime.cancelOrder({
      ...input,
      accountId: session.user.tradingAccountId ?? runtime.getEngineState().account.accountId
    });

    return reply.code(202).send(result);
  });

  app.post("/api/orders/:id/cancel", async (request, reply) => {
    const session = requireRole(request, reply, "frontend");
    if (!session) {
      return;
    }
    const params = request.params as { id: string };
    const input = request.body as Partial<CancelOrderInput>;
    const result = await runtime.cancelOrder({
      accountId: session.user.tradingAccountId ?? input.accountId ?? runtime.getEngineState().account.accountId,
      orderId: params.id,
      requestedAt: input.requestedAt
    });

    return reply.code(202).send(result);
  });

  app.register(async (instance) => {
    instance.get("/ws", { websocket: true }, (socket, request) => {
      const session = runtime.getSession(getToken(request as never));
      if (!session) {
        socket.close();
        return;
      }
      runtime.addSocket(socket);
    });
  });
};
