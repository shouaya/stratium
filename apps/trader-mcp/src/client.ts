import { createHmac } from "node:crypto";
import type {
  BatchModifyOrderInput,
  ModifyOrderInput,
  OrderGrouping,
  PlaceOrderInput,
  StratiumBotCredentials
} from "./types.js";

interface LoginResponse {
  token: string;
}

interface StratiumClientConfig {
  apiBaseUrl: string;
  authToken?: string;
  frontendUsername?: string;
  frontendPassword?: string;
  frontendRole?: "frontend";
  botCredentials?: StratiumBotCredentials;
}

const canonicalStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalStringify(entry)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalStringify(entry)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
};

const textContent = (value: unknown) => ({
  type: "text" as const,
  text: JSON.stringify(value, null, 2)
});

export class StratiumHttpClient {
  private token: string | null = null;
  private credentials: StratiumBotCredentials | null;
  private nonceCursor = Date.now();

  constructor(private readonly config: StratiumClientConfig) {
    this.credentials = config.botCredentials ?? null;
  }

  async getMeta() {
    return this.info({ type: "meta" });
  }

  async getMetaAndAssetCtxs() {
    return this.info({ type: "metaAndAssetCtxs" });
  }

  async getAllMids() {
    return this.info({ type: "allMids" });
  }

  async getL2Book(coin: string) {
    return this.info({ type: "l2Book", coin });
  }

  async getCandles(coin: string, interval: string, startTime: number, endTime: number) {
    return this.info({
      type: "candleSnapshot",
      req: {
        coin,
        interval,
        startTime,
        endTime
      }
    });
  }

  async getRecentTrades(coin: string) {
    return this.info({ type: "recentTrades", coin });
  }

  async getClearinghouseState() {
    const credentials = await this.getBotCredentials();
    return this.info({
      type: "clearinghouseState",
      user: credentials.accountId
    }, true);
  }

  async getOpenOrders() {
    const credentials = await this.getBotCredentials();
    return this.info({
      type: "openOrders",
      user: credentials.accountId
    }, true);
  }

  async getFrontendOpenOrders() {
    const credentials = await this.getBotCredentials();
    return this.info({
      type: "frontendOpenOrders",
      user: credentials.accountId
    }, true);
  }

  async getOrderStatus(oidOrCloid: number | string) {
    const credentials = await this.getBotCredentials();
    return this.info({
      type: "orderStatus",
      user: credentials.accountId,
      oid: oidOrCloid
    }, true);
  }

  async getExchangeStatus() {
    return this.info({ type: "exchangeStatus" });
  }

  async placeOrder(input: PlaceOrderInput) {
    return this.placeOrders([input], input.grouping ?? "na");
  }

  async placeOrders(inputs: PlaceOrderInput[], grouping: OrderGrouping = "na") {
    return this.exchange({
      type: "order",
      orders: inputs.map((entry) => this.toOrderWire(entry)),
      grouping
    });
  }

  async cancelOrder(oid: number, asset = 0) {
    return this.exchange({
      type: "cancel",
      cancels: [{ asset, oid }]
    });
  }

  async cancelOrderByCloid(cloid: string, asset = 0) {
    return this.exchange({
      type: "cancelByCloid",
      cancels: [{ asset, cloid }]
    });
  }

  async modifyOrder(input: ModifyOrderInput) {
    return this.exchange({
      type: "modify",
      oid: input.oid,
      order: this.toOrderWire(input)
    });
  }

  async batchModify(inputs: BatchModifyOrderInput[]) {
    return this.exchange({
      type: "batchModify",
      modifies: inputs.map((entry) => ({
        oid: entry.oid,
        order: this.toOrderWire(entry)
      }))
    });
  }

  async scheduleCancel(time: number) {
    return this.exchange({
      type: "scheduleCancel",
      time
    });
  }

  async toMcpResult(operation: string, response: unknown, summary?: unknown) {
    return {
      content: [textContent({
        operation,
        summary: summary ?? response,
        raw: response
      })],
      structuredContent: {
        operation,
        summary: summary ?? response,
        raw: response
      }
    };
  }

  private async info(body: Record<string, unknown>, signed = false) {
    const payload = signed ? await this.signBody(body) : body;
    return this.request("/info", payload);
  }

  private async exchange(action: Record<string, unknown>) {
    return this.request("/exchange", await this.signBody({ action }));
  }

  private async request(path: string, body: Record<string, unknown>) {
    const token = await this.getOptionalFrontendToken();
    const response = await fetch(`${this.config.apiBaseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(body)
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(typeof data?.message === "string"
        ? data.message
        : typeof data?.response?.data === "string"
          ? data.response.data
          : `Request failed with status ${response.status}`);
    }

    return data;
  }

  private toOrderWire(input: PlaceOrderInput) {
    return {
      a: input.asset ?? 0,
      b: input.isBuy,
      p: input.price,
      s: input.size,
      r: input.reduceOnly ?? false,
      t: input.trigger
        ? { trigger: input.trigger }
        : { limit: { tif: input.tif ?? "Gtc" } },
      c: input.cloid
    };
  }

  private async signBody(body: Record<string, unknown>) {
    const credentials = await this.getBotCredentials();
    const unsignedBody = {
      ...body,
      nonce: this.nextNonce(),
      vaultAddress: credentials.vaultAddress
    };
    const signature = `0x${createHmac("sha256", credentials.apiSecret)
      .update(canonicalStringify(unsignedBody))
      .digest("hex")}`;

    return {
      ...unsignedBody,
      signature: {
        r: credentials.signerAddress,
        s: signature,
        v: 27
      }
    };
  }

  private nextNonce() {
    this.nonceCursor = Math.max(this.nonceCursor + 1, Date.now());
    return this.nonceCursor;
  }

  private async getBotCredentials() {
    if (this.credentials) {
      return this.credentials;
    }

    const token = await this.getFrontendToken();
    const response = await fetch(`${this.config.apiBaseUrl}/api/bot-credentials`, {
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(typeof data?.message === "string" ? data.message : "Failed to fetch bot credentials");
    }

    this.credentials = data as StratiumBotCredentials;
    return this.credentials;
  }

  private async getOptionalFrontendToken() {
    if (this.config.authToken?.trim()) {
      return this.config.authToken.trim();
    }

    if (this.token) {
      return this.token;
    }

    if (!this.config.frontendUsername || !this.config.frontendPassword) {
      return null;
    }

    const response = await fetch(`${this.config.apiBaseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        username: this.config.frontendUsername,
        password: this.config.frontendPassword,
        role: this.config.frontendRole ?? "frontend"
      })
    });
    const data = await response.json() as LoginResponse & { message?: string };
    if (!response.ok || !data.token) {
      throw new Error(typeof data.message === "string" ? data.message : "Failed to login to Stratium API");
    }

    this.token = data.token;
    return this.token;
  }

  private async getFrontendToken() {
    const token = await this.getOptionalFrontendToken();
    if (!token) {
      throw new Error("Missing platform bearer token or frontend login credentials for trader MCP bootstrap");
    }
    return token;
  }
}

export const summarizeExchangeStatuses = (response: unknown) => {
  const statuses = (response as {
    response?: {
      data?: {
        statuses?: unknown[];
      };
    };
  })?.response?.data?.statuses;

  if (!Array.isArray(statuses)) {
    return response;
  }

  return statuses.map((entry) => {
    if (entry && typeof entry === "object") {
      const statusEntry = entry as {
        resting?: { oid?: number; cloid?: string };
        filled?: { oid?: number; totalSz?: string; avgPx?: string };
        success?: string;
        error?: string;
      };

      if (statusEntry.error) {
        return { accepted: false, error: statusEntry.error };
      }

      if (statusEntry.success) {
        return { accepted: true, status: statusEntry.success };
      }

      if (statusEntry.resting) {
        return {
          accepted: true,
          state: "resting",
          oid: statusEntry.resting.oid,
          cloid: statusEntry.resting.cloid
        };
      }

      if (statusEntry.filled) {
        return {
          accepted: true,
          state: "filled",
          oid: statusEntry.filled.oid,
          size: statusEntry.filled.totalSz,
          averagePrice: statusEntry.filled.avgPx
        };
      }
    }

    return entry;
  });
};

export type {
  BatchModifyOrderInput,
  ModifyOrderInput,
  OrderGrouping,
  PlaceOrderInput,
  StratiumBotCredentials
} from "./types.js";
