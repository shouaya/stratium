import { connectPrismaWithLocalhostFallback } from "../infra/prisma-connection.js";

interface CliOptions {
  symbol: string;
  interval: string;
  since: string;
  until: string;
  apiBaseUrl: string;
}

type OkxHistoryCandleRow = [
  string,
  string,
  string,
  string,
  string,
  string,
  string?,
  string?,
  string?
];

interface OkxHistoryResponse {
  code?: string;
  msg?: string;
  data?: OkxHistoryCandleRow[];
}

const DEFAULT_API_BASE_URL = "https://www.okx.com";
const DEFAULT_INTERVAL = "1m";
const OKX_SOURCE = "okx";
const OKX_PAGE_LIMIT = 300;

const parseCliOptions = (argv: string[]): CliOptions => {
  const options: Partial<CliOptions> = {
    interval: DEFAULT_INTERVAL,
    apiBaseUrl: process.env.OKX_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--") {
      continue;
    }

    if (current === "--symbol") {
      if (!next) {
        throw new Error("--symbol requires a value");
      }

      options.symbol = next.trim().toUpperCase();
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

    if (current === "--since") {
      if (!next) {
        throw new Error("--since requires an ISO datetime value");
      }

      const candidate = new Date(next.trim());
      if (Number.isNaN(candidate.getTime())) {
        throw new Error("--since must be a valid ISO datetime");
      }

      options.since = candidate.toISOString();
      index += 1;
      continue;
    }

    if (current === "--until") {
      if (!next) {
        throw new Error("--until requires an ISO datetime value");
      }

      const candidate = new Date(next.trim());
      if (Number.isNaN(candidate.getTime())) {
        throw new Error("--until must be a valid ISO datetime");
      }

      options.until = candidate.toISOString();
      index += 1;
      continue;
    }

    if (current === "--api-base-url") {
      if (!next) {
        throw new Error("--api-base-url requires a value");
      }

      options.apiBaseUrl = next.trim();
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${current}`);
  }

  if (!options.symbol || !/^[A-Z0-9]{2,20}-[A-Z0-9]{2,10}$/.test(options.symbol)) {
    throw new Error("--symbol must look like BTC-USD.");
  }

  if (!options.interval || !/^[0-9]+[mhdw]$/i.test(options.interval)) {
    throw new Error("--interval must look like 1m, 5m, 1h, or 1d.");
  }

  if (!options.since || !options.until) {
    throw new Error("--since and --until are required.");
  }

  if (new Date(options.since).getTime() >= new Date(options.until).getTime()) {
    throw new Error("--since must be earlier than --until.");
  }

  return options as CliOptions;
};

const resolveIntervalMs = (interval: string): number => {
  const matched = interval.match(/^(\d+)([mhdw])$/i);

  if (!matched) {
    throw new Error(`Unsupported interval: ${interval}`);
  }

  const amount = Number(matched[1]);
  const unit = matched[2].toLowerCase();

  if (unit === "m") {
    return amount * 60_000;
  }

  if (unit === "h") {
    return amount * 60 * 60_000;
  }

  if (unit === "d") {
    return amount * 24 * 60 * 60_000;
  }

  if (unit === "w") {
    return amount * 7 * 24 * 60 * 60_000;
  }

  throw new Error(`Unsupported interval unit: ${unit}`);
};

const toOkxBar = (interval: string): string => {
  const normalized = interval.trim();

  if (/^\d+m$/i.test(normalized)) {
    return normalized.toLowerCase();
  }

  if (/^\d+h$/i.test(normalized)) {
    return normalized.replace(/h$/i, "H");
  }

  if (/^\d+d$/i.test(normalized)) {
    return normalized.replace(/d$/i, "D");
  }

  if (/^\d+w$/i.test(normalized)) {
    return normalized.replace(/w$/i, "W");
  }

  throw new Error(`Unsupported OKX bar interval: ${interval}`);
};

const fetchCandlesPage = async (
  apiBaseUrl: string,
  instId: string,
  bar: string,
  after?: string
): Promise<OkxHistoryCandleRow[]> => {
  const url = new URL("/api/v5/market/history-candles", apiBaseUrl);
  url.searchParams.set("instId", instId);
  url.searchParams.set("bar", bar);
  url.searchParams.set("limit", String(OKX_PAGE_LIMIT));

  if (after) {
    url.searchParams.set("after", after);
  }

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`OKX request failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json() as OkxHistoryResponse;

  if (payload.code && payload.code !== "0") {
    throw new Error(`OKX responded with code ${payload.code}: ${payload.msg ?? "unknown error"}`);
  }

  if (!Array.isArray(payload.data)) {
    throw new Error("Unexpected OKX history-candles response.");
  }

  return payload.data;
};

const main = async () => {
  const options = parseCliOptions(process.argv.slice(2));
  const prisma = await connectPrismaWithLocalhostFallback();

  try {
    const symbolConfig = await prisma.symbolConfig.findUnique({
      where: {
        source_symbol: {
          source: OKX_SOURCE,
          symbol: options.symbol
        }
      }
    });

    if (!symbolConfig) {
      throw new Error(`OKX symbol config ${options.symbol} was not found in DB.`);
    }

    const sinceMs = new Date(options.since).getTime();
    const untilMs = new Date(options.until).getTime();
    const intervalMs = resolveIntervalMs(options.interval);
    const bar = toOkxBar(options.interval);
    const collected = new Map<number, OkxHistoryCandleRow>();
    let after: string | undefined;

    while (true) {
      const rows = await fetchCandlesPage(options.apiBaseUrl, symbolConfig.marketSymbol ?? symbolConfig.coin, bar, after);

      if (rows.length === 0) {
        break;
      }

      let oldestOpenTime = Number.POSITIVE_INFINITY;

      for (const row of rows) {
        const openTime = Number(row[0]);

        if (!Number.isFinite(openTime)) {
          continue;
        }

        oldestOpenTime = Math.min(oldestOpenTime, openTime);

        if (openTime < sinceMs || openTime > untilMs) {
          continue;
        }

        collected.set(openTime, row);
      }

      if (!Number.isFinite(oldestOpenTime) || oldestOpenTime <= sinceMs || rows.length < OKX_PAGE_LIMIT) {
        break;
      }

      after = String(oldestOpenTime);
    }

    const candles = [...collected.values()].sort((left, right) => Number(left[0]) - Number(right[0]));

    console.log(`Importing ${candles.length} OKX candles for ${options.symbol} (${symbolConfig.marketSymbol ?? symbolConfig.coin}) ${options.interval}`);

    for (const row of candles) {
      const openTime = Number(row[0]);
      const closeTime = openTime + intervalMs - 1;
      const volume = Number(row[5] ?? 0);

      await prisma.marketCandle.upsert({
        where: {
          source_coin_interval_openTime: {
            source: OKX_SOURCE,
            coin: symbolConfig.coin,
            interval: options.interval,
            openTime: new Date(openTime)
          }
        },
        update: {
          source: OKX_SOURCE,
          coin: symbolConfig.coin,
          interval: options.interval,
          openTime: new Date(openTime),
          closeTime: new Date(closeTime),
          open: Number(row[1]),
          high: Number(row[2]),
          low: Number(row[3]),
          close: Number(row[4]),
          volume,
          tradeCount: 0
        },
        create: {
          id: `${OKX_SOURCE}-${symbolConfig.coin}-${options.interval}-${openTime}`,
          source: OKX_SOURCE,
          coin: symbolConfig.coin,
          interval: options.interval,
          openTime: new Date(openTime),
          closeTime: new Date(closeTime),
          open: Number(row[1]),
          high: Number(row[2]),
          low: Number(row[3]),
          close: Number(row[4]),
          volume,
          tradeCount: 0
        }
      });

      await prisma.marketVolumeRecord.upsert({
        where: {
          source_coin_interval_bucketStart: {
            source: OKX_SOURCE,
            coin: symbolConfig.coin,
            interval: options.interval,
            bucketStart: new Date(openTime)
          }
        },
        update: {
          source: OKX_SOURCE,
          coin: symbolConfig.coin,
          interval: options.interval,
          bucketStart: new Date(openTime),
          bucketEnd: new Date(closeTime),
          volume,
          tradeCount: 0
        },
        create: {
          id: `vol-${OKX_SOURCE}-${symbolConfig.coin}-${options.interval}-${openTime}`,
          source: OKX_SOURCE,
          coin: symbolConfig.coin,
          interval: options.interval,
          bucketStart: new Date(openTime),
          bucketEnd: new Date(closeTime),
          volume,
          tradeCount: 0
        }
      });
    }

    console.log(`Imported ${candles.length} OKX candles into PostgreSQL.`);
  } finally {
    await prisma.$disconnect();
  }
};

void main().catch((error: unknown) => {
  console.error("Failed to import OKX candles", error);
  process.exit(1);
});
