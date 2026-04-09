"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  authHeaders,
  clearStoredToken,
  getStoredLocale,
  getStoredToken,
  setStoredLocale,
  type AppLocale,
  type AuthUser,
  type PlatformSettings
} from "./auth-client";
import { getUiText } from "./i18n";
import { TradingDashboard } from "./trading-dashboard";
import { buildApiUrl, resolveApiBaseUrl } from "./api-base-url";

const apiBaseUrl = resolveApiBaseUrl();

export function TradePage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [locale, setLocale] = useState<AppLocale>("en");
  const [busy, setBusy] = useState(true);
  const ui = getUiText(locale);

  useEffect(() => {
    const storedLocale = getStoredLocale();
    setLocale(storedLocale);
    const storedToken = getStoredToken("frontend");

    if (!storedToken) {
      router.replace("/login");
      return;
    }

    void loadSession(storedToken, storedLocale);
  }, [router]);

  const loadSession = async (candidateToken: string, nextLocale = locale) => {
    try {
      const response = await fetch(buildApiUrl(apiBaseUrl, "/api/auth/me"), {
        headers: authHeaders(candidateToken, nextLocale),
        cache: "no-store"
      });

      if (!response.ok) {
        clearStoredToken("frontend");
        router.replace("/login");
        return;
      }

      const payload = await response.json() as { user: AuthUser; platform: PlatformSettings };

      if (payload.user.role !== "frontend") {
        clearStoredToken("frontend");
        router.replace("/login");
        return;
      }

      setToken(candidateToken);
      setUser(payload.user);
    } catch {
      clearStoredToken("frontend");
      router.replace("/login");
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    const currentToken = token;
    clearStoredToken("frontend");
    setToken(null);
    setUser(null);
    router.replace("/login");

    if (!currentToken) {
      return;
    }

    await fetch(buildApiUrl(apiBaseUrl, "/api/auth/logout"), {
      method: "POST",
      headers: authHeaders(currentToken, locale)
    }).catch(() => undefined);
  };

  if (!token || !user) {
    return (
      <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", color: "#dbe7ef", background: "#071116", fontFamily: "\"Segoe UI\", sans-serif" }}>
        <div>{busy ? ui.login.signingIn : ui.trader.loginRequired}</div>
      </main>
    );
  }

  return (
    <TradingDashboard
      apiBaseUrl={apiBaseUrl}
      authToken={token}
      viewer={user}
      locale={locale}
      onLocaleChange={(nextLocale) => {
        setLocale(nextLocale);
        setStoredLocale(nextLocale);
      }}
      onLogout={() => void logout()}
    />
  );
}
