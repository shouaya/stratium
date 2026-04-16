import type { FastifyBaseLogger } from "fastify";
import type { AnyEventEnvelope, CancelOrderInput, CreateOrderInput, MarketTick } from "@stratium/shared";
import { AuthRuntime, type AuthRole, type AuthSession, type FrontendUserView, type PlatformSettingsView } from "../auth/auth.js";
import { BatchJobStateFeed } from "../batch/batch-job-state.js";
import { BatchJobRunner, type BatchJobDefinition, type BatchJobExecution, type BatchJobId, type BatchJobRunInput } from "../batch/batch-job-runner.js";
import { MarketRuntime, type SocketLike, type SymbolConfigState } from "../market/market-runtime.js";
import {
  createPositionReplayPayload,
} from "./payloads.js";
import { TradingRepository } from "../persistence/repository.js";
import { bootstrapApiRuntime } from "./api-runtime-bootstrap.js";
import {
  createApiAdminStatePayload,
  createApiReplayPayload,
  createApiStatePayload,
  createSocketPayloadFactory,
  filterBroadcastEvents
} from "./api-runtime-payloads.js";
import { runActiveSymbolSwitchBatchJob } from "./symbol-switch.js";
import { TradingRuntime } from "./trading-runtime.js";
import { WebSocketHub } from "./websocket-hub.js";
export type { SocketLike, SymbolConfigState } from "../market/market-runtime.js";

export class ApiRuntime {
  private static readonly SOCKET_EVENT_BOOTSTRAP_LIMIT = 500;
  private readonly broadcastListeners = new Set<(accountId: string | undefined, events: AnyEventEnvelope[]) => void>();

  private readonly repository = new TradingRepository();

  private readonly webSocketHub: WebSocketHub;

  private symbolConfigState: SymbolConfigState;
  private platformSettings: PlatformSettingsView = {
    platformName: "Stratium Demo",
    platformAnnouncement: "",
    activeExchange: process.env.TRADING_EXCHANGE ?? process.env.MARKET_SOURCE ?? "hyperliquid",
    activeSymbol: process.env.TRADING_SYMBOL ?? "BTC-USD",
    maintenanceMode: false,
    allowFrontendTrading: true,
    allowManualTicks: true
  };

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
    this.webSocketHub = new WebSocketHub(logger);
    this.symbolConfigState = {
      source: this.platformSettings.activeExchange,
      marketSymbol: this.hyperliquidCoin,
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
      configuredExchange: this.platformSettings.activeExchange,
      configuredCoin: this.hyperliquidCoin,
      configuredMarketSymbol: this.hyperliquidCoin,
      marketCandleInterval: this.hyperliquidCandleInterval,
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
    const sessionId = this.tradingRuntime.getEngineState(accountId).simulationSessionId;
    const persistedEvents = (await this.repository.loadEvents(sessionId))
      .filter((event) => event.eventType === "OrderFilled" || event.eventType === "OrderPartiallyFilled");
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

  getSymbolConfigState() {
    return this.symbolConfigState;
  }

  getActiveExchange() {
    const marketRuntime = this.marketRuntime as MarketRuntime & {
      getActiveExchange?: () => string;
    };
    return marketRuntime.getActiveExchange
      ? marketRuntime.getActiveExchange()
      : this.platformSettings.activeExchange;
  }

  getActiveCoin() {
    const marketRuntime = this.marketRuntime as MarketRuntime & {
      getActiveCoin?: () => string;
      getHyperliquidCoin?: () => string;
    };
    return marketRuntime.getActiveCoin
      ? marketRuntime.getActiveCoin()
      : (marketRuntime.getHyperliquidCoin?.() ?? this.hyperliquidCoin);
  }

  getHyperliquidCoin() {
    return this.getActiveCoin();
  }

  getHyperliquidCandleInterval() {
    const marketRuntime = this.marketRuntime as MarketRuntime & {
      getActiveCandleInterval?: () => string;
      getHyperliquidCandleInterval?: () => string;
    };
    return marketRuntime.getActiveCandleInterval
      ? marketRuntime.getActiveCandleInterval()
      : (marketRuntime.getHyperliquidCandleInterval?.() ?? this.hyperliquidCandleInterval);
  }

  getPlatformSettings() {
    return this.platformSettings;
  }

  getAccountIds() {
    return this.tradingRuntime.getAccountIds();
  }

  getStatePayload(accountId: string) {
    return createApiStatePayload(accountId, this.getPayloadContext());
  }

  getAdminStatePayload() {
    return createApiAdminStatePayload(this.getPayloadContext());
  }

  async getReplayPayload(accountId: string, sessionId: string) {
    return createApiReplayPayload(accountId, sessionId, this.getPayloadContext());
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
    const bootstrapState = await bootstrapApiRuntime({
      repository: this.repository,
      authRuntime: this.authRuntime,
      tradingRuntime: this.tradingRuntime,
      marketRuntime: this.marketRuntime,
      batchJobStateFeed: this.batchJobStateFeed,
      symbolConfigState: this.symbolConfigState,
      configuredTradingSymbol: this.configuredTradingSymbol,
      fallbackCoin: this.hyperliquidCoin,
      hyperliquidCandleInterval: this.hyperliquidCandleInterval
    });

    this.platformSettings = bootstrapState.platformSettings;
    this.symbolConfigState = bootstrapState.symbolConfigState;
    this.runningBatchJobs = bootstrapState.runningBatchJobs;
    this.lastBatchJobExecution = bootstrapState.lastBatchJobExecution;
  }

  async shutdown(): Promise<void> {
    await this.tradingRuntime.setBootstrapReady(false);
    await this.marketRuntime.shutdown();
    await this.batchJobStateFeed.shutdown();
    await this.tradingRuntime.flushPersistence();
    await this.repository.close();
  }

  addSocket(socket: SocketLike, session: AuthSession): void {
    this.webSocketHub.addSocket(socket, createSocketPayloadFactory(session, this.getPayloadContext()));
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
    if (jobId === "batch-switch-active-symbol") {
      return runActiveSymbolSwitchBatchJob({
        input,
        platformSettings: this.platformSettings,
        repository: this.repository,
        tradingRuntime: this.tradingRuntime,
        batchJobRunner: this.batchJobRunner,
        updatePlatformSettings: async (settings) => this.updatePlatformSettings(settings)
      });
    }

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

  getSessionStartedAt(accountId: string) {
    return this.tradingRuntime.getSessionStartedAt(accountId);
  }

  async cancelAllOpenOrders(accountId: string, requestedAt?: string) {
    return this.tradingRuntime.cancelAllOpenOrders(accountId, requestedAt);
  }

  async ingestManualTick(tick: MarketTick): Promise<
    | { ok: true; result: ReturnType<ReturnType<TradingRuntime["getEngine"]>["ingestMarketTick"]> }
    | { ok: false; message: string }
  > {
    const result = await this.tradingRuntime.ingestManualTick(
      tick,
      this.symbolConfigState.symbol
    );

    if (result.ok) {
      await this.marketRuntime.ingestManualTick(tick);
    }

    return result;
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

  async listAvailableSymbolConfigMeta() {
    return this.repository.listAvailableSymbolConfigMeta();
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

  setMarketTickInFlight(value: boolean): void {
    this.marketRuntime.setMarketTickInFlight(value);
  }

  private broadcast(accountId?: string, events: AnyEventEnvelope[] = []): void {
    const filteredEvents = filterBroadcastEvents(accountId, events);
    this.webSocketHub.broadcast(filteredEvents);
    for (const listener of this.broadcastListeners) {
      listener(accountId, filteredEvents);
    }
  }

  private getPayloadContext() {
    return {
      tradingRuntime: this.tradingRuntime,
      marketRuntime: this.marketRuntime,
      symbolConfigState: this.symbolConfigState,
      platformSettings: this.platformSettings,
      batch: {
        runningJobs: this.runningBatchJobs,
        lastExecution: this.lastBatchJobExecution
      },
      socketEventBootstrapLimit: ApiRuntime.SOCKET_EVENT_BOOTSTRAP_LIMIT
    };
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
