import { randomUUID } from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { PassThrough } from "node:stream";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { JsonLineFileLogger } from "./logger.js";
import { normalizeIncomingHeaders, tryParseJson } from "./logger.js";
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

const captureChunk = (chunks: Buffer[], chunk: unknown) => {
  if (chunk === undefined || chunk === null) {
    return;
  }

  if (Buffer.isBuffer(chunk)) {
    chunks.push(chunk);
    return;
  }

  if (chunk instanceof Uint8Array) {
    chunks.push(Buffer.from(chunk));
    return;
  }

  chunks.push(Buffer.from(String(chunk)));
};

const teeIncomingRequest = (request: IncomingMessage) => {
  const replayRequest = new PassThrough() as unknown as IncomingMessage & PassThrough;
  replayRequest.method = request.method;
  replayRequest.url = request.url;
  replayRequest.headers = { ...request.headers };
  replayRequest.rawHeaders = [...request.rawHeaders];
  replayRequest.httpVersion = request.httpVersion;
  replayRequest.httpVersionMajor = request.httpVersionMajor;
  replayRequest.httpVersionMinor = request.httpVersionMinor;
  replayRequest.complete = request.complete;
  replayRequest.rawTrailers = [...request.rawTrailers];
  replayRequest.trailers = { ...request.trailers };
  (replayRequest as unknown as { socket?: IncomingMessage["socket"] }).socket = request.socket;

  const captureStream = new PassThrough();
  const capturedChunks: Buffer[] = [];
  captureStream.on("data", (chunk) => {
    captureChunk(capturedChunks, chunk);
  });

  request.pipe(replayRequest as unknown as PassThrough);
  request.pipe(captureStream);

  const bodyBufferPromise = new Promise<Buffer>((resolve, reject) => {
    request.once("end", () => resolve(Buffer.concat(capturedChunks)));
    request.once("error", reject);
    captureStream.once("error", reject);
  });

  return {
    replayRequest: replayRequest as IncomingMessage,
    bodyBufferPromise
  };
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

    const requestId = randomUUID();
    request.headers["x-stratium-mcp-request-id"] = requestId;
    response.setHeader("x-stratium-mcp-request-id", requestId);

    const { replayRequest, bodyBufferPromise } = teeIncomingRequest(request);

    const responseChunks: Buffer[] = [];
    const originalWrite = response.write.bind(response);
    const originalEnd = response.end.bind(response);
    response.write = ((...args: Parameters<typeof response.write>) => {
      captureChunk(responseChunks, args[0]);
      return originalWrite(...args);
    }) as typeof response.write;
    response.end = ((...args: Parameters<typeof response.end>) => {
      captureChunk(responseChunks, args[0]);
      return originalEnd(...args);
    }) as typeof response.end;

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
      void bodyBufferPromise.then((requestBodyBuffer) =>
        config.logger?.log({
          channel: "incoming-mcp-http",
          event: "mcp-http-request",
          requestId,
          data: {
            request: {
              method: request.method,
              url: request.url,
              headers: normalizeIncomingHeaders(request.headers),
              rawHeaders: request.rawHeaders,
              body: requestBodyBuffer.toString("utf8"),
              json: tryParseJson(requestBodyBuffer.toString("utf8"))
            },
            response: {
              statusCode: response.statusCode,
              headers: response.getHeaders(),
              body: Buffer.concat(responseChunks).toString("utf8"),
              json: tryParseJson(Buffer.concat(responseChunks).toString("utf8"))
            }
          }
        }));
      void cleanup();
    });

    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(replayRequest, response);
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
    corsOrigin: config.corsOrigin ?? "*",
    logger: config.logger ?? (config.debugLogPath ? new JsonLineFileLogger(config.debugLogPath) : undefined)
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
