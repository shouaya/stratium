import type { AiTraderOrderSide, AiTraderOrderType, AiTraderPlan, AiTraderPlanAction, AiTraderPlanCandidate } from "@stratium/shared";

type ParsePlanOptions = {
  defaultSymbol?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown, path: string): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value.trim();
};

const asOptionalString = (value: unknown, path: string): string | undefined => {
  if (value == null || (typeof value === "string" && value.trim() === "")) {
    return undefined;
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
};

const asStringWithFallback = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;

const asSymbol = (value: unknown, path: string, options: ParsePlanOptions): string =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : asString(options.defaultSymbol, path);

const asNumber = (value: unknown, path: string): number => {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : Number.NaN;

  if (!Number.isFinite(parsed)) {
    throw new Error(`${path} must be a finite number`);
  }
  return parsed;
};

const asOptionalNumber = (value: unknown, path: string): number | undefined => {
  if (value == null) {
    return undefined;
  }
  return asNumber(value, path);
};

const asBoolean = (value: unknown, fallback: boolean): boolean => typeof value === "boolean" ? value : fallback;

const parseSide = (value: unknown, path: string): AiTraderOrderSide => {
  if (value === "buy" || value === "sell") {
    return value;
  }
  throw new Error(`${path} must be buy or sell`);
};

const parseOrderType = (value: unknown, path: string): AiTraderOrderType => {
  if (value === "market" || value === "limit") {
    return value;
  }
  throw new Error(`${path} must be market or limit`);
};

const parseTimeInForce = (value: unknown): "GTC" | "IOC" | undefined => {
  if (value == null || (typeof value === "string" && value.trim() === "")) {
    return undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (normalized === "GTC" || normalized === "GOOD_TIL_CANCEL" || normalized === "GOOD_TIL_CANCELLED" || normalized === "GOOD_TILL_CANCELLED") {
    return "GTC";
  }
  if (normalized === "IOC" || normalized === "IMMEDIATE_OR_CANCEL") {
    return "IOC";
  }
  return undefined;
};

const parseAction = (value: unknown, path: string, fallbackReason: string, options: ParsePlanOptions): AiTraderPlanAction => {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }

  const type = asString(value.type, `${path}.type`);
  const reason = asStringWithFallback(value.reason, fallbackReason);
  if (type === "observe") {
    return {
      type,
      reason
    };
  }

  if (type === "place_order") {
    const action: AiTraderPlanAction = {
      type,
      symbol: asSymbol(value.symbol, `${path}.symbol`, options),
      side: parseSide(value.side, `${path}.side`),
      orderType: parseOrderType(value.orderType, `${path}.orderType`),
      quantity: asNumber(value.quantity, `${path}.quantity`),
      price: asOptionalNumber(value.price, `${path}.price`),
      reduceOnly: asBoolean(value.reduceOnly, false),
      invalidationPrice: asOptionalNumber(value.invalidationPrice, `${path}.invalidationPrice`),
      takeProfitPrice: asOptionalNumber(value.takeProfitPrice, `${path}.takeProfitPrice`),
      reason
    };
    const timeInForce = parseTimeInForce(value.timeInForce);
    if (timeInForce != null) {
      action.timeInForce = timeInForce;
    }
    return action;
  }

  if (type === "cancel_order") {
    const orderId = asOptionalString(value.orderId, `${path}.orderId`);
    const clientOrderId = asOptionalString(value.clientOrderId, `${path}.clientOrderId`);
    if (!orderId && !clientOrderId) {
      return {
        type: "observe",
        reason: `Planner requested cancel_order without orderId/clientOrderId; observing instead. Original reason: ${reason}`
      };
    }

    return {
      type,
      symbol: asSymbol(value.symbol, `${path}.symbol`, options),
      orderId,
      clientOrderId,
      reason
    };
  }

  if (type === "reduce_position" || type === "close_position") {
    return {
      type,
      symbol: asSymbol(value.symbol, `${path}.symbol`, options),
      quantity: asOptionalNumber(value.quantity, `${path}.quantity`),
      reason
    };
  }

  throw new Error(`${path}.type is not an allowed action type`);
};

const parseCandidate = (value: unknown, index: number, options: ParsePlanOptions): AiTraderPlanCandidate => {
  const path = `candidates[${index}]`;
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }
  const actions = value.actions;
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new Error(`${path}.actions must be a non-empty array`);
  }
  const confidence = asNumber(value.confidence, `${path}.confidence`);
  if (confidence < 0 || confidence > 1) {
    throw new Error(`${path}.confidence must be between 0 and 1`);
  }
  const riskNotes = value.riskNotes == null
    ? undefined
    : Array.isArray(value.riskNotes)
      ? value.riskNotes.map((entry, noteIndex) => asString(entry, `${path}.riskNotes[${noteIndex}]`))
      : (() => {
          throw new Error(`${path}.riskNotes must be an array`);
        })();

  const thesis = asString(value.thesis, `${path}.thesis`);
  const fallbackReason = `Planner omitted action reason; using candidate thesis: ${thesis}`;

  return {
    id: asString(value.id, `${path}.id`),
    thesis,
    confidence,
    expectedReward: asOptionalNumber(value.expectedReward, `${path}.expectedReward`),
    riskNotes,
    actions: actions.map((entry, actionIndex) => parseAction(entry, `${path}.actions[${actionIndex}]`, fallbackReason, options))
  };
};

const extractJson = (raw: string): string => {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    return trimmed;
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1] != null) {
    return fenced[1].trim();
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }
  throw new Error("planner output did not contain JSON");
};

export const parsePlan = (input: string | AiTraderPlan, options: ParsePlanOptions = {}): AiTraderPlan => {
  const value = typeof input === "string" ? JSON.parse(extractJson(input)) as unknown : input;
  if (!isRecord(value)) {
    throw new Error("plan must be an object");
  }
  if (value.schemaVersion !== "stratium.ai-trader-plan.v1") {
    throw new Error("plan schemaVersion must be stratium.ai-trader-plan.v1");
  }
  const candidates = value.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error("plan candidates must be a non-empty array");
  }
  return {
    schemaVersion: "stratium.ai-trader-plan.v1",
    summary: asString(value.summary, "summary"),
    candidates: candidates.map((candidate, index) => parseCandidate(candidate, index, options))
  };
};
