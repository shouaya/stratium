import { mkdir, appendFile } from "node:fs/promises";
import type { IncomingHttpHeaders } from "node:http";
import { dirname } from "node:path";

export interface TraderMcpLogEntry {
  timestamp?: string;
  channel: "incoming-mcp-http" | "outgoing-stratium-http" | "tool-call";
  event: string;
  requestId?: string;
  toolName?: string;
  data: unknown;
}

export interface TraderMcpLogger {
  log(entry: TraderMcpLogEntry): Promise<void>;
}

const normalizeHeaderValue = (value: string | string[] | number | undefined) => {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry));
  }

  if (value === undefined) {
    return undefined;
  }

  return String(value);
};

export const normalizeIncomingHeaders = (headers?: IncomingHttpHeaders) =>
  Object.fromEntries(
    Object.entries(headers ?? {})
      .map(([key, value]) => [key, normalizeHeaderValue(value as string | string[] | number | undefined)])
      .filter(([, value]) => value !== undefined)
  );

export const normalizeFetchHeaders = (headers?: HeadersInit | Headers) => {
  if (!headers) {
    return {};
  }

  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers.map(([key, value]) => [key, value]));
  }

  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, normalizeHeaderValue(value as string | string[] | number | undefined)])
  );
};

export const tryParseJson = (text: string | undefined) => {
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

export class JsonLineFileLogger implements TraderMcpLogger {
  private writeQueue = Promise.resolve();

  constructor(private readonly logPath?: string) {}

  async log(entry: TraderMcpLogEntry) {
    if (!this.logPath) {
      return;
    }

    const payload = JSON.stringify({
      timestamp: entry.timestamp ?? new Date().toISOString(),
      ...entry
    }) + "\n";

    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(this.logPath as string), { recursive: true });
        await appendFile(this.logPath as string, payload, "utf8");
      });

    await this.writeQueue;
  }
}
