import http from "node:http";
import https from "node:https";

const baseUrl = process.argv[2] || process.env.JOB_RUNNER_BASE_URL || "http://127.0.0.1:4300";
const healthUrl = new URL("/health", baseUrl);
const pollIntervalMs = Number(process.env.JOB_RUNNER_WAIT_POLL_MS || 2000);
const requestTimeoutMs = Number(process.env.JOB_RUNNER_WAIT_REQUEST_TIMEOUT_MS || 5000);
const timeoutMs = Number(process.env.JOB_RUNNER_WAIT_TIMEOUT_MS || 120000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const checkHealth = () =>
  new Promise((resolve) => {
    const client = healthUrl.protocol === "https:" ? https : http;
    let settled = false;

    const settle = (isHealthy) => {
      if (!settled) {
        settled = true;
        resolve(isHealthy);
      }
    };

    const request = client.request(
      healthUrl,
      {
        method: "GET",
        timeout: requestTimeoutMs
      },
      (response) => {
        response.resume();
        response.on("end", () => {
          settle(response.statusCode >= 200 && response.statusCode < 300);
        });
      }
    );

    request.on("timeout", () => {
      settle(false);
      request.destroy();
    });

    request.on("error", () => {
      settle(false);
    });

    request.end();
  });

const main = async () => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await checkHealth()) {
      return;
    }

    console.log("Waiting for job-runner...");
    await sleep(pollIntervalMs);
  }

  throw new Error(`Timed out waiting for job-runner at ${healthUrl.toString()}.`);
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
