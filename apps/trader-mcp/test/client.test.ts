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
      action: { type: string; grouping: string; orders: Array<{ b: boolean; p: string; s: string }> };
      nonce: number;
      signature: { r: string; s: string; v: number };
    };
    expect(exchangeBody.action.type).toBe("order");
    expect(exchangeBody.action.grouping).toBe("na");
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

  it("reuses an injected platform bearer token for bot bootstrap and downstream requests", async () => {
    fetchMock
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
        json: async () => ([{ oid: 9 }])
      });

    const client = new StratiumHttpClient({
      apiBaseUrl: "http://127.0.0.1:4000",
      authToken: "platform-token"
    });

    expect(await client.getOpenOrders()).toEqual([{ oid: 9 }]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const credentialRequest = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((credentialRequest.headers as Record<string, string>).authorization).toBe("Bearer platform-token");

    const infoRequest = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect((infoRequest.headers as Record<string, string>).authorization).toBe("Bearer platform-token");
  });

  it("logs outgoing request and response payloads", async () => {
    const log = vi.fn().mockResolvedValue(undefined);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => JSON.stringify({ mids: { BTC: "70000" } })
    });

    const client = new StratiumHttpClient({
      apiBaseUrl: "http://127.0.0.1:4000",
      logger: { log },
      requestId: "req-1",
      toolName: "stratium_get_all_mids"
    });

    expect(await client.getAllMids()).toEqual({ mids: { BTC: "70000" } });
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      channel: "outgoing-stratium-http",
      event: "private-request",
      requestId: "req-1",
      toolName: "stratium_get_all_mids",
      data: expect.objectContaining({
        request: expect.objectContaining({
          method: "POST",
          url: "http://127.0.0.1:4000/info",
          path: "/info"
        }),
        response: expect.objectContaining({
          status: 200,
          body: JSON.stringify({ mids: { BTC: "70000" } })
        })
      })
    }));
  });

  it("covers all tool-facing client methods and normalized MCP results", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ([{ universe: [] }, [{ markPx: "70000" }]]) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ mids: { BTC: "70000" } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ coin: "BTC" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ([{ T: 1 }]) })
      .mockResolvedValueOnce({ ok: true, json: async () => ([{ tid: 1 }]) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ marginSummary: {} }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ([{ oid: 3, grouping: "normalTpsl" }]) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ order: { status: "open" } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ("ok") })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "ok", response: { data: { statuses: [{ success: "ok" }] } } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "ok", response: { data: { statuses: [{ error: "bad" }] } } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "ok", response: { data: { statuses: [{ filled: { oid: 9, totalSz: "1", avgPx: "70001" } }] } } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "ok", response: { data: { statuses: [{ resting: { oid: 5 } }] } } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "ok", response: { data: { statuses: [{ resting: { oid: 11 } }, { resting: { oid: 12 } }] } } }) })
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

    expect(await client.getMetaAndAssetCtxs()).toEqual([{ universe: [] }, [{ markPx: "70000" }]]);
    expect(await client.getAllMids()).toEqual({ mids: { BTC: "70000" } });
    expect(await client.getL2Book("BTC")).toEqual({ coin: "BTC" });
    expect(await client.getCandles("BTC", "1m", 1, 2)).toEqual([{ T: 1 }]);
    expect(await client.getRecentTrades("BTC")).toEqual([{ tid: 1 }]);
    expect(await client.getClearinghouseState()).toEqual({ marginSummary: {} });
    expect(await client.getFrontendOpenOrders()).toEqual([{ oid: 3, grouping: "normalTpsl" }]);
    expect(await client.getOrderStatus("0xabc")).toEqual({ order: { status: "open" } });
    expect(await client.getExchangeStatus()).toEqual("ok");
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
    expect(summarizeExchangeStatuses(await client.placeOrders([{
      isBuy: true,
      price: "70010",
      size: "1",
      tif: "Gtc",
      cloid: "0xparent"
    }, {
      isBuy: false,
      price: "71000",
      size: "1",
      reduceOnly: true,
      cloid: "0xtp",
      trigger: {
        isMarket: true,
        triggerPx: "71000",
        tpsl: "tp"
      }
    }], "normalTpsl"))).toEqual([
      { accepted: true, state: "resting", oid: 11, cloid: undefined },
      { accepted: true, state: "resting", oid: 12, cloid: undefined }
    ]);
    expect(await client.scheduleCancel(123456)).toEqual({ status: "ok", response: { type: "scheduleCancel" } });

    const cancelExchangeRequest = fetchMock.mock.calls[9]?.[1] as RequestInit;
    const cancelExchangeBody = JSON.parse(String(cancelExchangeRequest.body)) as {
      action: {
        type: string;
        cancels: Array<{ a?: number; o?: number }>;
      };
    };
    expect(cancelExchangeBody.action).toMatchObject({
      type: "cancel",
      cancels: [{ a: 0, o: 7 }]
    });

    const cancelByCloidExchangeRequest = fetchMock.mock.calls[10]?.[1] as RequestInit;
    const cancelByCloidExchangeBody = JSON.parse(String(cancelByCloidExchangeRequest.body)) as {
      action: {
        type: string;
        cancels: Array<{ asset?: number; cloid?: string }>;
      };
    };
    expect(cancelByCloidExchangeBody.action).toMatchObject({
      type: "cancelByCloid",
      cancels: [{ asset: 0, cloid: "0xabc" }]
    });

    const groupedExchangeRequest = fetchMock.mock.calls[13]?.[1] as RequestInit;
    const groupedExchangeBody = JSON.parse(String(groupedExchangeRequest.body)) as {
      action: {
        type: string;
        grouping: string;
        orders: Array<{ c?: string; r: boolean }>;
      };
    };
    expect(groupedExchangeBody.action.type).toBe("order");
    expect(groupedExchangeBody.action.grouping).toBe("normalTpsl");
    expect(groupedExchangeBody.action.orders).toHaveLength(2);
    expect(groupedExchangeBody.action.orders[0]?.c).toBe("0xparent");
    expect(groupedExchangeBody.action.orders[1]?.r).toBe(true);

    const mcpResult = await client.toMcpResult("demo", { foo: "bar" }, { simple: true });
    expect(mcpResult.structuredContent).toEqual({
      operation: "demo",
      summary: { simple: true },
      raw: { foo: "bar" }
    });
    expect(mcpResult.isError).toBe(false);
    expect(mcpResult.content[0]?.type).toBe("text");

    const rejectedMcpResult = await client.toMcpResult(
      "demo_reject",
      { status: "ok" },
      [{ accepted: false, error: "bad" }]
    );
    expect(rejectedMcpResult.isError).toBe(true);
  });

  it("throws useful request and bootstrap errors", async () => {
    const noCredsClient = new StratiumHttpClient({
      apiBaseUrl: "http://127.0.0.1:4000"
    });
    await expect(noCredsClient.getOpenOrders()).rejects.toThrow("Missing platform bearer token or frontend login credentials for trader MCP bootstrap");

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
