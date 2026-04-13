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
