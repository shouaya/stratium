import { randomUUID } from "node:crypto";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { createClient } from "@redis/client";
import { JobExecutor, type JobRunInput, type JobRunResult, type JobRunnerJobId } from "./job-executor";

const port = Number(process.env.JOB_RUNNER_PORT ?? 4300);
const host = process.env.JOB_RUNNER_HOST ?? "127.0.0.1";
const authToken = process.env.JOB_RUNNER_TOKEN?.trim() || "stratium-local-runner";
const redisUrl = process.env.REDIS_URL?.trim() || "redis://127.0.0.1:6379";

const app = Fastify({ logger: true });
const executor = new JobExecutor();
const redis = createClient({ url: redisUrl });

type JobExecutionStatus = "running" | "success" | "failed";

type JobExecution = {
  executionId: string;
  jobId: JobRunnerJobId;
  status: JobExecutionStatus;
  startedAt: string;
  finishedAt?: string;
  input: JobRunInput;
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  code?: number;
  ok?: boolean;
  message?: string;
};

const RUNNING_SET_KEY = "stratium:batch:running";
const LAST_EXECUTION_KEY = "stratium:batch:last-execution";
const EVENTS_CHANNEL = "stratium:batch:events";
const executionKey = (executionId: string) => `stratium:batch:execution:${executionId}`;

const isAuthorized = (authorization: string | undefined): boolean => {
  if (!authToken) {
    return true;
  }

  return authorization === `Bearer ${authToken}`;
};

const saveExecution = async (execution: JobExecution): Promise<void> => {
  const key = executionKey(execution.executionId);
  await redis.set(key, JSON.stringify(execution));

  if (execution.status === "running") {
    await redis.sAdd(RUNNING_SET_KEY, execution.executionId);
  } else {
    await redis.sRem(RUNNING_SET_KEY, execution.executionId);
    await redis.set(LAST_EXECUTION_KEY, execution.executionId);
  }

  await redis.publish(EVENTS_CHANNEL, JSON.stringify(execution));
};

const getExecution = async (executionId: string): Promise<JobExecution | null> => {
  const payload = await redis.get(executionKey(executionId));
  return payload ? JSON.parse(payload) as JobExecution : null;
};

const listRunningExecutions = async (): Promise<JobExecution[]> => {
  const executionIds = await redis.sMembers(RUNNING_SET_KEY);
  const executions = await Promise.all(executionIds.map((executionId: string) => getExecution(executionId)));
  return executions.filter((execution: JobExecution | null): execution is JobExecution => Boolean(execution));
};

const failStaleRunningExecutions = async (): Promise<void> => {
  const staleExecutions = await listRunningExecutions();

  for (const execution of staleExecutions) {
    await saveExecution({
      ...execution,
      status: "failed",
      finishedAt: new Date().toISOString(),
      code: 1,
      ok: false,
      stderr: execution.stderr || "Job runner restarted before the job finished.",
      message: execution.message || "Job runner restarted before the job finished."
    });
  }
};

app.get("/health", async () => ({
  ok: true,
  service: "job-runner"
}));

app.get("/jobs", async (request: FastifyRequest, reply: FastifyReply) => {
  if (!isAuthorized(request.headers.authorization)) {
    return reply.code(401).send({ message: "Unauthorized." });
  }

  return {
    jobs: executor.listJobs()
  };
});

app.get("/jobs/running", async (request: FastifyRequest, reply: FastifyReply) => {
  if (!isAuthorized(request.headers.authorization)) {
    return reply.code(401).send({ message: "Unauthorized." });
  }

  return {
    jobs: await listRunningExecutions()
  };
});

app.get("/jobs/:executionId", async (request: FastifyRequest, reply: FastifyReply) => {
  if (!isAuthorized(request.headers.authorization)) {
    return reply.code(401).send({ message: "Unauthorized." });
  }

  const params = request.params as { executionId?: string };
  const executionId = params.executionId?.trim();

  if (!executionId) {
    return reply.code(400).send({ message: "executionId is required." });
  }

  const execution = await getExecution(executionId);

  if (!execution) {
    return reply.code(404).send({ message: "Job execution not found." });
  }

  return execution;
});

app.get("/jobs/last", async (request: FastifyRequest, reply: FastifyReply) => {
  if (!isAuthorized(request.headers.authorization)) {
    return reply.code(401).send({ message: "Unauthorized." });
  }

  const executionId = await redis.get(LAST_EXECUTION_KEY);

  if (!executionId) {
    return {
      execution: null
    };
  }

  return {
    execution: await getExecution(executionId)
  };
});

app.post("/jobs/run", async (request: FastifyRequest, reply: FastifyReply) => {
  if (!isAuthorized(request.headers.authorization)) {
    return reply.code(401).send({ message: "Unauthorized." });
  }

  const body = (request.body ?? {}) as JobRunInput & { jobId?: JobRunnerJobId };

  if (!body.jobId) {
    return reply.code(400).send({ message: "jobId is required." });
  }

  try {
    const executionId = randomUUID();
    const execution: JobExecution = {
      executionId,
      jobId: body.jobId,
      status: "running",
      startedAt: new Date().toISOString(),
      input: body,
      command: "",
      args: [],
      stdout: "",
      stderr: ""
    };

    await saveExecution(execution);

    void executor.run(body.jobId, body)
      .then(async (result: JobRunResult) => {
        await saveExecution({
          ...execution,
          status: result.ok ? "success" : "failed",
          finishedAt: new Date().toISOString(),
          command: result.command,
          args: result.args,
          stdout: result.stdout,
          stderr: result.stderr,
          code: result.code,
          ok: result.ok,
          message: result.message
        });
      })
      .catch(async (error) => {
        await saveExecution({
          ...execution,
          status: "failed",
          finishedAt: new Date().toISOString(),
          command: "",
          args: [],
          stdout: "",
          stderr: error instanceof Error ? error.message : "Job runner request failed.",
          code: 1,
          ok: false,
          message: error instanceof Error ? error.message : "Job runner request failed."
        });
      });

    return reply.code(202).send(execution);
  } catch (error) {
    return reply.code(400).send({
      executionId: "",
      status: "failed",
      ok: false,
      command: "",
      args: [],
      stdout: "",
      stderr: error instanceof Error ? error.message : "Job runner request failed.",
      code: 1,
      message: error instanceof Error ? error.message : "Job runner request failed."
    });
  }
});

await redis.connect();
await failStaleRunningExecutions();
await app.listen({ port, host });
