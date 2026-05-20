import { Prisma } from "@prisma/client";
import type {
  AiTraderExecutionStatus,
  AiTraderExecutionTarget,
  AiTraderMemorySnapshot,
  AiTraderMode,
  AiTraderPlan,
  AiTraderPlanScore,
  AiTraderRuntimeTarget,
  AiTraderStrategySnapshot,
  AiTraderWakeReason,
  AiTraderWakeReport,
  AiTraderWakeStatus
} from "@stratium/shared";
import { prisma } from "./prisma-client.js";
import { TradingPersistenceRepository } from "./trading-persistence-repository.js";

type AiTraderPrismaDelegate = {
  upsert: (input: unknown) => Promise<unknown>;
  findMany?: (input: unknown) => Promise<unknown[]>;
  deleteMany?: (input?: unknown) => Promise<unknown>;
};

type AiTraderTransactionClient = {
  aiTraderWakeReport: AiTraderPrismaDelegate;
  aiTraderBotState: AiTraderPrismaDelegate;
  aiTraderMemory: AiTraderPrismaDelegate;
};

type AiTraderPrismaClient = AiTraderTransactionClient & {
  $transaction: <T>(callback: (client: AiTraderTransactionClient) => Promise<T>) => Promise<T>;
};

type AiTraderWakeReportRow = {
  wakeId: string;
  botId: string;
  accountId: string;
  mode: string;
  runtimeTarget: string;
  executionTarget: string;
  symbol: string;
  status: string;
  requestedAt?: Date | null;
  startedAt: Date;
  finishedAt: Date;
  reasons: string[];
  selectedCandidateId?: string | null;
  planSummary?: string | null;
  strategySnapshot?: unknown;
  plan?: unknown;
  memories?: unknown;
  score?: unknown;
  approvedActions: number;
  rejectedActions: number;
  executionResults?: unknown;
  errors: string[];
  marketSnapshot?: unknown;
  accountSnapshot?: unknown;
};

type AiTraderMemoryRow = {
  botId: string;
  accountId: string;
  memoryKey: string;
  value: string;
  importance?: number | null;
  source: string;
  lastSeenAt: Date;
  updatedAt: Date;
};

const aiTraderDb = prisma as unknown as AiTraderPrismaClient;

const toStoredJson = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;

const toNullableJson = (value: unknown): unknown =>
  value == null ? ((Prisma as { DbNull?: unknown }).DbNull ?? null) : toStoredJson(value);

const toIso = (value: Date | string | null | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

const toDate = (value: string | undefined): Date | null => {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const asJson = <T>(value: unknown): T | undefined => {
  if (value == null || value === (Prisma as { DbNull?: unknown }).DbNull) {
    return undefined;
  }
  return value as T;
};

const asJsonArray = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

const wakeReportRow = (report: AiTraderWakeReport) => ({
  wakeId: report.wakeId,
  botId: report.botId,
  accountId: report.accountId,
  mode: report.mode,
  runtimeTarget: report.runtimeTarget,
  executionTarget: report.executionTarget,
  symbol: report.symbol,
  status: report.status,
  requestedAt: toDate(report.requestedAt),
  startedAt: toDate(report.startedAt) ?? new Date(),
  finishedAt: toDate(report.finishedAt) ?? new Date(),
  reasons: report.reasons,
  selectedCandidateId: report.selectedCandidateId ?? null,
  planSummary: report.planSummary ?? null,
  strategySnapshot: toNullableJson(report.strategySnapshot),
  plan: toNullableJson(report.plan),
  memories: toStoredJson(report.memories),
  score: toNullableJson(report.score),
  approvedActions: report.approvedActions,
  rejectedActions: report.rejectedActions,
  executionResults: toStoredJson(report.executionResults),
  errors: report.errors,
  marketSnapshot: toNullableJson(report.marketSnapshot),
  accountSnapshot: toNullableJson(report.accountSnapshot),
  rawReport: toStoredJson(report)
});

const botStateRow = (report: AiTraderWakeReport) => ({
  botId: report.botId,
  accountId: report.accountId,
  mode: report.mode,
  runtimeTarget: report.runtimeTarget,
  executionTarget: report.executionTarget,
  symbol: report.symbol,
  status: report.status,
  lastWakeId: report.wakeId,
  lastWakeAt: toDate(report.finishedAt),
  lastWakeStatus: report.status,
  lastWakeReasons: report.reasons,
  selectedCandidateId: report.selectedCandidateId ?? null,
  planSummary: report.planSummary ?? null,
  strategySnapshot: toNullableJson(report.strategySnapshot),
  plan: toNullableJson(report.plan),
  score: toNullableJson(report.score),
  approvedActions: report.approvedActions,
  rejectedActions: report.rejectedActions,
  errorCount: report.errors.length,
  marketSnapshot: toNullableJson(report.marketSnapshot),
  accountSnapshot: toNullableJson(report.accountSnapshot)
});

const memoryRow = (report: AiTraderWakeReport, memory: AiTraderMemorySnapshot) => ({
  botId: report.botId,
  accountId: report.accountId,
  memoryKey: memory.key,
  value: memory.value,
  importance: memory.importance ?? null,
  source: memory.source ?? "runtime",
  lastSeenAt: toDate(memory.updatedAt) ?? toDate(report.finishedAt) ?? new Date()
});

const rowToWakeReport = (row: AiTraderWakeReportRow): AiTraderWakeReport => ({
  schemaVersion: "stratium.ai-trader-wake-report.v1",
  wakeId: row.wakeId,
  botId: row.botId,
  accountId: row.accountId,
  mode: row.mode as AiTraderMode,
  runtimeTarget: row.runtimeTarget as AiTraderRuntimeTarget,
  executionTarget: row.executionTarget as AiTraderExecutionTarget,
  symbol: row.symbol,
  status: row.status as AiTraderWakeStatus,
  requestedAt: toIso(row.requestedAt),
  startedAt: toIso(row.startedAt) ?? new Date().toISOString(),
  finishedAt: toIso(row.finishedAt) ?? new Date().toISOString(),
  reasons: row.reasons as AiTraderWakeReason[],
  selectedCandidateId: row.selectedCandidateId ?? undefined,
  planSummary: row.planSummary ?? undefined,
  strategySnapshot: asJson<AiTraderStrategySnapshot>(row.strategySnapshot),
  plan: asJson<AiTraderPlan>(row.plan),
  memories: asJsonArray<AiTraderMemorySnapshot>(row.memories),
  score: asJson<AiTraderPlanScore>(row.score),
  approvedActions: row.approvedActions,
  rejectedActions: row.rejectedActions,
  executionResults: asJsonArray<{
    actionType: string;
    status: AiTraderExecutionStatus;
    message?: string;
  }>(row.executionResults),
  errors: row.errors,
  marketSnapshot: asJson<AiTraderWakeReport["marketSnapshot"]>(row.marketSnapshot),
  accountSnapshot: asJson<AiTraderWakeReport["accountSnapshot"]>(row.accountSnapshot)
});

export class AiTraderPersistenceRepository extends TradingPersistenceRepository {
  async upsertAiTraderWakeReport(report: AiTraderWakeReport): Promise<void> {
    const wake = wakeReportRow(report);
    const state = botStateRow(report);

    await aiTraderDb.$transaction(async (transactionClient) => {
      await transactionClient.aiTraderWakeReport.upsert({
        where: { wakeId: report.wakeId },
        update: wake,
        create: wake
      });
      await transactionClient.aiTraderBotState.upsert({
        where: { botId: report.botId },
        update: state,
        create: state
      });

      for (const memory of report.memories) {
        await transactionClient.aiTraderMemory.upsert({
          where: {
            botId_memoryKey: {
              botId: report.botId,
              memoryKey: memory.key
            }
          },
          update: memoryRow(report, memory),
          create: memoryRow(report, memory)
        });
      }
    });
  }

  async listAiTraderWakeReports(input: {
    botId?: string;
    accountId?: string;
    limit?: number;
  } = {}): Promise<AiTraderWakeReport[]> {
    const rows = await aiTraderDb.aiTraderWakeReport.findMany?.({
      where: {
        ...(input.botId ? { botId: input.botId } : {}),
        ...(input.accountId ? { accountId: input.accountId } : {})
      },
      orderBy: [
        { finishedAt: "desc" },
        { wakeId: "desc" }
      ],
      take: input.limit ?? 1_000
    }) ?? [];

    return rows.map((row) => rowToWakeReport(row as AiTraderWakeReportRow));
  }

  async listAiTraderMemories(input: {
    botId: string;
    accountId?: string;
    limit?: number;
  }): Promise<AiTraderMemorySnapshot[]> {
    const rows = await aiTraderDb.aiTraderMemory.findMany?.({
      where: {
        botId: input.botId,
        ...(input.accountId ? { accountId: input.accountId } : {})
      },
      orderBy: [
        { importance: "desc" },
        { lastSeenAt: "desc" },
        { memoryKey: "asc" }
      ],
      take: input.limit ?? 200
    }) ?? [];

    return rows.map((row) => {
      const memory = row as AiTraderMemoryRow;
      return {
        key: memory.memoryKey,
        value: memory.value,
        importance: memory.importance ?? undefined,
        updatedAt: toIso(memory.lastSeenAt ?? memory.updatedAt),
        source: memory.source as AiTraderMemorySnapshot["source"]
      };
    });
  }
}
