import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { JsonLineFileLogger } from "./logger.js";
import { parseBotCredentialsFromEnv } from "./auth.js";
import type { TraderMcpRuntimeConfig } from "./types.js";

const workspaceRoot = process.cwd().endsWith("/apps/trader-mcp")
  ? resolve(process.cwd(), "../..")
  : process.cwd();

const isRunningInContainer = () => existsSync("/.dockerenv");

const resolveDefaultApiBaseUrl = (runningInContainer = isRunningInContainer()) => {
  if (runningInContainer) {
    return "http://api:4000";
  }

  throw new Error("STRATIUM_API_BASE_URL is required when trader-mcp runs outside Docker Compose.");
};

const resolveLogPath = (pathValue?: string) => {
  const trimmed = pathValue?.trim();
  if (!trimmed) {
    return resolve(workspaceRoot, "logs/trader-mcp-http.ndjson");
  }

  return resolve(trimmed) === trimmed
    ? trimmed
    : resolve(workspaceRoot, trimmed);
};

export const loadRuntimeConfigFromEnv = (): TraderMcpRuntimeConfig => ({
  apiBaseUrl: process.env.STRATIUM_API_BASE_URL?.trim() || resolveDefaultApiBaseUrl(),
  host: process.env.STRATIUM_MCP_HOST?.trim() || "0.0.0.0",
  port: Number(process.env.STRATIUM_MCP_PORT ?? "4600"),
  mcpPath: process.env.STRATIUM_MCP_PATH?.trim() || "/mcp",
  corsOrigin: process.env.STRATIUM_MCP_CORS_ORIGIN?.trim() || "*",
  debugLogPath: resolveLogPath(process.env.STRATIUM_MCP_DEBUG_LOG_PATH),
  logger: new JsonLineFileLogger(resolveLogPath(process.env.STRATIUM_MCP_DEBUG_LOG_PATH)),
  frontendUsername: process.env.STRATIUM_FRONTEND_USERNAME?.trim(),
  frontendPassword: process.env.STRATIUM_FRONTEND_PASSWORD?.trim(),
  frontendRole: "frontend",
  botCredentials: parseBotCredentialsFromEnv()
});

export const loadTransportModeFromEnv = () => process.env.STRATIUM_MCP_TRANSPORT?.trim().toLowerCase() || "http";

export const __internal = {
  isRunningInContainer,
  resolveDefaultApiBaseUrl
};
