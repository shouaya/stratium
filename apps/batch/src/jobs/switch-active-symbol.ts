import { connectPrismaWithLocalhostFallback } from "../infra/prisma-connection.js";

interface CliOptions {
  exchange: string;
  symbol: string;
}

const parseCliOptions = (argv: string[]): CliOptions => {
  let exchange = "hyperliquid";
  let symbol = "";

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--") {
      continue;
    }

    if (current === "--exchange") {
      if (!next) {
        throw new Error("--exchange requires a value");
      }

      exchange = next.trim().toLowerCase();
      index += 1;
      continue;
    }

    if (current === "--symbol") {
      if (!next) {
        throw new Error("--symbol requires a value");
      }

      symbol = next.trim().toUpperCase();
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${current}`);
  }

  if (!/^[a-z0-9_-]{2,32}$/.test(exchange)) {
    throw new Error("--exchange must look like hyperliquid");
  }

  if (!/^[A-Z0-9]{2,20}-[A-Z0-9]{2,10}$/.test(symbol)) {
    throw new Error("--symbol must look like BTC-USD");
  }

  return { exchange, symbol };
};

const main = async () => {
  const options = parseCliOptions(process.argv.slice(2));
  const prisma = await connectPrismaWithLocalhostFallback();

  try {
    const symbolConfig = await prisma.symbolConfig.findUnique({
      where: { symbol: options.symbol }
    });

    if (!symbolConfig) {
      throw new Error(`Symbol config ${options.symbol} was not found.`);
    }

    const settings = await prisma.platformSettings.upsert({
      where: { id: "platform" },
      update: {
        activeExchange: options.exchange,
        activeSymbol: options.symbol,
        maintenanceMode: false,
        allowFrontendTrading: true,
        allowManualTicks: true
      },
      create: {
        id: "platform",
        platformName: "Stratium Demo",
        platformAnnouncement: "",
        activeExchange: options.exchange,
        activeSymbol: options.symbol,
        maintenanceMode: false,
        allowFrontendTrading: true,
        allowManualTicks: true
      }
    });

    console.log(`Switched active market to ${settings.activeExchange}:${settings.activeSymbol} (${symbolConfig.coin}).`);
  } finally {
    await prisma.$disconnect();
  }
};

void main().catch((error: unknown) => {
  console.error("Failed to switch active symbol", error);
  process.exit(1);
});
