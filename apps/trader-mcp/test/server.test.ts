import { afterEach, describe, expect, it } from "vitest";
import { extractBearerToken, startTraderMcpHttpServer } from "../src/server";

describe("trader-mcp server helpers", () => {
  const runtimes: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
  });

  it("extracts bearer tokens from MCP request headers", () => {
    expect(extractBearerToken({ authorization: "Bearer demo-token" })).toBe("demo-token");
    expect(extractBearerToken({ authorization: "bearer demo-token" })).toBe("demo-token");
    expect(extractBearerToken({ authorization: "Basic something" })).toBeUndefined();
    expect(extractBearerToken()).toBeUndefined();
  });

  it("serves health and rejects non-mcp paths", async () => {
    const runtime = await startTraderMcpHttpServer({
      apiBaseUrl: "http://127.0.0.1:4000",
      host: "127.0.0.1",
      port: 4611
    });
    runtimes.push(runtime);

    const healthResponse = await fetch("http://127.0.0.1:4611/health");
    expect(healthResponse.status).toBe(200);
    expect(await healthResponse.json()).toEqual({
      status: "ok",
      transport: "streamable-http",
      path: "/mcp"
    });

    const missingResponse = await fetch("http://127.0.0.1:4611/unknown");
    expect(missingResponse.status).toBe(404);
  });
});
