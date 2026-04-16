import { z } from "zod";
import type { StratiumHttpClient } from "../core/client.js";
import type { ClientToolDefinition } from "./tool-registry.js";

export const infoToolDefinitions: ClientToolDefinition[] = [
  {
    name: "stratium_get_meta",
    title: "Get Meta",
    description: "Return Stratium's Hyperliquid-compatible market metadata.",
    run: (client: StratiumHttpClient) => client.getMeta()
  },
  {
    name: "stratium_get_meta_and_asset_ctxs",
    title: "Get Meta And Asset Contexts",
    description: "Return Stratium's Hyperliquid-compatible meta and asset context snapshot.",
    run: (client: StratiumHttpClient) => client.getMetaAndAssetCtxs()
  },
  {
    name: "stratium_get_all_mids",
    title: "Get All Mids",
    description: "Return Hyperliquid-compatible mid prices.",
    run: (client: StratiumHttpClient) => client.getAllMids()
  },
  {
    name: "stratium_get_l2_book",
    title: "Get L2 Book",
    description: "Return the Hyperliquid-compatible order book snapshot for a coin.",
    inputSchema: {
      coin: z.string().default("BTC")
    },
    run: (client, { coin }) => client.getL2Book(coin)
  },
  {
    name: "stratium_get_candles",
    title: "Get Candles",
    description: "Return Hyperliquid-compatible candle snapshots for a coin and interval.",
    inputSchema: {
      coin: z.string().default("BTC"),
      interval: z.string().default("1m"),
      startTime: z.number(),
      endTime: z.number()
    },
    run: (client, { coin, interval, startTime, endTime }) =>
      client.getCandles(coin, interval, startTime, endTime)
  },
  {
    name: "stratium_get_recent_trades",
    title: "Get Recent Trades",
    description: "Return Hyperliquid-compatible recent trades for a coin.",
    inputSchema: {
      coin: z.string().default("BTC")
    },
    run: (client, { coin }) => client.getRecentTrades(coin)
  },
  {
    name: "stratium_get_clearinghouse_state",
    title: "Get Clearinghouse State",
    description: "Return the authenticated account state through Hyperliquid-compatible private info.",
    run: (client: StratiumHttpClient) => client.getClearinghouseState()
  },
  {
    name: "stratium_get_open_orders",
    title: "Get Open Orders",
    description: "Return the authenticated account's open orders.",
    run: (client: StratiumHttpClient) => client.getOpenOrders()
  },
  {
    name: "stratium_get_frontend_open_orders",
    title: "Get Frontend Open Orders",
    description: "Return the authenticated account's open orders including trigger order metadata for frontend use.",
    run: (client: StratiumHttpClient) => client.getFrontendOpenOrders()
  },
  {
    name: "stratium_get_order_status",
    title: "Get Order Status",
    description: "Return order status by oid or cloid for the authenticated account.",
    inputSchema: {
      oid: z.union([z.number(), z.string()])
    },
    run: (client, { oid }) => client.getOrderStatus(oid)
  },
  {
    name: "stratium_get_exchange_status",
    title: "Get Exchange Status",
    description: "Return the Hyperliquid-compatible exchange status.",
    run: (client: StratiumHttpClient) => client.getExchangeStatus()
  }
];
