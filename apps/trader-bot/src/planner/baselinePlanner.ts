import type { AiTraderPlan, AiTraderPlanAction } from "@stratium/shared";
import type { TraderBotPlanner, TraderBotPlannerContext } from "../types.js";
import { resolveTraderBotLanguage } from "./language.js";

const roundDown = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.floor(value * factor) / factor;
};

const tinyProbeQuantity = (context: TraderBotPlannerContext) => {
  const referencePrice = Math.max(context.market.last, context.market.ask, context.market.bid);
  const notional = Math.min(
    context.config.riskPolicy.maxOrderNotional * 0.25,
    context.config.riskPolicy.maxPositionNotional * 0.1,
    Math.max(0, context.account.availableMargin * 0.01)
  );

  if (!Number.isFinite(referencePrice) || referencePrice <= 0 || !Number.isFinite(notional) || notional <= 0) {
    return 0;
  }

  return roundDown(notional / referencePrice, 5);
};

const openOrdersMemory = (context: TraderBotPlannerContext) =>
  context.memories.find((memory) => memory.key === "state/open_orders")?.value ?? "[]";

const hasOpenOrders = (context: TraderBotPlannerContext) => {
  try {
    const parsed = JSON.parse(openOrdersMemory(context));
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
};

const baselineText = (context: TraderBotPlannerContext) => {
  const language = resolveTraderBotLanguage(context);

  if (language === "zh") {
    return {
      observeRiskNote: "本次唤醒不交易更安全。",
      probeReason: "Baseline 模拟探针开一个极小多头，用来测试执行、风控和评分闭环。",
      closeSummary: "Baseline 规划器发现已有仓位，将先平仓以完成模拟闭环。",
      closeThesis: (side: string, symbol: string) => `先关闭现有 ${side} ${symbol} 探针仓位，再考虑新的交易。`,
      closeRiskNote: "这是 reduce-only 仓位清理。",
      closeReason: "Baseline 规划器保持单仓位入门策略，并关闭已有敞口。",
      openOrdersReason: "Baseline 规划器检测到已有挂单，因此等待而不是叠加订单。",
      unsafeSizeReason: "Baseline 规划器无法根据当前风控策略计算安全探针订单大小。",
      probeSummary: "Baseline 规划器将在模拟环境提交一个极小的市价探针订单。",
      probeThesis: `用极小的 ${context.config.activeSymbol} 市价探针验证规划、风控、Trader MCP 执行、评分、记忆和 admin telemetry 是否端到端运转。`,
      probeRiskNotes: [
        "这不是生产 alpha 策略。",
        "订单名义金额故意很小，并受风控策略限制。",
        "下一次唤醒应该关闭可能产生的仓位。"
      ]
    };
  }

  if (language === "ja") {
    return {
      observeRiskNote: "このウェイクでは取引しない方が安全です。",
      probeReason: "Baseline シミュレーションプローブは、実行、リスク、スコアリングの流れを検証するために極小のロングを開きます。",
      closeSummary: "Baseline プランナーは既存ポジションを検出したため、シミュレーションループを完了するためにクローズします。",
      closeThesis: (side: string, symbol: string) => `新しい取引を開く前に、既存の ${side} ${symbol} プローブポジションをクローズします。`,
      closeRiskNote: "これは reduce-only のポジション整理です。",
      closeReason: "Baseline プランナーはスターター戦略を単一ポジションに保ち、既存エクスポージャーを閉じます。",
      openOrdersReason: "Baseline プランナーは既存の未約定注文を検出したため、注文を積み増さずに待機します。",
      unsafeSizeReason: "Baseline プランナーは現在のリスクポリシーから安全なプローブ注文サイズを算出できませんでした。",
      probeSummary: "Baseline プランナーはシミュレーションで極小の成行プローブ注文を送信します。",
      probeThesis: `極小の ${context.config.activeSymbol} 成行プローブで、計画、リスク、Trader MCP 実行、スコアリング、記憶、admin telemetry がエンドツーエンドで動くことを検証します。`,
      probeRiskNotes: [
        "これは本番用の alpha 戦略ではありません。",
        "注文の想定元本は意図的に小さく、リスクポリシーで制限されます。",
        "次回のウェイクでは発生したポジションをクローズするべきです。"
      ]
    };
  }

  return {
    observeRiskNote: "No trade action is safer for this wake.",
    probeReason: "Baseline simulation probe opens a tiny long position so the full execution, risk, and scoring loop can be tested.",
    closeSummary: "Baseline planner found an open position and will close it to complete the simulation loop.",
    closeThesis: (side: string, symbol: string) => `Close the existing ${side} ${symbol} probe position before opening another one.`,
    closeRiskNote: "This is reduce-only position cleanup.",
    closeReason: "Baseline planner keeps the starter strategy single-position and closes existing exposure.",
    openOrdersReason: "Baseline planner detected existing open orders and will wait instead of stacking orders.",
    unsafeSizeReason: "Baseline planner could not size a safe probe order from the current risk policy.",
    probeSummary: "Baseline planner will submit a tiny market probe order in simulation.",
    probeThesis: `Use a tiny ${context.config.activeSymbol} market probe to verify that planning, risk, Trader MCP execution, scoring, memory, and admin telemetry all move end-to-end.`,
    probeRiskNotes: [
      "This is not a production alpha strategy.",
      "Order notional is intentionally small and bounded by risk policy.",
      "The next wake should close any resulting position."
    ]
  };
};

const observePlan = (context: TraderBotPlannerContext, reason: string): AiTraderPlan => ({
  schemaVersion: "stratium.ai-trader-plan.v1",
  summary: reason,
  candidates: [{
    id: "baseline-observe",
    thesis: reason,
    confidence: 0.5,
    expectedReward: 0,
    riskNotes: [baselineText(context).observeRiskNote],
    actions: [{
      type: "observe",
      reason
    }]
  }]
});

const marketProbeAction = (context: TraderBotPlannerContext, quantity: number): AiTraderPlanAction => ({
  type: "place_order",
  symbol: context.config.activeSymbol,
  side: "buy",
  orderType: "market",
  quantity,
  reduceOnly: false,
  timeInForce: "IOC",
  invalidationPrice: Number((context.market.last * 0.995).toFixed(2)),
  takeProfitPrice: Number((context.market.last * 1.006).toFixed(2)),
  reason: baselineText(context).probeReason
});

export const createBaselinePlanner = (): TraderBotPlanner => ({
  plan: async (context: TraderBotPlannerContext): Promise<AiTraderPlan> => {
    const position = context.account.position;
    const text = baselineText(context);

    if (position && position.side !== "flat" && position.quantity > 0) {
      return {
        schemaVersion: "stratium.ai-trader-plan.v1",
        summary: text.closeSummary,
        candidates: [{
          id: "baseline-close-position",
          thesis: text.closeThesis(position.side, position.symbol),
          confidence: 0.62,
          expectedReward: 0.05,
          riskNotes: [text.closeRiskNote],
          actions: [{
            type: "close_position",
            symbol: position.symbol,
            reason: text.closeReason
          }]
        }]
      };
    }

    if (hasOpenOrders(context)) {
      return observePlan(context, text.openOrdersReason);
    }

    const quantity = tinyProbeQuantity(context);
    if (quantity <= 0) {
      return observePlan(context, text.unsafeSizeReason);
    }

    return {
      schemaVersion: "stratium.ai-trader-plan.v1",
      summary: text.probeSummary,
      candidates: [{
        id: "baseline-market-probe",
        thesis: text.probeThesis,
        confidence: 0.58,
        expectedReward: 0.05,
        riskNotes: text.probeRiskNotes,
        actions: [marketProbeAction(context, quantity)]
      }]
    };
  }
});
