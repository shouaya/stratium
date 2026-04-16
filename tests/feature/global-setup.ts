import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadFeatureTestEnv } from "./env";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../..");

const run = (command: string, args: string[], options: { env?: NodeJS.ProcessEnv; stdio?: "pipe" | "inherit" } = {}) =>
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: options.stdio ?? "pipe",
    env: {
      ...process.env,
      ...options.env
    }
  });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const dockerContainerExists = (name: string): boolean => {
  const output = run("docker", ["ps", "-a", "--filter", `name=^/${name}$`, "--format", "{{.Names}}"]);
  return output.toString("utf8").trim() === name;
};

const waitForDatabaseReady = async (containerName: string, databaseName: string): Promise<void> => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      run("docker", ["exec", containerName, "pg_isready", "-U", "postgres", "-d", databaseName]);
      return;
    } catch {
      await sleep(1_000);
    }
  }

  throw new Error(`Feature test database ${databaseName} did not become ready in time.`);
};

export default async function globalSetup() {
  loadFeatureTestEnv();

  const containerName = process.env.FEATURE_TEST_DB_CONTAINER_NAME ?? "stratium-feature-test-db";
  const port = process.env.FEATURE_TEST_DB_PORT ?? "55432";
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for feature tests.");
  }

  const databaseName = new URL(databaseUrl).pathname.replace(/^\//, "") || "stratium_feature_test";

  if (dockerContainerExists(containerName)) {
    run("docker", ["rm", "-f", containerName], { stdio: "inherit" });
  }

  run("docker", [
    "run",
    "--detach",
    "--rm",
    "--name",
    containerName,
    "--publish",
    `${port}:5432`,
    "--env",
    "POSTGRES_USER=postgres",
    "--env",
    "POSTGRES_PASSWORD=postgres",
    "--env",
    `POSTGRES_DB=${databaseName}`,
    "postgres:16-alpine"
  ], { stdio: "inherit" });

  await waitForDatabaseReady(containerName, databaseName);

  run("pnpm", ["exec", "prisma", "db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
    env: {
      DATABASE_URL: databaseUrl
    },
    stdio: "inherit"
  });

  return async () => {
    if (dockerContainerExists(containerName)) {
      run("docker", ["rm", "-f", containerName], { stdio: "inherit" });
    }
  };
}
