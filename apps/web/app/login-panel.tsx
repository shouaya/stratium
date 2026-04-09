"use client";

import { useState } from "react";
import type { CSSProperties } from "react";
import type { AppLocale, AuthRole, PlatformSettings } from "./auth-client";
import { APP_LOCALES, getUiText, LOCALE_LABELS } from "./i18n";

export function LoginPanel({
  role,
  title,
  subtitle,
  platform,
  locale,
  onLocaleChange,
  busy,
  error,
  onSubmit
}: {
  role: AuthRole;
  title: string;
  subtitle: string;
  platform?: PlatformSettings | null;
  locale: AppLocale;
  onLocaleChange: (locale: AppLocale) => void;
  busy?: boolean;
  error?: string;
  onSubmit: (credentials: { username: string; password: string; role: AuthRole }) => Promise<void>;
}) {
  const [username, setUsername] = useState(role === "admin" ? "admin" : "demo");
  const [password, setPassword] = useState(role === "admin" ? "admin123456" : "demo123456");
  const ui = getUiText(locale);

  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "radial-gradient(circle at top, #0f2730, #071116 58%)", color: "#dbe7ef", fontFamily: "\"Segoe UI\", sans-serif", padding: 24 }}>
      <div style={{ width: "min(460px, 100%)", background: "rgba(9, 18, 24, 0.94)", border: "1px solid #16313b", borderRadius: 22, boxShadow: "0 30px 80px rgba(0, 0, 0, 0.35)", overflow: "hidden" }}>
        <div style={{ padding: "24px 24px 18px", borderBottom: "1px solid #13262f" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
            <div style={{ fontSize: 12, letterSpacing: "0.18em", color: "#56d7c4", textTransform: "uppercase" }}>{platform?.platformName ?? "Stratium Demo"}</div>
            <label style={{ display: "grid", gap: 4, minWidth: 120 }}>
              <span style={{ color: "#7e97a5", fontSize: 11 }}>{ui.common.language}</span>
              <select value={locale} onChange={(event) => onLocaleChange(event.target.value as AppLocale)} style={selectStyle}>
                {APP_LOCALES.map((entry) => <option key={entry} value={entry}>{LOCALE_LABELS[entry]}</option>)}
              </select>
            </label>
          </div>
          <h1 style={{ margin: "10px 0 8px", fontSize: 30 }}>{title}</h1>
          <div style={{ color: "#7e97a5", fontSize: 14 }}>{subtitle}</div>
          {platform?.platformAnnouncement ? (
            <div style={{ marginTop: 14, border: "1px solid #1a3640", background: "#0d1d24", color: "#b7c9d4", borderRadius: 12, padding: "10px 12px", fontSize: 13 }}>
              {platform.platformAnnouncement}
            </div>
          ) : null}
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void onSubmit({ username, password, role });
          }}
          style={{ display: "grid", gap: 14, padding: 24 }}
        >
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "#7e97a5", fontSize: 12 }}>{ui.login.username}</span>
            <input value={username} onChange={(event) => setUsername(event.target.value)} style={inputStyle} autoComplete="username" />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "#7e97a5", fontSize: 12 }}>{ui.login.password}</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} style={inputStyle} autoComplete="current-password" />
          </label>
          {error ? <div style={{ color: "#fca5a5", fontSize: 13 }}>{error}</div> : <div style={{ color: "#7e97a5", fontSize: 12 }}>{ui.login.accountsIssued}</div>}
          <button disabled={busy} type="submit" style={{ border: 0, background: "#22c55e", color: "#041015", fontWeight: 800, borderRadius: 12, padding: "14px 16px", cursor: busy ? "wait" : "pointer", opacity: busy ? 0.65 : 1 }}>
            {busy ? ui.login.signingIn : role === "admin" ? ui.login.signInAdmin : ui.login.signInTrader}
          </button>
        </form>
      </div>
    </main>
  );
}

const inputStyle: CSSProperties = {
  borderRadius: 12,
  border: "1px solid #22343d",
  background: "#0f1b22",
  color: "#f8fafc",
  padding: "12px 14px",
  outline: "none"
};

const selectStyle: CSSProperties = {
  borderRadius: 10,
  border: "1px solid #22343d",
  background: "#0f1b22",
  color: "#f8fafc",
  padding: "8px 10px",
  outline: "none"
};
