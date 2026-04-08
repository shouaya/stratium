import type { FastifyBaseLogger } from "fastify";
import type { AnyEventEnvelope, CancelOrderInput, CreateOrderInput, MarketTick } from "@stratium/shared";
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
  private readonly repository = new TradingRepository();

  private readonly webSocketHub = new WebSocketHub();

  private symbolConfigState: SymbolConfigState;

  private readonly marketSource = process.env.MARKET_SOURCE ?? "hyperliquid";

  private readonly hyperliquidCoin = process.env.HYPERLIQUID_COIN ?? "BTC";

  private readonly hyperliquidCandleInterval = process.env.HYPERLIQUID_CANDLE_INTERVAL ?? "1m";

  private readonly configuredTradingSymbol = process.env.TRADING_SYMBOL ?? `${this.hyperliquidCoin}-USD`;

  private readonly marketRuntime: MarketRuntime;

  private readonly tradingRuntime: TradingRuntime;

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
      onEvents: (events) => {
        this.broadcast(events);
      }
    });
  }

  getEngineState() {
    return this.tradingRuntime.getEngineState();
  }

  getEventStore() {
    return this.tradingRuntime.getEventStore();
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

  getStatePayload() {
    return createStatePayload({
      state: this.tradingRuntime.getEngineState(),
      events: this.tradingRuntime.getEventStore(),
      simulator: this.marketRuntime.getMarketSimulatorState(),
      market: this.marketRuntime.getMarketData(),
      symbolConfig: this.symbolConfigState
    });
  }

  getReplayPayload(sessionId: string) {
    return createReplayPayload(
      sessionId,
      this.tradingRuntime.getReplayState(this.tradingRuntime.getEngineState().simulationSessionId),
      this.tradingRuntime.getEventStore(),
      this.marketRuntime.getMarketSimulatorState(),
      this.marketRuntime.getMarketData()
    );
  }

  async bootstrap(): Promise<void> {
    await this.repository.connect();
    const bootstrapState = await loadApiBootstrapState(this.repository, {
      sessionId: "session-1",
      configuredTradingSymbol: this.configuredTradingSymbol,
      hyperliquidCoin: this.hyperliquidCoin,
      hyperliquidCandleInterval: this.hyperliquidCandleInterval
    });

    await this.tradingRuntime.bootstrap({
      sessionId: "session-1",
      persistedEvents: bootstrapState.persistedEvents,
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

    this.marketRuntime.setBootstrapState(
      this.tradingRuntime.getEngineState().position.symbol,
      this.tradingRuntime.getEngineState().latestTick?.last,
      bootstrapState.persistedMarketSnapshot
    );

    this.tradingRuntime.setBootstrapReady(true);
    this.marketRuntime.maybeStartConfiguredSource();
  }

  async shutdown(): Promise<void> {
    this.tradingRuntime.setBootstrapReady(false);
    await this.marketRuntime.shutdown();
    await this.tradingRuntime.flushPersistence();
    await this.repository.close();
  }

  addSocket(socket: SocketLike): void {
    this.webSocketHub.addSocket(
      socket,
      createSocketBootstrapPayload(
        this.tradingRuntime.getEngineState(),
        this.tradingRuntime.getEventStore(),
        this.marketRuntime.getMarketSimulatorState(),
        this.marketRuntime.getMarketData()
      )
    );
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
    return this.marketRuntime.startMarketSimulator(payload, this.tradingRuntime.getEngineState().latestTick);
  }

  stopMarketSimulator(): MarketSimulatorState {
    return this.marketRuntime.stopMarketSimulator();
  }

  async runMarketSimulationTick(): Promise<void> {
    await this.marketRuntime.runMarketSimulationTick(this.tradingRuntime.getEngineState().latestTick ?? undefined);
  }

  setMarketSimulatorRunning(value: boolean): void {
    this.marketRuntime.setMarketSimulatorRunning(value);
  }

  setMarketTickInFlight(value: boolean): void {
    this.marketRuntime.setMarketTickInFlight(value);
  }

  private createSocketPayload(events: AnyEventEnvelope[] = []) {
    return createSocketEventsPayload(
      this.tradingRuntime.getEngineState(),
      events,
      this.marketRuntime.getMarketSimulatorState(),
      this.marketRuntime.getMarketData(),
      this.symbolConfigState
    );
  }

  private broadcast(events: AnyEventEnvelope[] = []): void {
    this.webSocketHub.broadcast(this.createSocketPayload(events));
  }

  private get engine() {
    return this.tradingRuntime.getEngine();
  }

  private async persistEvents(events: AnyEventEnvelope[]): Promise<void> {
    await this.tradingRuntime.persistExternalEvents(events);
  }
}
