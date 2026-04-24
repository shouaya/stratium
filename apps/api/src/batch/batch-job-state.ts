import { createClient, type RedisClientType } from "@redis/client";
import type { BatchJobExecution } from "./batch-job-runner.js";

const redisUrl = process.env.REDIS_URL?.trim() || "redis://redis:6379";
const RUNNING_SET_KEY = "stratium:batch:running";
const LAST_EXECUTION_KEY = "stratium:batch:last-execution";
const EVENTS_CHANNEL = "stratium:batch:events";
const executionKey = (executionId: string) => `stratium:batch:execution:${executionId}`;
const isBatchJobStateFeedDisabled = (): boolean => process.env.DISABLE_BATCH_JOB_STATE_FEED === "true";

const parseExecution = (value: string | null): BatchJobExecution | null => value ? JSON.parse(value) as BatchJobExecution : null;

export class BatchJobStateFeed {
  private readonly client?: RedisClientType;
  private readonly subscriber?: RedisClientType;
  private runningJobs: BatchJobExecution[] = [];
  private lastExecution: BatchJobExecution | null = null;

  constructor(private readonly onUpdate: () => void) {
    if (isBatchJobStateFeedDisabled()) {
      return;
    }

    this.client = createClient({ url: redisUrl });
    this.subscriber = createClient({ url: redisUrl });
  }

  async connect(): Promise<void> {
    if (!this.client || !this.subscriber) {
      this.runningJobs = [];
      this.lastExecution = null;
      return;
    }

    await this.client.connect();
    await this.subscriber.connect();
    await this.refreshState();

    await this.subscriber.subscribe(EVENTS_CHANNEL, async (payload: string) => {
      const execution = parseExecution(payload);

      if (!execution) {
        return;
      }

      if (execution.status === "running") {
        this.runningJobs = [
          ...this.runningJobs.filter((entry) => entry.executionId !== execution.executionId),
          execution
        ];
      } else {
        this.runningJobs = this.runningJobs.filter((entry) => entry.executionId !== execution.executionId);
        this.lastExecution = execution;
      }

      this.onUpdate();
    });
  }

  async refreshState(): Promise<void> {
    if (!this.client) {
      this.runningJobs = [];
      this.lastExecution = null;
      return;
    }

    const client = this.client;
    const runningIds = await client.sMembers(RUNNING_SET_KEY);
    const runningPayloads = await Promise.all(runningIds.map((executionId: string) => client.get(executionKey(executionId))));
    this.runningJobs = runningPayloads
      .map((payload: string | null) => parseExecution(payload))
      .filter((execution: BatchJobExecution | null): execution is BatchJobExecution => Boolean(execution));

    const lastExecutionId = await client.get(LAST_EXECUTION_KEY);
    this.lastExecution = lastExecutionId ? parseExecution(await client.get(executionKey(lastExecutionId))) : null;
  }

  getRunningJobs(): BatchJobExecution[] {
    return this.runningJobs;
  }

  getLastExecution(): BatchJobExecution | null {
    return this.lastExecution;
  }

  async shutdown(): Promise<void> {
    await this.subscriber?.quit();
    await this.client?.quit();
  }
}
