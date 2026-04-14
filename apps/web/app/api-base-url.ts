"use client";

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, "");
const LOCAL_API_BASE_URL_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

const isLocalBrowserOrigin = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }

  return /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
};

export const resolveApiBaseUrl = (): string => {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();

  if (!configured) {
    return "";
  }

  // In deployed same-origin setups, a leftover localhost value would point to
  // the end user's own machine. Fall back to relative /api and /ws instead.
  if (LOCAL_API_BASE_URL_PATTERN.test(configured) && !isLocalBrowserOrigin()) {
    return "";
  }

  return trimTrailingSlash(configured);
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
