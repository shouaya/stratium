import { describe, expect, it } from "vitest";
import { HyperliquidBotAuth } from "../src/hyperliquid-bot-auth";

describe("HyperliquidBotAuth", () => {
  const makeRuntime = (accountIds = ["paper-account-1", "paper-account-2"]) => ({
    getAccountIds: () => accountIds
  });

  const canonicalStringify = (value: unknown): string => {
    if (Array.isArray(value)) {
      return `[${value.map((entry) => canonicalStringify(entry)).join(",")}]`;
    }

    if (value && typeof value === "object") {
      return `{${Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalStringify(entry)}`)
        .join(",")}}`;
    }

    return JSON.stringify(value);
  };

  const sign = async (secret: string, body: Record<string, unknown>) => {
    const { createHmac } = await import("node:crypto");
    return `0x${createHmac("sha256", secret).update(canonicalStringify(body)).digest("hex")}`;
  };

  it("returns stable local credentials and authenticates valid signed requests", async () => {
    const auth = new HyperliquidBotAuth();
    const credentials = auth.getCredentials("paper-account-1");
    expect(credentials.accountId).toBe("paper-account-1");
    expect(credentials.vaultAddress.startsWith("0x")).toBe(true);
    expect(credentials.signerAddress.startsWith("0x")).toBe(true);

    const unsignedBody = {
      type: "openOrders",
      user: credentials.accountId,
      nonce: 1001,
      vaultAddress: credentials.vaultAddress
    };
    const signature = await sign(credentials.apiSecret, unsignedBody);

    expect(auth.authenticate(makeRuntime() as never, {
      ...unsignedBody,
      signature: {
        r: credentials.signerAddress,
        s: signature,
        v: 27
      }
    })).toEqual({
      accountId: "paper-account-1",
      signerAddress: credentials.signerAddress
    });
  });

  it("rejects missing signer identity, missing nonce, invalid signature, replayed nonce, and unknown signer", async () => {
    const auth = new HyperliquidBotAuth();
    const credentials = auth.getCredentials("paper-account-1");

    expect(() => auth.authenticate(makeRuntime() as never, {
      type: "openOrders"
    })).toThrow("Missing signer identity");

    const noNonceBody = {
      type: "openOrders",
      user: credentials.accountId,
      vaultAddress: credentials.vaultAddress
    };
    const noNonceSignature = await sign(credentials.apiSecret, noNonceBody);
    expect(() => auth.authenticate(makeRuntime() as never, {
      ...noNonceBody,
      signature: {
        r: credentials.signerAddress,
        s: noNonceSignature,
        v: 27
      }
    })).toThrow("Missing nonce");

    const signedBody = {
      type: "openOrders",
      user: credentials.accountId,
      nonce: 1002,
      vaultAddress: credentials.vaultAddress
    };
    expect(() => auth.authenticate(makeRuntime() as never, {
      ...signedBody,
      signature: {
        r: credentials.signerAddress,
        s: "0xbadsignature",
        v: 27
      }
    })).toThrow("Invalid signature");

    const validSignature = await sign(credentials.apiSecret, signedBody);
    auth.authenticate(makeRuntime() as never, {
      ...signedBody,
      signature: {
        r: credentials.signerAddress,
        s: validSignature,
        v: 27
      }
    });
    expect(() => auth.authenticate(makeRuntime() as never, {
      ...signedBody,
      signature: {
        r: credentials.signerAddress,
        s: validSignature,
        v: 27
      }
    })).toThrow("Nonce already used");

    expect(() => auth.authenticate(makeRuntime([]) as never, {
      ...signedBody,
      nonce: 1003,
      signature: {
        r: credentials.signerAddress,
        s: validSignature,
        v: 27
      }
    })).toThrow("Unknown signer or vault address");
  });

  it("allows signer-only matching when vault address is omitted", async () => {
    const auth = new HyperliquidBotAuth();
    const credentials = auth.getCredentials("paper-account-2");
    const unsignedBody = {
      type: "clearinghouseState",
      user: credentials.accountId,
      nonce: 2001
    };
    const signature = await sign(credentials.apiSecret, unsignedBody);

    expect(auth.authenticate(makeRuntime() as never, {
      ...unsignedBody,
      signature: {
        r: credentials.signerAddress,
        s: signature,
        v: 27
      }
    })).toEqual({
      accountId: "paper-account-2",
      signerAddress: credentials.signerAddress
    });
  });
});
