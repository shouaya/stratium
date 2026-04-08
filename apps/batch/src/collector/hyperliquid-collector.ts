import fs from "node:fs";
import path from "node:path";
import { AlertQueuePublisher } from "../infra/alert-queue-publisher.js";
import type { BatchConfig } from "../infra/config.js";
import { RotatingNdjsonWriter } from "../infra/rotating-ndjson-writer.js";
import { S3Uploader } from "../infra/s3-uploader.js";
import { SqsPublisher } from "../infra/sqs-publisher.js";

type Channel = "l2Book" | "trades" | "candle" | "activeAssetCtx";

interface HyperliquidEnvelope {
  channel?: string;
  data?: unknown;
}

interface PersistedRecord {
  source: "hyperliquid";
  channel: Channel;
  coin: string;
  candleInterval?: string;
  capturedAt: string;
  payload: unknown;
}

const CHANNELS: Channel[] = ["l2Book", "trades", "candle", "activeAssetCtx"];

const inferCoin = (channel: Channel, data: unknown): string | null => {
  if (channel === "trades" && Array.isArray(data)) {
    const trade = data.find((entry) => typeof entry === "object" && entry !== null && "coin" in entry) as { coin?: unknown } | undefined;
    return typeof trade?.coin === "string" ? trade.coin : null;
  }

  if (channel === "activeAssetCtx" && Array.isArray(data)) {
    const ctx = data.find((entry) => typeof entry === "object" && entry !== null && "coin" in entry) as { coin?: unknown } | undefined;
    return typeof ctx?.coin === "string" ? ctx.coin : null;
  }

  if (typeof data === "object" && data !== null) {
    if ("coin" in data && typeof (data as { coin?: unknown }).coin === "string") {
      return (data as { coin: string }).coin;
    }

    if ("s" in data && typeof (data as { s?: unknown }).s === "string") {
      return (data as { s: string }).s;
    }

    if ("candle" in data && typeof (data as { candle?: unknown }).candle === "object" && (data as { candle: { s?: unknown } }).candle?.s) {
      const candle = (data as { candle: { s?: unknown } }).candle;
      return typeof candle.s === "string" ? candle.s : null;
    }
  }

  return null;
};

const listPendingFiles = async (baseDir: string): Promise<Array<{ fullPath: string; relativePath: string }>> => {
  const pending: Array<{ fullPath: string; relativePath: string }> = [];
  const stack = [baseDir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    const entries = await fs.promises.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (entry.isFile() && fullPath.endsWith(".ndjson") && !fullPath.endsWith(".open.ndjson")) {
        pending.push({
          fullPath,
          relativePath: path.relative(baseDir, fullPath)
        });
      }
    }
  }

  return pending.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
};

export class HyperliquidBatchCollector {
  private readonly config: BatchConfig;

  private readonly writer: RotatingNdjsonWriter;

  private readonly uploader: S3Uploader;

  private readonly sqsPublisher: SqsPublisher;

  private readonly alertQueuePublisher: AlertQueuePublisher;

  private socket?: WebSocket;

  private reconnectTimer?: NodeJS.Timeout;

  private uploadTimer?: NodeJS.Timeout;

  private stopped = false;

  private uploadInFlight = false;

  constructor(config: BatchConfig) {
    this.config = config;
    this.writer = new RotatingNdjsonWriter(config.spoolDir, config.rollMinutes, "hyperliquid");
    this.uploader = new S3Uploader({
      bucket: config.s3Bucket,
      prefix: config.s3Prefix,
      region: config.awsRegion,
      storageClass: config.s3StorageClass
    });
    this.sqsPublisher = new SqsPublisher({
      region: config.awsRegion,
      queueUrl: config.sqsQueueUrl
    });
    this.alertQueuePublisher = new AlertQueuePublisher({
      region: config.awsRegion,
      queueUrl: config.alertSqsQueueUrl
    });
  }

  async start(): Promise<void> {
    await this.writer.initialize();
    this.startUploadLoop();
    this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    if (this.uploadTimer) {
      clearInterval(this.uploadTimer);
      this.uploadTimer = undefined;
    }

    if (this.socket) {
      this.socket.close();
      this.socket = undefined;
    }

    await this.writer.close();
    await this.flushPendingFiles();
  }

  private connect(): void {
    if (this.stopped) {
      return;
    }

    console.log(`Connecting to ${this.config.wsUrl} for ${this.config.coins.join(",")}`);
    const socket = new WebSocket(this.config.wsUrl);
    this.socket = socket;

    socket.addEventListener("open", () => {
      console.log("Hyperliquid batch websocket connected");
      for (const coin of this.config.coins) {
        this.subscribe(socket, "l2Book", coin);
        this.subscribe(socket, "trades", coin);
        this.subscribe(socket, "candle", coin, this.config.candleInterval);
        this.subscribe(socket, "activeAssetCtx", coin);
      }
    });

    socket.addEventListener("message", (event) => {
      this.handleMessage(String(event.data));
    });

    socket.addEventListener("close", () => {
      console.warn("Hyperliquid websocket closed");
      this.scheduleReconnect();
    });

    socket.addEventListener("error", (error) => {
      console.error("Hyperliquid websocket error", error);
      this.scheduleReconnect();
    });
  }

  private subscribe(socket: WebSocket, channel: Channel, coin: string, interval?: string): void {
    const subscription = channel === "candle"
      ? { type: channel, coin, interval }
      : { type: channel, coin };

    socket.send(JSON.stringify({
      method: "subscribe",
      subscription
    }));
  }

  private handleMessage(raw: string): void {
    let envelope: HyperliquidEnvelope;

    try {
      envelope = JSON.parse(raw) as HyperliquidEnvelope;
    } catch (error) {
      console.error("Failed to parse Hyperliquid payload", error);
      return;
    }

    if (!envelope.channel || !CHANNELS.includes(envelope.channel as Channel)) {
      return;
    }

    const channel = envelope.channel as Channel;
    const coin = inferCoin(channel, envelope.data);
    if (!coin) {
      return;
    }

    const record: PersistedRecord = {
      source: "hyperliquid",
      channel,
      coin,
      candleInterval: channel === "candle" ? this.config.candleInterval : undefined,
      capturedAt: new Date().toISOString(),
      payload: envelope.data
    };

    this.writer.write(record);
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, this.config.reconnectDelayMs);
  }

  private startUploadLoop(): void {
    this.uploadTimer = setInterval(() => {
      void this.flushPendingFiles();
    }, this.config.uploadIntervalSeconds * 1000);
  }

  private async flushPendingFiles(): Promise<void> {
    if (this.uploadInFlight) {
      return;
    }

    this.uploadInFlight = true;

    try {
      await this.writer.sealExpiredFile();
      await this.writer.flushFinalizations();
      const pendingFiles = await listPendingFiles(this.config.spoolDir);

      for (const file of pendingFiles) {
        try {
          const uploadedObject = await this.uploader.uploadCompressedFile(file.fullPath, file.relativePath);
          await this.sqsPublisher.publishUploadedBatch({
            bucket: uploadedObject.bucket,
            key: uploadedObject.key,
            source: "hyperliquid",
            uploadedAt: new Date().toISOString(),
            contentEncoding: "gzip",
            contentType: "application/x-ndjson"
          });
          await this.uploader.cleanupUploadedFile(file.fullPath);
        } catch (error) {
          await this.handlePipelineFailure(file.relativePath, error);
          break;
        }
      }
    } finally {
      this.uploadInFlight = false;
    }
  }

  private async handlePipelineFailure(relativePath: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(`Failed to process ${relativePath}`, error);

    try {
      await this.alertQueuePublisher.publishEmailTask({
        to: this.config.alertEmailTo,
        subject: `[stratium-batch] delivery failed for ${relativePath}`,
        html: [
          "<p>A Hyperliquid batch delivery failed.</p>",
          `<p><strong>File:</strong> ${relativePath}</p>`,
          `<p><strong>S3 bucket:</strong> ${this.config.s3Bucket}</p>`,
          `<p><strong>S3 prefix:</strong> ${this.config.s3Prefix}</p>`,
          `<p><strong>SQS queue:</strong> ${this.config.sqsQueueUrl}</p>`,
          `<p><strong>Time:</strong> ${new Date().toISOString()}</p>`,
          `<p><strong>Error:</strong> ${message}</p>`
        ].join("")
      });
    } catch (notifyError) {
      console.error("Failed to publish failure email task", notifyError);
    }
  }
}
