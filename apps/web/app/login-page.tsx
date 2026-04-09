"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  authHeaders,
  clearStoredToken,
  getStoredLocale,
  getStoredToken,
  publicHeaders,
  setStoredLocale,
  setStoredToken,
  type AppLocale,
  type AuthUser,
  type PlatformSettings
} from "./auth-client";
import { getUiText } from "./i18n";
import { LoginPanel } from "./login-panel";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export function FrontendLoginPage() {
  const router = useRouter();
  const [platform, setPlatform] = useState<PlatformSettings | null>(null);
  const [locale, setLocale] = useState<AppLocale>("en");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const ui = getUiText(locale);

  useEffect(() => {
    const storedLocale = getStoredLocale();
    setLocale(storedLocale);
    const storedToken = getStoredToken("frontend");

    if (!storedToken) {
      setBusy(false);
      return;
    }

    void loadSession(storedToken, storedLocale);
  }, []);

  const loadSession = async (candidateToken: string, nextLocale = locale) => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/auth/me`, {
        headers: authHeaders(candidateToken, nextLocale),
        cache: "no-store"
      });

      if (!response.ok) {
        clearStoredToken("frontend");
        setBusy(false);
        return;
      }

      const payload = await response.json() as { user: AuthUser; platform: PlatformSettings };

      if (payload.user.role !== "frontend") {
        clearStoredToken("frontend");
        setBusy(false);
        return;
      }

      router.replace("/trade");
    } catch {
      setError(ui.login.failedReachApi);
    } finally {
      setBusy(false);
    }
  };

  const login = async (credentials: { username: string; password: string; role: "frontend" | "admin" }) => {
    setBusy(true);
    setError("");

    try {
      const response = await fetch(`${apiBaseUrl}/api/auth/login`, {
        method: "POST",
        headers: publicHeaders(locale, { "Content-Type": "application/json" }),
        body: JSON.stringify(credentials)
      });
      const payload = await response.json() as { token?: string; user?: AuthUser; platform?: PlatformSettings; message?: string };

      if (!response.ok || !payload.token || !payload.user || payload.user.role !== "frontend") {
        setError(payload.message ?? ui.login.failedLogin);
        return;
      }

      setStoredToken("frontend", payload.token);
      setPlatform(payload.platform ?? null);
      router.replace("/trade");
    } catch {
      setError(ui.login.failedLogin);
    } finally {
      setBusy(false);
    }
  };

  return (
    <LoginPanel
      role="frontend"
      title={ui.login.traderTitle}
      subtitle={ui.login.traderSubtitle}
      platform={platform}
      locale={locale}
      onLocaleChange={(nextLocale) => {
        setLocale(nextLocale);
        setStoredLocale(nextLocale);
      }}
      busy={busy}
      error={error}
      onSubmit={login}
    />
  );
}
