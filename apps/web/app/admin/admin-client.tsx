"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminConsole } from "./admin-console";
import { LoginPanel } from "../login-panel";
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
} from "../auth-client";
import { getUiText } from "../i18n";
import { buildApiUrl, resolveApiBaseUrl } from "../api-base-url";

const apiBaseUrl = resolveApiBaseUrl();

export type AdminSection = "dashboard" | "users" | "platform" | "market" | "batch";

export function AdminProtectedPage({ section }: { section: AdminSection }) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [locale, setLocale] = useState<AppLocale>("en");
  const [busy, setBusy] = useState(true);
  const ui = getUiText(locale);

  useEffect(() => {
    const storedLocale = getStoredLocale();
    setLocale(storedLocale);
    const storedToken = getStoredToken("admin");

    if (!storedToken) {
      router.replace("/admin/login");
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
        clearStoredToken("admin");
        router.replace("/admin/login");
        return;
      }

      const payload = await response.json() as { user: AuthUser; platform: PlatformSettings };

      if (payload.user.role !== "admin") {
        clearStoredToken("admin");
        router.replace("/admin/login");
        return;
      }

      setToken(candidateToken);
      setUser(payload.user);
    } catch {
      clearStoredToken("admin");
      router.replace("/admin/login");
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    const currentToken = token;
    clearStoredToken("admin");
    setToken(null);
    setUser(null);
    router.replace("/admin/login");

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
    <AdminConsole
      apiBaseUrl={apiBaseUrl}
      authToken={token}
      viewer={user}
      locale={locale}
      currentSection={section}
      onLocaleChange={(nextLocale) => {
        setLocale(nextLocale);
        setStoredLocale(nextLocale);
      }}
      onLogout={() => void logout()}
    />
  );
}

export function AdminLoginPage() {
  const router = useRouter();
  const [platform, setPlatform] = useState<PlatformSettings | null>(null);
  const [locale, setLocale] = useState<AppLocale>("en");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const ui = getUiText(locale);

  useEffect(() => {
    const storedLocale = getStoredLocale();
    setLocale(storedLocale);
    const storedToken = getStoredToken("admin");

    if (!storedToken) {
      setBusy(false);
      return;
    }

    void loadSession(storedToken, storedLocale);
  }, []);

  const loadSession = async (candidateToken: string, nextLocale = locale) => {
    try {
      const response = await fetch(buildApiUrl(apiBaseUrl, "/api/auth/me"), {
        headers: authHeaders(candidateToken, nextLocale),
        cache: "no-store"
      });

      if (!response.ok) {
        clearStoredToken("admin");
        setBusy(false);
        return;
      }

      const payload = await response.json() as { user: AuthUser; platform: PlatformSettings };

      if (payload.user.role !== "admin") {
        clearStoredToken("admin");
        setBusy(false);
        return;
      }

      router.replace("/admin/dashboard");
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
      const response = await fetch(buildApiUrl(apiBaseUrl, "/api/auth/login"), {
        method: "POST",
        headers: publicHeaders(locale, { "Content-Type": "application/json" }),
        body: JSON.stringify(credentials)
      });
      const payload = await response.json() as { token?: string; user?: AuthUser; platform?: PlatformSettings; message?: string };

      if (!response.ok || !payload.token || !payload.user || payload.user.role !== "admin") {
        setError(payload.message ?? ui.login.failedLogin);
        return;
      }

      setStoredToken("admin", payload.token);
      setPlatform(payload.platform ?? null);
      router.replace("/admin/dashboard");
    } catch {
      setError(ui.login.failedLogin);
    } finally {
      setBusy(false);
    }
  };

  return (
    <LoginPanel
      role="admin"
      title={ui.login.adminTitle}
      subtitle={ui.login.adminSubtitle}
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
