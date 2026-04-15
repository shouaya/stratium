import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type JobRunnerJobId =
  | "db-migrate"
  | "db-push"
  | "db-seed"
  | "db-clear-runtime-data"
  | "db-bootstrap"
  | "seed-symbol-configs"
  | "batch-clear-kline"
  | "batch-import-hl-day"
  | "batch-refresh-hl-day"
  | "batch-switch-active-symbol";

export interface JobRunInput {
  exchange?: string;
  coin?: string;
  symbol?: string;
  date?: string;
  interval?: string;
  migrationName?: string;
}

export interface JobRunResult {
  ok: boolean;
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  code: number;
  message?: string;
}

export interface JobDefinition {
  id: JobRunnerJobId;
  label: string;
  description: string;
  adminVisible: boolean;
}

const DEFAULT_COIN = process.env.HYPERLIQUID_COIN ?? "BTC";
const DEFAULT_INTERVAL = process.env.HYPERLIQUID_CANDLE_INTERVAL ?? "1m";
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const composeCommandOverride = process.env.JOB_RUNNER_COMPOSE_COMMAND?.trim();
const composeCommandArgsOverride = (process.env.JOB_RUNNER_COMPOSE_ARGS ?? "")
  .split(/\s+/)
  .map((value) => value.trim())
  .filter(Boolean);
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const workdir = process.env.JOB_RUNNER_WORKDIR?.trim() || path.resolve(moduleDir, "../../..");
const batchEnvFile = process.env.JOB_RUNNER_BATCH_ENV_FILE?.trim() || ".env";
const batchComposeFile = process.env.JOB_RUNNER_BATCH_COMPOSE_FILE?.trim() || "docker-compose.batch.yml";
const mainComposeFile = process.env.JOB_RUNNER_MAIN_COMPOSE_FILE?.trim() || "docker-compose.yml";
const apiContainerName = process.env.JOB_RUNNER_API_CONTAINER?.trim() || "stratium-api";
const supportedExchanges = new Set(["hyperliquid", "okx"]);

const definitions: JobDefinition[] = [
  {
    id: "db-bootstrap",
    label: "DB Bootstrap",
    description: "Run Prisma push, seed default access, and seed symbol configs.",
    adminVisible: true
  },
  {
    id: "batch-clear-kline",
    label: "Clear K-Line",
    description: "Clear persisted Hyperliquid K-line history for one coin and interval.",
    adminVisible: true
  },
  {
    id: "batch-import-hl-day",
    label: "Import Hyperliquid Day",
    description: "Import one day of Hyperliquid 1-minute candles into PostgreSQL.",
    adminVisible: true
  },
  {
    id: "batch-refresh-hl-day",
    label: "Refresh Hyperliquid Day",
    description: "Stop API, refresh the latest 24 hours of Hyperliquid 1-minute candles, then restart API.",
    adminVisible: true
  },
  {
    id: "batch-switch-active-symbol",
    label: "Switch Active Symbol",
    description: "Switch the active trading symbol, import the latest 24 hours of candles, and restart API.",
    adminVisible: true
  },
  {
    id: "db-clear-runtime-data",
    label: "DB Clear Runtime Data",
    description: "Clear runtime event, account, order, position, fill, and trigger tables.",
    adminVisible: false
  },
  {
    id: "db-push",
    label: "DB Push",
    description: "Push Prisma schema inside the batch container.",
    adminVisible: false
  },
  {
    id: "db-seed",
    label: "DB Seed",
    description: "Seed default app accounts and platform settings inside the batch container.",
    adminVisible: false
  },
  {
    id: "seed-symbol-configs",
    label: "Seed Symbol Configs",
    description: "Seed default symbol configs inside the batch container.",
    adminVisible: false
  },
  {
    id: "db-migrate",
    label: "DB Migrate",
    description: "Run Prisma migrate dev inside the batch container.",
    adminVisible: false
  }
];

const ensureSafeCoin = (value: string | undefined): string => {
  const candidate = (value ?? DEFAULT_COIN).trim().toUpperCase();

  if (!/^[A-Z0-9_-]{2,20}$/.test(candidate)) {
    throw new Error("Batch coin must be an uppercase symbol like BTC.");
  }

  return candidate;
};

const ensureSafeExchange = (value: string | undefined): string => {
  const candidate = (value ?? "hyperliquid").trim().toLowerCase();

  if (!/^[a-z0-9_-]{2,32}$/.test(candidate)) {
    throw new Error("Batch exchange must be a lowercase identifier like hyperliquid.");
  }

  if (!supportedExchanges.has(candidate)) {
    throw new Error(`Unsupported exchange: ${candidate}.`);
  }

  return candidate;
};

const ensureSafeSymbol = (value: string | undefined): string => {
  const candidate = (value ?? "").trim().toUpperCase();

  if (!/^[A-Z0-9]{2,20}-[A-Z0-9]{2,10}$/.test(candidate)) {
    throw new Error("Batch symbol must look like BTC-USD.");
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

const ensureMigrationName = (value: string | undefined): string => {
  const candidate = (value ?? "schema-update").trim();

  if (!/^[a-zA-Z0-9_-]{2,64}$/.test(candidate)) {
    throw new Error("Migration name must be 2-64 chars using letters, digits, dash, or underscore.");
  }

  return candidate;
};

const batchComposeBaseArgs = ["--env-file", batchEnvFile, "-f", batchComposeFile];

type ComposeRunner = {
  command: string;
  args: string[];
};

const runCommand = async (command: string, args: string[]): Promise<JobRunResult> => {
  try {
    const result = await execFileAsync(command, args, {
      cwd: workdir,
      timeout: DEFAULT_TIMEOUT_MS,
      maxBuffer: 1024 * 1024 * 10
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
      code: typeof failure.code === "number" ? failure.code : 1,
      message: failure.message
    };
  }
};

const canRunCommand = async (command: string, args: string[]) => {
  const result = await runCommand(command, args);
  return result.ok;
};

let composeRunnerPromise: Promise<ComposeRunner> | null = null;

const resolveComposeRunner = async (): Promise<ComposeRunner> => {
  if (composeRunnerPromise) {
    return composeRunnerPromise;
  }

  composeRunnerPromise = (async () => {
    if (composeCommandOverride) {
      return {
        command: composeCommandOverride,
        args: composeCommandArgsOverride
      };
    }

    if (await canRunCommand("docker", ["compose", "version"])) {
      return {
        command: "docker",
        args: ["compose"]
      };
    }

    if (await canRunCommand("docker-compose", ["version"])) {
      return {
        command: "docker-compose",
        args: []
      };
    }

    throw new Error("Unable to find a working Docker Compose command. Tried `docker compose` and `docker-compose`.");
  })();

  return composeRunnerPromise;
};

const combineResults = (steps: JobRunResult[]): JobRunResult => {
  const firstFailure = steps.find((step) => !step.ok);
  const lastStep = steps[steps.length - 1];

  return {
    ok: !firstFailure,
    command: steps[0]?.command ?? "docker",
    args: [],
    stdout: steps
      .map((step, index) => step.stdout ? `# Step ${index + 1}: ${step.command} ${step.args.join(" ")}\n${step.stdout}` : "")
      .filter(Boolean)
      .join("\n\n"),
    stderr: steps
      .map((step, index) => step.stderr ? `# Step ${index + 1}: ${step.command} ${step.args.join(" ")}\n${step.stderr}` : "")
      .filter(Boolean)
      .join("\n\n"),
    code: firstFailure?.code ?? lastStep?.code ?? 0,
    message: firstFailure?.message
  };
};

const runBatchShell = async (script: string) => {
  const composeRunner = await resolveComposeRunner();
  return runCommand(composeRunner.command, [...composeRunner.args, ...batchComposeBaseArgs, "run", "--build", "--rm", "--workdir", "/workspace", "batch", "sh", "-lc", script]);
};

const runBatchNode = async (args: string[]) => {
  const composeRunner = await resolveComposeRunner();
  return runCommand(composeRunner.command, [...composeRunner.args, ...batchComposeBaseArgs, "run", "--build", "--rm", "batch", "node", "--experimental-specifier-resolution=node", ...args]);
};

const runMainCompose = async (args: string[]) => {
  const composeRunner = await resolveComposeRunner();
  return runCommand(composeRunner.command, [...composeRunner.args, "-f", mainComposeFile, ...args]);
};

const runDocker = (args: string[]) =>
  runCommand("docker", args);

const getContainerRunningState = async (containerName: string): Promise<boolean> => {
  // Use `docker container inspect` so a same-named image does not match when
  // the API container has not been created yet.
  const result = await runDocker(["container", "inspect", "-f", "{{.State.Running}}", containerName]);

  if (!result.ok) {
    const missingContainer = result.stderr.includes("No such object") || result.stderr.includes("No such container");

    if (missingContainer) {
      return false;
    }

    throw new Error(`Failed to inspect container ${containerName}: ${result.stderr || result.message || "unknown error"}`);
  }

  return result.stdout.trim() === "true";
};

const buildHistoryRefreshSteps = async (exchange: string, symbol: string, coin: string, since: Date, until: Date): Promise<JobRunResult[]> => {
  const steps: JobRunResult[] = [
    await runBatchNode([
      "dist/jobs/clear-market-history.js",
      "--coin",
      coin,
      "--interval",
      "1m",
      "--source",
      exchange,
      "--after",
      since.toISOString(),
      "--before",
      until.toISOString()
    ])
  ];

  if (exchange === "hyperliquid") {
    steps.push(
      await runBatchNode([
        "dist/jobs/import-hyperliquid-day.js",
        "--coin",
        coin,
        "--interval",
        "1m",
        "--since",
        since.toISOString(),
        "--until",
        until.toISOString()
      ])
    );
    return steps;
  }

  if (exchange === "okx") {
    steps.push(
      await runBatchNode([
        "dist/jobs/import-okx-history.js",
        "--symbol",
        symbol,
        "--interval",
        "1m",
        "--since",
        since.toISOString(),
        "--until",
        until.toISOString()
      ])
    );
    return steps;
  }

  throw new Error(`Unsupported exchange: ${exchange}.`);
};

export class JobExecutor {
  listJobs(): JobDefinition[] {
    return definitions.filter((job) => job.adminVisible);
  }

  async run(jobId: JobRunnerJobId, input: JobRunInput = {}): Promise<JobRunResult> {
    switch (jobId) {
      case "db-migrate": {
        const migrationName = ensureMigrationName(input.migrationName);
        return runBatchShell(`pnpm exec prisma generate && pnpm exec prisma migrate dev --name ${migrationName}`);
      }
      case "db-push":
        return runBatchShell("pnpm exec prisma generate && pnpm exec prisma db push --accept-data-loss");
      case "db-seed":
        return runBatchShell("pnpm exec prisma generate && pnpm exec prisma db seed");
      case "db-clear-runtime-data":
        return runBatchShell("pnpm exec prisma generate && node prisma/clear-runtime-data.mjs");
      case "seed-symbol-configs":
        return runBatchShell("node prisma/seed-symbol-configs.mjs");
      case "db-bootstrap":
        return combineResults([
          await this.run("db-push"),
          await this.run("db-clear-runtime-data"),
          await this.run("db-seed"),
          await this.run("seed-symbol-configs")
        ]);
      case "batch-clear-kline": {
        const coin = ensureSafeCoin(input.coin);
        const interval = ensureSafeInterval(input.interval);

        return runBatchNode([
          "dist/jobs/clear-market-history.js",
          "--coin",
          coin,
          "--interval",
          interval,
          "--source",
          "hyperliquid"
        ]);
      }
      case "batch-import-hl-day": {
        const coin = ensureSafeCoin(input.coin);
        const date = ensureSafeDate(input.date);

        return runBatchNode([
          "dist/jobs/import-hyperliquid-day.js",
          "--coin",
          coin,
          ...(date ? ["--date", date] : [])
        ]);
      }
      case "batch-refresh-hl-day": {
        const coin = ensureSafeCoin(input.coin);
        const until = new Date();
        const since = new Date(until.getTime() - (24 * 60 * 60 * 1000));
        const interval = "1m";
        const apiWasRunning = await getContainerRunningState(apiContainerName);
        const steps: JobRunResult[] = [];

        if (apiWasRunning) {
          steps.push(await runDocker(["stop", apiContainerName]));
        }

        steps.push(
          await runBatchNode([
            "dist/jobs/clear-market-history.js",
            "--coin",
            coin,
            "--interval",
            interval,
            "--source",
            "hyperliquid",
            "--after",
            since.toISOString(),
            "--before",
            until.toISOString()
          ])
        );

        steps.push(
          await runBatchNode([
            "dist/jobs/import-hyperliquid-day.js",
            "--coin",
            coin,
            "--interval",
            interval,
            "--since",
            since.toISOString(),
            "--until",
            until.toISOString()
          ])
        );

        if (apiWasRunning) {
          steps.push(await runDocker(["start", apiContainerName]));
        }

        return combineResults(steps);
      }
      case "batch-switch-active-symbol": {
        const exchange = ensureSafeExchange(input.exchange);
        const symbol = ensureSafeSymbol(input.symbol);
        const coin = ensureSafeCoin(symbol.replace(/-USD$/i, ""));
        const until = new Date();
        const since = new Date(until.getTime() - (24 * 60 * 60 * 1000));
        const steps: JobRunResult[] = [];
        const apiWasRunning = await getContainerRunningState(apiContainerName);

        steps.push(
          await runBatchNode([
            "dist/jobs/switch-active-symbol.js",
            "--exchange",
            exchange,
            "--symbol",
            symbol
          ])
        );

        steps.push(...await buildHistoryRefreshSteps(exchange, symbol, coin, since, until));

        if (apiWasRunning) {
          steps.push(await runDocker(["restart", apiContainerName]));
        } else {
          steps.push(await runMainCompose(["up", "-d", "api"]));
        }

        return combineResults(steps);
      }
      default:
        throw new Error(`Unsupported job: ${String(jobId)}`);
    }
  }
}
