import type { FastifyInstance } from "fastify";
import type { CancelOrderInput, CreateOrderInput, MarketTick } from "@stratium/shared";
import { getMessages, localizeRuntimeMessage, resolveLocale } from "./locale";
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
    const locale = resolveLocale(request as never);
    const messages = getMessages(locale);
    const session = runtime.getSession(getToken(request));

    if (!session || session.user.role !== role) {
      reply.code(401).send({
        status: "unauthorized",
        message: role === "admin" ? messages.auth.loginRequiredForAdmin : messages.auth.loginRequiredForFrontend
      });
      return null;
    }

    return session;
  };

  app.get("/health", async () => ({
    status: "ok"
  }));

  app.post("/api/auth/login", async (request, reply) => {
    const locale = resolveLocale(request as never);
    const messages = getMessages(locale);
    const payload = request.body as { username?: string; password?: string; role?: "frontend" | "admin" };

    if (!payload.username || !payload.password || !payload.role) {
      return reply.code(400).send({
        status: "rejected",
        message: messages.auth.loginFieldsRequired
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
        message: error instanceof Error && error.message !== "Invalid credentials." ? error.message : messages.auth.invalidCredentials
      });
    }
  });

  app.get("/api/auth/me", async (request, reply) => {
    const locale = resolveLocale(request as never);
    const messages = getMessages(locale);
    const session = runtime.getSession(getToken(request));

    if (!session) {
      return reply.code(401).send({
        status: "unauthorized",
        message: messages.auth.loginRequired
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
    const locale = resolveLocale(request as never);
    const messages = getMessages(locale);
    const session = runtime.getSession(getToken(request));
    if (!session) {
      return reply.code(401).send({ status: "unauthorized", message: messages.auth.loginRequired });
    }

    const query = request.query as { limit?: string };
    const limit = Number(query.limit ?? 200);

    return runtime.getMarketHistory(limit);
  });

  app.get("/api/market-volume", async (request, reply) => {
    const locale = resolveLocale(request as never);
    const messages = getMessages(locale);
    const session = runtime.getSession(getToken(request));
    if (!session) {
      return reply.code(401).send({ status: "unauthorized", message: messages.auth.loginRequired });
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
    const locale = resolveLocale(request as never);
    const messages = getMessages(locale);

    const payload = request.body as {
      username?: string;
      password?: string;
      displayName?: string;
      tradingAccountId?: string | null;
    };

    if (!payload.username || !payload.password || !payload.displayName) {
      return reply.code(400).send({
        status: "rejected",
        message: messages.admin.createUserFieldsRequired
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

  app.get("/api/admin/batch-jobs", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) {
      return;
    }

    return {
      jobs: runtime.listBatchJobs()
    };
  });

  app.get("/api/admin/batch-job-executions/running", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) {
      return;
    }

    const messages = getMessages(resolveLocale(request));

    try {
      const jobs = await runtime.listRunningBatchJobs();
      return reply.send({ jobs });
    } catch (error) {
      return reply.code(500).send({
        message: error instanceof Error ? error.message : messages.admin.batchJobRequestFailed
      });
    }
  });

  app.get("/api/admin/batch-job-executions/:executionId", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) {
      return;
    }

    const messages = getMessages(resolveLocale(request));
    const params = request.params as { executionId: string };

    try {
      const execution = await runtime.getBatchJobExecution(params.executionId);
      return reply.send(execution);
    } catch (error) {
      return reply.code(500).send({
        message: error instanceof Error ? error.message : messages.admin.batchJobRequestFailed
      });
    }
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

  app.post("/api/admin/batch-jobs/:jobId/run", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) {
      return;
    }
    const locale = resolveLocale(request as never);
    const messages = getMessages(locale);

    const params = request.params as { jobId: "db-bootstrap" | "batch-clear-kline" | "batch-import-hl-day" | "batch-refresh-hl-day" };
    const payload = request.body as {
      coin?: string;
      date?: string;
      interval?: string;
    };

    try {
      const result = await runtime.runBatchJob(params.jobId, payload ?? {});
      const statusCode = result.status === "running"
        ? 202
        : result.ok === false
          ? 500
          : 200;

      return reply.code(statusCode).send(result);
    } catch (error) {
      return reply.code(400).send({
        ok: false,
        message: error instanceof Error ? error.message : messages.admin.batchJobRequestFailed
      });
    }
  });

  app.post("/api/leverage", async (request, reply) => {
    const session = requireRole(request, reply, "frontend");
    if (!session) {
      return;
    }
    const locale = resolveLocale(request as never);
    const messages = getMessages(locale);
    const payload = request.body as { symbol?: string; leverage?: number };
    const symbolConfigState = runtime.getSymbolConfigState();
    const symbol = payload.symbol ?? symbolConfigState.symbol;
    const requestedLeverage = Number(payload.leverage);

    if (!Number.isFinite(requestedLeverage)) {
      return reply.code(400).send({
        status: "rejected",
        message: messages.trading.leverageMustBeNumber
      });
    }

    const leverage = Math.floor(requestedLeverage);

    if (leverage < 1) {
      return reply.code(400).send({
        status: "rejected",
        message: messages.trading.leverageMin
      });
    }

    if (symbol !== symbolConfigState.symbol) {
      return reply.code(400).send({
        status: "rejected",
        message: messages.trading.leverageWrongSymbol
      });
    }

    if (leverage > symbolConfigState.maxLeverage) {
      return reply.code(400).send({
        status: "rejected",
        message: messages.trading.leverageMax(symbolConfigState.maxLeverage, symbol)
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
    const locale = resolveLocale(request as never);
    const messages = getMessages(locale);

    if (!runtime.getPlatformSettings().allowSimulatorControl) {
      return reply.code(403).send({
        status: "rejected",
        message: messages.admin.simulatorDisabled
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
    const locale = resolveLocale(request as never);
    const messages = getMessages(locale);

    if (!runtime.getPlatformSettings().allowSimulatorControl) {
      return reply.code(403).send({
        status: "rejected",
        message: messages.admin.simulatorDisabled
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
    const locale = resolveLocale(request as never);
    const messages = getMessages(locale);

    if (!runtime.getPlatformSettings().allowManualTicks) {
      return reply.code(403).send({
        status: "rejected",
        message: messages.admin.manualTicksDisabled
      });
    }

    const tick = request.body as MarketTick;
    const result = await runtime.ingestManualTick(tick);

    if (!result.ok) {
      return reply.code(400).send({
        status: "rejected",
        message: localizeRuntimeMessage(locale, result.message)
      });
    }

    return reply.code(202).send(result.result);
  });

  app.post("/api/orders", async (request, reply) => {
    const session = requireRole(request, reply, "frontend");
    if (!session) {
      return;
    }
    const locale = resolveLocale(request as never);
    const messages = getMessages(locale);

    if (!runtime.getPlatformSettings().allowFrontendTrading) {
      return reply.code(403).send({
        status: "rejected",
        message: messages.admin.tradingDisabled
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
