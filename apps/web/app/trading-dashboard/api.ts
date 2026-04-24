"use client";

import { authHeaders } from "../auth-client";
import { buildApiUrl } from "../api-base-url";
import type { AppLocale } from "../auth-client";
import type { BotCredentials, ExchangeResponsePayload, FillHistoryResponse, FrontendOpenOrder, HistoricalOrder, State } from "./types";

const canonicalStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalStringify(entry)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalStringify(entry)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
};

const toHex = (value: string): string =>
  Array.from(new TextEncoder().encode(value)).map((byte) => byte.toString(16).padStart(2, "0")).join("");

export const signBotPayload = async (apiSecret: string, payload: Record<string, unknown>): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(apiSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonicalStringify(payload)));
  return `0x${toHex(String.fromCharCode(...new Uint8Array(signature)))}`;
};

export const fetchDashboardSnapshot = async (
  apiBaseUrl: string,
  authToken: string,
  locale: AppLocale,
  tradingAccountId?: string | null
): Promise<{
  stateResponse: Response;
  fillHistoryResponse: Response;
  botCredentialsResponse: Response;
  openOrdersResponse: Response;
  orderHistoryResponse: Response;
  statePayload: State;
  fillHistoryPayload: FillHistoryResponse;
  credentialsPayload: BotCredentials | null;
  openOrdersPayload: FrontendOpenOrder[];
  orderHistoryPayload: HistoricalOrder[];
}> => {
  const [stateResponse, fillHistoryResponse, botCredentialsResponse, openOrdersResponse, orderHistoryResponse] = await Promise.all([
    fetch(buildApiUrl(apiBaseUrl, "/api/state"), { cache: "no-store", headers: authHeaders(authToken, locale) }),
    fetch(buildApiUrl(apiBaseUrl, "/api/fill-history"), { cache: "no-store", headers: authHeaders(authToken, locale) }),
    fetch(buildApiUrl(apiBaseUrl, "/api/bot-credentials"), { cache: "no-store", headers: authHeaders(authToken, locale) }),
    fetch(buildApiUrl(apiBaseUrl, "/api/info"), {
      method: "POST",
      cache: "no-store",
      headers: authHeaders(authToken, locale, { "Content-Type": "application/json" }),
      body: JSON.stringify({ type: "frontendOpenOrders", user: tradingAccountId ?? undefined })
    }),
    fetch(buildApiUrl(apiBaseUrl, "/api/order-history"), { cache: "no-store", headers: authHeaders(authToken, locale) })
  ]);

  const statePayload = await stateResponse.json() as State;
  const fillHistoryPayload = await fillHistoryResponse.json() as FillHistoryResponse;
  const credentialsPayload = await botCredentialsResponse.json().catch(() => null) as BotCredentials | null;
  const openOrdersRaw = await openOrdersResponse.json().catch(() => []) as unknown;
  const openOrdersPayload = Array.isArray(openOrdersRaw) ? openOrdersRaw as FrontendOpenOrder[] : [];
  const orderHistoryRaw = await orderHistoryResponse.json().catch(() => []) as unknown;
  const orderHistoryPayload = Array.isArray(orderHistoryRaw) ? orderHistoryRaw as HistoricalOrder[] : [];

  return {
    stateResponse,
    fillHistoryResponse,
    botCredentialsResponse,
    openOrdersResponse,
    orderHistoryResponse,
    statePayload,
    fillHistoryPayload,
    credentialsPayload,
    openOrdersPayload,
    orderHistoryPayload
  };
};

export const fetchOrderActivity = async (
  apiBaseUrl: string,
  authToken: string,
  locale: AppLocale,
  tradingAccountId?: string | null
): Promise<{
  openOrdersResponse: Response;
  orderHistoryResponse: Response;
  openOrdersPayload: FrontendOpenOrder[];
  orderHistoryPayload: HistoricalOrder[];
}> => {
  const [openOrdersResponse, orderHistoryResponse] = await Promise.all([
    fetch(buildApiUrl(apiBaseUrl, "/api/info"), {
      method: "POST",
      cache: "no-store",
      headers: authHeaders(authToken, locale, { "Content-Type": "application/json" }),
      body: JSON.stringify({ type: "frontendOpenOrders", user: tradingAccountId ?? undefined })
    }),
    fetch(buildApiUrl(apiBaseUrl, "/api/order-history"), { cache: "no-store", headers: authHeaders(authToken, locale) })
  ]);

  const openOrdersRaw = await openOrdersResponse.json().catch(() => []) as unknown;
  const openOrdersPayload = Array.isArray(openOrdersRaw) ? openOrdersRaw as FrontendOpenOrder[] : [];
  const orderHistoryRaw = await orderHistoryResponse.json().catch(() => []) as unknown;
  const orderHistoryPayload = Array.isArray(orderHistoryRaw) ? orderHistoryRaw as HistoricalOrder[] : [];

  return {
    openOrdersResponse,
    orderHistoryResponse,
    openOrdersPayload,
    orderHistoryPayload
  };
};

export const submitSignedExchangeRequest = async (input: {
  apiBaseUrl: string;
  authToken: string;
  locale: AppLocale;
  botCredentials: BotCredentials;
  body: Record<string, unknown>;
}) => {
  const signature = await signBotPayload(input.botCredentials.apiSecret, input.body);
  const response = await fetch(buildApiUrl(input.apiBaseUrl, "/api/exchange"), {
    method: "POST",
    headers: authHeaders(input.authToken, input.locale, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      ...input.body,
      signature: {
        r: input.botCredentials.signerAddress,
        s: signature,
        v: 27
      }
    })
  });
  const payload = await response.json().catch(() => ({})) as ExchangeResponsePayload;

  return {
    response,
    payload
  };
};

export const updateLeverageRequest = async (input: {
  apiBaseUrl: string;
  authToken: string;
  locale: AppLocale;
  symbol: string;
  leverage: number;
}) => {
  const response = await fetch(buildApiUrl(input.apiBaseUrl, "/api/leverage"), {
    method: "POST",
    headers: authHeaders(input.authToken, input.locale, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      symbol: input.symbol,
      leverage: input.leverage
    })
  });

  const payload = await response.json().catch(() => ({})) as { message?: string; symbolConfig?: State["symbolConfig"] };

  return {
    response,
    payload
  };
};
