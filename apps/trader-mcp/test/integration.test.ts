import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startTraderMcpHttpServer } from "../src/server";

const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return undefined;
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

describe("trader-mcp http integration", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).reverse().map((cleanup) => cleanup()));
  });

  it("serves MCP over HTTP and forwards bearer-authenticated private flows", async () => {
    const logDir = await mkdtemp(join(tmpdir(), "stratium-trader-mcp-logs-"));
    const logPath = join(logDir, "http.ndjson");
    const upstreamCalls: Array<{
      method: string;
      path: string;
      authorization?: string;
      body?: unknown;
    }> = [];

    const upstreamServer = http.createServer(async (request: IncomingMessage, response: ServerResponse) => {
      const authorization = Array.isArray(request.headers.authorization)
        ? request.headers.authorization[0]
        : request.headers.authorization;

      if (request.url === "/api/bot-credentials" && request.method === "GET") {
        upstreamCalls.push({
          method: request.method,
          path: request.url,
          authorization
        });
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({
          accountId: "paper-account-1",
          vaultAddress: "0xvault",
          signerAddress: "0xsigner",
          apiSecret: "secret"
        }));
        return;
      }

      if (request.url === "/info" && request.method === "POST") {
        const body = await readJsonBody(request);
        upstreamCalls.push({
          method: request.method,
          path: request.url,
          authorization,
          body
        });

        const type = (body as { type?: string })?.type;
        response.setHeader("content-type", "application/json");

        if (type === "meta") {
          response.end(JSON.stringify({
            universe: [{ name: "BTC", szDecimals: 5 }]
          }));
          return;
        }

        if (type === "openOrders") {
          response.end(JSON.stringify([{ oid: 1, coin: "BTC" }]));
          return;
        }

        response.statusCode = 400;
        response.end(JSON.stringify({ message: `Unsupported info type: ${type}` }));
        return;
      }

      if (request.url === "/exchange" && request.method === "POST") {
        const body = await readJsonBody(request);
        upstreamCalls.push({
          method: request.method,
          path: request.url,
          authorization,
          body
        });
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({
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
        }));
        return;
      }

      response.statusCode = 404;
      response.end("not found");
    });

    await new Promise<void>((resolve, reject) => {
      upstreamServer.once("error", reject);
      upstreamServer.listen(4612, "127.0.0.1", () => {
        upstreamServer.off("error", reject);
        resolve();
      });
    });
    cleanups.push(async () => {
      await new Promise<void>((resolve, reject) => {
        upstreamServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    });

    const runtime = await startTraderMcpHttpServer({
      apiBaseUrl: "http://127.0.0.1:4612",
      host: "127.0.0.1",
      port: 4613,
      debugLogPath: logPath
    });
    cleanups.push(runtime.close);

    const client = new Client({
      name: "integration-client",
      version: "1.0.0"
    });
    cleanups.push(async () => {
      await client.close();
    });

    const transport = new StreamableHTTPClientTransport(new URL("http://127.0.0.1:4613/mcp"), {
      requestInit: {
        headers: {
          authorization: "Bearer platform-token"
        }
      }
    });
    cleanups.push(async () => {
      await transport.close();
    });

    await client.connect(transport);

    const toolList = await client.listTools();
    expect(toolList.tools.some((tool) => tool.name === "stratium_get_meta")).toBe(true);
    expect(toolList.tools.some((tool) => tool.name === "stratium_place_order")).toBe(true);

    const metaResult = await client.callTool({
      name: "stratium_get_meta"
    });
    expect(metaResult.isError).not.toBe(true);
    expect(metaResult.structuredContent).toMatchObject({
      operation: "stratium_get_meta",
      raw: {
        universe: [{ name: "BTC", szDecimals: 5 }]
      }
    });

    const openOrdersResult = await client.callTool({
      name: "stratium_get_open_orders"
    });
    expect(openOrdersResult.isError).not.toBe(true);
    expect(openOrdersResult.structuredContent).toMatchObject({
      operation: "stratium_get_open_orders",
      raw: [{ oid: 1, coin: "BTC" }]
    });

    const placeOrderResult = await client.callTool({
      name: "stratium_place_order",
      arguments: {
        isBuy: true,
        price: "70000",
        size: "1"
      }
    });
    expect(placeOrderResult.isError).not.toBe(true);
    expect(placeOrderResult.structuredContent).toMatchObject({
      operation: "stratium_place_order",
      summary: [{
        accepted: true,
        state: "resting",
        oid: 7,
        cloid: "0xabc"
      }]
    });

    const credentialCall = upstreamCalls.find((call) => call.path === "/api/bot-credentials");
    expect(credentialCall?.authorization).toBe("Bearer platform-token");

    const signedInfoCall = upstreamCalls.find((call) =>
      call.path === "/info" && (call.body as { type?: string })?.type === "openOrders");
    expect(signedInfoCall?.authorization).toBe("Bearer platform-token");
    expect(signedInfoCall?.body).toMatchObject({
      type: "openOrders",
      user: "paper-account-1",
      vaultAddress: "0xvault",
      signature: {
        r: "0xsigner",
        v: 27
      }
    });

    const exchangeCall = upstreamCalls.find((call) => call.path === "/exchange");
    expect(exchangeCall?.authorization).toBe("Bearer platform-token");
    expect(exchangeCall?.body).toMatchObject({
      action: {
        type: "order",
        grouping: "na"
      },
      vaultAddress: "0xvault",
      signature: {
        r: "0xsigner",
        v: 27
      }
    });

    const logLines = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(logLines.some((entry) =>
      entry.channel === "incoming-mcp-http"
      && entry.event === "mcp-http-request"
      && entry.data?.request?.headers?.authorization === "Bearer platform-token")).toBe(true);

    expect(logLines.some((entry) =>
      entry.channel === "outgoing-stratium-http"
      && entry.data?.request?.path === "/exchange"
      && entry.data?.response?.status === 200)).toBe(true);
  });
});
