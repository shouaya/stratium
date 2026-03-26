import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const HYPERLIQUID_INFO_URL = "https://api.hyperliquid.xyz/info";
const HYPERLIQUID_SOURCE = "hyperliquid";
const DEFAULT_QUOTE_ASSET = "USDC";
const DEFAULT_CONTRACT_TYPE = "perp";
const DEFAULT_CONTRACT_MULTIPLIER = 1;
const DEFAULT_BASE_TAKER_FEE_RATE = 0.00045;
const DEFAULT_BASE_MAKER_FEE_RATE = 0.00015;
const DEFAULT_ENGINE_MAINTENANCE_MARGIN_RATE = 0.05;
const DEFAULT_ENGINE_BASE_SLIPPAGE_BPS = 5;
const DEFAULT_SYMBOL_WHITELIST = ["BTC"];

async function fetchMeta() {
  const response = await fetch(HYPERLIQUID_INFO_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ type: "meta" })
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Hyperliquid meta: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function mapUniverseToConfig(universeItem, assetIndex, syncedAt) {
  const coin = universeItem.name;
  const maxLeverage = Number(universeItem.maxLeverage);
  const szDecimals = Number(universeItem.szDecimals);
  const maxPriceDecimals = Math.max(0, 6 - szDecimals);

  return {
    source: HYPERLIQUID_SOURCE,
    assetIndex,
    coin,
    symbol: `${coin}-USD`,
    quoteAsset: DEFAULT_QUOTE_ASSET,
    contractType: DEFAULT_CONTRACT_TYPE,
    contractMultiplier: DEFAULT_CONTRACT_MULTIPLIER,
    szDecimals,
    maxPriceDecimals,
    maxLeverage,
    marginTableId: Number(universeItem.marginTableId),
    onlyIsolated: Boolean(universeItem.onlyIsolated ?? false),
    marginMode: universeItem.marginMode ?? null,
    isDelisted: Boolean(universeItem.isDelisted ?? false),
    isActive: !Boolean(universeItem.isDelisted ?? false),
    baseTakerFeeRate: DEFAULT_BASE_TAKER_FEE_RATE,
    baseMakerFeeRate: DEFAULT_BASE_MAKER_FEE_RATE,
    engineDefaultLeverage: Math.min(10, maxLeverage),
    engineMaintenanceMarginRate: DEFAULT_ENGINE_MAINTENANCE_MARGIN_RATE,
    engineBaseSlippageBps: DEFAULT_ENGINE_BASE_SLIPPAGE_BPS,
    enginePartialFillEnabled: false,
    lastSyncedAt: syncedAt
  };
}

async function main() {
  const meta = await fetchMeta();

  if (!Array.isArray(meta.universe)) {
    throw new Error("Hyperliquid meta response does not contain a valid universe array.");
  }

  const whitelist = (process.env.SYMBOL_CONFIG_WHITELIST ?? DEFAULT_SYMBOL_WHITELIST.join(","))
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean);
  const whitelistSet = new Set(whitelist);
  const filteredUniverse = meta.universe.filter((item) => whitelistSet.has(String(item.name).toUpperCase()));

  const syncedAt = new Date();
  let upserted = 0;

  await prisma.symbolConfig.deleteMany({
    where: {
      source: HYPERLIQUID_SOURCE,
      coin: {
        notIn: whitelist
      }
    }
  });

  for (const universeItem of filteredUniverse) {
    const assetIndex = meta.universe.findIndex((item) => item.name === universeItem.name);
    const config = mapUniverseToConfig(universeItem, assetIndex, syncedAt);

    await prisma.symbolConfig.upsert({
      where: { symbol: config.symbol },
      update: config,
      create: config
    });

    upserted += 1;
  }

  console.log(`Seeded ${upserted} Hyperliquid symbol configs at ${syncedAt.toISOString()}.`);
  console.log(`Whitelist: ${whitelist.join(", ")}`);
  console.log("Source alignment:");
  console.log("- meta universe -> assetIndex, coin, szDecimals, maxLeverage, marginTableId, onlyIsolated, marginMode, isDelisted");
  console.log("- fees -> Hyperliquid perps base rates (taker 0.045%, maker 0.015%)");
  console.log("- contractMultiplier -> 1 (1 contract = 1 unit of underlying spot asset)");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
