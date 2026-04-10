import type { HTMLAttributes } from "react";
import { fmt } from "../utils";

export function Metric({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: "up" | "down" }) {
  return <div><div style={{ color: "#60727f", fontSize: 11 }}>{label}</div><div style={{ color: strong ? "#f8fafc" : tone === "down" ? "#f87171" : tone === "up" ? "#2dd4bf" : "#dbe7ef", fontSize: strong ? 18 : 15, fontWeight: 700 }}>{value}</div></div>;
}

export function Line({ label, value }: { label: string; value: string }) {
  return <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13 }}><span style={{ color: "#7e97a5" }}>{label}</span><strong>{value}</strong></div>;
}

export function Field({
  label,
  value,
  onChange,
  compact,
  error,
  hint,
  inputMode,
  readOnly
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  compact?: boolean;
  error?: string;
  hint?: string;
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
  readOnly?: boolean;
}) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span style={{ color: "#7e97a5", fontSize: 12 }}>{label}</span>
      <input
        value={value}
        inputMode={inputMode}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        style={{
          borderRadius: 10,
          border: error ? "1px solid #7f1d1d" : "1px solid #22343d",
          background: readOnly ? "#0d171d" : "#101b22",
          color: "#f8fafc",
          padding: compact ? "9px 10px" : "11px 12px",
          outline: "none",
          boxShadow: error ? "0 0 0 1px rgba(248, 113, 113, 0.16)" : "none"
        }}
      />
      {error ? <span style={{ color: "#f87171", fontSize: 12 }}>{error}</span> : hint ? <span style={{ color: "#7e97a5", fontSize: 12 }}>{hint}</span> : null}
    </label>
  );
}

export function BookRow({
  price,
  size,
  total,
  tone,
  maxTotal,
  priceDigits
}: {
  price: number;
  size: number;
  total: number;
  tone: "ask" | "bid";
  maxTotal: number;
  priceDigits: number;
}) {
  const width = maxTotal > 0 ? `${Math.max((total / maxTotal) * 100, 2)}%` : "0%";

  return (
    <div style={{ position: "relative", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, padding: "6px 8px", borderRadius: 6, overflow: "hidden", fontSize: 12 }}>
      <div style={{ position: "absolute", top: 0, bottom: 0, width, left: tone === "bid" ? 0 : "auto", right: tone === "ask" ? 0 : "auto", background: tone === "ask" ? "rgba(248, 113, 113, 0.16)" : "rgba(45, 212, 191, 0.16)", pointerEvents: "none" }} />
      <span style={{ position: "relative", zIndex: 1, color: tone === "ask" ? "#f87171" : "#2dd4bf" }}>{fmt(price, priceDigits)}</span>
      <span style={{ position: "relative", zIndex: 1, textAlign: "right" }}>{fmt(size, 4)}</span>
      <span style={{ position: "relative", zIndex: 1, textAlign: "right", color: "#c8d6df" }}>{fmt(total, 4)}</span>
    </div>
  );
}

export function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick?: () => void }) {
  return <button onClick={onClick} style={{ border: 0, background: "transparent", color: active ? "#f8fafc" : "#7e97a5", padding: "12px 10px", borderBottom: active ? "2px solid #2dd4bf" : "2px solid transparent", cursor: "pointer" }}>{label}</button>;
}
