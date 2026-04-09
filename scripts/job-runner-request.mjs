const [, , jobId, ...restArgs] = process.argv;

if (!jobId) {
  console.error("Usage: node scripts/job-runner-request.mjs <jobId> [key=value ...]");
  process.exit(1);
}

const baseUrl = process.env.JOB_RUNNER_BASE_URL || "http://127.0.0.1:4300";
const token = process.env.JOB_RUNNER_TOKEN || "stratium-local-runner";
const pollIntervalMs = Number(process.env.JOB_RUNNER_POLL_MS || 1000);
const pollTimeoutMs = Number(process.env.JOB_RUNNER_TIMEOUT_MS || 10 * 60 * 1000);

const payload = { jobId };

for (const rawArg of restArgs) {
  const [key, ...valueParts] = rawArg.split("=");
  const value = valueParts.join("=");

  if (!key || !value) {
    console.error(`Invalid arg: ${rawArg}. Expected key=value.`);
    process.exit(1);
  }

  payload[key] = value;
}

const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${token}`
};

const response = await fetch(`${baseUrl}/jobs/run`, {
  method: "POST",
  headers,
  body: JSON.stringify(payload)
});

const initialResult = await response.json().catch(() => ({
  ok: false,
  message: `Request failed with HTTP ${response.status}.`
}));

if (!response.ok) {
  console.log("status: failed");

  if (initialResult.message) {
    console.error(initialResult.message);
  }

  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let result = initialResult;

if (result.status === "running" && result.executionId) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < pollTimeoutMs) {
    await sleep(pollIntervalMs);

    const pollResponse = await fetch(`${baseUrl}/jobs/${result.executionId}`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!pollResponse.ok) {
      console.log("status: failed");
      console.error(`Failed to poll job status: HTTP ${pollResponse.status}`);
      process.exit(1);
    }

    result = await pollResponse.json();

    if (result.status === "success" || result.status === "failed") {
      break;
    }
  }
}

if (result.status === "running") {
  console.log("status: failed");
  console.error(`Job did not finish within ${pollTimeoutMs}ms.`);
  process.exit(1);
}

const statusLabel = result.status === "success" || result.ok ? "success" : "failed";

console.log(`status: ${statusLabel}`);

if (result.command) {
  console.log(`command: ${result.command}`);
}

if (Array.isArray(result.args) && result.args.length > 0) {
  console.log(`args: ${result.args.join(" ")}`);
}

if (result.stdout) {
  console.log("\nstdout:");
  console.log(result.stdout);
}

if (result.stderr) {
  console.error("\nstderr:");
  console.error(result.stderr);
}

if (!response.ok || !result.ok) {
  process.exit(1);
}
