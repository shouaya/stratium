import type { CSSProperties } from "react";

export const box = (padding?: string): CSSProperties => ({
  background: "#0b161d",
  border: "1px solid #16262f",
  borderRadius: 12,
  overflow: "hidden",
  padding
});

export const chipButton = (active?: boolean): CSSProperties => ({
  color: active ? "#f8fafc" : "#7e97a5",
  background: active ? "#15252d" : "transparent",
  border: active ? "1px solid #23414d" : "1px solid transparent",
  padding: "5px 8px",
  borderRadius: 8,
  cursor: "pointer"
});

export const tabIdle: CSSProperties = {
  border: 0,
  background: "transparent",
  color: "#7e97a5",
  padding: "8px 12px",
  borderBottomWidth: 2,
  borderBottomStyle: "solid",
  borderBottomColor: "transparent"
};

export const tabActive: CSSProperties = { ...tabIdle, color: "#f8fafc", borderBottomColor: "#2dd4bf" };
export const btnGhost: CSSProperties = { border: "1px solid #253740", background: "#111d24", color: "#dce7ee", padding: "10px 14px", borderRadius: 10, cursor: "pointer" };
export const btnInline: CSSProperties = { border: "1px solid #394d56", background: "#122028", color: "#dce7ee", borderRadius: 8, padding: "6px 10px", cursor: "pointer" };
export const btnModeIdle: CSSProperties = {
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "#24353d",
  background: "#101b22",
  color: "#8fa3af",
  padding: "9px 12px",
  borderRadius: 10,
  cursor: "pointer",
  fontWeight: 700
};
export const btnModeActive: CSSProperties = {
  ...btnModeIdle,
  background: "#15333a",
  borderColor: "#2a5964",
  color: "#f8fafc"
};
export const selectStyle: CSSProperties = { border: "1px solid #394d56", background: "#122028", color: "#dce7ee", borderRadius: 8, padding: "6px 10px", outline: "none" };
export const btnSide: CSSProperties = {
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "#24353d",
  background: "#132229",
  color: "#d6e2ea",
  padding: "10px 14px",
  borderRadius: 10,
  cursor: "pointer",
  fontWeight: 700
};
export const btnBuyActive: CSSProperties = { ...btnSide, background: "#1e6b5f", borderColor: "#1e6b5f", color: "#f8fafc" };
export const btnSellActive: CSSProperties = { ...btnSide, background: "#7f3d38", borderColor: "#7f3d38", color: "#f8fafc" };
export const btnBuySubmit: CSSProperties = { border: 0, borderRadius: 12, background: "#22c55e", color: "#041015", padding: "14px 16px", cursor: "pointer", fontWeight: 800 };
export const btnSellSubmit: CSSProperties = { border: 0, borderRadius: 12, background: "#ef4444", color: "#fff7f7", padding: "14px 16px", cursor: "pointer", fontWeight: 800 };
export const th: CSSProperties = { padding: "12px 14px", fontWeight: 500 };
export const td: CSSProperties = { padding: "12px 14px" };
export const bookHead: CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, color: "#60727f", fontSize: 12, padding: "0 8px 8px" };
