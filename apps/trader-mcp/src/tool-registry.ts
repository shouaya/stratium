import type { IncomingHttpHeaders } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import type { ZodRawShape } from "zod";
import { StratiumHttpClient } from "./client.js";
import { extractBearerToken, extractRequestId } from "./auth.js";
import type { TraderMcpRuntimeConfig } from "./types.js";

type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;
type ToolSummary = (response: unknown) => unknown;

interface BaseClientToolDefinition {
  name: string;
  title: string;
  description: string;
  summarize?: ToolSummary;
}

export interface NoInputClientToolDefinition extends BaseClientToolDefinition {
  run: (client: StratiumHttpClient) => Promise<unknown>;
}

export interface InputClientToolDefinition extends BaseClientToolDefinition {
  inputSchema: ZodRawShape;
  run: (client: StratiumHttpClient, args: any) => Promise<unknown>;
}

export type ClientToolDefinition = NoInputClientToolDefinition | InputClientToolDefinition;

const createClient = (config: TraderMcpRuntimeConfig, toolName: string, extra?: ToolExtra) => {
  const headers = extra?.requestInfo?.headers as IncomingHttpHeaders | undefined;
  const authToken = extractBearerToken(headers);
  const requestId = extractRequestId(headers);

  return new StratiumHttpClient({
    apiBaseUrl: config.apiBaseUrl,
    logger: config.logger,
    requestId,
    toolName,
    authToken,
    frontendUsername: authToken ? undefined : config.frontendUsername,
    frontendPassword: authToken ? undefined : config.frontendPassword,
    frontendRole: config.frontendRole ?? "frontend",
    botCredentials: authToken ? undefined : config.botCredentials
  });
};

export function registerClientTool(
  server: McpServer,
  config: TraderMcpRuntimeConfig,
  definition: ClientToolDefinition
) {
  const toolConfig = {
    title: definition.title,
    description: definition.description,
    ...("inputSchema" in definition ? { inputSchema: definition.inputSchema } : {})
  };

  if ("inputSchema" in definition) {
    (server.registerTool as any)(definition.name, toolConfig, async (args: any, extra: ToolExtra) => {
      const client = createClient(config, definition.name, extra);
      const response = await definition.run(client, args);
      return client.toMcpResult(definition.name, response, definition.summarize?.(response));
    });
    return;
  }

  (server.registerTool as any)(definition.name, toolConfig, async (extra: ToolExtra) => {
    const client = createClient(config, definition.name, extra);
    const response = await definition.run(client);
    return client.toMcpResult(definition.name, response, definition.summarize?.(response));
  });
}
