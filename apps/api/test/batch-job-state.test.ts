import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();
vi.mock("@redis/client", () => ({
  createClient: createClientMock
}));

describe("BatchJobStateFeed", () => {
  const makeRedisClient = () => ({
    connect: vi.fn(async () => undefined),
    subscribe: vi.fn(async (_channel: string, handler: (payload: string) => Promise<void> | void) => {
      (makeRedisClient as unknown as { handler?: typeof handler }).handler = handler;
    }),
    sMembers: vi.fn(async () => ["exec-1"]),
    get: vi.fn(async (key: string) => {
      if (key === "stratium:batch:last-execution") {
        return "exec-2";
      }
      if (key === "stratium:batch:execution:exec-1") {
        return JSON.stringify({
          executionId: "exec-1",
          jobId: "db-bootstrap",
          status: "running",
          startedAt: "2026-04-10T00:00:00.000Z",
          command: "cmd",
          args: [],
          stdout: "",
          stderr: ""
        });
      }
      if (key === "stratium:batch:execution:exec-2") {
        return JSON.stringify({
          executionId: "exec-2",
          jobId: "batch-refresh-hl-day",
          status: "success",
          startedAt: "2026-04-10T00:01:00.000Z",
          finishedAt: "2026-04-10T00:02:00.000Z",
          command: "cmd",
          args: [],
          stdout: "",
          stderr: ""
        });
      }
      return null;
    }),
    quit: vi.fn(async () => undefined)
  });

  beforeEach(() => {
    createClientMock.mockReset();
    createClientMock.mockImplementation(() => makeRedisClient());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("connects, refreshes state, handles subscriber updates, and shuts down", async () => {
    const onUpdate = vi.fn();
    const module = await import("../src/batch-job-state");
    const feed = new module.BatchJobStateFeed(onUpdate);

    await feed.connect();
    expect(feed.getRunningJobs()).toHaveLength(1);
    expect(feed.getLastExecution()).toMatchObject({
      executionId: "exec-2"
    });

    const subscriber = createClientMock.mock.results[1]?.value as {
      subscribe: ReturnType<typeof vi.fn>;
    };
    const updateHandler = subscriber.subscribe.mock.calls[0]?.[1] as ((payload: string) => Promise<void>) | undefined;
    await updateHandler?.("not-json").catch(() => undefined);

    await updateHandler?.(JSON.stringify({
      executionId: "exec-3",
      jobId: "db-bootstrap",
      status: "running",
      startedAt: "2026-04-10T00:03:00.000Z",
      command: "cmd",
      args: [],
      stdout: "",
      stderr: ""
    }));
    expect(feed.getRunningJobs().some((entry) => entry.executionId === "exec-3")).toBe(true);

    await updateHandler?.(JSON.stringify({
      executionId: "exec-3",
      jobId: "db-bootstrap",
      status: "failed",
      startedAt: "2026-04-10T00:03:00.000Z",
      finishedAt: "2026-04-10T00:04:00.000Z",
      command: "cmd",
      args: [],
      stdout: "",
      stderr: "",
      code: 1
    }));
    expect(feed.getRunningJobs().some((entry) => entry.executionId === "exec-3")).toBe(false);
    expect(feed.getLastExecution()).toMatchObject({
      executionId: "exec-3",
      status: "failed"
    });
    expect(onUpdate).toHaveBeenCalled();

    await feed.shutdown();
    const firstClient = createClientMock.mock.results[0]?.value as { quit: ReturnType<typeof vi.fn> };
    expect(firstClient.quit).toHaveBeenCalled();
  });

  it("ignores null payloads and handles empty refresh state", async () => {
    const emptyClient = {
      connect: vi.fn(async () => undefined),
      subscribe: vi.fn(async (_channel: string, handler: (payload: string) => Promise<void> | void) => {
        (emptyClient as unknown as { handler?: typeof handler }).handler = handler;
      }),
      sMembers: vi.fn(async () => ["exec-missing"]),
      get: vi.fn(async (key: string) => {
        if (key === "stratium:batch:last-execution") {
          return null;
        }
        return null;
      }),
      quit: vi.fn(async () => undefined)
    };
    createClientMock.mockReset();
    createClientMock.mockImplementation(() => emptyClient);

    const onUpdate = vi.fn();
    const module = await import("../src/batch-job-state");
    const feed = new module.BatchJobStateFeed(onUpdate);

    await feed.connect();
    expect(feed.getRunningJobs()).toEqual([]);
    expect(feed.getLastExecution()).toBeNull();

    const subscriber = createClientMock.mock.results[1]?.value as {
      subscribe: ReturnType<typeof vi.fn>;
    };
    const updateHandler = subscriber.subscribe.mock.calls[0]?.[1] as ((payload: string) => Promise<void>) | undefined;
    await updateHandler?.("null");

    expect(feed.getRunningJobs()).toEqual([]);
    expect(feed.getLastExecution()).toBeNull();
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
