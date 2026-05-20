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

const deriveMarket = (symbol: string, allMids: unknown, l2Book: unknown): TraderBotMarketSnapshot => {
  const mid = deriveMid(allMids, symbol);
  const bid = deriveBookSide(l2Book, 0, mid);
  const ask = deriveBookSide(l2Book, 1, mid);
  const record = asRecord(l2Book);
  return {
    symbol,
    bid,
    ask,
    last: mid || (bid + ask) / 2,
    timestamp: new Date(toNumber(record?.time, Date.now())).toISOString()
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
  const [allMids, l2Book, clearinghouseState, openOrders] = await Promise.all([
    input.mcpClient.callTool("stratium_get_all_mids"),
    input.mcpClient.callTool("stratium_get_l2_book", { coin }),
    input.mcpClient.callTool("stratium_get_clearinghouse_state"),
    input.mcpClient.callTool("stratium_get_open_orders")
  ]);

  return {
    config: input.config,
    wakeRequest: input.wakeRequest,
    market: deriveMarket(input.config.activeSymbol, toolRaw(allMids), toolRaw(l2Book)),
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
