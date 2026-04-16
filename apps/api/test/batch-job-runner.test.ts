import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("BatchJobRunner", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.BATCH_JOB_RUNNER_ENABLED;
  });

  it("lists jobs and handles run/list/get execution success paths", async () => {
    const module = await import("../src/batch/batch-job-runner");
    const runner = new module.BatchJobRunner();

    fetchMock
      .mockResolvedValueOnce({
        status: 202,
        json: async () => ({
          executionId: "exec-1",
          jobId: "batch-refresh-hl-day",
          status: "running",
          command: "cmd",
          args: [],
          stdout: "",
          stderr: "",
          code: 0
        })
      })
      .mockResolvedValueOnce({
        status: 200,
        json: async () => ({
          jobs: [{
            executionId: "exec-1",
            jobId: "batch-refresh-hl-day",
            status: "running",
            startedAt: "2026-04-10T00:00:00.000Z",
            command: "cmd",
            args: [],
            stdout: "",
            stderr: ""
          }]
        })
      })
      .mockResolvedValueOnce({
        status: 200,
        json: async () => ({
          executionId: "exec-1",
          jobId: "batch-refresh-hl-day",
          status: "success",
          startedAt: "2026-04-10T00:00:00.000Z",
          finishedAt: "2026-04-10T00:01:00.000Z",
          command: "cmd",
          args: [],
          stdout: "",
          stderr: "",
          ok: true
        })
      });

    expect(runner.listJobs().map((job) => job.id)).toEqual([
      "db-bootstrap",
      "batch-clear-kline",
      "batch-import-hl-day",
      "batch-refresh-hl-day",
      "batch-switch-active-symbol"
    ]);
    expect(await runner.run("batch-refresh-hl-day", { coin: "BTC" })).toMatchObject({
      executionId: "exec-1"
    });
    expect(await runner.listRunningJobs()).toHaveLength(1);
    expect(await runner.getExecution("exec-1")).toMatchObject({
      executionId: "exec-1",
      status: "success"
    });
  });

  it("handles disabled runner, fetch failures, and invalid payloads", async () => {
    process.env.BATCH_JOB_RUNNER_ENABLED = "false";
    const disabledModule = await import("../src/batch/batch-job-runner");
    const disabledRunner = new disabledModule.BatchJobRunner();
    await expect(disabledRunner.run("db-bootstrap")).rejects.toThrow("Batch job runner is disabled.");
    await expect(disabledRunner.listRunningJobs()).rejects.toThrow("Batch job runner is disabled.");
    await expect(disabledRunner.getExecution("x")).rejects.toThrow("Batch job runner is disabled.");

    vi.resetModules();
    fetchMock.mockReset();
    delete process.env.BATCH_JOB_RUNNER_ENABLED;
    const module = await import("../src/batch/batch-job-runner");
    const runner = new module.BatchJobRunner();

    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await expect(runner.run("db-bootstrap")).rejects.toThrow("Failed to reach job runner");

    fetchMock.mockResolvedValueOnce({
      status: 500,
      json: async () => ({})
    });
    await expect(runner.run("db-bootstrap")).rejects.toThrow("invalid response");

    fetchMock.mockResolvedValueOnce({
      status: 500,
      json: async () => null
    });
    await expect(runner.listRunningJobs()).rejects.toThrow("invalid running jobs response");

    fetchMock.mockResolvedValueOnce({
      status: 500,
      json: async () => ({})
    });
    await expect(runner.getExecution("bad id")).rejects.toThrow("invalid execution response");
  });

  it("uses trimmed runner env vars and formats non-Error fetch failures", async () => {
    process.env.JOB_RUNNER_BASE_URL = " http://runner.example ";
    process.env.JOB_RUNNER_TOKEN = " token-123 ";
    vi.resetModules();
    fetchMock.mockReset();
    const module = await import("../src/batch/batch-job-runner");
    const runner = new module.BatchJobRunner();

    fetchMock.mockResolvedValueOnce({
      status: 202,
      json: async () => ({
        executionId: "exec-env",
        command: "cmd",
        args: [],
        stdout: "",
        stderr: "",
        code: 0
      })
    });
    await runner.run("db-bootstrap");
    expect(fetchMock).toHaveBeenCalledWith("http://runner.example/jobs/run", expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: "Bearer token-123"
      })
    }));

    fetchMock.mockResolvedValueOnce({
      status: 200,
      json: async () => ({
        ok: false,
        command: "cmd",
        args: [],
        stdout: "",
        stderr: "failed",
        code: 1
      })
    });
    await expect(runner.run("db-bootstrap")).resolves.toMatchObject({
      ok: false,
      code: 1
    });

    fetchMock.mockRejectedValueOnce("network down");
    await expect(runner.listRunningJobs()).rejects.toThrow("Failed to reach job runner at http://runner.example: network down");

    fetchMock.mockRejectedValueOnce("network down");
    await expect(runner.getExecution("exec-env")).rejects.toThrow("Failed to reach job runner at http://runner.example: network down");
  });
});
