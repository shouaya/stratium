import type { FastifyBaseLogger } from "fastify";
import type { AnyEventEnvelope, CancelOrderInput, CreateOrderInput, MarketTick } from "@stratium/shared";
import { AuthRuntime, type AuthRole, type AuthSession, type FrontendUserView, type PlatformSettingsView } from "./auth";
import { BatchJobStateFeed } from "./batch-job-state";
import { BatchJobRunner, type BatchJobDefinition, type BatchJobExecution, type BatchJobId, type BatchJobRunInput } from "./batch-job-runner";
import { loadApiBootstrapState } from "./bootstrap";
import { MarketRuntime, type MarketSimulatorState, type SocketLike, type SymbolConfigState } from "./market-runtime";
import {
  createReplayPayload,
  createSocketBootstrapPayload,
  createSocketEventsPayload,
  createStatePayload
} from "./payloads";
import { TradingRepository } from "./repository";
import { TradingRuntime } from "./trading-runtime";
import { WebSocketHub } from "./websocket-hub";
export type { MarketSimulatorState, SocketLike, SymbolConfigState } from "./market-runtime";

export class ApiRuntime {
  private static readonly SOCKET_EVENT_BOOTSTRAP_LIMIT = 500;

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

  getReplayPayload(accountId: string, sessionId: string) {
    return createReplayPayload(
      sessionId,
      this.tradingRuntime.getReplayState(accountId),
      this.tradingRuntime.getEventStore(accountId),
      this.marketRuntime.getMarketSimulatorState(),
      this.marketRuntime.getMarketData(),
      this.platformSettings,
      {
        runningJobs: this.runningBatchJobs,
        lastExecution: this.lastBatchJobExecution
      }
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
