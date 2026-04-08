"use client";

export type AuthRole = "frontend" | "admin";

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

export const authHeaders = (token: string, extra?: HeadersInit): HeadersInit => ({
  ...(extra ?? {}),
  Authorization: `Bearer ${token}`
});
