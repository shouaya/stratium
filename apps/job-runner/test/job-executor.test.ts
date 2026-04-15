import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecFileException } from "node:child_process";

const execFileMock = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: execFileMock
}));

describe("JobExecutor", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it("treats a missing API container as not running during refresh jobs", async () => {
    execFileMock.mockImplementation((
      command: string,
      args: string[],
      _options: unknown,
      callback: (error: ExecFileException | null, result?: { stdout: string; stderr: string }) => void
    ) => {
      if (command === "docker" && args[0] === "container" && args[1] === "inspect") {
        const error = new Error("No such container") as ExecFileException & { stdout?: string; stderr?: string; code?: number };
        error.code = 1;
        error.stdout = "";
        error.stderr = "Error response from daemon: No such container: stratium-api";
        callback(error);
        return;
      }

      if (command === "docker" && args[0] === "compose") {
        callback(null, { stdout: "ok", stderr: "" });
        return;
      }

      callback(new Error(`Unexpected command: ${command} ${args.join(" ")}`) as ExecFileException);
    });

    const module = await import("../src/job-executor.js");
    const executor = new module.JobExecutor();
    const result = await executor.run("batch-refresh-hl-day", { coin: "BTC" });

    expect(result.ok).toBe(true);
    expect(execFileMock).toHaveBeenCalledWith(
      "docker",
      ["container", "inspect", "-f", "{{.State.Running}}", "stratium-api"],
      expect.any(Object),
      expect.any(Function)
    );

    const dockerCalls = execFileMock.mock.calls
      .filter(([command]: [string]) => command === "docker")
      .map(([, args]: [string, string[]]) => args);

    expect(dockerCalls.some((args: string[]) => args[0] === "stop")).toBe(false);
    expect(dockerCalls.some((args: string[]) => args[0] === "start")).toBe(false);
  });

  it("supports okx when switching the active symbol", async () => {
    execFileMock.mockImplementation((
      command: string,
      args: string[],
      _options: unknown,
      callback: (error: ExecFileException | null, result?: { stdout: string; stderr: string }) => void
    ) => {
      if (command === "docker" && args[0] === "container" && args[1] === "inspect") {
        callback(null, { stdout: "true", stderr: "" });
        return;
      }

      if (command === "docker" && args[0] === "restart") {
        callback(null, { stdout: "restarted", stderr: "" });
        return;
      }

      if (command === "docker" && args[0] === "compose") {
        callback(null, { stdout: "ok", stderr: "" });
        return;
      }

      callback(new Error(`Unexpected command: ${command} ${args.join(" ")}`) as ExecFileException);
    });

    const module = await import("../src/job-executor.js");
    const executor = new module.JobExecutor();
    const result = await executor.run("batch-switch-active-symbol", {
      exchange: "okx",
      symbol: "ETH-USD"
    });

    expect(result.ok).toBe(true);

    const batchNodeCalls = execFileMock.mock.calls
      .filter(([command, args]: [string, string[]]) =>
        command === "docker"
        && args[0] === "compose"
        && args.includes("node")
      )
      .map(([, args]: [string, string[]]) => args.join(" "));

    expect(batchNodeCalls.some((value: string) => value.includes("dist/jobs/switch-active-symbol.js --exchange okx --symbol ETH-USD"))).toBe(true);
    expect(batchNodeCalls.some((value: string) => value.includes("dist/jobs/clear-market-history.js --coin ETH --interval 1m --source okx"))).toBe(true);
    expect(batchNodeCalls.some((value: string) => value.includes("dist/jobs/import-okx-history.js --symbol ETH-USD --interval 1m"))).toBe(true);
  });
});
