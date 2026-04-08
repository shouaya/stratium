"use client";

import { useEffect, useState } from "react";
import { AdminConsole } from "./admin-console";
import { authHeaders, clearStoredToken, getStoredToken, setStoredToken, type AuthUser, type PlatformSettings } from "../auth-client";
import { LoginPanel } from "../login-panel";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [platform, setPlatform] = useState<PlatformSettings | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const storedToken = getStoredToken("admin");

    if (!storedToken) {
      setBusy(false);
      return;
    }

    void loadSession(storedToken);
  }, []);

  const loadSession = async (candidateToken: string) => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/auth/me`, {
        headers: authHeaders(candidateToken),
        cache: "no-store"
      });

      if (!response.ok) {
        clearStoredToken("admin");
        setToken(null);
        setUser(null);
        setBusy(false);
        return;
      }

      const payload = await response.json() as { user: AuthUser; platform: PlatformSettings };

      if (payload.user.role !== "admin") {
        clearStoredToken("admin");
        setBusy(false);
        return;
      }

      setToken(candidateToken);
      setUser(payload.user);
      setPlatform(payload.platform);
      setError("");
    } catch {
      setError("Failed to reach the API.");
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials)
      });
      const payload = await response.json() as { token?: string; user?: AuthUser; platform?: PlatformSettings; message?: string };

      if (!response.ok || !payload.token || !payload.user || payload.user.role !== "admin") {
        setError(payload.message ?? "Login failed.");
        return;
      }

      setStoredToken("admin", payload.token);
      setToken(payload.token);
      setUser(payload.user);
      setPlatform(payload.platform ?? null);
    } catch {
      setError("Login failed.");
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    const currentToken = token;
    clearStoredToken("admin");
    setToken(null);
    setUser(null);

    if (!currentToken) {
      return;
    }

    await fetch(`${apiBaseUrl}/api/auth/logout`, {
      method: "POST",
      headers: authHeaders(currentToken)
    }).catch(() => undefined);
  };

  if (!token || !user) {
    return (
      <LoginPanel
        role="admin"
        title="Admin Login"
        subtitle="Admin users can issue frontend accounts and change platform settings."
        platform={platform}
        busy={busy}
        error={error}
        onSubmit={login}
      />
    );
  }

  return <AdminConsole apiBaseUrl={apiBaseUrl} authToken={token} viewer={user} onLogout={() => void logout()} />;
}
