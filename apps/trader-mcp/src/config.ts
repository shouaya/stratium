import { parseBotCredentialsFromEnv } from "./auth.js";
import type { TraderMcpRuntimeConfig } from "./types.js";

export const loadRuntimeConfigFromEnv = (): TraderMcpRuntimeConfig => ({
  apiBaseUrl: process.env.STRATIUM_API_BASE_URL?.trim() || "http://127.0.0.1:4000",
  host: process.env.STRATIUM_MCP_HOST?.trim() || "0.0.0.0",
  port: Number(process.env.STRATIUM_MCP_PORT ?? "4600"),
  mcpPath: process.env.STRATIUM_MCP_PATH?.trim() || "/mcp",
  corsOrigin: process.env.STRATIUM_MCP_CORS_ORIGIN?.trim() || "*",
  frontendUsername: process.env.STRATIUM_FRONTEND_USERNAME?.trim(),
  frontendPassword: process.env.STRATIUM_FRONTEND_PASSWORD?.trim(),
  frontendRole: "frontend",
  botCredentials: parseBotCredentialsFromEnv()
});

export const loadTransportModeFromEnv = () => process.env.STRATIUM_MCP_TRANSPORT?.trim().toLowerCase() || "http";
