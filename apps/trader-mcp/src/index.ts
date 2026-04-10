import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { StratiumHttpClient, summarizeExchangeStatuses, type StratiumBotCredentials } from "./client.js";

const parseBotCredentialsFromEnv = (): StratiumBotCredentials | undefined => {
  const accountId = process.env.STRATIUM_BOT_ACCOUNT_ID?.trim();
  const vaultAddress = process.env.STRATIUM_BOT_VAULT_ADDRESS?.trim();
  const signerAddress = process.env.STRATIUM_BOT_SIGNER_ADDRESS?.trim();
  const apiSecret = process.env.STRATIUM_BOT_API_SECRET?.trim();

  if (!accountId || !vaultAddress || !signerAddress || !apiSecret) {
    return undefined;
  }

  return {
    accountId,
    vaultAddress,
    signerAddress,
    apiSecret
  };
};

const client = new StratiumHttpClient({
  apiBaseUrl: process.env.STRATIUM_API_BASE_URL?.trim() || "http://127.0.0.1:4000",
  frontendUsername: process.env.STRATIUM_FRONTEND_USERNAME?.trim(),
  frontendPassword: process.env.STRATIUM_FRONTEND_PASSWORD?.trim(),
  frontendRole: "frontend",
  botCredentials: parseBotCredentialsFromEnv()
});

const server = new McpServer({
  name: "stratium-trader-mcp",
  version: "0.0.1"
});

server.registerTool("stratium_get_meta", {
  title: "Get Meta",
  description: "Return Stratium's Hyperliquid-compatible market metadata."
}, async () => client.toMcpResult("stratium_get_meta", await client.getMeta()));

server.registerTool("stratium_get_all_mids", {
  title: "Get All Mids",
  description: "Return Hyperliquid-compatible mid prices."
}, async () => client.toMcpResult("stratium_get_all_mids", await client.getAllMids()));

server.registerTool("stratium_get_l2_book", {
  title: "Get L2 Book",
  description: "Return the Hyperliquid-compatible order book snapshot for a coin.",
  inputSchema: {
    coin: z.string().default("BTC")
  }
}, async ({ coin }) => client.toMcpResult("stratium_get_l2_book", await client.getL2Book(coin)));

server.registerTool("stratium_get_candles", {
  title: "Get Candles",
  description: "Return Hyperliquid-compatible candle snapshots for a coin and interval.",
  inputSchema: {
    coin: z.string().default("BTC"),
    interval: z.string().default("1m"),
    startTime: z.number(),
    endTime: z.number()
  }
}, async ({ coin, interval, startTime, endTime }) =>
  client.toMcpResult("stratium_get_candles", await client.getCandles(coin, interval, startTime, endTime)));

server.registerTool("stratium_get_recent_trades", {
  title: "Get Recent Trades",
  description: "Return Hyperliquid-compatible recent trades for a coin.",
  inputSchema: {
    coin: z.string().default("BTC")
  }
}, async ({ coin }) => client.toMcpResult("stratium_get_recent_trades", await client.getRecentTrades(coin)));

server.registerTool("stratium_get_clearinghouse_state", {
  title: "Get Clearinghouse State",
  description: "Return the authenticated account state through Hyperliquid-compatible private info."
}, async () => client.toMcpResult(
  "stratium_get_clearinghouse_state",
  await client.getClearinghouseState()
));

server.registerTool("stratium_get_open_orders", {
  title: "Get Open Orders",
  description: "Return the authenticated account's open orders."
}, async () => client.toMcpResult("stratium_get_open_orders", await client.getOpenOrders()));

server.registerTool("stratium_get_order_status", {
  title: "Get Order Status",
  description: "Return order status by oid or cloid for the authenticated account.",
  inputSchema: {
    oid: z.union([z.number(), z.string()])
  }
}, async ({ oid }) => client.toMcpResult("stratium_get_order_status", await client.getOrderStatus(oid)));

server.registerTool("stratium_place_order", {
  title: "Place Order",
  description: "Place a Hyperliquid-compatible order using trader-MCP managed signing and nonce generation.",
  inputSchema: {
    asset: z.number().optional(),
    isBuy: z.boolean(),
    price: z.string(),
    size: z.string(),
    reduceOnly: z.boolean().optional(),
    tif: z.enum(["Gtc", "Ioc"]).optional(),
    cloid: z.string().optional(),
    trigger: z.object({
      isMarket: z.boolean(),
      triggerPx: z.string(),
      tpsl: z.enum(["tp", "sl"])
    }).optional()
  }
}, async (input) => {
  const response = await client.placeOrder(input);
  return client.toMcpResult("stratium_place_order", response, summarizeExchangeStatuses(response));
});

server.registerTool("stratium_cancel_order", {
  title: "Cancel Order",
  description: "Cancel a Hyperliquid-compatible order by oid.",
  inputSchema: {
    oid: z.number(),
    asset: z.number().optional()
  }
}, async ({ oid, asset }) => {
  const response = await client.cancelOrder(oid, asset);
  return client.toMcpResult("stratium_cancel_order", response, summarizeExchangeStatuses(response));
});

server.registerTool("stratium_cancel_order_by_cloid", {
  title: "Cancel Order By Cloid",
  description: "Cancel a Hyperliquid-compatible order by client order id.",
  inputSchema: {
    cloid: z.string(),
    asset: z.number().optional()
  }
}, async ({ cloid, asset }) => {
  const response = await client.cancelOrderByCloid(cloid, asset);
  return client.toMcpResult("stratium_cancel_order_by_cloid", response, summarizeExchangeStatuses(response));
});

server.registerTool("stratium_modify_order", {
  title: "Modify Order",
  description: "Modify a Hyperliquid-compatible order by oid.",
  inputSchema: {
    oid: z.number(),
    asset: z.number().optional(),
    isBuy: z.boolean(),
    price: z.string(),
    size: z.string(),
    reduceOnly: z.boolean().optional(),
    tif: z.enum(["Gtc", "Ioc"]).optional(),
    cloid: z.string().optional(),
    trigger: z.object({
      isMarket: z.boolean(),
      triggerPx: z.string(),
      tpsl: z.enum(["tp", "sl"])
    }).optional()
  }
}, async (input) => {
  const response = await client.modifyOrder(input);
  return client.toMcpResult("stratium_modify_order", response, summarizeExchangeStatuses(response));
});

server.registerTool("stratium_batch_modify", {
  title: "Batch Modify",
  description: "Modify multiple Hyperliquid-compatible orders sequentially.",
  inputSchema: {
    modifies: z.array(z.object({
      oid: z.number(),
      asset: z.number().optional(),
      isBuy: z.boolean(),
      price: z.string(),
      size: z.string(),
      reduceOnly: z.boolean().optional(),
      tif: z.enum(["Gtc", "Ioc"]).optional(),
      cloid: z.string().optional(),
      trigger: z.object({
        isMarket: z.boolean(),
        triggerPx: z.string(),
        tpsl: z.enum(["tp", "sl"])
      }).optional()
    })).min(1)
  }
}, async ({ modifies }) => {
  const response = await client.batchModify(modifies);
  return client.toMcpResult("stratium_batch_modify", response, summarizeExchangeStatuses(response));
});

server.registerTool("stratium_schedule_cancel", {
  title: "Schedule Cancel",
  description: "Schedule account-wide cancel behavior at a target unix timestamp in milliseconds.",
  inputSchema: {
    time: z.number()
  }
}, async ({ time }) => {
  const response = await client.scheduleCancel(time);
  return client.toMcpResult("stratium_schedule_cancel", response, summarizeExchangeStatuses(response));
});

const transport = new StdioServerTransport();
await server.connect(transport);
