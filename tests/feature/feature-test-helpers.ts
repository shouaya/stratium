import { randomBytes, scryptSync } from "node:crypto";
import { createServer } from "node:net";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { PrismaClient } from "@prisma/client";
import type { MarketTick } from "@stratium/shared";
import { ApiRuntime } from "../../apps/api/src/runtime/runtime";
import { registerRoutes } from "../../apps/api/src/transport/routes";

export const featureTestPrisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL
});

type FeatureDbInitUser = {
  username: string;
  password: string;
  role: "frontend" | "admin";
  displayName: string;
  tradingAccountId?: string | null;
  isActive?: boolean;
};

type FeatureDbInitPlatformSettings = {
  id: string;
  platformName: string;
  platformAnnouncement?: string | null;
  activeExchange: string;
  activeSymbol: string;
  maintenanceMode: boolean;
  allowFrontendTrading: boolean;
  allowManualTicks: boolean;
};

type FeatureDbInitSymbolConfig = {
  source: string;
  assetIndex: number;
  coin: string;
  symbol: string;
  marketSymbol?: string | null;
  quoteAsset: string;
  contractType: string;
  contractMultiplier: number;
  szDecimals: number;
  maxPriceDecimals: number;
  maxLeverage: number;
  marginTableId: number;
  onlyIsolated: boolean;
  marginMode?: string | null;
  isDelisted: boolean;
  isActive: boolean;
  baseTakerFeeRate: number;
  baseMakerFeeRate: number;
  engineDefaultLeverage: number;
  engineMaintenanceMarginRate: number;
  engineBaseSlippageBps: number;
  enginePartialFillEnabled: boolean;
  lastSyncedAt: string;
};

export type FeatureDbInit = {
  appUsers?: FeatureDbInitUser[];
  platformSettings?: FeatureDbInitPlatformSettings | FeatureDbInitPlatformSettings[];
  symbolConfigs?: FeatureDbInitSymbolConfig[];
};

export type FeatureTableName =
  | "account"
  | "position"
  | "orders"
  | "fills"
  | "market_ticks"
  | "trigger_order_history";

const FEATURE_TABLES = [
  "MarketBookLevel",
  "MarketBookSnapshot",
  "MarketTrade",
  "MarketCandle",
  "MarketAssetContext",
  "MarketVolumeRecord",
  "MarketTick",
  "LiquidationEvent",
  "LedgerEntry",
  "Fill",
  "Order",
  "Position",
  "Account",
  "SimulationEvent",
  "SimulationSnapshot",
  "TriggerOrderHistory",
  "SymbolConfig",
  "AppUser",
  "PlatformSettings"
];

const hashPassword = (password: string, salt = randomBytes(16).toString("hex")): string => {
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
};

export const baseFeatureTick: MarketTick = {
  symbol: "BTC-USD",
  bid: 100,
  ask: 101,
  last: 100.5,
  spread: 1,
  tickTime: "2026-04-16T00:00:00.000Z",
  volatilityTag: "normal"
};

export const resetFeatureTestDatabase = async (): Promise<void> => {
  await featureTestPrisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${FEATURE_TABLES.map((table) => `"${table}"`).join(", ")} RESTART IDENTITY CASCADE`
  );
};

export const seedFeatureTestDatabase = async (fixture: FeatureDbInit): Promise<void> => {
  if (fixture.appUsers && fixture.appUsers.length > 0) {
    await featureTestPrisma.appUser.createMany({
      data: fixture.appUsers.map((user) => ({
        username: user.username,
        passwordHash: hashPassword(user.password),
        role: user.role,
        displayName: user.displayName,
        tradingAccountId: user.tradingAccountId ?? null,
        isActive: user.isActive ?? true
      }))
    });
  }

  const platformSettings = Array.isArray(fixture.platformSettings)
    ? fixture.platformSettings
    : fixture.platformSettings
      ? [fixture.platformSettings]
      : [];

  for (const settings of platformSettings) {
    await featureTestPrisma.platformSettings.create({
      data: {
        id: settings.id,
        platformName: settings.platformName,
        platformAnnouncement: settings.platformAnnouncement ?? null,
        activeExchange: settings.activeExchange,
        activeSymbol: settings.activeSymbol,
        maintenanceMode: settings.maintenanceMode,
        allowFrontendTrading: settings.allowFrontendTrading,
        allowManualTicks: settings.allowManualTicks
      }
    });
  }

  if (fixture.symbolConfigs && fixture.symbolConfigs.length > 0) {
    await featureTestPrisma.symbolConfig.createMany({
      data: fixture.symbolConfigs.map((symbolConfig) => ({
        source: symbolConfig.source,
        assetIndex: symbolConfig.assetIndex,
        coin: symbolConfig.coin,
        symbol: symbolConfig.symbol,
        marketSymbol: symbolConfig.marketSymbol ?? null,
        quoteAsset: symbolConfig.quoteAsset,
        contractType: symbolConfig.contractType,
        contractMultiplier: symbolConfig.contractMultiplier,
        szDecimals: symbolConfig.szDecimals,
        maxPriceDecimals: symbolConfig.maxPriceDecimals,
        maxLeverage: symbolConfig.maxLeverage,
        marginTableId: symbolConfig.marginTableId,
        onlyIsolated: symbolConfig.onlyIsolated,
        marginMode: symbolConfig.marginMode ?? null,
        isDelisted: symbolConfig.isDelisted,
        isActive: symbolConfig.isActive,
        baseTakerFeeRate: symbolConfig.baseTakerFeeRate,
        baseMakerFeeRate: symbolConfig.baseMakerFeeRate,
        engineDefaultLeverage: symbolConfig.engineDefaultLeverage,
        engineMaintenanceMarginRate: symbolConfig.engineMaintenanceMarginRate,
        engineBaseSlippageBps: symbolConfig.engineBaseSlippageBps,
        enginePartialFillEnabled: symbolConfig.enginePartialFillEnabled,
        lastSyncedAt: new Date(symbolConfig.lastSyncedAt)
      }))
    });
  }
};

export const loginThroughApi = async (
  app: Awaited<ReturnType<typeof createFeatureTestApiServer>>["app"],
  payload: { username: string; password: string; role: "frontend" | "admin" }
) => {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload
  });

  return {
    response,
    body: response.json() as {
      token: string;
      user: {
        id: string;
        username: string;
        role: "frontend" | "admin";
        displayName: string;
        tradingAccountId: string | null;
      };
    }
  };
};

export const createFeatureTestApiServer = async () => {
  const app = Fastify();
  const runtime = new ApiRuntime(app.log);

  await app.register(websocket);
  await registerRoutes(app, runtime);
  await runtime.bootstrap();

  return {
    app,
    runtime,
    close: async () => {
      await runtime.shutdown();
      await app.close();
    }
  };
};

export const allocateFeatureTestPort = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to resolve an available port for feature tests.")));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });

export const startFeatureTestApiServer = async () => {
  const server = await createFeatureTestApiServer();
  const port = await allocateFeatureTestPort();

  await server.app.listen({
    host: "127.0.0.1",
    port
  });

  return {
    ...server,
    baseUrl: `http://127.0.0.1:${port}`
  };
};

const normalizeScalar = (value: unknown): string => {
  if (value == null) {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "object" && value !== null && "toString" in value) {
    return String(value.toString());
  }

  return String(value);
};

export const loadFeatureTableRows = async (
  table: FeatureTableName,
  options: { accountId?: string; symbol?: string } = {}
): Promise<Array<Record<string, string>>> => {
  const accountId = options.accountId ?? "paper-account-1";
  const symbol = options.symbol ?? "BTC-USD";

  if (table === "account") {
    const rows = await featureTestPrisma.account.findMany({
      where: { id: accountId },
      orderBy: { id: "asc" }
    });

    return rows.map((row) => ({
      id: row.id,
      walletBalance: normalizeScalar(row.walletBalance),
      availableBalance: normalizeScalar(row.availableBalance),
      positionMargin: normalizeScalar(row.positionMargin),
      orderMargin: normalizeScalar(row.orderMargin),
      equity: normalizeScalar(row.equity),
      realizedPnl: normalizeScalar(row.realizedPnl),
      unrealizedPnl: normalizeScalar(row.unrealizedPnl),
      riskRatio: normalizeScalar(row.riskRatio)
    }));
  }

  if (table === "position") {
    const rows = await featureTestPrisma.position.findMany({
      where: { accountId, symbol },
      orderBy: { id: "asc" }
    });

    return rows.map((row) => ({
      id: row.id,
      accountId: row.accountId,
      symbol: row.symbol,
      side: row.side,
      quantity: normalizeScalar(row.quantity),
      averageEntryPrice: normalizeScalar(row.averageEntryPrice),
      markPrice: normalizeScalar(row.markPrice),
      realizedPnl: normalizeScalar(row.realizedPnl),
      unrealizedPnl: normalizeScalar(row.unrealizedPnl),
      initialMargin: normalizeScalar(row.initialMargin),
      maintenanceMargin: normalizeScalar(row.maintenanceMargin),
      liquidationPrice: normalizeScalar(row.liquidationPrice)
    }));
  }

  if (table === "orders") {
    const rows = await featureTestPrisma.order.findMany({
      where: { accountId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });

    return rows.map((row) => ({
      id: row.id,
      accountId: row.accountId,
      clientOrderId: normalizeScalar(row.clientOrderId),
      symbol: row.symbol,
      side: row.side,
      orderType: row.orderType,
      status: row.status,
      quantity: normalizeScalar(row.quantity),
      limitPrice: normalizeScalar(row.limitPrice),
      filledQuantity: normalizeScalar(row.filledQuantity),
      remainingQuantity: normalizeScalar(row.remainingQuantity),
      averageFillPrice: normalizeScalar(row.averageFillPrice),
      rejectionCode: normalizeScalar(row.rejectionCode),
      rejectionMessage: normalizeScalar(row.rejectionMessage)
    }));
  }

  if (table === "fills") {
    const rows = await featureTestPrisma.fill.findMany({
      where: { accountId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });

    return rows.map((row) => ({
      id: row.id,
      orderId: row.orderId,
      accountId: row.accountId,
      symbol: row.symbol,
      price: normalizeScalar(row.price),
      quantity: normalizeScalar(row.quantity),
      slippage: normalizeScalar(row.slippage),
      fee: normalizeScalar(row.fee)
    }));
  }

  if (table === "trigger_order_history") {
    const rows = await featureTestPrisma.triggerOrderHistory.findMany({
      where: { accountId },
      orderBy: [{ oid: "asc" }]
    });

    return rows.map((row) => ({
      id: row.id,
      oid: normalizeScalar(row.oid),
      accountId: row.accountId,
      asset: normalizeScalar(row.asset),
      isBuy: normalizeScalar(row.isBuy),
      triggerPx: normalizeScalar(row.triggerPx),
      actualTriggerPx: normalizeScalar(row.actualTriggerPx),
      isMarket: normalizeScalar(row.isMarket),
      tpsl: row.tpsl,
      size: normalizeScalar(row.size),
      limitPx: normalizeScalar(row.limitPx),
      reduceOnly: normalizeScalar(row.reduceOnly),
      cloid: normalizeScalar(row.cloid),
      status: row.status
    }));
  }

  const rows = await featureTestPrisma.marketTick.findMany({
    where: { symbol },
    orderBy: { tickTime: "asc" }
  });

  return rows.map((row) => ({
    id: row.id,
    symbol: row.symbol,
    bid: normalizeScalar(row.bid),
    ask: normalizeScalar(row.ask),
    last: normalizeScalar(row.last),
    spread: normalizeScalar(row.spread),
    volatilityTag: normalizeScalar(row.volatilityTag),
    tickTime: normalizeScalar(row.tickTime)
  }));
};

export const loadPersistedTradingState = async (accountId = "paper-account-1") => {
  const [account, position, orders, fills, events, snapshot, ticks] = await Promise.all([
    featureTestPrisma.account.findUnique({
      where: { id: accountId }
    }),
    featureTestPrisma.position.findFirst({
      where: { accountId },
      orderBy: { updatedAt: "desc" }
    }),
    featureTestPrisma.order.findMany({
      where: { accountId },
      orderBy: { createdAt: "asc" }
    }),
    featureTestPrisma.fill.findMany({
      where: { accountId },
      orderBy: { createdAt: "asc" }
    }),
    featureTestPrisma.simulationEvent.findMany({
      where: { accountId },
      orderBy: { sequence: "asc" }
    }),
    featureTestPrisma.simulationSnapshot.findFirst({
      where: { accountId },
      orderBy: { updatedAt: "desc" }
    }),
    featureTestPrisma.marketTick.findMany({
      where: { symbol: "BTC-USD" },
      orderBy: { tickTime: "asc" }
    })
  ]);

  return {
    account,
    position,
    orders,
    fills,
    events,
    snapshot,
    ticks
  };
};

export const disconnectFeatureTestPrisma = async (): Promise<void> => {
  await featureTestPrisma.$disconnect();
};
