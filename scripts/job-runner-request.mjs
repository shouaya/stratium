const [, , jobId, ...restArgs] = process.argv;

if (!jobId) {
  console.error("Usage: node scripts/job-runner-request.mjs <jobId> [key=value ...]");
  process.exit(1);
}

const baseUrl = process.env.JOB_RUNNER_BASE_URL || "http://127.0.0.1:4300";
const token = process.env.JOB_RUNNER_TOKEN || "stratium-local-runner";

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

const response = await fetch(`${baseUrl}/jobs/run`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`
  },
  body: JSON.stringify(payload)
});

const result = await response.json().catch(() => ({
  ok: false,
  message: `Request failed with HTTP ${response.status}.`
}));

const statusLabel = result.ok ? "success" : "failed";

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
