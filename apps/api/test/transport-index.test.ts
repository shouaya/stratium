import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("transport/index", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("boots the server with fallback origins and shuts down on process signals", async () => {
    const handlers: Record<string, () => void> = {};
    const registrations: Array<{ plugin: unknown; options: Record<string, unknown> | undefined }> = [];
    const runtime = {
      bootstrap: vi.fn(async () => undefined),
      shutdown: vi.fn(async () => undefined)
    };
    const app = {
      log: {},
      register: vi.fn(async (plugin: unknown, options?: Record<string, unknown>) => {
        registrations.push({ plugin, options });
      }),
      listen: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined)
    };
    const corsPlugin = { name: "cors" };
    const rateLimitPlugin = { name: "rateLimit" };
    const websocketPlugin = { name: "websocket" };
    const registerRoutes = vi.fn(async () => undefined);

    vi.doMock("fastify", () => ({
      default: vi.fn(() => app)
    }));
    vi.doMock("@fastify/cors", () => ({ default: corsPlugin }));
    vi.doMock("@fastify/rate-limit", () => ({ default: rateLimitPlugin }));
    vi.doMock("@fastify/websocket", () => ({ default: websocketPlugin }));
    vi.doMock("../src/transport/routes", () => ({ registerRoutes }));
    vi.doMock("../src/runtime/runtime", () => ({
      ApiRuntime: class {
        constructor() {
          return runtime;
        }
      }
    }));
    vi.spyOn(process, "on").mockImplementation(((event: string, handler: () => void) => {
      handlers[event] = handler;
      return process;
    }) as never);

    await import("../src/transport/index");

    expect(registerRoutes).toHaveBeenCalledWith(app, runtime);
    expect(runtime.bootstrap).toHaveBeenCalledOnce();
    expect(app.listen).toHaveBeenCalledWith({
      port: 4000,
      host: "0.0.0.0"
    });

    const corsRegistration = registrations.find((entry) => entry.plugin === corsPlugin);
    expect(corsRegistration).toBeDefined();

    const origin = corsRegistration?.options?.origin as (value: string | undefined, callback: (error: Error | null, allowed: boolean) => void) => void;
    const allowedCallback = vi.fn();
    origin(undefined, allowedCallback);
    origin("http://localhost:5000", allowedCallback);
    expect(allowedCallback).toHaveBeenNthCalledWith(1, null, true);
    expect(allowedCallback).toHaveBeenNthCalledWith(2, null, true);

    const blockedCallback = vi.fn();
    origin("https://blocked.example.com", blockedCallback);
    expect(blockedCallback.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(blockedCallback.mock.calls[0]?.[1]).toBe(false);

    handlers.SIGINT?.();
    handlers.SIGTERM?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(runtime.shutdown).toHaveBeenCalledTimes(2);
    expect(app.close).toHaveBeenCalledTimes(2);
  });

  it("uses configured origins, host, and port when provided", async () => {
    vi.stubEnv("ALLOWED_ORIGINS", "https://one.example.com, https://two.example.com");
    vi.stubEnv("PORT", "4300");
    vi.stubEnv("HOST", "127.0.0.1");

    const registrations: Array<{ plugin: unknown; options: Record<string, unknown> | undefined }> = [];
    const app = {
      log: {},
      register: vi.fn(async (plugin: unknown, options?: Record<string, unknown>) => {
        registrations.push({ plugin, options });
      }),
      listen: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined)
    };
    const corsPlugin = { name: "cors" };

    vi.doMock("fastify", () => ({
      default: vi.fn(() => app)
    }));
    vi.doMock("@fastify/cors", () => ({ default: corsPlugin }));
    vi.doMock("@fastify/rate-limit", () => ({ default: { name: "rateLimit" } }));
    vi.doMock("@fastify/websocket", () => ({ default: { name: "websocket" } }));
    vi.doMock("../src/transport/routes", () => ({ registerRoutes: vi.fn(async () => undefined) }));
    vi.doMock("../src/runtime/runtime", () => ({
      ApiRuntime: class {
        bootstrap = vi.fn(async () => undefined);
        shutdown = vi.fn(async () => undefined);
      }
    }));
    vi.spyOn(process, "on").mockImplementation((((_event: string, _handler: () => void) => process)) as never);

    await import("../src/transport/index");

    const corsRegistration = registrations.find((entry) => entry.plugin === corsPlugin);
    const origin = corsRegistration?.options?.origin as (value: string | undefined, callback: (error: Error | null, allowed: boolean) => void) => void;
    const allowedCallback = vi.fn();
    origin("https://one.example.com", allowedCallback);
    origin("https://two.example.com", allowedCallback);

    expect(allowedCallback).toHaveBeenNthCalledWith(1, null, true);
    expect(allowedCallback).toHaveBeenNthCalledWith(2, null, true);
    expect(app.listen).toHaveBeenCalledWith({
      port: 4300,
      host: "127.0.0.1"
    });
  });
});
