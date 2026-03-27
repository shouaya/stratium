import path from "node:path";
import type { PutObjectCommandInput } from "@aws-sdk/client-s3";

const required = (value: string | undefined, name: string): string => {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

const positiveInteger = (value: string | undefined, fallback: number, name: string): number => {
  if (value == null || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
};

const optionalNonEmpty = (value: string | undefined): string | undefined => {
  if (value == null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

const parseCoins = (value: string | undefined): string[] => {
  const coins = (value ?? "BTC")
    .split(",")
    .map((coin) => coin.trim().toUpperCase())
    .filter(Boolean);

  if (coins.length === 0) {
    throw new Error("HYPERLIQUID_COINS must contain at least one coin");
  }

  return [...new Set(coins)];
};

export interface BatchConfig {
  wsUrl: string;
  coins: string[];
  candleInterval: string;
  spoolDir: string;
  rollMinutes: number;
  uploadIntervalSeconds: number;
  reconnectDelayMs: number;
  awsRegion: string;
  s3Bucket: string;
  s3Prefix: string;
  s3StorageClass?: PutObjectCommandInput["StorageClass"];
  sqsQueueUrl: string;
  alertSqsQueueUrl: string;
  alertEmailTo: string;
  nodeEnv: string;
}

export const loadConfig = (): BatchConfig => ({
  wsUrl: process.env.HYPERLIQUID_WS_URL ?? "wss://api.hyperliquid.xyz/ws",
  coins: parseCoins(process.env.HYPERLIQUID_COINS),
  candleInterval: process.env.HYPERLIQUID_CANDLE_INTERVAL ?? "1m",
  spoolDir: path.resolve(process.cwd(), process.env.BATCH_SPOOL_DIR ?? "logs/hyperliquid-batch"),
  rollMinutes: positiveInteger(process.env.BATCH_FILE_ROLL_MINUTES, 5, "BATCH_FILE_ROLL_MINUTES"),
  uploadIntervalSeconds: positiveInteger(process.env.BATCH_UPLOAD_INTERVAL_SECONDS, 60, "BATCH_UPLOAD_INTERVAL_SECONDS"),
  reconnectDelayMs: positiveInteger(process.env.BATCH_RECONNECT_DELAY_MS, 3000, "BATCH_RECONNECT_DELAY_MS"),
  awsRegion: process.env.AWS_REGION ?? "ap-northeast-1",
  s3Bucket: required(process.env.BATCH_S3_BUCKET, "BATCH_S3_BUCKET"),
  s3Prefix: trimTrailingSlash(process.env.BATCH_S3_PREFIX ?? "hyperliquid"),
  s3StorageClass: optionalNonEmpty(process.env.BATCH_S3_STORAGE_CLASS) as PutObjectCommandInput["StorageClass"] | undefined,
  sqsQueueUrl: required(process.env.BATCH_SQS_QUEUE_URL, "BATCH_SQS_QUEUE_URL"),
  alertSqsQueueUrl: required(process.env.BATCH_ALERT_SQS_QUEUE_URL, "BATCH_ALERT_SQS_QUEUE_URL"),
  alertEmailTo: required(process.env.BATCH_ALERT_EMAIL_TO, "BATCH_ALERT_EMAIL_TO"),
  nodeEnv: process.env.NODE_ENV ?? "development"
});
