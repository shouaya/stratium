"use client";

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

export const resolveApiBaseUrl = (): string => {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  return configured ? trimTrailingSlash(configured) : "";
};

export const buildApiUrl = (apiBaseUrl: string, requestPath: string): string => {
  const normalizedPath = requestPath.startsWith("/") ? requestPath : `/${requestPath}`;
  return apiBaseUrl ? `${apiBaseUrl}${normalizedPath}` : normalizedPath;
};

export const buildWebSocketUrl = (apiBaseUrl: string, token: string): string => {
  const baseUrl = apiBaseUrl || (typeof window !== "undefined" ? window.location.origin : "");
  const wsBaseUrl = trimTrailingSlash(baseUrl).replace(/^http/, "ws");
  return `${wsBaseUrl}/ws?token=${encodeURIComponent(token)}`;
};
