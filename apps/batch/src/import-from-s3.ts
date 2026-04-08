import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { PrismaClient } from "@prisma/client";
import readline from "node:readline";
import zlib from "node:zlib";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

type Channel = "l2Book" | "trades" | "candle" | "activeAssetCtx";

interface PersistedRecord {
  source: "hyperliquid";
  channel: Channel;
  coin: string;
  candleInterval?: string;
  capturedAt: string;
  payload: unknown;
}

interface HyperliquidWsLevel {
  px: string;
  sz: string;
  n: number;
}

interface HyperliquidWsBook {
  coin: string;
  levels: [HyperliquidWsLevel[], HyperliquidWsLevel[]];
  time: number;
}

interface HyperliquidWsTrade {
  coin: string;
  side: string;
  px: string;
  sz: string;
  time: number;
  tid: number;
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

interface HyperliquidWsActiveAssetCtx {
  coin: string;
  ctx: {
    dayNtlVlm?: number | string;
    prevDayPx?: number | string;
    markPx?: number | string;
    midPx?: number | string;
    oraclePx?: number | string;
    funding?: number | string;
    openInterest?: number | string;
  };
}

const prisma = new PrismaClient();

interface CliOptions {
  year?: number;
  month?: number;
  day?: number;
}

const required = (value: string | undefined, name: string): string => {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

const isWsCandle = (value: unknown): value is HyperliquidWsCandle =>
  typeof value === "object" && value !== null && "s" in value && "i" in value && "t" in value;

const toNumber = (value: number | string | undefined): number | null => {
  if (value == null) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parsePositiveInteger = (value: string | undefined, envName: string): number | undefined => {
  if (value == null || value.trim() === "") {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${envName} must be a positive integer`);
  }

  return parsed;
};

const parseCliOptions = (argv: string[]): CliOptions => {
  const options: CliOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--") {
      continue;
    }

    if (current === "--year") {
      options.year = parsePositiveInteger(next, "--year");
      index += 1;
      continue;
    }

    if (current === "--month") {
      options.month = parsePositiveInteger(next, "--month");
      index += 1;
      continue;
    }

    if (current === "--day") {
      options.day = parsePositiveInteger(next, "--day");
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${current}`);
  }

  return options;
};

const buildImportPrefix = (basePrefix: string, year?: number, month?: number, day?: number): string => {
  const segments = [basePrefix.replace(/\/+$/, "")];

  if (year != null) {
    segments.push(String(year).padStart(4, "0"));
  }

  if (month != null) {
    if (year == null) {
      throw new Error("IMPORT_S3_MONTH requires IMPORT_S3_YEAR");
    }

    if (month < 1 || month > 12) {
      throw new Error("IMPORT_S3_MONTH must be between 1 and 12");
    }

    segments.push(String(month).padStart(2, "0"));
  }

  if (day != null) {
    if (year == null || month == null) {
      throw new Error("IMPORT_S3_DAY requires IMPORT_S3_YEAR and IMPORT_S3_MONTH");
    }

    if (day < 1 || day > 31) {
      throw new Error("IMPORT_S3_DAY must be between 1 and 31");
    }

    segments.push(String(day).padStart(2, "0"));
  }

  return `${segments.join("/")}/`;
};

const collectCandidates = async (client: S3Client, bucket: string, prefix: string): Promise<string[]> => {
  const keys: string[] = [];
  let continuationToken: string | undefined;

  while (true) {
    const response = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken
    }));

    for (const object of response.Contents ?? []) {
      if (object.Key?.endsWith(".ndjson.gz")) {
        keys.push(object.Key);
      }
    }

    if (!response.IsTruncated) {
      return keys.sort();
    }

    continuationToken = response.NextContinuationToken;
  }
};

const upsertBook = async (payload: HyperliquidWsBook) => {
  const capturedAt = new Date(payload.time);
  const snapshotId = `${payload.coin}-${payload.time}`;
  const bids = payload.levels[0]
    .map((level, index) => ({
      id: `${snapshotId}-bid-${index}`,
      snapshotId,
      source: "hyperliquid",
      coin: payload.coin,
      side: "bid",
      levelIndex: index,
      price: Number(level.px),
      size: Number(level.sz),
      orders: level.n,
      capturedAt
    }))
    .slice(0, 12);
  const asks = payload.levels[1]
    .map((level, index) => ({
      id: `${snapshotId}-ask-${index}`,
      snapshotId,
      source: "hyperliquid",
      coin: payload.coin,
      side: "ask",
      levelIndex: index,
      price: Number(level.px),
      size: Number(level.sz),
      orders: level.n,
      capturedAt
    }))
    .slice(0, 12);
  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;

  await prisma.marketBookSnapshot.upsert({
    where: { id: snapshotId },
    update: {
      source: "hyperliquid",
      coin: payload.coin,
      symbol: `${payload.coin}-USD`,
      bestBid,
      bestAsk,
      spread: bestBid != null && bestAsk != null ? bestAsk - bestBid : null,
      capturedAt
    },
    create: {
      id: snapshotId,
      source: "hyperliquid",
      coin: payload.coin,
      symbol: `${payload.coin}-USD`,
      bestBid,
      bestAsk,
      spread: bestBid != null && bestAsk != null ? bestAsk - bestBid : null,
      capturedAt
    }
  });

  for (const level of [...bids, ...asks]) {
    await prisma.marketBookLevel.upsert({
      where: { id: level.id },
      update: level,
      create: level
    });
  }
};

const upsertTrades = async (payload: HyperliquidWsTrade[]) => {
  for (const trade of payload) {
    const id = `${trade.coin}-${trade.time}-${trade.tid}`;
    await prisma.marketTrade.upsert({
      where: { id },
      update: {
        source: "hyperliquid",
        coin: trade.coin,
        side: trade.side === "A" || trade.side.toLowerCase() === "sell" ? "sell" : "buy",
        price: Number(trade.px),
        size: Number(trade.sz),
        tradeTime: new Date(trade.time)
      },
      create: {
        id,
        source: "hyperliquid",
        coin: trade.coin,
        side: trade.side === "A" || trade.side.toLowerCase() === "sell" ? "sell" : "buy",
        price: Number(trade.px),
        size: Number(trade.sz),
        tradeTime: new Date(trade.time)
      }
    });
  }
};

const upsertCandles = async (payload: HyperliquidWsCandle | HyperliquidWsCandle[] | { candle?: HyperliquidWsCandle }) => {
  const candidates = Array.isArray(payload)
    ? payload
    : typeof payload === "object" && payload !== null && "candle" in payload && payload.candle
      ? [payload.candle]
      : [payload];

  const candles = candidates.filter(isWsCandle);
  for (const candle of candles) {
    const candleId = `${candle.s}-${candle.i}-${candle.t}`;
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
        id: candleId,
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
};

const upsertAssetCtx = async (
  payload: HyperliquidWsActiveAssetCtx | HyperliquidWsActiveAssetCtx[],
  capturedAtIso: string
) => {
  const entries = Array.isArray(payload) ? payload : [payload];
  const capturedAt = new Date(capturedAtIso);

  for (const entry of entries) {
    const id = `${entry.coin}-${capturedAt.getTime()}`;

    await prisma.marketAssetContext.upsert({
      where: { id },
      update: {
        source: "hyperliquid",
        coin: entry.coin,
        markPrice: toNumber(entry.ctx.markPx),
        midPrice: toNumber(entry.ctx.midPx),
        oraclePrice: toNumber(entry.ctx.oraclePx),
        fundingRate: toNumber(entry.ctx.funding),
        openInterest: toNumber(entry.ctx.openInterest),
        prevDayPrice: toNumber(entry.ctx.prevDayPx),
        dayNotionalVolume: toNumber(entry.ctx.dayNtlVlm),
        capturedAt
      },
      create: {
        id,
        source: "hyperliquid",
        coin: entry.coin,
        markPrice: toNumber(entry.ctx.markPx),
        midPrice: toNumber(entry.ctx.midPx),
        oraclePrice: toNumber(entry.ctx.oraclePx),
        fundingRate: toNumber(entry.ctx.funding),
        openInterest: toNumber(entry.ctx.openInterest),
        prevDayPrice: toNumber(entry.ctx.prevDayPx),
        dayNotionalVolume: toNumber(entry.ctx.dayNtlVlm),
        capturedAt
      }
    });
  }
};

const importRecord = async (record: PersistedRecord) => {
  if (record.channel === "l2Book") {
    await upsertBook(record.payload as HyperliquidWsBook);
    return;
  }

  if (record.channel === "trades") {
    await upsertTrades(record.payload as HyperliquidWsTrade[]);
    return;
  }

  if (record.channel === "candle") {
    await upsertCandles(record.payload as HyperliquidWsCandle | HyperliquidWsCandle[] | { candle?: HyperliquidWsCandle });
    return;
  }

  if (record.channel === "activeAssetCtx") {
    await upsertAssetCtx(
      record.payload as HyperliquidWsActiveAssetCtx | HyperliquidWsActiveAssetCtx[],
      record.capturedAt
    );
  }
};

const bodyToReadable = (body: unknown): Readable => {
  if (body instanceof Readable) {
    return body;
  }

  if (body && typeof body === "object" && "transformToWebStream" in body && typeof (body as { transformToWebStream(): unknown }).transformToWebStream === "function") {
    return Readable.fromWeb((body as { transformToWebStream(): NodeReadableStream }).transformToWebStream());
  }

  throw new Error("Unsupported S3 body stream");
};

const importObject = async (client: S3Client, bucket: string, key: string) => {
  const response = await client.send(new GetObjectCommand({
    Bucket: bucket,
    Key: key
  }));

  if (!response.Body) {
    return;
  }

  const stream = bodyToReadable(response.Body);
  const gunzip = zlib.createGunzip();
  const rl = readline.createInterface({
    input: stream.pipe(gunzip),
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    await importRecord(JSON.parse(trimmed) as PersistedRecord);
  }
};

const main = async () => {
  const bucket = required(process.env.BATCH_S3_BUCKET, "BATCH_S3_BUCKET");
  const basePrefix = required(process.env.BATCH_S3_PREFIX, "BATCH_S3_PREFIX");
  const cliOptions = parseCliOptions(process.argv.slice(2));
  const region = process.env.AWS_REGION ?? "ap-northeast-1";
  const prefix = buildImportPrefix(basePrefix, cliOptions.year, cliOptions.month, cliOptions.day);

  const client = new S3Client({ region });
  await prisma.$connect();

  const targetKeys = await collectCandidates(client, bucket, prefix);

  console.log(`Importing ${targetKeys.length} S3 objects from s3://${bucket}/${prefix}`);

  for (const key of targetKeys) {
    console.log(`Importing ${key}`);
    await importObject(client, bucket, key);
  }

  console.log("S3 import completed");
  await prisma.$disconnect();
};

void main().catch(async (error: unknown) => {
  console.error("S3 import failed", error);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
