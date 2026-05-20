import type { AiTraderReviewSnapshot, AiTraderWakeReport, AccountView, OrderView, PositionView } from "@stratium/shared";

type EngineStateForReview = {
  account?: AccountView;
  position?: PositionView;
  latestTick?: {
    last?: number;
    tickTime?: string;
    timestamp?: string;
  };
  orders?: OrderView[];
};

const OPEN_ORDER_STATUSES = new Set(["NEW", "ACCEPTED", "PARTIALLY_FILLED"]);

const round = (value: number): number => Number(value.toFixed(8));

const countByStatus = (orders: OrderView[]): Record<string, number> =>
  orders.reduce<Record<string, number>>((counts, order) => {
    counts[order.status] = (counts[order.status] ?? 0) + 1;
    return counts;
  }, {});

const isAiOrder = (order: OrderView): boolean =>
  order.clientOrderId?.startsWith("ai-") ?? false;

const sum = (values: number[]): number =>
  values.reduce((total, value) => total + value, 0);

const sortOrders = (orders: OrderView[]): OrderView[] =>
  [...orders].sort((left, right) =>
    new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    || right.id.localeCompare(left.id)
  );

const buildObservations = (
  reports: AiTraderWakeReport[],
  orders: OrderView[],
  position: PositionView | undefined
): string[] => {
  const observations: string[] = [];
  const filledOrders = orders.filter((order) => order.status === "FILLED");
  const marketFilled = filledOrders.filter((order) => order.orderType === "market").length;
  const limitFilled = filledOrders.filter((order) => order.orderType === "limit").length;
  const canceled = orders.filter((order) => order.status === "CANCELED").length;
  const realizedPnl = position?.realizedPnl ?? reports[0]?.accountSnapshot?.dailyPnl;

  if (typeof realizedPnl === "number" && realizedPnl < 0) {
    observations.push(`Realized PnL is negative (${round(realizedPnl)}); reduce churn and require cleaner reward-to-risk before opening new exposure.`);
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
    observations: buildObservations(input.reports, orders, position)
  };
};
