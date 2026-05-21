import type { AiTraderMode, AiTraderPlanAction } from "@stratium/shared";
import type { TraderMcpClient } from "../infra/traderMcpClient.js";
import type { TraderBotAccountSnapshot, TraderBotExecutionResult, TraderBotExecutor, TraderBotMarketSnapshot } from "../types.js";
import { createShadowExecutionResults } from "./shadowExecutor.js";

type ExecutionRef = {
  botId?: string;
  wakeId?: string;
  actionIndex: number;
  kind?: "order" | "reduce";
};

const cloidPart = (value: string | undefined, fallback: string, maxLength = 24): string => {
  const normalized = (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength);
  return normalized || fallback;
};

const createCloid = (ref: ExecutionRef): string =>
  [
    ref.kind === "reduce" ? "ai-reduce" : "ai",
    cloidPart(ref.botId, "bot"),
    cloidPart(ref.wakeId, "wake"),
    String(ref.actionIndex),
    Date.now().toString(36),
    Math.random().toString(16).slice(2, 10)
  ].join("-");

const toMcpOrderArgs = (
  action: Extract<AiTraderPlanAction, { type: "place_order" }>,
  market: TraderBotMarketSnapshot,
  ref: ExecutionRef
): Record<string, unknown> => {
  const referencePrice = action.price
    ?? (action.side === "buy" ? market.ask : market.bid)
    ?? market.last;

  return {
    isBuy: action.side === "buy",
    price: String(referencePrice),
    size: String(action.quantity),
    reduceOnly: action.reduceOnly ?? false,
    tif: action.orderType === "market" ? "Ioc" : action.timeInForce === "IOC" ? "Ioc" : "Gtc",
    cloid: createCloid(ref)
  };
};

const toReduceOnlyOrderArgs = (
  action: Extract<AiTraderPlanAction, { type: "reduce_position" | "close_position" }>,
  market: TraderBotMarketSnapshot,
  account: TraderBotAccountSnapshot | undefined,
  ref: ExecutionRef
): Record<string, unknown> | null => {
  const position = account?.position;
  if (!position || position.side === "flat" || position.quantity <= 0) {
    return null;
  }
  const quantity = action.type === "close_position"
    ? position.quantity
    : Math.min(action.quantity ?? position.quantity, position.quantity);
  if (quantity <= 0) {
    return null;
  }
  const isBuy = position.side === "short";
  return {
    isBuy,
    price: String(isBuy ? market.ask : market.bid),
    size: String(quantity),
    reduceOnly: true,
    tif: "Ioc",
    cloid: createCloid({ ...ref, kind: "reduce" })
  };
};

const reduceOnlyPlaceOrderRejection = (
  action: Extract<AiTraderPlanAction, { type: "place_order" }>,
  account: TraderBotAccountSnapshot | undefined
): string | undefined => {
  if (action.reduceOnly !== true) {
    return "reduce-only mode rejects opening orders at execution";
  }
  const position = account?.position;
  if (!position || position.side === "flat" || position.quantity <= 0) {
    return "reduce-only place_order requires an open position";
  }
  const reduces = (position.side === "long" && action.side === "sell") || (position.side === "short" && action.side === "buy");
  if (!reduces) {
    return "reduce-only place_order side does not reduce the current position";
  }
  if (action.quantity > position.quantity) {
    return "reduce-only place_order quantity exceeds the current position";
  }
  return undefined;
};

const executeAction = async (
  mcpClient: TraderMcpClient,
  market: TraderBotMarketSnapshot,
  account: TraderBotAccountSnapshot | undefined,
  action: AiTraderPlanAction,
  ref: ExecutionRef
): Promise<TraderBotExecutionResult> => {
  if (action.type === "observe") {
    return {
      action,
      status: "executed",
      message: "observe action recorded without trade tool call"
    };
  }

  try {
    if (action.type === "place_order") {
      const raw = await mcpClient.callTool("stratium_place_order", toMcpOrderArgs(action, market, ref));
      return {
        action,
        status: "executed",
        message: "order submitted through Trader MCP",
        raw
      };
    }

    if (action.type === "cancel_order") {
      const raw = action.orderId != null && Number.isFinite(Number(action.orderId))
        ? await mcpClient.callTool("stratium_cancel_order", { oid: Number(action.orderId) })
        : action.clientOrderId != null
          ? await mcpClient.callTool("stratium_cancel_order_by_cloid", { cloid: action.clientOrderId })
          : undefined;

      if (!raw) {
        return {
          action,
          status: "failed",
          message: "cancel_order requires orderId or clientOrderId"
        };
      }

      return {
        action,
        status: "executed",
        message: "cancel submitted through Trader MCP",
        raw
      };
    }

    if (action.type === "reduce_position" || action.type === "close_position") {
      const args = toReduceOnlyOrderArgs(action, market, account, ref);
      if (!args) {
        return {
          action,
          status: "failed",
          message: `${action.type} requires an open position`
        };
      }
      const raw = await mcpClient.callTool("stratium_place_order", args);
      return {
        action,
        status: "executed",
        message: `${action.type} submitted as reduce-only order through Trader MCP`,
        raw
      };
    }

    return {
      action,
      status: "failed",
      message: `${action.type} is not supported by the MCP executor`
    };
  } catch (error) {
    return {
      action,
      status: "failed",
      message: error instanceof Error ? error.message : String(error)
    };
  }
};

export const createMcpExecutor = (input: {
  mcpClient: TraderMcpClient;
  market: TraderBotMarketSnapshot;
  account?: TraderBotAccountSnapshot;
  botId?: string;
  wakeId?: string;
}): TraderBotExecutor => ({
  execute: async (mode: AiTraderMode, actions: AiTraderPlanAction[]) => {
    if (mode !== "paper_execute" && mode !== "reduce_only") {
      return createShadowExecutionResults(mode, actions);
    }

    const results: TraderBotExecutionResult[] = [];
    for (const [actionIndex, action] of actions.entries()) {
      if (mode === "reduce_only" && action.type === "place_order") {
        const rejection = reduceOnlyPlaceOrderRejection(action, input.account);
        if (rejection) {
          results.push({
            action,
            status: "rejected",
            message: rejection
          });
          continue;
        }
      }
      results.push(await executeAction(input.mcpClient, input.market, input.account, action, {
        botId: input.botId,
        wakeId: input.wakeId,
        actionIndex
      }));
    }
    return results;
  }
});
