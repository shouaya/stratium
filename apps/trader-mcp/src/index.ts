import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadRuntimeConfigFromEnv, loadTransportModeFromEnv } from "./core/config.js";
import { createMcpServer, startTraderMcpHttpServer } from "./server/server.js";

const transportMode = loadTransportModeFromEnv();
const config = loadRuntimeConfigFromEnv();

if (transportMode === "stdio") {
  const server = createMcpServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
} else {
  const runtime = await startTraderMcpHttpServer(config);
  process.stdout.write(`Stratium Trader MCP listening on http://${runtime.host}:${runtime.port}${runtime.mcpPath}\n`);
}
