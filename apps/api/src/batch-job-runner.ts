export type BatchJobId =
  | "db-bootstrap"
  | "batch-clear-kline"
  | "batch-import-hl-day"
  | "batch-refresh-hl-day"
  | "batch-switch-active-symbol";

export interface BatchJobDefinition {
  id: BatchJobId;
  label: string;
  description: string;
}

export interface BatchJobRunInput {
  exchange?: string;
  coin?: string;
  symbol?: string;
  date?: string;
  interval?: string;
}

export interface BatchJobRunResult {
  executionId?: string;
  jobId?: BatchJobId;
  status?: "running" | "success" | "failed";
  startedAt?: string;
  finishedAt?: string;
  ok?: boolean;
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  code: number;
  message?: string;
}

export interface BatchJobExecution {
  executionId: string;
  jobId: BatchJobId;
  status: "running" | "success" | "failed";
  startedAt: string;
  finishedAt?: string;
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  code?: number;
  ok?: boolean;
  message?: string;
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
    description: "Stop API, refresh the latest 24 hours of Hyperliquid 1-minute candles, then restart API."
  },
  {
    id: "batch-switch-active-symbol",
    label: "Switch Active Symbol",
    description: "Switch the active trading symbol, import the latest 24 hours of candles, and restart API."
  }
];

const runnerBaseUrl = process.env.JOB_RUNNER_BASE_URL?.trim() || "http://host.docker.internal:4300";
const runnerToken = process.env.JOB_RUNNER_TOKEN?.trim() || "stratium-local-runner";
const runnerEnabled = (process.env.BATCH_JOB_RUNNER_ENABLED ?? "true").toLowerCase() !== "false";

export class BatchJobRunner {
  listJobs(): BatchJobDefinition[] {
    return JOB_DEFINITIONS;
  }

  async run(jobId: BatchJobId, input: BatchJobRunInput = {}): Promise<BatchJobRunResult> {
    if (!runnerEnabled) {
      throw new Error("Batch job runner is disabled.");
    }

    const response = await fetch(`${runnerBaseUrl}/jobs/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${runnerToken}`
      },
      body: JSON.stringify({
        jobId,
        ...input
      })
    }).catch((error) => {
      throw new Error(`Failed to reach job runner at ${runnerBaseUrl}: ${error instanceof Error ? error.message : String(error)}`);
    });

    const payload = await response.json().catch(() => null) as BatchJobRunResult | { message?: string } | null;

    if (!payload || (!("ok" in payload) && !("executionId" in payload))) {
      throw new Error(`Job runner returned an invalid response with HTTP ${response.status}.`);
    }

    return payload;
  }

  async listRunningJobs(): Promise<BatchJobExecution[]> {
    if (!runnerEnabled) {
      throw new Error("Batch job runner is disabled.");
    }

    const response = await fetch(`${runnerBaseUrl}/jobs/running`, {
      headers: {
        Authorization: `Bearer ${runnerToken}`
      }
    }).catch((error) => {
      throw new Error(`Failed to reach job runner at ${runnerBaseUrl}: ${error instanceof Error ? error.message : String(error)}`);
    });

    const payload = await response.json().catch(() => null) as { jobs?: BatchJobExecution[] } | null;

    if (!payload?.jobs) {
      throw new Error(`Job runner returned an invalid running jobs response with HTTP ${response.status}.`);
    }

    return payload.jobs;
  }

  async getExecution(executionId: string): Promise<BatchJobExecution> {
    if (!runnerEnabled) {
      throw new Error("Batch job runner is disabled.");
    }

    const response = await fetch(`${runnerBaseUrl}/jobs/${encodeURIComponent(executionId)}`, {
      headers: {
        Authorization: `Bearer ${runnerToken}`
      }
    }).catch((error) => {
      throw new Error(`Failed to reach job runner at ${runnerBaseUrl}: ${error instanceof Error ? error.message : String(error)}`);
    });

    const payload = await response.json().catch(() => null) as BatchJobExecution | null;

    if (!payload?.executionId) {
      throw new Error(`Job runner returned an invalid execution response with HTTP ${response.status}.`);
    }

    return payload;
  }
}
