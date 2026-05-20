import type { AiTraderWakeRequest } from "@stratium/shared";
import type { TraderMcpClient, TraderMcpToolResult } from "../infra/traderMcpClient.js";
import type { TraderBotAccountSnapshot, TraderBotMarketSnapshot, TraderBotMemory, TraderBotPlannerContext, TraderBotRunnerConfig } from "../types.js";

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

const toNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
};

const coinFromSymbol = (symbol: string): string => symbol.split("-")[0] || symbol;

const toolRaw = (result: TraderMcpToolResult): unknown => result.raw ?? result.summary ?? result;

const mergeMemories = (memories: TraderBotMemory[]): TraderBotMemory[] => {
  const byKey = new Map<string, TraderBotMemory>();
  for (const memory of memories) {
    if (!memory.key.trim()) {
      continue;
    }
    byKey.set(memory.key, memory);
  }
  return [...byKey.values()];
};

const deriveMid = (allMids: unknown, symbol: string): number => {
  const record = asRecord(allMids);
  if (!record) {
    return 0;
  }
  const coin = coinFromSymbol(symbol);
  return toNumber(record[coin] ?? record[symbol] ?? Object.values(record)[0], 0);
};

const deriveBookSide = (book: unknown, side: 0 | 1, fallback: number): number => {
  const record = asRecord(book);
  const levels = Array.isArray(record?.levels) ? record.levels : undefined;
  const sideLevels = Array.isArray(levels?.[side]) ? levels[side] as unknown[] : undefined;
  const first = asRecord(sideLevels?.[0]);
  return toNumber(first?.px, fallback);
};

type ParsedCandle = {
  openTime: number;
  high: number;
  low: number;
  close: number;
};

const parseCandle = (value: unknown): ParsedCandle | undefined => {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const openTime = toNumber(record.t ?? record.openTime, Number.NaN);
  const high = toNumber(record.h ?? record.high, Number.NaN);
  const low = toNumber(record.l ?? record.low, Number.NaN);
  const close = toNumber(record.c ?? record.close, Number.NaN);

  if (![openTime, high, low, close].every(Number.isFinite)) {
    return undefined;
  }
  return { openTime, high, low, close };
};

const parseCandles = (value: unknown): ParsedCandle[] =>
  (Array.isArray(value) ? value : [])
    .flatMap((entry) => {
      const candle = parseCandle(entry);
      return candle ? [candle] : [];
    })
    .sort((left, right) => left.openTime - right.openTime);

const calculateRsi = (closes: number[], period = 14): number | undefined => {
  if (closes.length <= period) {
    return undefined;
  }

  let gains = 0;
  let losses = 0;
  for (let index = closes.length - period; index < closes.length; index += 1) {
    const delta = closes[index] - closes[index - 1];
    if (delta >= 0) {
      gains += delta;
    } else {
      losses += Math.abs(delta);
    }
  }

  if (losses === 0) {
    return gains === 0 ? 50 : 100;
  }

  const relativeStrength = gains / losses;
  return Number((100 - 100 / (1 + relativeStrength)).toFixed(2));
};

const calculateAtr = (candles: ParsedCandle[], period = 14): number | undefined => {
  if (candles.length <= period) {
    return undefined;
  }

  const trueRanges: number[] = [];
  for (let index = candles.length - period; index < candles.length; index += 1) {
    const candle = candles[index];
    const previousClose = candles[index - 1]?.close ?? candle.close;
    trueRanges.push(Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose)
    ));
  }

  return Number((trueRanges.reduce((sum, value) => sum + value, 0) / trueRanges.length).toFixed(2));
};

const deriveIndicators = (candlesInput: unknown): TraderBotMarketSnapshot["indicators"] | undefined => {
  const candles = parseCandles(candlesInput);
  if (candles.length === 0) {
    return undefined;
  }

  const closes = candles.map((candle) => candle.close);
  const lastClose = closes.at(-1);
  const close5m = closes.at(-6);
  const return5mPct = lastClose !== undefined && close5m !== undefined && close5m > 0
    ? Number((((lastClose - close5m) / close5m) * 100).toFixed(4))
    : undefined;

  return {
    rsi: calculateRsi(closes),
    atr: calculateAtr(candles),
    return5mPct
  };
};

const deriveMarket = (symbol: string, allMids: unknown, l2Book: unknown, candles?: unknown): TraderBotMarketSnapshot => {
  const mid = deriveMid(allMids, symbol);
  const bid = deriveBookSide(l2Book, 0, mid);
  const ask = deriveBookSide(l2Book, 1, mid);
  const record = asRecord(l2Book);
  return {
    symbol,
    bid,
    ask,
    last: mid || (bid + ask) / 2,
    timestamp: new Date(toNumber(record?.time, Date.now())).toISOString(),
    indicators: deriveIndicators(candles)
  };
};

const derivePosition = (clearinghouseState: unknown, symbol: string): TraderBotAccountSnapshot["position"] => {
  const state = asRecord(clearinghouseState);
  const positions = Array.isArray(state?.assetPositions) ? state.assetPositions : [];
  const coin = coinFromSymbol(symbol);
  for (const entry of positions) {
    const position = asRecord(asRecord(entry)?.position);
    if (!position) {
      continue;
    }
    const positionCoin = typeof position.coin === "string" ? position.coin : undefined;
    const signedSize = toNumber(position.szi, 0);
    if (positionCoin !== coin || signedSize === 0) {
      continue;
    }
    return {
      symbol,
      side: signedSize > 0 ? "long" : "short",
      quantity: Math.abs(signedSize),
      notional: Math.abs(toNumber(position.positionValue, 0))
    };
  }
  return {
    symbol,
    side: "flat",
    quantity: 0,
    notional: 0
  };
};

const deriveAccount = (clearinghouseState: unknown, symbol: string): TraderBotAccountSnapshot => {
  const state = asRecord(clearinghouseState);
  const marginSummary = asRecord(state?.marginSummary);
  return {
    equity: toNumber(marginSummary?.accountValue, 0),
    availableMargin: toNumber(state?.withdrawable, toNumber(marginSummary?.accountValue, 0)),
    currentPositionNotional: toNumber(marginSummary?.totalNtlPos, 0),
    position: derivePosition(clearinghouseState, symbol)
  };
};

export const createPlannerContextFromMcp = async (input: {
  config: TraderBotRunnerConfig;
  wakeRequest: AiTraderWakeRequest;
  mcpClient: TraderMcpClient;
  memories?: TraderBotMemory[];
  now?: string;
}): Promise<TraderBotPlannerContext> => {
  const coin = coinFromSymbol(input.config.activeSymbol);
  const now = Date.now();
  const [allMids, l2Book, clearinghouseState, openOrders, candles] = await Promise.all([
    input.mcpClient.callTool("stratium_get_all_mids"),
    input.mcpClient.callTool("stratium_get_l2_book", { coin }),
    input.mcpClient.callTool("stratium_get_clearinghouse_state"),
    input.mcpClient.callTool("stratium_get_open_orders"),
    input.mcpClient.callTool("stratium_get_candles", {
      coin,
      interval: "1m",
      startTime: now - 60 * 60_000,
      endTime: now
    }).catch(() => undefined)
  ]);

  return {
    config: input.config,
    wakeRequest: input.wakeRequest,
    market: deriveMarket(input.config.activeSymbol, toolRaw(allMids), toolRaw(l2Book), candles ? toolRaw(candles) : undefined),
    account: deriveAccount(toolRaw(clearinghouseState), input.config.activeSymbol),
    memories: mergeMemories([
      ...(input.memories ?? []),
      {
        key: "state/open_orders",
        value: JSON.stringify(toolRaw(openOrders)),
        importance: 0.3
      }
    ]),
    now: input.now ?? new Date().toISOString()
  };
};
