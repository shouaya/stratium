import { describe, expect, it } from "vitest";
import { TradingEngine, createInitialTradingState } from "../../src";

describe("TradingEngine internals", () => {
  it("exposes working internal orchestration helpers", () => {
    const engine = new TradingEngine(createInitialTradingState());
    const internal = engine as unknown as {
      setState: (state: ReturnType<TradingEngine["getState"]>) => void;
      incrementNextFillId: () => number;
      buildAccountBalancePayload: () => {
        walletBalance: number;
        availableBalance: number;
        positionMargin: number;
        orderMargin: number;
        equity: number;
      };
      buildMarginPayload: () => {
        initialMargin: number;
        maintenanceMargin: number;
        riskRatio: number;
        liquidationPrice: number;
      };
      createRefreshAccountHandlerContext: () => {
        getState: () => ReturnType<TradingEngine["getState"]>;
        setState: (state: ReturnType<TradingEngine["getState"]>) => void;
        getSymbolConfig: () => ReturnType<TradingEngine["getSymbolConfig"]>;
        refreshAccountState: () => void;
        buildAccountBalancePayload: () => unknown;
        buildMarginPayload: () => unknown;
      };
      createSubmitOrderHandlerContext: () => {
        getState: () => ReturnType<TradingEngine["getState"]>;
        getSymbolConfig: () => ReturnType<TradingEngine["getSymbolConfig"]>;
        now: () => string;
      };
      createMarketTickHandlerContext: () => {
        getState: () => ReturnType<TradingEngine["getState"]>;
      };
      createFillOrderHandlerContext: () => {
        getState: () => ReturnType<TradingEngine["getState"]>;
        incrementNextFillId: () => number;
      };
      createPostFillHandlerContext: () => {
        getState: () => ReturnType<TradingEngine["getState"]>;
        getCurrentFillId: () => number;
      };
      createCancelOrderHandlerContext: () => {
        getState: () => ReturnType<TradingEngine["getState"]>;
        now: () => string;
      };
    };

    internal.setState({
      ...engine.getState(),
      account: {
        ...engine.getState().account,
        walletBalance: 1200,
        equity: 1210,
        availableBalance: 1190,
        positionMargin: 20,
        riskRatio: 0.1
      },
      position: {
        ...engine.getState().position,
        symbol: "BTC-USD",
        initialMargin: 20,
        maintenanceMargin: 10,
        liquidationPrice: 80
      }
    });

    expect(internal.incrementNextFillId()).toBe(1);
    expect(internal.buildAccountBalancePayload()).toEqual({
      walletBalance: 1200,
      availableBalance: 1190,
      positionMargin: 20,
      orderMargin: 0,
      equity: 1210
    });
    expect(internal.buildMarginPayload()).toEqual({
      initialMargin: 20,
      maintenanceMargin: 10,
      riskRatio: 0.1,
      liquidationPrice: 80
    });

    const refreshContext = internal.createRefreshAccountHandlerContext();
    expect(refreshContext.getState().account.walletBalance).toBe(1200);
    refreshContext.setState(engine.getState());
    expect(refreshContext.getSymbolConfig().symbol).toBe("BTC-USD");
    expect(refreshContext.buildAccountBalancePayload()).toEqual(internal.buildAccountBalancePayload());
    expect(refreshContext.buildMarginPayload()).toEqual(internal.buildMarginPayload());
    refreshContext.refreshAccountState();

    expect(internal.createSubmitOrderHandlerContext().getState().simulationSessionId).toBe("session-1");
    expect(internal.createSubmitOrderHandlerContext().getSymbolConfig().symbol).toBe("BTC-USD");
    expect(typeof internal.createSubmitOrderHandlerContext().now()).toBe("string");
    expect(internal.createMarketTickHandlerContext().getState().simulationSessionId).toBe("session-1");
    expect(internal.createFillOrderHandlerContext().getState().simulationSessionId).toBe("session-1");
    expect(internal.createFillOrderHandlerContext().incrementNextFillId()).toBe(2);
    expect(internal.createPostFillHandlerContext().getState().simulationSessionId).toBe("session-1");
    expect(internal.createPostFillHandlerContext().getCurrentFillId()).toBe(3);
    expect(internal.createCancelOrderHandlerContext().getState().simulationSessionId).toBe("session-1");
    expect(typeof internal.createCancelOrderHandlerContext().now()).toBe("string");
  });
});
