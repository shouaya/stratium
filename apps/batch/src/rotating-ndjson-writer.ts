import fs from "node:fs";
import path from "node:path";

const pad = (value: number): string => String(value).padStart(2, "0");

const formatUtcFolder = (date: Date): string =>
  `${date.getUTCFullYear()}/${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}/${pad(date.getUTCHours())}`;

const formatUtcStamp = (date: Date): string =>
  `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;

const floorToWindow = (timestampMs: number, windowMs: number): number =>
  Math.floor(timestampMs / windowMs) * windowMs;

export interface RotatingFileMetadata {
  startedAt: number;
  endedAt: number;
  relativePath: string;
  fullPath: string;
}

interface ActiveFile {
  startedAt: number;
  relativeOpenPath: string;
  fullOpenPath: string;
  stream: fs.WriteStream;
}

export class RotatingNdjsonWriter {
  private readonly baseDir: string;

  private readonly windowMs: number;

  private readonly filePrefix: string;

  private active?: ActiveFile;

  constructor(baseDir: string, rollMinutes: number, filePrefix: string) {
    this.baseDir = baseDir;
    this.windowMs = rollMinutes * 60_000;
    this.filePrefix = filePrefix;
  }

  async initialize(): Promise<void> {
    await fs.promises.mkdir(this.baseDir, { recursive: true });
    await this.finalizeDanglingOpenFiles();
  }

  write(record: unknown, timestampMs = Date.now()): void {
    const file = this.ensureActiveFile(timestampMs);
    file.stream.write(`${JSON.stringify(record)}\n`);
  }

  async close(): Promise<RotatingFileMetadata | null> {
    if (!this.active) {
      return null;
    }

    const metadata = await this.finalizeActiveFile(this.active);
    this.active = undefined;
    return metadata;
  }

  async sealExpiredFile(nowMs = Date.now()): Promise<RotatingFileMetadata | null> {
    if (!this.active) {
      return null;
    }

    if (this.active.startedAt + this.windowMs > nowMs) {
      return null;
    }

    const metadata = await this.finalizeActiveFile(this.active);
    this.active = undefined;
    return metadata;
  }

  private ensureActiveFile(timestampMs: number): ActiveFile {
    const startedAt = floorToWindow(timestampMs, this.windowMs);

    if (this.active && this.active.startedAt === startedAt) {
      return this.active;
    }

    const previous = this.active;
    if (previous) {
      this.active = undefined;
      void this.finalizeActiveFile(previous).catch((error: unknown) => {
        console.error("Failed to finalize rotated file", error);
      });
    }

    const folder = formatUtcFolder(new Date(startedAt));
    const baseName = `${this.filePrefix}-${formatUtcStamp(new Date(startedAt))}`;
    const relativeOpenPath = path.join(folder, `${baseName}.open.ndjson`);
    const fullOpenPath = path.join(this.baseDir, relativeOpenPath);

    fs.mkdirSync(path.dirname(fullOpenPath), { recursive: true });

    const stream = fs.createWriteStream(fullOpenPath, {
      flags: "a",
      encoding: "utf8"
    });

    this.active = {
      startedAt,
      relativeOpenPath,
      fullOpenPath,
      stream
    };

    return this.active;
  }

  private async finalizeActiveFile(file: ActiveFile): Promise<RotatingFileMetadata> {
    await new Promise<void>((resolve, reject) => {
      file.stream.end((error?: Error | null) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    const finalRelativePath = file.relativeOpenPath.replace(/\.open\.ndjson$/, ".ndjson");
    const finalFullPath = path.join(this.baseDir, finalRelativePath);
    await fs.promises.rename(file.fullOpenPath, finalFullPath);

    return {
      startedAt: file.startedAt,
      endedAt: file.startedAt + this.windowMs,
      relativePath: finalRelativePath,
      fullPath: finalFullPath
    };
  }

  private async finalizeDanglingOpenFiles(): Promise<void> {
    const stack = [this.baseDir];

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

        if (entry.isFile() && fullPath.endsWith(".open.ndjson")) {
          await fs.promises.rename(fullPath, fullPath.replace(/\.open\.ndjson$/, ".ndjson"));
        }
      }
    }
  }
}
