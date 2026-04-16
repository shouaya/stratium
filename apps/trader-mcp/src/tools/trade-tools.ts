import { z } from "zod";
import { summarizeExchangeStatuses } from "../core/client.js";
import { groupingSchema, modifyOrderSchema, placeOrderSchema } from "./tool-schemas.js";
import type { ClientToolDefinition } from "./tool-registry.js";
import type { OrderGrouping } from "../core/types.js";

export const tradingToolDefinitions: ClientToolDefinition[] = [
  {
    name: "stratium_place_order",
    title: "Place Order",
    description: "Place a Hyperliquid-compatible order using trader-MCP managed signing and nonce generation.",
    inputSchema: placeOrderSchema,
    summarize: summarizeExchangeStatuses,
    run: (client, input) => client.placeOrder(input)
  },
  {
    name: "stratium_place_orders",
    title: "Place Orders",
    description: "Place one or more Hyperliquid-compatible orders in a single action, including grouped normalTpsl and positionTpsl flows.",
    inputSchema: {
      grouping: groupingSchema.default("na"),
      orders: z.array(z.object(placeOrderSchema)).min(1)
    },
    summarize: summarizeExchangeStatuses,
    run: (client, { grouping, orders }) => client.placeOrders(orders, grouping as OrderGrouping)
  },
  {
    name: "stratium_cancel_order",
    title: "Cancel Order",
    description: "Cancel a Hyperliquid-compatible order by oid.",
    inputSchema: {
      oid: z.number(),
      asset: z.number().optional()
    },
    summarize: summarizeExchangeStatuses,
    run: (client, { oid, asset }) => client.cancelOrder(oid, asset)
  },
  {
    name: "stratium_cancel_order_by_cloid",
    title: "Cancel Order By Cloid",
    description: "Cancel a Hyperliquid-compatible order by client order id.",
    inputSchema: {
      cloid: z.string(),
      asset: z.number().optional()
    },
    summarize: summarizeExchangeStatuses,
    run: (client, { cloid, asset }) => client.cancelOrderByCloid(cloid, asset)
  },
  {
    name: "stratium_modify_order",
    title: "Modify Order",
    description: "Modify a Hyperliquid-compatible order by oid.",
    inputSchema: modifyOrderSchema,
    summarize: summarizeExchangeStatuses,
    run: (client, input) => client.modifyOrder(input)
  },
  {
    name: "stratium_batch_modify",
    title: "Batch Modify",
    description: "Modify multiple Hyperliquid-compatible orders sequentially.",
    inputSchema: {
      modifies: z.array(z.object(modifyOrderSchema)).min(1)
    },
    summarize: summarizeExchangeStatuses,
    run: (client, { modifies }) => client.batchModify(modifies)
  },
  {
    name: "stratium_schedule_cancel",
    title: "Schedule Cancel",
    description: "Schedule account-wide cancel behavior at a target unix timestamp in milliseconds.",
    inputSchema: {
      time: z.number()
    },
    summarize: summarizeExchangeStatuses,
    run: (client, { time }) => client.scheduleCancel(time)
  }
];
