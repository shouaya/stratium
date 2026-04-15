import type { FastifyBaseLogger } from "fastify";
import type { AnyEventEnvelope, CancelOrderInput, CreateOrderInput, MarketTick } from "@stratium/shared";
import { AuthRuntime, type AuthRole, type AuthSession, type FrontendUserView, type PlatformSettingsView } from "./auth.js";
import { BatchJobStateFeed } from "./batch-job-state.js";
import { BatchJobRunner, type BatchJobDefinition, type BatchJobExecution, type BatchJobId, type BatchJobRunInput } from "./batch-job-runner.js";
import { loadApiBootstrapState } from "./bootstrap.js";
import { MarketRuntime, type MarketSimulatorState, type SocketLike, type SymbolConfigState } from "./market-runtime.js";
import {
  createPositionReplayPayload,
  createReplayPayload,
  createSocketBootstrapPayload,
  createSocketEventsPayload,
  createStatePayload
} from "./payloads.js";
import { TradingRepository } from "./repository.js";
import { TradingRuntime } from "./trading-runtime.js";
import { WebSocketHub } from "./websocket-hub.js";
export type { MarketSimulatorState, SocketLike, SymbolConfigState } from "./market-runtime.js";

export class ApiRuntime {
  private static readonly SOCKET_EVENT_BOOTSTRAP_LIMIT = 500;
  private readonly broadcastListeners = new Set<(accountId: string | undefined, events: AnyEventEnvelope[]) => void>();

  private readonly repository = new TradingRepository();

  private readonly webSocketHub = new WebSocketHub();

  private symbolConfigState: SymbolConfigState;
  private platformSettings: PlatformSettingsView = {
    platformName: "Stratium Demo",
    platformAnnouncement: "",
    allowFrontendTrading: true,
    allowManualTicks: true,
    allowSimulatorControl: true
  };

  private readonly marketSource = process.env.MARKET_SOURCE ?? "hyperliquid";

  private readonly hyperliquidCoin = process.env.HYPERLIQUID_COIN ?? "BTC";

  private readonly hyperliquidCandleInterval = process.env.HYPERLIQUID_CANDLE_INTERVAL ?? "1m";

  private readonly configuredTradingSymbol = process.env.TRADING_SYMBOL ?? `${this.hyperliquidCoin}-USD`;

  private readonly marketRuntime: MarketRuntime;

  private readonly tradingRuntime: TradingRuntime;
  private readonly authRuntime: AuthRuntime;
  private readonly batchJobRunner = new BatchJobRunner();
  private readonly batchJobStateFeed: BatchJobStateFeed;
  private runningBatchJobs: BatchJobExecution[] = [];
  private lastBatchJobExecution: BatchJobExecution | null = null;

  constructor(private readonly logger: FastifyBaseLogger) {
    this.symbolConfigState = {
      symbol: this.configuredTradingSymbol,
      coin: this.hyperliquidCoin,
      leverage: 10,
      maxLeverage: 10,
      szDecimals: 5,
      quoteAsset: "USDC"
    };

    this.marketRuntime = new MarketRuntime({
      logger,
      repository: this.repository,
      marketSource: this.marketSource,
      hyperliquidCoin: this.hyperliquidCoin,
      hyperliquidCandleInterval: this.hyperliquidCandleInterval,
      configuredTradingSymbol: this.configuredTradingSymbol,
      onLiveTick: async (tick) => this.tradingRuntime.handleLiveTick(tick),
      onBroadcast: () => {
        this.broadcast();
      }
    });

    this.tradingRuntime = new TradingRuntime({
      logger,
      repository: this.repository,
      onEvents: (accountId, events) => {
        this.broadcast(accountId, events);
      }
    });

    this.authRuntime = new AuthRuntime(this.repository);
    this.batchJobStateFeed = new BatchJobStateFeed(() => {
      this.runningBatchJobs = this.batchJobStateFeed.getRunningJobs();
      this.lastBatchJobExecution = this.batchJobStateFeed.getLastExecution();
      this.broadcast();
    });
  }

  getEngineState(accountId?: string) {
    return this.tradingRuntime.getEngineState(accountId);
  }

  getEventStore(accountId?: string) {
    return this.tradingRuntime.getEventStore(accountId);
  }

  getFillHistoryEvents(accountId?: string) {
    return this.tradingRuntime.getFillHistoryEvents(accountId);
  }

  async getFillHistoryPayload(accountId: string) {
    const persistedEvents = await this.repository.listFillHistoryEvents(accountId);
    const liveEvents = this.tradingRuntime.getFillHistoryEvents(accountId);
    const merged = new Map<string, AnyEventEnvelope>();

    for (const event of [...persistedEvents, ...liveEvents]) {
      const payload = event.payload as { fillId?: string };
      const mergeKey = payload.fillId ? `fill:${payload.fillId}` : `event:${event.eventId}`;
      merged.set(mergeKey, event);
    }

    return {
      sessionId: this.tradingRuntime.getEngineState(accountId).simulationSessionId,
      events: [...merged.values()].sort((left, right) => {
        const timeDelta = new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime();
        return timeDelta !== 0 ? timeDelta : left.sequence - right.sequence;
      })
    };
  }

  getMarketData() {
    return this.marketRuntime.getMarketData();
  }

  getMarketSimulatorState() {
    return this.marketRuntime.getMarketSimulatorState();
  }

  getSymbolConfigState() {
    return this.symbolConfigState;
  }

  getHyperliquidCoin() {
    return this.marketRuntime.getHyperliquidCoin();
  }

  getHyperliquidCandleInterval() {
    return this.marketRuntime.getHyperliquidCandleInterval();
  }

  getPlatformSettings() {
    return this.platformSettings;
  }

  getAccountIds() {
    return this.tradingRuntime.getAccountIds();
  }

  getStatePayload(accountId: string) {
    return createStatePayload({
      state: this.tradingRuntime.getEngineState(accountId),
      events: this.tradingRuntime.getRecentEventStore(accountId, ApiRuntime.SOCKET_EVENT_BOOTSTRAP_LIMIT),
      simulator: this.marketRuntime.getMarketSimulatorState(),
      market: this.marketRuntime.getMarketData(),
      symbolConfig: this.symbolConfigState,
      platform: this.platformSettings,
      batch: {
        runningJobs: this.runningBatchJobs,
        lastExecution: this.lastBatchJobExecution
      }
    });
  }

  getAdminStatePayload() {
    const primaryAccountId = this.tradingRuntime.getPrimaryAccountId();

    return {
      latestTick: primaryAccountId ? this.tradingRuntime.getEngineState(primaryAccountId).latestTick : null,
      simulator: this.marketRuntime.getMarketSimulatorState(),
      platform: this.platformSettings,
      accountIds: this.tradingRuntime.getAccountIds(),
      runningBatchJobs: this.runningBatchJobs,
      lastBatchJobExecution: this.lastBatchJobExecution
    };
  }

  async getReplayPayload(accountId: string, sessionId: string) {
    const replay = await this.tradingRuntime.getReplayData(accountId, sessionId);

    return createReplayPayload(
      sessionId,
      replay.state,
      replay.events,
      this.marketRuntime.getMarketSimulatorState(),
      this.marketRuntime.getMarketData(),
      this.platformSettings,
      {
        runningJobs: this.runningBatchJobs,
        lastExecution: this.lastBatchJobExecution
      }
    );
  }

  async getPositionReplayPayload(accountId: string, fillId: string) {
    const replay = await this.tradingRuntime.getPositionReplayData(accountId, fillId);

    return createPositionReplayPayload(
      replay.sessionId,
      fillId,
      replay.fills,
      replay.events,
      replay.marketEvents,
      replay.state
    );
  }

  async bootstrap(): Promise<void> {
    await this.repository.connect();
    this.platformSettings = await this.authRuntime.bootstrap();
    await this.batchJobStateFeed.connect();
    this.runningBatchJobs = this.batchJobStateFeed.getRunningJobs();
    this.lastBatchJobExecution = this.batchJobStateFeed.getLastExecution();
    const bootstrapState = await loadApiBootstrapState(this.repository, {
      configuredTradingSymbol: this.configuredTradingSymbol,
      hyperliquidCoin: this.hyperliquidCoin,
      hyperliquidCandleInterval: this.hyperliquidCandleInterval
    });
    const frontendUsers = await this.authRuntime.listFrontendUsers();

    await this.tradingRuntime.bootstrap({
      frontendAccountIds: frontendUsers
        .map((user) => user.tradingAccountId)
        .filter((accountId): accountId is string => Boolean(accountId)),
      persistedSymbolConfig: bootstrapState.persistedSymbolConfig
    });

    if (bootstrapState.persistedSymbolMeta) {
      this.symbolConfigState = bootstrapState.persistedSymbolMeta;
    } else if (bootstrapState.persistedSymbolConfig) {
      this.symbolConfigState = {
        ...this.symbolConfigState,
        leverage: bootstrapState.persistedSymbolConfig.leverage
      };
    }

    const primaryAccountId = this.tradingRuntime.getPrimaryAccountId();
    this.marketRuntime.setBootstrapState(
      primaryAccountId ? this.tradingRuntime.getEngineState(primaryAccountId).position.symbol : this.configuredTradingSymbol,
      primaryAccountId ? this.tradingRuntime.getEngineState(primaryAccountId).latestTick?.last : undefined,
      bootstrapState.persistedMarketSnapshot
    );

    await this.tradingRuntime.setBootstrapReady(true);
    this.marketRuntime.maybeStartConfiguredSource();
  }

  async shutdown(): Promise<void> {
    await this.tradingRuntime.setBootstrapReady(false);
    await this.marketRuntime.shutdown();
    await this.batchJobStateFeed.shutdown();
    await this.tradingRuntime.flushPersistence();
    await this.repository.close();
  }

  addSocket(socket: SocketLike, session: AuthSession): void {
    this.webSocketHub.addSocket(socket, (events = []) => {
      if (session.user.role === "admin") {
        const primaryAccountId = this.tradingRuntime.getPrimaryAccountId();

        return createSocketBootstrapPayload(
          primaryAccountId ? this.tradingRuntime.getEngineState(primaryAccountId) : {
            simulationSessionId: "session-admin",
            account: null,
            orders: [],
            position: null,
            latestTick: null
          },
          [],
          this.marketRuntime.getMarketSimulatorState(),
          this.marketRuntime.getMarketData(),
          this.platformSettings,
          {
            runningJobs: this.runningBatchJobs,
            lastExecution: this.lastBatchJobExecution
          }
        );
      }

      const accountId = session.user.tradingAccountId;

      if (!accountId) {
        throw new Error("Frontend user is missing a trading account.");
      }

      const state = this.tradingRuntime.getEngineState(accountId);
      const filteredEvents = events.filter((event) => event.accountId === accountId);

      return events.length === 0
        ? createSocketBootstrapPayload(
          state,
          this.tradingRuntime.getRecentEventStore(accountId, ApiRuntime.SOCKET_EVENT_BOOTSTRAP_LIMIT),
          this.marketRuntime.getMarketSimulatorState(),
          this.marketRuntime.getMarketData(),
          this.platformSettings,
          {
            runningJobs: this.runningBatchJobs,
            lastExecution: this.lastBatchJobExecution
          }
        )
        : createSocketEventsPayload(
          state,
          filteredEvents,
          this.marketRuntime.getMarketSimulatorState(),
          this.marketRuntime.getMarketData(),
          this.symbolConfigState,
          this.platformSettings,
          {
            runningJobs: this.runningBatchJobs,
            lastExecution: this.lastBatchJobExecution
          }
        );
    });
  }

  async login(username: string, password: string, role: AuthRole) {
    const session = await this.authRuntime.login(username, password, role);

    if (session.user.role === "frontend" && session.user.tradingAccountId) {
      await this.tradingRuntime.ensureFrontendAccount(session.user.tradingAccountId);
    }

    return session;
  }

  logout(token: string | undefined): void {
    this.authRuntime.logout(token);
  }

  getSession(token: string | undefined): AuthSession | null {
    return this.authRuntime.getSession(token);
  }

  async listFrontendUsers(): Promise<FrontendUserView[]> {
    return this.authRuntime.listFrontendUsers();
  }

  async createFrontendUser(input: {
    username: string;
    password: string;
    displayName: string;
    tradingAccountId?: string | null;
  }): Promise<FrontendUserView> {
    const user = await this.authRuntime.createFrontendUser(input);
    if (user.tradingAccountId) {
      await this.tradingRuntime.ensureFrontendAccount(user.tradingAccountId);
    }
    return user;
  }

  async updateFrontendUser(userId: string, input: {
    password?: string;
    displayName?: string;
    tradingAccountId?: string | null;
    isActive?: boolean;
  }): Promise<FrontendUserView> {
    const user = await this.authRuntime.updateFrontendUser(userId, input);
    if (user.tradingAccountId) {
      await this.tradingRuntime.ensureFrontendAccount(user.tradingAccountId);
    }
    return user;
  }

  async updatePlatformSettings(input: PlatformSettingsView): Promise<PlatformSettingsView> {
    this.platformSettings = await this.authRuntime.updatePlatformSettings(input);
    this.broadcast();
    return this.platformSettings;
  }

  listBatchJobs(): BatchJobDefinition[] {
    return this.batchJobRunner.listJobs();
  }

  async runBatchJob(jobId: BatchJobId, input: BatchJobRunInput = {}) {
    return this.batchJobRunner.run(jobId, input);
  }

  async listRunningBatchJobs(): Promise<BatchJobExecution[]> {
    return this.batchJobRunner.listRunningJobs();
  }

  async getBatchJobExecution(executionId: string): Promise<BatchJobExecution> {
    return this.batchJobRunner.getExecution(executionId);
  }

  removeSocket(socket: SocketLike): void {
    this.webSocketHub.removeSocket(socket);
  }

  async submitOrder(input: CreateOrderInput) {
    return this.tradingRuntime.submitOrder(input);
  }

  async cancelOrder(input: CancelOrderInput) {
    return this.tradingRuntime.cancelOrder(input);
  }

  getOrders(accountId: string) {
    return this.tradingRuntime.getOrders(accountId);
  }

  getOrderByClientOrderId(accountId: string, clientOrderId: string) {
    return this.tradingRuntime.getOrderByClientOrderId(accountId, clientOrderId);
  }

  async cancelAllOpenOrders(accountId: string, requestedAt?: string) {
    return this.tradingRuntime.cancelAllOpenOrders(accountId, requestedAt);
  }

  async ingestManualTick(tick: MarketTick): Promise<
    | { ok: true; result: ReturnType<ReturnType<TradingRuntime["getEngine"]>["ingestMarketTick"]> }
    | { ok: false; message: string }
  > {
    return this.tradingRuntime.ingestManualTick(
      tick,
      this.marketRuntime.getMarketSimulatorState().symbol
    );
  }

  async updateLeverage(symbol: string, leverage: number): Promise<void> {
    const nextSymbolConfigState = await this.tradingRuntime.updateLeverage(this.symbolConfigState, leverage);
    this.symbolConfigState = { ...nextSymbolConfigState, symbol };

    this.broadcast();
  }

  async getMarketHistory(limit: number) {
    return this.marketRuntime.getMarketHistory(limit);
  }

  async getMarketVolume(limit: number, interval: string, coin: string) {
    return this.marketRuntime.getMarketVolume(limit, interval, coin);
  }

  async getNextTriggerOrderOid(base?: number) {
    return this.repository.getNextTriggerOrderOid(base);
  }

  async upsertTriggerOrderHistory(input: Parameters<TradingRepository["upsertTriggerOrderHistory"]>[0]) {
    return this.repository.upsertTriggerOrderHistory(input);
  }

  async listTriggerOrderHistory(accountId: string) {
    return this.repository.listTriggerOrderHistory(accountId);
  }

  async listPendingTriggerOrders() {
    return this.repository.listPendingTriggerOrders();
  }

  async findTriggerOrder(accountId: string, oidOrCloid: number | string) {
    return this.repository.findTriggerOrder(accountId, oidOrCloid);
  }

  startMarketSimulator(
    payload: Partial<Pick<MarketSimulatorState, "intervalMs" | "driftBps" | "volatilityBps" | "anchorPrice">> = {}
  ): MarketSimulatorState {
    const primaryAccountId = this.tradingRuntime.getPrimaryAccountId();
    return this.marketRuntime.startMarketSimulator(
      payload,
      primaryAccountId ? this.tradingRuntime.getEngineState(primaryAccountId).latestTick : undefined
    );
  }

  stopMarketSimulator(): MarketSimulatorState {
    return this.marketRuntime.stopMarketSimulator();
  }

  async runMarketSimulationTick(): Promise<void> {
    const primaryAccountId = this.tradingRuntime.getPrimaryAccountId();
    await this.marketRuntime.runMarketSimulationTick(
      primaryAccountId ? this.tradingRuntime.getEngineState(primaryAccountId).latestTick ?? undefined : undefined
    );
  }

  setMarketSimulatorRunning(value: boolean): void {
    this.marketRuntime.setMarketSimulatorRunning(value);
  }

  setMarketTickInFlight(value: boolean): void {
    this.marketRuntime.setMarketTickInFlight(value);
  }

  private broadcast(accountId?: string, events: AnyEventEnvelope[] = []): void {
    this.webSocketHub.broadcast(accountId ? events.filter((event) => event.accountId === accountId) : events);
    for (const listener of this.broadcastListeners) {
      listener(accountId, accountId ? events.filter((event) => event.accountId === accountId) : events);
    }
  }

  onBroadcast(listener: (accountId: string | undefined, events: AnyEventEnvelope[]) => void): () => void {
    this.broadcastListeners.add(listener);
    return () => {
      this.broadcastListeners.delete(listener);
    };
  }

  private get engine() {
    return this.tradingRuntime.getEngine();
  }

  private async persistEvents(events: AnyEventEnvelope[]): Promise<void> {
    const primaryAccountId = this.tradingRuntime.getPrimaryAccountId();

    if (!primaryAccountId) {
      return;
    }

    await this.tradingRuntime.persistExternalEvents(primaryAccountId, events);
  }
}
