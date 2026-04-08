import { connectPrismaWithLocalhostFallback } from "./prisma-connection.js";

interface CliOptions {
  all: boolean;
  coin?: string;
  interval?: string;
  source?: string;
  before?: Date;
}

const parseCliOptions = (argv: string[]): CliOptions => {
  const options: CliOptions = {
    all: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--") {
      continue;
    }

    if (current === "--all") {
      options.all = true;
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

    if (current === "--source") {
      if (!next) {
        throw new Error("--source requires a value");
      }

      options.source = next.trim();
      index += 1;
      continue;
    }

    if (current === "--before") {
      if (!next) {
        throw new Error("--before requires an ISO datetime value");
      }

      const before = new Date(next);

      if (Number.isNaN(before.getTime())) {
        throw new Error("--before must be a valid ISO datetime");
      }

      options.before = before;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${current}`);
  }

  return options;
};

const validateScope = (options: CliOptions) => {
  if (!options.all && !options.coin && !options.interval && !options.source && !options.before) {
    throw new Error("Refusing to clear K-line history without filters. Use --all to clear everything.");
  }
};

const main = async () => {
  const options = parseCliOptions(process.argv.slice(2));
  validateScope(options);
  const candleWhere = {
    ...(options.coin ? { coin: options.coin } : {}),
    ...(options.interval ? { interval: options.interval } : {}),
    ...(options.source ? { source: options.source } : {}),
    ...(options.before ? { openTime: { lt: options.before } } : {})
  };
  const volumeWhere = {
    ...(options.coin ? { coin: options.coin } : {}),
    ...(options.interval ? { interval: options.interval } : {}),
    ...(options.source ? { source: options.source } : {}),
    ...(options.before ? { bucketStart: { lt: options.before } } : {})
  };

  const prisma = await connectPrismaWithLocalhostFallback();

  try {
    const [candleCount, volumeCount] = await Promise.all([
      prisma.marketCandle.count({ where: candleWhere }),
      prisma.marketVolumeRecord.count({ where: volumeWhere })
    ]);

    console.log("Clearing historical K-line data with filters:");
    console.log(JSON.stringify({
      all: options.all,
      coin: options.coin ?? null,
      interval: options.interval ?? null,
      source: options.source ?? null,
      before: options.before?.toISOString() ?? null,
      matchedCandles: candleCount,
      matchedVolumeRecords: volumeCount
    }, null, 2));

    const [deletedCandles, deletedVolumeRecords] = await prisma.$transaction([
      prisma.marketCandle.deleteMany({ where: candleWhere }),
      prisma.marketVolumeRecord.deleteMany({ where: volumeWhere })
    ]);

    console.log(`Deleted ${deletedCandles.count} market candles.`);
    console.log(`Deleted ${deletedVolumeRecords.count} market volume records.`);
  } finally {
    await prisma.$disconnect();
  }
};

void main().catch(async (error: unknown) => {
  console.error("Failed to clear historical K-line data", error);
  process.exit(1);
});
