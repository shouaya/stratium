import type { AiTraderReviewSnapshot, AiTraderWakeReport, AccountView, AnyEventEnvelope, FillPayload, OrderView, PositionView } from "@stratium/shared";

type EngineStateForReview = {
  account?: AccountView;
  position?: PositionView;
  latestTick?: {
    last?: number;
    tickTime?: string;
    timestamp?: string;
  };
  orders?: OrderView[];
  fills?: AnyEventEnvelope[];
};

const OPEN_ORDER_STATUSES = new Set(["NEW", "ACCEPTED", "PARTIALLY_FILLED"]);
const SIM_REWARD_BASELINE_EQUITY = 10_000;

const round = (value: number): number => Number(value.toFixed(8));
const finite = (value?: number): value is number =>
  typeof value === "number" && Number.isFinite(value);

const countByStatus = (orders: OrderView[]): Record<string, number> =>
  orders.reduce<Record<string, number>>((counts, order) => {
    counts[order.status] = (counts[order.status] ?? 0) + 1;
    return counts;
  }, {});

const isAiOrder = (order: OrderView): boolean =>
  order.clientOrderId?.startsWith("ai-") ?? false;

const isFillEvent = (event: AnyEventEnvelope): event is AnyEventEnvelope & { payload: FillPayload } =>
  event.eventType === "OrderFilled" || event.eventType === "OrderPartiallyFilled";

const sum = (values: number[]): number =>
  values.reduce((total, value) => total + value, 0);

const sortOrders = (orders: OrderView[]): OrderView[] =>
  [...orders].sort((left, right) =>
    new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    || right.id.localeCompare(left.id)
  );

const sortReportsAsc = (reports: AiTraderWakeReport[]): AiTraderWakeReport[] =>
  [...reports].sort((left, right) =>
    new Date(left.finishedAt).getTime() - new Date(right.finishedAt).getTime()
    || left.wakeId.localeCompare(right.wakeId)
  );

const aiFillEvents = (fills: AnyEventEnvelope[] | undefined, symbol: string, orders: OrderView[]) => {
  const orderIds = new Set(orders.map((order) => order.id));
  return (fills ?? [])
    .filter(isFillEvent)
    .filter((event) => event.symbol === symbol && orderIds.has(event.payload.orderId));
};

const buildCostStats = (
  fills: Array<AnyEventEnvelope & { payload: FillPayload }>,
  orders: OrderView[]
): NonNullable<AiTraderReviewSnapshot["costStats"]> => {
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const totalFee = round(sum(fills.map((event) => event.payload.fee)));
  const totalSlippage = round(sum(fills.map((event) => event.payload.slippage)));
  const estimatedSlippageCost = round(sum(fills.map((event) => event.payload.slippage * event.payload.fillQuantity)));
  const totalCost = round(totalFee + estimatedSlippageCost);
  const fillCount = fills.length;

  return {
    fillCount,
    makerFills: fills.filter((event) => event.payload.liquidityRole === "maker").length,
    takerFills: fills.filter((event) => event.payload.liquidityRole === "taker").length,
    marketFills: fills.filter((event) => orderById.get(event.payload.orderId)?.orderType === "market").length,
    limitFills: fills.filter((event) => orderById.get(event.payload.orderId)?.orderType === "limit").length,
    totalFee,
    totalSlippage,
    estimatedSlippageCost,
    totalCost,
    averageCostPerFill: fillCount > 0 ? round(totalCost / fillCount) : 0
  };
};

const buildRewardStats = (
  reports: AiTraderWakeReport[],
  account: AccountView | undefined,
  position: PositionView | undefined,
  costStats: NonNullable<AiTraderReviewSnapshot["costStats"]>
): NonNullable<AiTraderReviewSnapshot["rewardStats"]> => {
  const points = sortReportsAsc(reports)
    .flatMap((report) => finite(report.accountSnapshot?.equity) ? [{
      equity: report.accountSnapshot.equity,
      delta: round(report.accountSnapshot.equity - SIM_REWARD_BASELINE_EQUITY)
    }] : []);
  const latestEquity = reports[0]?.accountSnapshot?.equity ?? account?.equity;
  let upSteps = 0;
  let downSteps = 0;
  let flatSteps = 0;

  for (let index = 1; index < points.length; index += 1) {
    const change = round(points[index].equity - points[index - 1].equity);
    if (change > 0) {
      upSteps += 1;
    } else if (change < 0) {
      downSteps += 1;
    } else {
      flatSteps += 1;
    }
  }

  const realizedPnl = position?.realizedPnl ?? account?.realizedPnl;

  return {
    baselineEquity: SIM_REWARD_BASELINE_EQUITY,
    latestEquity,
    equityDelta: finite(latestEquity) ? round(latestEquity - SIM_REWARD_BASELINE_EQUITY) : undefined,
    realizedPnl,
    unrealizedPnl: position?.unrealizedPnl ?? account?.unrealizedPnl,
    grossRealizedPnl: finite(realizedPnl) ? round(realizedPnl + costStats.totalFee) : undefined,
    upSteps,
    downSteps,
    flatSteps,
    maxEquityDelta: points.length > 0 ? Math.max(...points.map((point) => point.delta)) : undefined,
    minEquityDelta: points.length > 0 ? Math.min(...points.map((point) => point.delta)) : undefined
  };
};

const buildCandidateStats = (reports: AiTraderWakeReport[]): NonNullable<AiTraderReviewSnapshot["candidateStats"]> => {
  const byCandidate = new Map<string, {
    candidateId: string;
    wakes: number;
    cumulativeEquityDelta: number;
    upSteps: number;
    downSteps: number;
    flatSteps: number;
  }>();
  const points = sortReportsAsc(reports)
    .flatMap((report) => finite(report.accountSnapshot?.equity) ? [{ report, equity: report.accountSnapshot.equity }] : []);

  for (let index = 1; index < points.length; index += 1) {
    const candidateId = points[index].report.selectedCandidateId ?? "unknown";
    const change = round(points[index].equity - points[index - 1].equity);
    const current = byCandidate.get(candidateId) ?? {
      candidateId,
      wakes: 0,
      cumulativeEquityDelta: 0,
      upSteps: 0,
      downSteps: 0,
      flatSteps: 0
    };
    current.wakes += 1;
    current.cumulativeEquityDelta = round(current.cumulativeEquityDelta + change);
    if (change > 0) {
      current.upSteps += 1;
    } else if (change < 0) {
      current.downSteps += 1;
    } else {
      current.flatSteps += 1;
    }
    byCandidate.set(candidateId, current);
  }

  return [...byCandidate.values()]
    .map((entry) => ({
      ...entry,
      averageEquityDelta: entry.wakes > 0 ? round(entry.cumulativeEquityDelta / entry.wakes) : 0
    }))
    .sort((left, right) => left.cumulativeEquityDelta - right.cumulativeEquityDelta)
    .slice(0, 12);
};

const buildObservations = (
  reports: AiTraderWakeReport[],
  orders: OrderView[],
  position: PositionView | undefined,
  costStats: NonNullable<AiTraderReviewSnapshot["costStats"]>,
  rewardStats: NonNullable<AiTraderReviewSnapshot["rewardStats"]>
): string[] => {
  const observations: string[] = [];
  const filledOrders = orders.filter((order) => order.status === "FILLED");
  const marketFilled = filledOrders.filter((order) => order.orderType === "market").length;
  const limitFilled = filledOrders.filter((order) => order.orderType === "limit").length;
  const canceled = orders.filter((order) => order.status === "CANCELED").length;
  const realizedPnl = position?.realizedPnl ?? reports[0]?.accountSnapshot?.dailyPnl;
  const absoluteRealizedLoss = Math.abs(Math.min(0, realizedPnl ?? 0));

  if (typeof realizedPnl === "number" && realizedPnl < 0) {
    observations.push(`Realized PnL is negative (${round(realizedPnl)}); reduce churn and require cleaner reward-to-risk before opening new exposure.`);
  }

  if (costStats.totalCost > 0 && costStats.totalCost >= Math.max(0.5, absoluteRealizedLoss * 0.5)) {
    observations.push(`Execution cost is heavy (${round(costStats.totalCost)} total, fee=${round(costStats.totalFee)}, estSlippage=${round(costStats.estimatedSlippageCost)}); avoid market probes unless the setup clearly pays for costs.`);
  }

  if ((rewardStats.equityDelta ?? 0) < 0 && (rewardStats.maxEquityDelta ?? 0) <= 0) {
    observations.push(`Equity has not reclaimed baseline in this sample (delta=${round(rewardStats.equityDelta ?? 0)}); switch from exploration to selectivity until reward improves.`);
  }

  if (rewardStats.downSteps > Math.max(5, rewardStats.upSteps * 2)) {
    observations.push(`Equity steps are skewed down (${rewardStats.downSteps} down vs ${rewardStats.upSteps} up); require stronger confirmation before new entries.`);
  }

  if (marketFilled > limitFilled) {
    observations.push(`Market fills (${marketFilled}) exceed limit fills (${limitFilled}); use market orders mainly for exits or tiny urgent probes.`);
  }

  if (orders.length > 0 && canceled / orders.length > 0.2) {
    observations.push(`Canceled orders are high (${canceled}/${orders.length}); review whether entries are too reactive or levels become stale quickly.`);
  }

  if (position && position.side !== "flat" && position.quantity > 0) {
    observations.push(`Current exposure is ${position.side} ${position.quantity} ${position.symbol}; manage this thesis before opening another idea.`);
  } else {
    observations.push("Current exposure is flat; next trade should wait for a clearly bounded setup instead of forcing feedback.");
  }

  if (reports.some((report) => report.reasons.includes("reflection_due"))) {
    observations.push("A reflection wake has already occurred in this sample; compare new decisions against the latest review memory.");
  }

  return observations.slice(0, 6);
};

export const createAiTraderReviewSnapshot = (input: {
  botId: string;
  accountId: string;
  reports: AiTraderWakeReport[];
  state: EngineStateForReview;
  limit: number;
}): AiTraderReviewSnapshot => {
  const latestReport = input.reports[0];
  const symbol = latestReport?.symbol ?? input.state.position?.symbol ?? "BTC-USD";
  const orders = sortOrders((input.state.orders ?? [])
    .filter((order) => order.symbol === symbol && isAiOrder(order)));
  const completed = input.reports.filter((report) => report.status === "completed").length;
  const failed = input.reports.filter((report) => report.status === "failed").length;
  const filledOrders = orders.filter((order) => order.status === "FILLED");
  const position = input.state.position?.symbol === symbol ? input.state.position : undefined;
  const firstWake = input.reports.at(-1);
  const fills = aiFillEvents(input.state.fills, symbol, orders);
  const costStats = buildCostStats(fills, orders);
  const rewardStats = buildRewardStats(input.reports, input.state.account, position, costStats);

  return {
    schemaVersion: "stratium.ai-trader-review.v1",
    botId: input.botId,
    accountId: input.accountId,
    symbol,
    generatedAt: new Date().toISOString(),
    reportLimit: input.limit,
    firstWakeAt: firstWake?.finishedAt,
    lastWakeAt: latestReport?.finishedAt,
    wakeStats: {
      total: input.reports.length,
      completed,
      failed,
      approvedActions: sum(input.reports.map((report) => report.approvedActions)),
      rejectedActions: sum(input.reports.map((report) => report.rejectedActions))
    },
    orderStats: {
      total: orders.length,
      open: orders.filter((order) => OPEN_ORDER_STATUSES.has(order.status)).length,
      filled: filledOrders.length,
      canceled: orders.filter((order) => order.status === "CANCELED").length,
      rejected: orders.filter((order) => order.status === "REJECTED").length,
      marketFilled: filledOrders.filter((order) => order.orderType === "market").length,
      limitFilled: filledOrders.filter((order) => order.orderType === "limit").length,
      bySide: {
        buy: orders.filter((order) => order.side === "buy").length,
        sell: orders.filter((order) => order.side === "sell").length
      },
      byType: {
        market: orders.filter((order) => order.orderType === "market").length,
        limit: orders.filter((order) => order.orderType === "limit").length
      },
      byStatus: countByStatus(orders)
    },
    costStats,
    rewardStats,
    candidateStats: buildCandidateStats(input.reports),
    currentPosition: position
      ? {
          symbol: position.symbol,
          side: position.side,
          quantity: position.quantity,
          averageEntryPrice: position.averageEntryPrice,
          markPrice: position.markPrice,
          realizedPnl: position.realizedPnl,
          unrealizedPnl: position.unrealizedPnl
        }
      : undefined,
    account: input.state.account
      ? {
          equity: input.state.account.equity,
          availableBalance: input.state.account.availableBalance,
          realizedPnl: input.state.account.realizedPnl,
          unrealizedPnl: input.state.account.unrealizedPnl
        }
      : undefined,
    latestMarket: input.state.latestTick
      ? {
          last: input.state.latestTick.last,
          timestamp: input.state.latestTick.tickTime ?? input.state.latestTick.timestamp
        }
      : undefined,
    recentWakes: input.reports.slice(0, 12).map((report) => ({
      wakeId: report.wakeId,
      finishedAt: report.finishedAt,
      reasons: report.reasons,
      summary: report.planSummary,
      approvedActions: report.approvedActions,
      rejectedActions: report.rejectedActions
    })),
    recentOrders: orders.slice(0, 80).map((order) => ({
      id: order.id,
      clientOrderId: order.clientOrderId,
      symbol: order.symbol,
      side: order.side,
      orderType: order.orderType,
      status: order.status,
      quantity: order.quantity,
      limitPrice: order.limitPrice,
      filledQuantity: order.filledQuantity,
      remainingQuantity: order.remainingQuantity,
      averageFillPrice: order.averageFillPrice,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt
    })),
    observations: buildObservations(input.reports, orders, position, costStats, rewardStats)
  };
};
