import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StratiumHttpClient, summarizeExchangeStatuses } from "../src/client";

describe("StratiumHttpClient", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("logs in, fetches bot credentials, signs private requests, and normalizes exchange summaries", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: "frontend-token" })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accountId: "paper-account-1",
          vaultAddress: "0xvault",
          signerAddress: "0xsigner",
          apiSecret: "secret"
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ([{ oid: 1 }])
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "ok",
          response: {
            type: "order",
            data: {
              statuses: [{
                resting: {
                  oid: 7,
                  cloid: "0xabc"
                }
              }]
            }
          }
        })
      });

    const client = new StratiumHttpClient({
      apiBaseUrl: "http://127.0.0.1:4000",
      frontendUsername: "demo",
      frontendPassword: "demo123456",
      frontendRole: "frontend"
    });

    const openOrders = await client.getOpenOrders();
    expect(openOrders).toEqual([{ oid: 1 }]);

    const infoRequest = fetchMock.mock.calls[2]?.[1] as RequestInit;
    const infoBody = JSON.parse(String(infoRequest.body)) as {
      type: string;
      user: string;
      nonce: number;
      vaultAddress: string;
      signature: { r: string; s: string; v: number };
    };
    expect(infoBody.type).toBe("openOrders");
    expect(infoBody.user).toBe("paper-account-1");
    expect(infoBody.vaultAddress).toBe("0xvault");
    expect(infoBody.signature.r).toBe("0xsigner");
    expect(infoBody.signature.s.startsWith("0x")).toBe(true);
    expect(typeof infoBody.nonce).toBe("number");

    const exchangeResponse = await client.placeOrder({
      isBuy: true,
      price: "70000",
      size: "1"
    });
    expect(summarizeExchangeStatuses(exchangeResponse)).toEqual([{
      accepted: true,
      state: "resting",
      oid: 7,
      cloid: "0xabc"
    }]);

    const exchangeRequest = fetchMock.mock.calls[3]?.[1] as RequestInit;
    const exchangeBody = JSON.parse(String(exchangeRequest.body)) as {
      action: { type: string; orders: Array<{ b: boolean; p: string; s: string }> };
      nonce: number;
      signature: { r: string; s: string; v: number };
    };
    expect(exchangeBody.action.type).toBe("order");
    expect(exchangeBody.action.orders[0]).toMatchObject({
      b: true,
      p: "70000",
      s: "1"
    });
    expect(exchangeBody.signature.r).toBe("0xsigner");
  });

  it("can operate directly from injected bot credentials without frontend login", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ universe: [] })
    });

    const client = new StratiumHttpClient({
      apiBaseUrl: "http://127.0.0.1:4000",
      botCredentials: {
        accountId: "paper-account-1",
        vaultAddress: "0xvault",
        signerAddress: "0xsigner",
        apiSecret: "secret"
      }
    });

    await client.getMeta();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:4000/info");
  });

  it("covers all tool-facing client methods and normalized MCP results", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ mids: { BTC: "70000" } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ coin: "BTC" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ([{ T: 1 }]) })
      .mockResolvedValueOnce({ ok: true, json: async () => ([{ tid: 1 }]) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ marginSummary: {} }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ order: { status: "open" } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "ok", response: { data: { statuses: [{ success: "ok" }] } } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "ok", response: { data: { statuses: [{ error: "bad" }] } } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "ok", response: { data: { statuses: [{ filled: { oid: 9, totalSz: "1", avgPx: "70001" } }] } } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "ok", response: { data: { statuses: [{ resting: { oid: 5 } }] } } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "ok", response: { type: "scheduleCancel" } }) });

    const client = new StratiumHttpClient({
      apiBaseUrl: "http://127.0.0.1:4000",
      botCredentials: {
        accountId: "paper-account-1",
        vaultAddress: "0xvault",
        signerAddress: "0xsigner",
        apiSecret: "secret"
      }
    });

    expect(await client.getAllMids()).toEqual({ mids: { BTC: "70000" } });
    expect(await client.getL2Book("BTC")).toEqual({ coin: "BTC" });
    expect(await client.getCandles("BTC", "1m", 1, 2)).toEqual([{ T: 1 }]);
    expect(await client.getRecentTrades("BTC")).toEqual([{ tid: 1 }]);
    expect(await client.getClearinghouseState()).toEqual({ marginSummary: {} });
    expect(await client.getOrderStatus("0xabc")).toEqual({ order: { status: "open" } });
    expect(summarizeExchangeStatuses(await client.cancelOrder(7))).toEqual([{ accepted: true, status: "ok" }]);
    expect(summarizeExchangeStatuses(await client.cancelOrderByCloid("0xabc"))).toEqual([{ accepted: false, error: "bad" }]);
    expect(summarizeExchangeStatuses(await client.modifyOrder({
      oid: 9,
      isBuy: false,
      price: "69999",
      size: "1"
    }))).toEqual([{ accepted: true, state: "filled", oid: 9, size: "1", averagePrice: "70001" }]);
    expect(summarizeExchangeStatuses(await client.batchModify([{
      oid: 5,
      isBuy: true,
      price: "70010",
      size: "0.5",
      reduceOnly: true,
      trigger: {
        isMarket: false,
        triggerPx: "69950",
        tpsl: "sl"
      }
    }]))).toEqual([{ accepted: true, state: "resting", oid: 5, cloid: undefined }]);
    expect(await client.scheduleCancel(123456)).toEqual({ status: "ok", response: { type: "scheduleCancel" } });

    const mcpResult = await client.toMcpResult("demo", { foo: "bar" }, { simple: true });
    expect(mcpResult.structuredContent).toEqual({
      operation: "demo",
      summary: { simple: true },
      raw: { foo: "bar" }
    });
    expect(mcpResult.content[0]?.type).toBe("text");
  });

  it("throws useful request and bootstrap errors", async () => {
    const noCredsClient = new StratiumHttpClient({
      apiBaseUrl: "http://127.0.0.1:4000"
    });
    await expect(noCredsClient.getOpenOrders()).rejects.toThrow("Missing frontend login credentials for trader MCP bootstrap");

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ message: "login failed" })
    });
    const badLoginClient = new StratiumHttpClient({
      apiBaseUrl: "http://127.0.0.1:4000",
      frontendUsername: "demo",
      frontendPassword: "badpass"
    });
    await expect(badLoginClient.getOpenOrders()).rejects.toThrow("login failed");

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: "frontend-token" })
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: "credential bootstrap failed" })
      });
    const badBootstrapClient = new StratiumHttpClient({
      apiBaseUrl: "http://127.0.0.1:4000",
      frontendUsername: "demo",
      frontendPassword: "demo123456"
    });
    await expect(badBootstrapClient.getOpenOrders()).rejects.toThrow("credential bootstrap failed");

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ response: { data: "exchange failed" } })
    });
    const exchangeErrorClient = new StratiumHttpClient({
      apiBaseUrl: "http://127.0.0.1:4000",
      botCredentials: {
        accountId: "paper-account-1",
        vaultAddress: "0xvault",
        signerAddress: "0xsigner",
        apiSecret: "secret"
      }
    });
    await expect(exchangeErrorClient.placeOrder({
      isBuy: true,
      price: "70000",
      size: "1",
      tif: "Ioc"
    })).rejects.toThrow("exchange failed");

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({})
    });
    await expect(exchangeErrorClient.getMeta()).rejects.toThrow("Request failed with status 500");
  });

  it("passes through non-array exchange responses in summarizer", () => {
    expect(summarizeExchangeStatuses({ response: { type: "scheduleCancel" } })).toEqual({
      response: { type: "scheduleCancel" }
    });
    expect(summarizeExchangeStatuses({ response: { data: { statuses: [17] } } })).toEqual([17]);
  });
});
