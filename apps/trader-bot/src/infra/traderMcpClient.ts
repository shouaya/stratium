import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export type TraderMcpToolResult = {
  operation?: string;
  summary?: unknown;
  raw?: unknown;
};

export type TraderMcpClient = {
  listToolNames: () => Promise<string[]>;
  callTool: (name: string, args?: Record<string, unknown>) => Promise<TraderMcpToolResult>;
  close: () => Promise<void>;
};

const parseToolText = (result: unknown): TraderMcpToolResult | undefined => {
  if (!result || typeof result !== "object") {
    return undefined;
  }
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return undefined;
  }
  const firstText = content.find((entry): entry is { type: "text"; text: string } =>
    Boolean(entry) && typeof entry === "object" && (entry as { type?: unknown }).type === "text" && typeof (entry as { text?: unknown }).text === "string"
  );
  if (!firstText) {
    return undefined;
  }
  try {
    return JSON.parse(firstText.text) as TraderMcpToolResult;
  } catch {
    return {
      raw: firstText.text
    };
  }
};

const normalizeToolResult = (result: unknown): TraderMcpToolResult => {
  if (result && typeof result === "object" && "structuredContent" in result) {
    return (result as { structuredContent?: TraderMcpToolResult }).structuredContent ?? {};
  }
  return parseToolText(result) ?? { raw: result };
};

export const createTraderMcpClient = async (input: {
  mcpUrl: string;
  token: string;
  botId: string;
}): Promise<TraderMcpClient> => {
  const transport = new StreamableHTTPClientTransport(new URL(input.mcpUrl), {
    requestInit: {
      headers: {
        authorization: `Bearer ${input.token}`,
        "x-stratium-trader-bot-id": input.botId
      }
    }
  });
  const client = new Client({
    name: "stratium-trader-bot",
    version: "0.0.1"
  });

  await client.connect(transport);

  return {
    listToolNames: async () => {
      const response = await client.listTools();
      return response.tools.map((tool) => tool.name);
    },
    callTool: async (name, args = {}) => {
      const response = await client.callTool({
        name,
        arguments: args
      });
      return normalizeToolResult(response);
    },
    close: async () => {
      await client.close();
    }
  };
};

export const assertTraderMcpTools = async (client: TraderMcpClient, requiredTools: string[]): Promise<void> => {
  const toolNames = await client.listToolNames();
  const missing = requiredTools.filter((tool) => !toolNames.includes(tool));
  if (missing.length > 0) {
    throw new Error(`Trader MCP is missing required tools: ${missing.join(", ")}`);
  }
};
