import { connectPrismaWithLocalhostFallback } from "./prisma-connection.js";

interface CliOptions {
  coin: string;
  interval: string;
  date?: string;
  apiUrl: string;
}

interface HyperliquidWsCandle {
  t: number;
  T: number;
  s: string;
  i: string;
  o: number | string;
  c: number | string;
  h: number | string;
  l: number | string;
  v: number | string;
  n: number;
}

const DEFAULT_API_URL = "https://api.hyperliquid.xyz/info";
const DEFAULT_INTERVAL = "1m";

const pad2 = (value: number): string => String(value).padStart(2, "0");

const formatLocalDate = (value: Date): string => (
  `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`
);

const parseCliOptions = (argv: string[]): CliOptions => {
  const options: CliOptions = {
    coin: (process.env.HYPERLIQUID_COIN ?? process.env.HYPERLIQUID_COINS?.split(",")[0] ?? "BTC").trim().toUpperCase(),
    interval: process.env.HYPERLIQUID_CANDLE_INTERVAL ?? DEFAULT_INTERVAL,
    apiUrl: process.env.HYPERLIQUID_INFO_URL ?? DEFAULT_API_URL
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--") {
      continue;
    }

    if (current === "--coin") {
      if (!next) {
        throw new Error("--coin requires a value");
      }

      options.coin = next.trim().toUpperCase();
      index += 1;
      continue;
    }

    if (current === "--interval") {
      if (!next) {
        throw new Error("--interval requires a value");
      }

      options.interval = next.trim();
      index += 1;
      continue;
    }

    if (current === "--date") {
      if (!next) {
        throw new Error("--date requires a YYYY-MM-DD value");
      }

      if (!/^\d{4}-\d{2}-\d{2}$/.test(next.trim())) {
        throw new Error("--date must be in YYYY-MM-DD format");
      }

      options.date = next.trim();
      index += 1;
      continue;
    }

    if (current === "--api-url") {
      if (!next) {
        throw new Error("--api-url requires a value");
      }

      options.apiUrl = next.trim();
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${current}`);
  }

  return options;
};

const resolveDateRange = (dateText?: string): { dateLabel: string; startTime: number; endTime: number } => {
  const now = new Date();
  const target = dateText
    ? new Date(`${dateText}T00:00:00`)
    : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

  if (Number.isNaN(target.getTime())) {
    throw new Error("Failed to parse target date");
  }

  const startTime = target.getTime();
  const endOfDay = new Date(target.getFullYear(), target.getMonth(), target.getDate() + 1, 0, 0, 0, 0).getTime() - 1;
  const endTime = Math.min(now.getTime(), endOfDay);

  return {
    dateLabel: dateText ?? formatLocalDate(target),
    startTime,
    endTime
  };
};

const fetchCandles = async (
  apiUrl: string,
  coin: string,
  interval: string,
  startTime: number,
  endTime: number
): Promise<HyperliquidWsCandle[]> => {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      type: "candleSnapshot",
      req: {
        coin,
        interval,
        startTime,
        endTime
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Hyperliquid request failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json() as unknown;

  if (!Array.isArray(payload)) {
    throw new Error("Unexpected Hyperliquid candleSnapshot response");
  }

  return payload as HyperliquidWsCandle[];
};

const main = async () => {
  const options = parseCliOptions(process.argv.slice(2));

  if (options.interval !== "1m") {
    throw new Error("This command currently supports only --interval 1m.");
  }

  const { dateLabel, startTime, endTime } = resolveDateRange(options.date);
  const candles = await fetchCandles(options.apiUrl, options.coin, options.interval, startTime, endTime);
  const prisma = await connectPrismaWithLocalhostFallback();

  try {
    console.log(`Importing ${candles.length} Hyperliquid candles for ${options.coin} ${options.interval} on ${dateLabel}`);

    for (const candle of candles) {
      await prisma.marketCandle.upsert({
        where: {
          coin_interval_openTime: {
            coin: candle.s,
            interval: candle.i,
            openTime: new Date(candle.t)
          }
        },
        update: {
          source: "hyperliquid",
          coin: candle.s,
          interval: candle.i,
          openTime: new Date(candle.t),
          closeTime: new Date(candle.T),
          open: Number(candle.o),
          high: Number(candle.h),
          low: Number(candle.l),
          close: Number(candle.c),
          volume: Number(candle.v),
          tradeCount: candle.n
        },
        create: {
          id: `${candle.s}-${candle.i}-${candle.t}`,
          source: "hyperliquid",
          coin: candle.s,
          interval: candle.i,
          openTime: new Date(candle.t),
          closeTime: new Date(candle.T),
          open: Number(candle.o),
          high: Number(candle.h),
          low: Number(candle.l),
          close: Number(candle.c),
          volume: Number(candle.v),
          tradeCount: candle.n
        }
      });

      await prisma.marketVolumeRecord.upsert({
        where: {
          coin_interval_bucketStart: {
            coin: candle.s,
            interval: candle.i,
            bucketStart: new Date(candle.t)
          }
        },
        update: {
          source: "hyperliquid",
          coin: candle.s,
          interval: candle.i,
          bucketStart: new Date(candle.t),
          bucketEnd: new Date(candle.T),
          volume: Number(candle.v),
          tradeCount: candle.n
        },
        create: {
          id: `vol-${candle.s}-${candle.i}-${candle.t}`,
          source: "hyperliquid",
          coin: candle.s,
          interval: candle.i,
          bucketStart: new Date(candle.t),
          bucketEnd: new Date(candle.T),
          volume: Number(candle.v),
          tradeCount: candle.n
        }
      });
    }

    console.log(`Imported ${candles.length} 1-minute candles into PostgreSQL.`);
  } finally {
    await prisma.$disconnect();
  }
};

void main().catch((error: unknown) => {
  console.error("Failed to import Hyperliquid day candles", error);
  process.exit(1);
});
