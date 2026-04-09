"use client";

export type AuthRole = "frontend" | "admin";
export type AppLocale = "zh" | "ja" | "en";

export type AuthUser = {
  id: string;
  username: string;
  role: AuthRole;
  displayName: string;
  tradingAccountId: string | null;
  isActive: boolean;
};

export type PlatformSettings = {
  platformName: string;
  platformAnnouncement: string;
  allowFrontendTrading: boolean;
  allowManualTicks: boolean;
  allowSimulatorControl: boolean;
};

export const tokenStorageKey = (role: AuthRole) => `stratium.${role}.token`;
export const localeStorageKey = "stratium.locale";

export const normalizeLocale = (value?: string | null): AppLocale => {
  if (value === "zh" || value === "ja" || value === "en") {
    return value;
  }
  return "en";
};

export const detectBrowserLocale = (): AppLocale => {
  if (typeof window === "undefined") {
    return "en";
  }

  const language = window.navigator.language.toLowerCase();
  if (language.startsWith("zh")) {
    return "zh";
  }
  if (language.startsWith("ja")) {
    return "ja";
  }
  return "en";
};

export const getStoredLocale = (): AppLocale => {
  if (typeof window === "undefined") {
    return "en";
  }

  const stored = window.localStorage.getItem(localeStorageKey);
  return stored ? normalizeLocale(stored) : detectBrowserLocale();
};

export const setStoredLocale = (locale: AppLocale): void => {
  window.localStorage.setItem(localeStorageKey, locale);
};

export const getStoredToken = (role: AuthRole): string | null => {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(tokenStorageKey(role));
};

export const setStoredToken = (role: AuthRole, token: string): void => {
  window.localStorage.setItem(tokenStorageKey(role), token);
};

export const clearStoredToken = (role: AuthRole): void => {
  window.localStorage.removeItem(tokenStorageKey(role));
};

export const authHeaders = (token: string, locale: AppLocale, extra?: HeadersInit): HeadersInit => ({
  ...(extra ?? {}),
  Authorization: `Bearer ${token}`,
  "X-Stratium-Locale": locale
});

export const publicHeaders = (locale: AppLocale, extra?: HeadersInit): HeadersInit => ({
  ...(extra ?? {}),
  "X-Stratium-Locale": locale
});
