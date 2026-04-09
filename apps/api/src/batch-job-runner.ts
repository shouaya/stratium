import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type BatchJobId =
  | "db-bootstrap"
  | "batch-clear-kline"
  | "batch-import-hl-day"
  | "batch-refresh-hl-day";

export interface BatchJobDefinition {
  id: BatchJobId;
  label: string;
  description: string;
}

export interface BatchJobRunInput {
  coin?: string;
  date?: string;
  interval?: string;
}

export interface BatchJobRunResult {
  ok: boolean;
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  code: number;
}

const JOB_DEFINITIONS: BatchJobDefinition[] = [
  {
    id: "db-bootstrap",
    label: "DB Bootstrap",
    description: "Run Prisma push, seed default access, and seed symbol configs."
  },
  {
    id: "batch-clear-kline",
    label: "Clear K-Line",
    description: "Clear persisted Hyperliquid K-line history for one coin and interval."
  },
  {
    id: "batch-import-hl-day",
    label: "Import Hyperliquid Day",
    description: "Import one day of Hyperliquid 1-minute candles into PostgreSQL."
  },
  {
    id: "batch-refresh-hl-day",
    label: "Refresh Hyperliquid Day",
    description: "Stop API, clear one day of Hyperliquid candles, import the day again, then restart API."
  }
];

const DEFAULT_COIN = process.env.HYPERLIQUID_COIN ?? "BTC";
const DEFAULT_INTERVAL = process.env.HYPERLIQUID_CANDLE_INTERVAL ?? "1m";
const runnerCommand = process.env.BATCH_JOB_RUNNER_COMMAND?.trim() || "make";
const runnerWorkdir = process.env.BATCH_JOB_RUNNER_WORKDIR?.trim() || process.cwd();
const runnerEnabled = (process.env.BATCH_JOB_RUNNER_ENABLED ?? "true").toLowerCase() !== "false";

const ensureSafeCoin = (value: string | undefined): string => {
  const candidate = (value ?? DEFAULT_COIN).trim().toUpperCase();

  if (!/^[A-Z0-9_-]{2,20}$/.test(candidate)) {
    throw new Error("Batch coin must be an uppercase symbol like BTC.");
  }

  return candidate;
};

const ensureSafeInterval = (value: string | undefined): string => {
  const candidate = (value ?? DEFAULT_INTERVAL).trim();

  if (!/^[0-9]+[mhdw]$/.test(candidate)) {
    throw new Error("Batch interval must look like 1m, 5m, 1h, or 1d.");
  }

  return candidate;
};

const ensureSafeDate = (value: string | undefined): string | undefined => {
  const candidate = value?.trim();

  if (!candidate) {
    return undefined;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    throw new Error("Batch date must use YYYY-MM-DD.");
  }

  return candidate;
};

const buildCommand = (jobId: BatchJobId, input: BatchJobRunInput): { command: string; args: string[] } => {
  const coin = ensureSafeCoin(input.coin);
  const date = ensureSafeDate(input.date);
  const interval = ensureSafeInterval(input.interval);

  switch (jobId) {
    case "db-bootstrap":
      return {
        command: runnerCommand,
        args: ["db-bootstrap"]
      };
    case "batch-clear-kline":
      return {
        command: runnerCommand,
        args: ["batch-clear-kline", `ARGS=--coin ${coin} --interval ${interval} --source hyperliquid`]
      };
    case "batch-import-hl-day":
      return {
        command: runnerCommand,
        args: ["batch-import-hl-day", `ARGS=--coin ${coin}${date ? ` --date ${date}` : ""}`]
      };
    case "batch-refresh-hl-day":
      return {
        command: runnerCommand,
        args: ["batch-refresh-hl-day", `COIN=${coin}`, ...(date ? [`DATE=${date}`] : [])]
      };
    default:
      throw new Error(`Unsupported batch job: ${String(jobId)}`);
  }
};

export class BatchJobRunner {
  listJobs(): BatchJobDefinition[] {
    return JOB_DEFINITIONS;
  }

  async run(jobId: BatchJobId, input: BatchJobRunInput = {}): Promise<BatchJobRunResult> {
    if (!runnerEnabled) {
      throw new Error("Batch job runner is disabled.");
    }

    const { command, args } = buildCommand(jobId, input);

    try {
      const result = await execFileAsync(command, args, {
        cwd: runnerWorkdir,
        timeout: 10 * 60 * 1000,
        maxBuffer: 1024 * 1024
      });

      return {
        ok: true,
        command,
        args,
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim(),
        code: 0
      };
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
        code?: number | string;
      };

      return {
        ok: false,
        command,
        args,
        stdout: String(failure.stdout ?? "").trim(),
        stderr: String(failure.stderr ?? failure.message ?? "").trim(),
        code: typeof failure.code === "number" ? failure.code : 1
      };
    }
  }
}
