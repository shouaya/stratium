import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { JobExecutor, type JobRunInput, type JobRunnerJobId } from "./job-executor";

const port = Number(process.env.JOB_RUNNER_PORT ?? 4300);
const host = process.env.JOB_RUNNER_HOST ?? "127.0.0.1";
const authToken = process.env.JOB_RUNNER_TOKEN?.trim() || "stratium-local-runner";

const app = Fastify({ logger: true });
const executor = new JobExecutor();

const isAuthorized = (authorization: string | undefined): boolean => {
  if (!authToken) {
    return true;
  }

  return authorization === `Bearer ${authToken}`;
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

app.post("/jobs/run", async (request: FastifyRequest, reply: FastifyReply) => {
  if (!isAuthorized(request.headers.authorization)) {
    return reply.code(401).send({ message: "Unauthorized." });
  }

  const body = (request.body ?? {}) as JobRunInput & { jobId?: JobRunnerJobId };

  if (!body.jobId) {
    return reply.code(400).send({ message: "jobId is required." });
  }

  try {
    const result = await executor.run(body.jobId, body);
    return reply.code(result.ok ? 202 : 500).send(result);
  } catch (error) {
    return reply.code(400).send({
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

await app.listen({ port, host });
