"use client";

import { useEffect, useState } from "react";
import { box, btnGhost, btnModeIdle } from "../styles";
import { Line } from "./primitives";
import { fmt } from "../utils";

export function BalancePanel({ vm }: { vm: any }) {
  const { state, t, message } = vm;
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const account = state.account;
  const position = state.position;
  const positionTone = !position || position.side === "flat" ? "#dbe7ef" : position.side === "long" ? "#2dd4bf" : "#f87171";
  const unrealizedTone = (account?.unrealizedPnl ?? 0) > 0 ? "#2dd4bf" : (account?.unrealizedPnl ?? 0) < 0 ? "#f87171" : "#dbe7ef";
  const tokenFeedback = copyState === "copied" ? t.tokenCopied : copyState === "failed" ? t.copyTokenFailed : "";

  useEffect(() => {
    if (copyState === "idle") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 1800);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const handleCopyToken = async () => {
    if (!vm.authToken) {
      setCopyState("failed");
      return;
    }

    try {
      await navigator.clipboard.writeText(vm.authToken);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <div
      style={{
        ...box(),
        display: "grid",
        gap: 14,
        padding: 14,
        alignContent: "start",
        height: "100%",
        borderBottomLeftRadius: 12,
        borderBottomRightRadius: 12,
        boxShadow: "inset 0 -1px 0 #16262f"
      }}
    >
      <div style={{ display: "grid", gap: 4 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
          <strong style={{ fontSize: 18 }}>{t.balances}</strong>
          <span style={{ color: "#7e97a5", fontSize: 12 }}>{state.symbolConfig?.symbol ?? "BTC-USD"}</span>
        </div>
        <div style={{ color: "#7e97a5", fontSize: 12 }}>{t.available} / {t.equity}</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div style={{ padding: 12, borderRadius: 10, background: "#0f1c23", border: "1px solid #15262e" }}>
          <div style={{ color: "#7e97a5", fontSize: 12 }}>{t.available}</div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 6 }}>{fmt(account?.availableBalance, 2)} USDC</div>
        </div>
        <div style={{ padding: 12, borderRadius: 10, background: "#0f1c23", border: "1px solid #15262e" }}>
          <div style={{ color: "#7e97a5", fontSize: 12 }}>{t.equity}</div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 6 }}>{fmt(account?.equity, 2)} USDC</div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 8, padding: 12, borderRadius: 10, background: "#0f1c23", border: "1px solid #15262e" }}>
        <Line label={t.wallet} value={`${fmt(account?.walletBalance, 2)} USDC`} />
        <Line label={t.realizedPnl} value={`${fmt(account?.realizedPnl, 4)} USDC`} />
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13 }}>
          <span style={{ color: "#7e97a5" }}>{t.unrealizedPnl}</span>
          <strong style={{ color: unrealizedTone }}>{fmt(account?.unrealizedPnl, 4)} USDC</strong>
        </div>
      </div>

      <div style={{ display: "grid", gap: 8, padding: 12, borderRadius: 10, background: "#0f1c23", border: "1px solid #15262e" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
          <strong>{t.currentPosition}</strong>
          <span style={{ color: positionTone, textTransform: "capitalize", fontSize: 12 }}>
            {!position || position.side === "flat" ? t.noPosition : position.side}
          </span>
        </div>
        <Line label={t.contracts} value={!position || position.side === "flat" ? "0" : fmt(position.quantity, 4)} />
        <Line label={t.entry} value={!position || position.side === "flat" ? "-" : fmt(position.averageEntryPrice, vm.priceDigits)} />
        <Line label={t.mark} value={!position || position.side === "flat" ? "-" : fmt(position.markPrice, vm.priceDigits)} />
      </div>

      {vm.authToken ? (
        <div style={{ display: "grid", gap: 8, padding: 12, borderRadius: 10, background: "#0f1c23", border: "1px solid #15262e" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
            <strong>{t.mcpToken}</strong>
            <button onClick={handleCopyToken} style={{ ...btnGhost, padding: "6px 10px", fontSize: 12, fontWeight: 700 }}>
              {t.copyToken}
            </button>
          </div>
          <div style={{ color: "#7e97a5", fontSize: 12 }}>{t.mcpTokenHint}</div>
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid #1b3038",
              background: "#09141a",
              color: "#dbe7ef",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              fontSize: 11,
              lineHeight: 1.5,
              wordBreak: "break-all",
              maxHeight: 88,
              overflowY: "auto"
            }}
          >
            {vm.authToken}
          </div>
          {tokenFeedback ? (
            <div style={{ color: copyState === "copied" ? "#2dd4bf" : "#f87171", fontSize: 12 }}>{tokenFeedback}</div>
          ) : null}
        </div>
      ) : null}

      {message ? (
        <div style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #23414d", background: "#112028", color: "#cce6f1", fontSize: 12 }}>
          {message}
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <button onClick={() => vm.setTradePanelOpen(true)} style={{ ...btnGhost, padding: "12px 14px", fontWeight: 700 }}>
          {t.simplePanel}
        </button>
        <button onClick={() => vm.openOcoPanel()} style={{ ...btnModeIdle, padding: "12px 14px" }}>
          {t.advancedPanel}
        </button>
      </div>
    </div>
  );
}
