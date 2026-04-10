import type { AnyEventEnvelope } from "@stratium/shared";
import { formatTokyoDateTime, formatTokyoTime } from "../time";
import type { AppLocale } from "../auth-client";
import type { TimeframeId } from "./types";

export const TIMEFRAMES: Array<{ id: TimeframeId; label: string; hint: string; bucketMs: number }> = [
  { id: "1m", label: "1m", hint: "1 minute", bucketMs: 60_000 },
  { id: "5m", label: "5m", hint: "5 minutes", bucketMs: 300_000 },
  { id: "15m", label: "15m", hint: "15 minutes", bucketMs: 900_000 },
  { id: "1h", label: "1h", hint: "1 hour", bucketMs: 3_600_000 }
];

export const fmt = (n?: number | null, d = 4) =>
  n == null ? "-" : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

export const clock = (s?: string) => formatTokyoTime(s);
export const dateTime = (s?: string) => formatTokyoDateTime(s);

export const priceDigitsForSymbol = (symbol?: string | null) => symbol?.startsWith("BTC-") ? 0 : 4;

export const coinFromSymbol = (symbol?: string | null) => {
  if (!symbol) {
    return "BTC";
  }

  if (symbol.includes("-")) {
    return symbol.split("-")[0] ?? symbol;
  }

  if (symbol.includes("/")) {
    return symbol.split("/")[0] ?? symbol;
  }

  return symbol;
};

export const mergeEvents = (currentEvents: AnyEventEnvelope[], nextEvents: AnyEventEnvelope[] = []) => {
  if (nextEvents.length === 0) {
    return currentEvents;
  }

  const merged = new Map(currentEvents.map((event) => [event.eventId, event]));

  for (const event of nextEvents) {
    merged.set(event.eventId, event);
  }

  return [...merged.values()].sort((left, right) => left.sequence - right.sequence);
};

export const extractExchangeMessage = (
  payload: {
    response?: {
      data?: {
        statuses?: Array<{
          error?: string;
          filled?: unknown;
          resting?: unknown;
          success?: string;
        }>;
      };
    };
  },
  successMessage: string
) => {
  const firstStatus = payload.response?.data?.statuses?.[0];

  if (firstStatus?.error) {
    return firstStatus.error;
  }

  return successMessage;
};

export const toOid = (orderId: string): number => {
  const numericPart = Number(orderId.replace(/^ord_/, ""));
  return Number.isFinite(numericPart) ? numericPart : 0;
};

export const getLocaleText = (locale: AppLocale, zh: string, ja: string, en: string) => {
  if (locale === "zh") {
    return zh;
  }

  if (locale === "ja") {
    return ja;
  }

  return en;
};
