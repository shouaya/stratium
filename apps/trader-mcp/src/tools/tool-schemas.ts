import { z } from "zod";

export const groupingSchema = z.enum(["na", "normalTpsl", "positionTpsl"]);

export const triggerSchema = z.object({
  isMarket: z.boolean(),
  triggerPx: z.string(),
  tpsl: z.enum(["tp", "sl"])
});

export const placeOrderSchema = {
  asset: z.number().optional(),
  isBuy: z.boolean(),
  price: z.string(),
  size: z.string(),
  reduceOnly: z.boolean().optional(),
  tif: z.enum(["Gtc", "Ioc"]).optional(),
  cloid: z.string().optional(),
  grouping: groupingSchema.optional(),
  trigger: triggerSchema.optional()
};

export const modifyOrderSchema = {
  oid: z.number(),
  asset: z.number().optional(),
  isBuy: z.boolean(),
  price: z.string(),
  size: z.string(),
  reduceOnly: z.boolean().optional(),
  tif: z.enum(["Gtc", "Ioc"]).optional(),
  cloid: z.string().optional(),
  trigger: triggerSchema.optional()
};

export const traderBotWakeReportSchema = {
  wakeId: z.string(),
  botId: z.string(),
  mode: z.string(),
  runtimeTarget: z.string().optional(),
  executionTarget: z.string().optional(),
  symbol: z.string(),
  status: z.string(),
  requestedAt: z.string().optional(),
  startedAt: z.string(),
  finishedAt: z.string(),
  reasons: z.array(z.string()).default([]),
  selectedCandidateId: z.string().optional(),
  planSummary: z.string().optional(),
  strategySnapshot: z.record(z.unknown()).optional(),
  plan: z.record(z.unknown()).optional(),
  memories: z.array(z.record(z.unknown())).default([]),
  score: z.record(z.unknown()).optional(),
  approvedActions: z.number().int().nonnegative().default(0),
  rejectedActions: z.number().int().nonnegative().default(0),
  executionResults: z.array(z.object({
    actionType: z.string(),
    status: z.string(),
    message: z.string().optional()
  })).default([]),
  errors: z.array(z.string()).default([]),
  marketSnapshot: z.record(z.unknown()).optional(),
  accountSnapshot: z.record(z.unknown()).optional()
};
