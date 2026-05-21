import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { analystToolDefinitions } from "./analyst-tools.js";
import { infoToolDefinitions } from "./info-tools.js";
import { registerClientTool } from "./tool-registry.js";
import { tradingToolDefinitions } from "./trade-tools.js";
import type { TraderMcpRuntimeConfig } from "../core/types.js";

export const createMcpServer = (config: TraderMcpRuntimeConfig) => {
  const server = new McpServer({
    name: "stratium-trader-mcp",
    version: "0.0.1"
  });
  const toolMode = config.toolMode ?? "all";

  if (toolMode !== "analyst") {
    for (const definition of infoToolDefinitions) {
      registerClientTool(server, config, definition);
    }
  }

  if (toolMode !== "trader") {
    for (const definition of analystToolDefinitions) {
      registerClientTool(server, config, definition);
    }
  }

  if (toolMode !== "analyst") {
    for (const definition of tradingToolDefinitions) {
      registerClientTool(server, config, definition);
    }
  }

  return server;
};
