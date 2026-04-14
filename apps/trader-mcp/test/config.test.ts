import { afterEach, describe, expect, it, vi } from "vitest";

describe("trader-mcp config defaults", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("defaults to the internal API URL when running in a container", async () => {
    const { __internal } = await import("../src/config.js");
    expect(__internal.resolveDefaultApiBaseUrl(true)).toBe("http://api:4000");
  });

  it("requires an explicit API URL when running outside a container", async () => {
    const { __internal } = await import("../src/config.js");
    expect(() => __internal.resolveDefaultApiBaseUrl(false)).toThrow(
      "STRATIUM_API_BASE_URL is required when trader-mcp runs outside Docker Compose."
    );
  });
});
