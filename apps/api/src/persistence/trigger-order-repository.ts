import { prisma } from "../persistence/prisma-client.js";
import { AuthRepository } from "../auth/auth-repository.js";

const toNumber = (value: { toString(): string } | number): number => Number(value.toString());
const triggerOrderRowId = (accountId: string, oid: number): string => `${accountId}:trigger:${oid}`;

export interface TriggerOrderHistoryRecord {
  oid: number;
  accountId: string;
  asset: number;
  isBuy: boolean;
  triggerPx: number;
  actualTriggerPx?: number;
  isMarket: boolean;
  tpsl: "tp" | "sl";
  size: number;
  limitPx?: number;
  reduceOnly: boolean;
  cloid?: string;
  status: "waitingForParent" | "triggerPending" | "triggered" | "filled" | "canceled";
  createdAt: number;
  updatedAt: number;
}

export interface PendingTriggerOrder {
  oid: number;
  accountId: string;
  asset: number;
  isBuy: boolean;
  triggerPx: number;
  isMarket: boolean;
  tpsl: "tp" | "sl";
  size: number;
  limitPx?: number;
  reduceOnly: boolean;
  cloid?: string;
  createdAt: number;
}

export class TriggerOrderRepository extends AuthRepository {
  async getNextTriggerOrderOid(base = 1_000_000_000): Promise<number> {
    const latest = await prisma.triggerOrderHistory.findFirst({
      orderBy: { oid: "desc" },
      select: { oid: true }
    });

    return Math.max(base, latest?.oid ?? base) + 1;
  }

  async upsertTriggerOrderHistory(input: {
    oid: number;
    accountId: string;
    asset: number;
    isBuy: boolean;
    triggerPx: number;
    actualTriggerPx?: number | null;
    isMarket: boolean;
    tpsl: "tp" | "sl";
    size: number;
    limitPx?: number | null;
    reduceOnly: boolean;
    cloid?: string;
    status: string;
    createdAt?: number;
    updatedAt?: number;
  }): Promise<void> {
    await prisma.triggerOrderHistory.upsert({
      where: { oid: input.oid },
      update: {
        asset: input.asset,
        isBuy: input.isBuy,
        triggerPx: input.triggerPx,
        actualTriggerPx: input.actualTriggerPx ?? null,
        isMarket: input.isMarket,
        tpsl: input.tpsl,
        size: input.size,
        limitPx: input.limitPx ?? null,
        reduceOnly: input.reduceOnly,
        cloid: input.cloid ?? null,
        status: input.status,
        updatedAt: new Date(input.updatedAt ?? Date.now())
      },
      create: {
        id: triggerOrderRowId(input.accountId, input.oid),
        oid: input.oid,
        accountId: input.accountId,
        asset: input.asset,
        isBuy: input.isBuy,
        triggerPx: input.triggerPx,
        actualTriggerPx: input.actualTriggerPx ?? null,
        isMarket: input.isMarket,
        tpsl: input.tpsl,
        size: input.size,
        limitPx: input.limitPx ?? null,
        reduceOnly: input.reduceOnly,
        cloid: input.cloid ?? null,
        status: input.status,
        createdAt: new Date(input.createdAt ?? Date.now()),
        updatedAt: new Date(input.updatedAt ?? Date.now())
      }
    });
  }

  async listTriggerOrderHistory(accountId: string): Promise<TriggerOrderHistoryRecord[]> {
    const rows = await prisma.triggerOrderHistory.findMany({
      where: { accountId },
      orderBy: { updatedAt: "desc" }
    });

    return rows.map((row) => ({
      oid: row.oid,
      accountId: row.accountId,
      asset: row.asset,
      isBuy: row.isBuy,
      triggerPx: toNumber(row.triggerPx),
      actualTriggerPx: row.actualTriggerPx == null ? undefined : toNumber(row.actualTriggerPx),
      isMarket: row.isMarket,
      tpsl: row.tpsl as "tp" | "sl",
      size: toNumber(row.size),
      limitPx: row.limitPx == null ? undefined : toNumber(row.limitPx),
      reduceOnly: row.reduceOnly,
      cloid: row.cloid ?? undefined,
      status: row.status as TriggerOrderHistoryRecord["status"],
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime()
    }));
  }

  async listPendingTriggerOrders(): Promise<PendingTriggerOrder[]> {
    const rows = await prisma.triggerOrderHistory.findMany({
      where: { status: "triggerPending" },
      orderBy: { createdAt: "asc" }
    });

    return rows.map((row) => ({
      oid: row.oid,
      accountId: row.accountId,
      asset: row.asset,
      isBuy: row.isBuy,
      triggerPx: toNumber(row.triggerPx),
      isMarket: row.isMarket,
      tpsl: row.tpsl as "tp" | "sl",
      size: toNumber(row.size),
      limitPx: row.limitPx == null ? undefined : toNumber(row.limitPx),
      reduceOnly: row.reduceOnly,
      cloid: row.cloid ?? undefined,
      createdAt: row.createdAt.getTime()
    }));
  }

  async findTriggerOrder(accountId: string, oidOrCloid: number | string): Promise<TriggerOrderHistoryRecord | null> {
    const row = typeof oidOrCloid === "string" && oidOrCloid.startsWith("0x")
      ? await prisma.triggerOrderHistory.findFirst({ where: { accountId, cloid: oidOrCloid } })
      : await prisma.triggerOrderHistory.findFirst({ where: { accountId, oid: Number(oidOrCloid) } });

    if (!row) {
      return null;
    }

    return {
      oid: row.oid,
      accountId: row.accountId,
      asset: row.asset,
      isBuy: row.isBuy,
      triggerPx: toNumber(row.triggerPx),
      actualTriggerPx: row.actualTriggerPx == null ? undefined : toNumber(row.actualTriggerPx),
      isMarket: row.isMarket,
      tpsl: row.tpsl as "tp" | "sl",
      size: toNumber(row.size),
      limitPx: row.limitPx == null ? undefined : toNumber(row.limitPx),
      reduceOnly: row.reduceOnly,
      cloid: row.cloid ?? undefined,
      status: row.status as TriggerOrderHistoryRecord["status"],
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime()
    };
  }
}
