import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./tools.js";
import type { TraderMcpRuntimeConfig } from "./types.js";

const writeJson = (response: ServerResponse, statusCode: number, payload: unknown) => {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(payload));
};

const setCorsHeaders = (response: ServerResponse, corsOrigin: string) => {
  response.setHeader("access-control-allow-origin", corsOrigin);
  response.setHeader("access-control-allow-headers", "authorization, content-type, accept, mcp-protocol-version");
  response.setHeader("access-control-allow-methods", "OPTIONS, POST");
  response.setHeader("access-control-expose-headers", "mcp-session-id");
};

const closeQuietly = async (resource: { close?: () => Promise<void> | void }) => {
  try {
    await resource.close?.();
  } catch {
    // Best-effort cleanup for per-request MCP instances.
  }
};

const handleHttpRequest = (config: Required<Pick<TraderMcpRuntimeConfig, "host" | "port" | "mcpPath" | "corsOrigin">> & TraderMcpRuntimeConfig) =>
  async (request: IncomingMessage, response: ServerResponse) => {
    setCorsHeaders(response, config.corsOrigin);

    if (!request.url) {
      writeJson(response, 400, { error: "Missing request URL." });
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host ?? `${config.host}:${config.port}`}`);

    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    if (url.pathname === "/health") {
      writeJson(response, 200, {
        status: "ok",
        transport: "streamable-http",
        path: config.mcpPath
      });
      return;
    }

    if (url.pathname !== config.mcpPath) {
      writeJson(response, 404, { error: "Not found." });
      return;
    }

    if (request.method !== "POST") {
      response.setHeader("allow", "OPTIONS, POST");
      writeJson(response, 405, {
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Method not allowed."
        },
        id: null
      });
      return;
    }

    const mcpServer = createMcpServer(config);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });

    let cleanedUp = false;
    const cleanup = async () => {
      if (cleanedUp) {
        return;
      }
      cleanedUp = true;
      await closeQuietly(transport);
      await closeQuietly(mcpServer);
    };

    response.once("close", () => {
      void cleanup();
    });
    response.once("finish", () => {
      void cleanup();
    });

    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(request, response);
    } catch (error) {
      await cleanup();
      if (!response.headersSent) {
        writeJson(response, 500, {
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : "Internal server error"
          },
          id: null
        });
      }
    }
  };

export const startTraderMcpHttpServer = async (config: TraderMcpRuntimeConfig) => {
  const resolvedConfig = {
    ...config,
    host: config.host ?? "0.0.0.0",
    port: config.port ?? 4600,
    mcpPath: config.mcpPath ?? "/mcp",
    corsOrigin: config.corsOrigin ?? "*"
  };

  const server = http.createServer(handleHttpRequest(resolvedConfig));

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(resolvedConfig.port, resolvedConfig.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    server,
    host: resolvedConfig.host,
    port: resolvedConfig.port,
    mcpPath: resolvedConfig.mcpPath,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  };
};
