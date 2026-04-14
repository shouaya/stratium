import type { IncomingHttpHeaders } from "node:http";
import type { StratiumBotCredentials } from "./types.js";

export const parseBotCredentialsFromEnv = (): StratiumBotCredentials | undefined => {
  const accountId = process.env.STRATIUM_BOT_ACCOUNT_ID?.trim();
  const vaultAddress = process.env.STRATIUM_BOT_VAULT_ADDRESS?.trim();
  const signerAddress = process.env.STRATIUM_BOT_SIGNER_ADDRESS?.trim();
  const apiSecret = process.env.STRATIUM_BOT_API_SECRET?.trim();

  if (!accountId || !vaultAddress || !signerAddress || !apiSecret) {
    return undefined;
  }

  return {
    accountId,
    vaultAddress,
    signerAddress,
    apiSecret
  };
};

export const extractBearerToken = (headers?: IncomingHttpHeaders): string | undefined => {
  const rawAuthorization = Array.isArray(headers?.authorization)
    ? headers.authorization[0]
    : headers?.authorization;

  if (!rawAuthorization) {
    return undefined;
  }

  const prefix = "bearer ";
  return rawAuthorization.toLowerCase().startsWith(prefix)
    ? rawAuthorization.slice(prefix.length).trim()
    : undefined;
};

export const extractRequestId = (headers?: IncomingHttpHeaders): string | undefined => {
  const rawRequestId = Array.isArray(headers?.["x-stratium-mcp-request-id"])
    ? headers["x-stratium-mcp-request-id"][0]
    : headers?.["x-stratium-mcp-request-id"];

  return rawRequestId?.trim() || undefined;
};
