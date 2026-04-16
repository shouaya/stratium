import { prisma } from "../persistence/prisma-client.js";
import { MarketDataRepository } from "../market/market-data-repository.js";
import type { TradingSymbolConfig } from "@stratium/shared";

const toNumber = (value: { toString(): string } | number): number => Number(value.toString());

export class SymbolConfigRepository extends MarketDataRepository {
  async loadSymbolConfig(symbol: string, source?: string): Promise<TradingSymbolConfig | null> {
    const symbolConfigDelegate = prisma.symbolConfig as {
      findFirst?: (args: unknown) => Promise<unknown>;
      findUnique?: (args: unknown) => Promise<unknown>;
    };
    const row = (symbolConfigDelegate.findFirst
      ? await symbolConfigDelegate.findFirst({
        where: {
          symbol,
          ...(source ? { source } : {})
        },
        orderBy: { source: "asc" }
      })
      : await symbolConfigDelegate.findUnique?.({
        where: { symbol }
      })) as {
        symbol: string;
        engineDefaultLeverage: number;
        engineMaintenanceMarginRate: { toString(): string } | number;
        baseTakerFeeRate: { toString(): string } | number;
        baseMakerFeeRate: { toString(): string } | number;
        engineBaseSlippageBps: number;
        enginePartialFillEnabled: boolean;
      } | null | undefined;

    if (!row) {
      return null;
    }

    return {
      symbol: row.symbol,
      leverage: row.engineDefaultLeverage,
      maintenanceMarginRate: toNumber(row.engineMaintenanceMarginRate),
      takerFeeRate: toNumber(row.baseTakerFeeRate),
      makerFeeRate: toNumber(row.baseMakerFeeRate),
      baseSlippageBps: row.engineBaseSlippageBps,
      partialFillEnabled: row.enginePartialFillEnabled
    };
  }

  async loadSymbolConfigMeta(symbol: string, source?: string): Promise<{
    source: string;
    symbol: string;
    coin: string;
    marketSymbol: string;
    leverage: number;
    maxLeverage: number;
    szDecimals: number;
    quoteAsset: string;
  } | null> {
    const symbolConfigDelegate = prisma.symbolConfig as {
      findFirst?: (args: unknown) => Promise<unknown>;
      findUnique?: (args: unknown) => Promise<unknown>;
    };
    const row = (symbolConfigDelegate.findFirst
      ? await symbolConfigDelegate.findFirst({
        where: {
          symbol,
          ...(source ? { source } : {})
        },
        orderBy: { source: "asc" }
      })
      : await symbolConfigDelegate.findUnique?.({
        where: { symbol }
      })) as {
        source: string;
        symbol: string;
        coin: string;
        marketSymbol: string;
        engineDefaultLeverage: number;
        maxLeverage: number;
        szDecimals: number;
        quoteAsset: string;
      } | null | undefined;

    if (!row) {
      return null;
    }

    const marketSymbol = row.marketSymbol ?? row.coin;

    return {
      source: row.source,
      symbol: row.symbol,
      coin: row.coin,
      marketSymbol,
      leverage: row.engineDefaultLeverage,
      maxLeverage: row.maxLeverage,
      szDecimals: row.szDecimals,
      quoteAsset: row.quoteAsset
    };
  }

  async listAvailableSymbolConfigMeta(): Promise<Array<{
    source: string;
    symbol: string;
    coin: string;
    marketSymbol: string;
    leverage: number;
    maxLeverage: number;
    szDecimals: number;
    quoteAsset: string;
  }>> {
    const rows = await prisma.symbolConfig.findMany({
      where: { isActive: true },
      orderBy: [{ source: "asc" }, { coin: "asc" }, { symbol: "asc" }]
    });

    return rows.map((row) => ({
      source: row.source,
      symbol: row.symbol,
      coin: row.coin,
      marketSymbol: row.marketSymbol ?? row.coin,
      leverage: row.engineDefaultLeverage,
      maxLeverage: row.maxLeverage,
      szDecimals: row.szDecimals,
      quoteAsset: row.quoteAsset
    }));
  }

  async updateSymbolLeverage(symbol: string, leverage: number, source?: string): Promise<void> {
    const symbolConfigDelegate = prisma.symbolConfig as {
      update?: (args: unknown) => Promise<unknown>;
      updateMany?: (args: unknown) => Promise<unknown>;
    };

    if (source) {
      await symbolConfigDelegate.update?.({
        where: {
          source_symbol: { source, symbol }
        },
        data: {
          engineDefaultLeverage: leverage,
          lastSyncedAt: new Date()
        }
      });
      return;
    }

    if (symbolConfigDelegate.updateMany) {
      await symbolConfigDelegate.updateMany({
        where: { symbol },
        data: {
          engineDefaultLeverage: leverage,
          lastSyncedAt: new Date()
        }
      });
      return;
    }

    await symbolConfigDelegate.update?.({
      where: { symbol },
      data: {
        engineDefaultLeverage: leverage,
        lastSyncedAt: new Date()
      }
    });
  }
}
