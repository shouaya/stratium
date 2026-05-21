import { spawn } from "node:child_process";

export type ProcessRunInput = {
  command: string;
  args: string[];
  stdin?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
};

export type ProcessRunOutput = {
  stdout: string;
  stderr: string;
};

export const runProcess = (input: ProcessRunInput): Promise<ProcessRunOutput> =>
  new Promise((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        ...input.env
      }
    });

    let settled = false;
    let stdout = "";
    let stderr = "";
    const timeout = input.timeoutMs && input.timeoutMs > 0
      ? setTimeout(() => {
          if (settled) {
            return;
          }
          settled = true;
          child.kill("SIGTERM");
          reject(new Error(`${input.command} timed out after ${input.timeoutMs}ms`));
        }, input.timeoutMs)
      : undefined;

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${input.command} exited with ${code}: ${[
        stderr.trim() ? `stderr:\n${stderr.trim()}` : "",
        stdout.trim() ? `stdout:\n${stdout.trim()}` : ""
      ].filter(Boolean).join("\n")}`));
    });

    child.stdin.end(input.stdin ?? "");
  });
