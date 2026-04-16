import { createHash, createHmac } from "node:crypto";
import type { ApiRuntime } from "../runtime/runtime.js";
import { hyperliquidCompatAddressForAccountId } from "./hyperliquid-user.js";

type SignatureLike = {
  r?: string;
  s?: string;
  v?: number;
};

interface SignedEnvelope {
  signature?: SignatureLike;
  [key: string]: unknown;
}

const BOT_MASTER_SECRET = process.env.BOT_SIGNER_MASTER_SECRET ?? "stratium-local-bot-master-secret";

const canonicalStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalStringify(entry)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalStringify(entry)}`).join(",")}}`;
  }

  return JSON.stringify(value);
};

const deriveSignerSecret = (accountId: string): string =>
  createHmac("sha256", BOT_MASTER_SECRET).update(`signer-secret:${accountId}`).digest("hex");

const deriveSignerAddress = (accountId: string): string =>
  `0x${createHash("sha256").update(`signer-address:${deriveSignerSecret(accountId)}`).digest("hex").slice(0, 40)}`;

const buildSigningPayload = (request: SignedEnvelope): string => {
  const { signature: _signature, ...unsignedRequest } = request;
  return canonicalStringify(unsignedRequest);
};

const signEnvelope = (accountId: string, request: SignedEnvelope): string =>
  `0x${createHmac("sha256", deriveSignerSecret(accountId)).update(buildSigningPayload(request)).digest("hex")}`;

export interface BotCredentialsView {
  accountId: string;
  vaultAddress: string;
  signerAddress: string;
  apiSecret: string;
}

export class HyperliquidBotAuth {
  private readonly recentNoncesBySigner = new Map<string, number[]>();

  getCredentials(accountId: string): BotCredentialsView {
    return {
      accountId,
      vaultAddress: hyperliquidCompatAddressForAccountId(accountId),
      signerAddress: deriveSignerAddress(accountId),
      apiSecret: deriveSignerSecret(accountId)
    };
  }

  authenticate(runtime: ApiRuntime, request: SignedEnvelope): { accountId: string; signerAddress: string } {
    const signerAddress = request.signature?.r?.toLowerCase();
    const signatureValue = request.signature?.s?.toLowerCase();
    const vaultAddress = typeof request.vaultAddress === "string" ? request.vaultAddress : undefined;
    const nonce = typeof request.nonce === "number" ? request.nonce : undefined;

    if (!signerAddress || !signatureValue) {
      throw new Error("Missing signer identity");
    }

    const accountId = this.resolveAccountId(runtime, vaultAddress, signerAddress);
    if (!accountId) {
      throw new Error("Unknown signer or vault address");
    }

    const expectedSignature = signEnvelope(accountId, request).toLowerCase();
    if (expectedSignature !== signatureValue) {
      throw new Error("Invalid signature");
    }

    this.consumeNonce(signerAddress, nonce);
    return { accountId, signerAddress };
  }

  private resolveAccountId(runtime: ApiRuntime, vaultAddress: string | undefined, signerAddress: string): string | null {
    const accountIds = runtime.getAccountIds();

    for (const accountId of accountIds) {
      const credentials = this.getCredentials(accountId);
      const vaultMatches = !vaultAddress || credentials.vaultAddress.toLowerCase() === vaultAddress.toLowerCase();
      const signerMatches = credentials.signerAddress.toLowerCase() === signerAddress;

      if (vaultMatches && signerMatches) {
        return accountId;
      }
    }

    return null;
  }

  private consumeNonce(signerAddress: string, nonce: number | undefined) {
    if (!Number.isFinite(nonce)) {
      throw new Error("Missing nonce");
    }

    const recent = this.recentNoncesBySigner.get(signerAddress) ?? [];
    if (recent.includes(nonce as number)) {
      throw new Error("Nonce already used");
    }

    const next = [...recent, nonce as number].sort((left, right) => right - left).slice(0, 100);
    this.recentNoncesBySigner.set(signerAddress, next);
  }
}
