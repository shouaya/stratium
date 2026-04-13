import type { HyperliquidMarketSnapshot } from "./hyperliquid-market.js";
import { hyperliquidCompatAddressForAccountId, matchesHyperliquidCompatUser } from "./hyperliquid-user.js";

const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface HyperliquidInfoRequest {
  type?: string;
  coin?: string;
  user?: string;
  oid?: number | string;
  req?: {
    coin?: string;
    interval?: string;
    startTime?: number;
    endTime?: number;
  };
}

export interface HyperliquidInfoRuntime {
  getMarketData(): HyperliquidMarketSnapshot;
  getMarketHistory(limit: number): Promise<{
    coin: string;
    interval: string;
    candles: Array<{
      openTime: number;
      closeTime: number;
      coin: string;
      interval: string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      tradeCount: number;
    }>;
    trades: Array<{
      coin: string;
      side: "buy" | "sell";
      price: number;
      size: number;
      time: number;
      id: string;
    }>;
    book: HyperliquidMarketSnapshot["book"];
    assetCtx?: HyperliquidMarketSnapshot["assetCtx"];
  }>;
  getSymbolConfigState(): {
    coin: string;
    maxLeverage: number;
    leverage: number;
    szDecimals: number;
  };
  getEngineState(accountId: string): {
    account: {
      walletBalance: number;
      availableBalance: number;
      positionMargin: number;
      orderMargin: number;
      equity: number;
      realizedPnl: number;
      unrealizedPnl: number;
      riskRatio: number;
    } | null;
    position: {
      symbol: string;
      side: "long" | "short" | "flat";
      quantity: number;
      averageEntryPrice: number;
      markPrice: number;
      unrealizedPnl: number;
      liquidationPrice: number;
      initialMargin: number;
      maintenanceMargin: number;
    } | null;
  };
  getOrders(accountId: string): Array<{
    id: string;
    clientOrderId?: string;
    symbol: string;
    side: "buy" | "sell";
    status: string;
    quantity: number;
    remainingQuantity: number;
    limitPrice?: number;
    createdAt: string;
    updatedAt: string;
  }>;
  getOrderByClientOrderId(accountId: string, clientOrderId: string): {
    id: string;
    clientOrderId?: string;
    symbol: string;
    side: "buy" | "sell";
    status: string;
    quantity: number;
    remainingQuantity: number;
    limitPrice?: number;
    createdAt: string;
    updatedAt: string;
  } | undefined;
  getVirtualOpenOrders?(accountId: string): Promise<Array<{
    coin: string;
    side: "A" | "B";
    limitPx: string;
    sz: string;
    oid: number;
    timestamp: number;
    origSz: string;
    cloid?: string;
    grouping?: "normalTpsl" | "positionTpsl";
    triggerCondition?: {
      triggerPx: string;
      isMarket: boolean;
      tpsl: "tp" | "sl";
    };
  }>>;
  getVirtualOrderStatus?(accountId: string, oidOrCloid: number | string): Promise<{
    order: {
      coin: string;
      side: "A" | "B";
      limitPx: string;
      sz: string;
      oid: number;
      timestamp: number;
      origSz: string;
      cloid?: string;
      triggerCondition?: {
        triggerPx: string;
        isMarket: boolean;
        tpsl: "tp" | "sl";
      };
    };
    status: string;
    statusTimestamp: number;
  } | undefined>;
}

const asString = (value: number | undefined): string | null =>
  value == null ? null : String(value);

const mapUniverse = (runtime: HyperliquidInfoRuntime) => {
  const symbol = runtime.getSymbolConfigState();
  return [{
    szDecimals: symbol.szDecimals,
    name: symbol.coin,
    maxLeverage: symbol.maxLeverage,
    marginTableId: 1
  }];
};

const mapMeta = (runtime: HyperliquidInfoRuntime) => ({
  universe: mapUniverse(runtime),
  marginTables: [[
    1,
    {
      description: "stratium-single-symbol",
      marginTiers: [{
        lowerBound: "0.0",
        maxLeverage: runtime.getSymbolConfigState().maxLeverage
      }]
    }
  ]],
  collateralToken: 0
});

const mapAssetCtx = (market: HyperliquidMarketSnapshot) => ([{
  funding: asString(market.assetCtx?.fundingRate ?? 0) ?? "0",
  openInterest: asString(market.assetCtx?.openInterest ?? 0) ?? "0",
  prevDayPx: asString(market.assetCtx?.prevDayPrice ?? market.markPrice ?? market.bestBid ?? market.bestAsk ?? 0) ?? "0",
  dayNtlVlm: asString(market.assetCtx?.dayNotionalVolume ?? 0) ?? "0",
  premium: "0.0",
  oraclePx: asString(market.assetCtx?.oraclePrice ?? market.markPrice ?? market.bestBid ?? market.bestAsk ?? 0) ?? "0",
  markPx: asString(market.assetCtx?.markPrice ?? market.markPrice ?? market.bestBid ?? market.bestAsk ?? 0) ?? "0",
  midPx: asString(market.assetCtx?.midPrice ?? market.markPrice ?? market.bestBid ?? market.bestAsk ?? 0) ?? "0",
  impactPxs: [
    asString(market.bestBid ?? market.markPrice ?? 0) ?? "0",
    asString(market.bestAsk ?? market.markPrice ?? 0) ?? "0"
  ],
  dayBaseVlm: "0"
}]);

export const buildHyperliquidInfoResponse = async (
  runtime: HyperliquidInfoRuntime,
  request: HyperliquidInfoRequest,
  currentAccountId?: string
): Promise<unknown> => {
  const type = request.type;
  const market = runtime.getMarketData();
  const resolveAccountId = () => {
    if (!currentAccountId) {
      throw new Error("Authentication required for this info request");
    }

    if (!matchesHyperliquidCompatUser(currentAccountId, request.user)) {
      throw new Error("Requested user does not match the authenticated account");
    }

    return currentAccountId;
  };

  if (type === "meta") {
    return mapMeta(runtime);
  }

  if (type === "metaAndAssetCtxs") {
    return [mapMeta(runtime), mapAssetCtx(market)];
  }

  if (type === "allMids") {
    return {
      [runtime.getSymbolConfigState().coin]: String(
        market.assetCtx?.midPrice
        ?? market.markPrice
        ?? (market.bestBid != null && market.bestAsk != null ? Number(((market.bestBid + market.bestAsk) / 2).toFixed(6)) : 0)
      )
    };
  }

  if (type === "l2Book") {
    const coin = request.coin ?? runtime.getSymbolConfigState().coin;
    if (coin !== runtime.getSymbolConfigState().coin) {
      throw new Error(`Unsupported coin ${coin}`);
    }

    return {
      coin,
      time: market.book.updatedAt ?? Date.now(),
      levels: [
        market.book.bids.map((level) => ({
          px: String(level.price),
          sz: String(level.size),
          n: level.orders
        })),
        market.book.asks.map((level) => ({
          px: String(level.price),
          sz: String(level.size),
          n: level.orders
        }))
      ]
    };
  }

  if (type === "candleSnapshot") {
    const req = request.req;
    const coin = req?.coin ?? runtime.getSymbolConfigState().coin;
    if (coin !== runtime.getSymbolConfigState().coin) {
      throw new Error(`Unsupported coin ${coin}`);
    }

    if (!req?.interval || !Number.isFinite(req.startTime) || !Number.isFinite(req.endTime)) {
      throw new Error("candleSnapshot requires req.coin, req.interval, req.startTime, req.endTime");
    }

    const history = await runtime.getMarketHistory(500);
    return history.candles
      .filter((candle) =>
        candle.coin === coin
        && candle.interval === req.interval
        && candle.openTime >= (req.startTime as number)
        && candle.openTime <= (req.endTime as number)
      )
      .map((candle) => ({
        t: candle.openTime,
        T: candle.closeTime,
        s: candle.coin,
        i: candle.interval,
        o: String(candle.open),
        c: String(candle.close),
        h: String(candle.high),
        l: String(candle.low),
        v: String(candle.volume),
        n: candle.tradeCount
      }));
  }

  if (type === "recentTrades") {
    const coin = request.coin ?? runtime.getSymbolConfigState().coin;
    if (coin !== runtime.getSymbolConfigState().coin) {
      throw new Error(`Unsupported coin ${coin}`);
    }

    const history = await runtime.getMarketHistory(200);
    return history.trades
      .filter((trade) => trade.coin === coin)
      .slice(0, 200)
      .map((trade, index) => ({
        coin: trade.coin,
        side: trade.side === "sell" ? "A" : "B",
        px: String(trade.price),
        sz: String(trade.size),
        time: trade.time,
        hash: ZERO_HASH,
        tid: Number(String(trade.time).slice(-12)) + index,
        users: [ZERO_ADDRESS, ZERO_ADDRESS]
      }));
  }

  if (type === "exchangeStatus") {
    return "ok";
  }

  if (type === "openOrders" || type === "frontendOpenOrders") {
    const accountId = resolveAccountId();
    return [
      ...runtime.getOrders(accountId)
      .filter((order) => order.status === "ACCEPTED" || order.status === "PARTIALLY_FILLED" || order.status === "NEW")
      .map((order) => ({
        coin: runtime.getSymbolConfigState().coin,
        side: order.side === "buy" ? "B" : "A",
        limitPx: String(order.limitPrice ?? market.markPrice ?? market.bestBid ?? market.bestAsk ?? 0),
        sz: String(order.remainingQuantity),
        oid: Number(order.id.replace(/^ord_/, "")),
        timestamp: new Date(order.createdAt).getTime(),
        origSz: String(order.quantity),
        cloid: order.clientOrderId
      })),
      ...((await runtime.getVirtualOpenOrders?.(accountId)) ?? [])
    ];
  }

  if (type === "orderStatus") {
    const accountId = resolveAccountId();
    const queryOid = request.oid;
    if (queryOid == null) {
      throw new Error("orderStatus requires oid");
    }

    const order = typeof queryOid === "string" && queryOid.startsWith("0x")
      ? runtime.getOrderByClientOrderId(accountId, queryOid)
      : runtime.getOrders(accountId).find((entry) => entry.id === `ord_${queryOid}`);

    const virtualOrder = await runtime.getVirtualOrderStatus?.(accountId, queryOid);
    if (virtualOrder) {
      return {
        order: virtualOrder
      };
    }

    if (!order) {
      return {
        status: "unknownOid"
      };
    }

    const status = order.status === "FILLED"
      ? "filled"
      : order.status === "CANCELED"
        ? "canceled"
        : order.status === "REJECTED"
          ? "rejected"
          : "open";

    return {
      order: {
        order: {
          coin: runtime.getSymbolConfigState().coin,
          side: order.side === "buy" ? "B" : "A",
          limitPx: String(order.limitPrice ?? market.markPrice ?? market.bestBid ?? market.bestAsk ?? 0),
          sz: String(order.remainingQuantity),
          oid: Number(order.id.replace(/^ord_/, "")),
          timestamp: new Date(order.createdAt).getTime(),
          origSz: String(order.quantity),
          cloid: order.clientOrderId
        },
        status,
        statusTimestamp: new Date(order.updatedAt).getTime()
      }
    };
  }

  if (type === "clearinghouseState") {
    const accountId = resolveAccountId();
    const state = runtime.getEngineState(accountId);
    const account = state.account;
    const position = state.position;
    const maxLeverage = runtime.getSymbolConfigState().maxLeverage;

    if (!account) {
      return {
        marginSummary: {
          accountValue: "0.0",
          totalNtlPos: "0.0",
          totalRawUsd: "0.0",
          totalMarginUsed: "0.0"
        },
        crossMarginSummary: {
          accountValue: "0.0",
          totalNtlPos: "0.0",
          totalRawUsd: "0.0",
          totalMarginUsed: "0.0"
        },
        crossMaintenanceMarginUsed: "0.0",
        withdrawable: "0.0",
        assetPositions: [],
        time: Date.now()
      };
    }

    const absQuantity = Math.abs(position?.quantity ?? 0);
    const entryPx = position?.averageEntryPrice ?? 0;
    const positionValue = absQuantity * entryPx;

    return {
      marginSummary: {
        accountValue: String(account.equity),
        totalNtlPos: String(positionValue),
        totalRawUsd: String(account.walletBalance),
        totalMarginUsed: String(account.positionMargin + account.orderMargin)
      },
      crossMarginSummary: {
        accountValue: String(account.equity),
        totalNtlPos: String(positionValue),
        totalRawUsd: String(account.walletBalance),
        totalMarginUsed: String(account.positionMargin + account.orderMargin)
      },
      crossMaintenanceMarginUsed: String(position?.maintenanceMargin ?? 0),
      withdrawable: String(account.availableBalance),
      assetPositions: position && position.side !== "flat" && absQuantity > 0 ? [{
        type: "oneWay",
        position: {
          coin: runtime.getSymbolConfigState().coin,
          szi: String(position.side === "short" ? -absQuantity : absQuantity),
          leverage: {
            type: "cross",
            value: runtime.getSymbolConfigState().leverage
          },
          entryPx: String(position.averageEntryPrice),
          positionValue: String(positionValue),
          unrealizedPnl: String(position.unrealizedPnl),
          liquidationPx: String(position.liquidationPrice),
          marginUsed: String(position.initialMargin),
          maxLeverage,
          returnOnEquity: position.initialMargin > 0 ? String(position.unrealizedPnl / position.initialMargin) : "0",
          cumFunding: {
            allTime: "0.0",
            sinceOpen: "0.0",
            sinceChange: "0.0"
          }
        }
      }] : [],
      time: Date.now()
    };
  }

  throw new Error(`Unsupported info type ${type ?? "undefined"}`);
};
