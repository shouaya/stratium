"use client";

import { box, btnBuyActive, btnBuySubmit, btnGhost, btnSellActive, btnSellSubmit, btnSide } from "../styles";
import { Field, Line } from "./primitives";
import { fmt } from "../utils";

export function OrderEntryPanel({ vm, popup, open, onClose }: { vm: any; popup?: boolean; open?: boolean; onClose?: () => void }) {
  const { state, t, ui } = vm;

  const panel = (
    <div
      className={popup ? "trade-panel-scroll" : undefined}
      style={{
        ...box(),
        height: "100%",
        overflowY: popup ? "auto" : "visible",
        boxShadow: popup ? "-18px 0 36px rgba(3, 8, 12, 0.4)" : undefined,
        scrollbarWidth: popup ? "none" : undefined,
        msOverflowStyle: popup ? "none" : undefined
      }}
    >
      {popup ? (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", padding: "12px 14px", borderBottom: "1px solid #16262f" }}>
          <strong style={{ fontSize: 16 }}>{t.openTradePanel}</strong>
          <button onClick={onClose} style={btnGhost}>{t.closeTradePanel}</button>
        </div>
      ) : null}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, padding: "14px" }}>
        <button onClick={() => vm.setSide("buy")} style={vm.side === "buy" ? btnBuyActive : btnSide}>{t.buy}</button>
        <button onClick={() => vm.setSide("sell")} style={vm.side === "sell" ? btnSellActive : btnSide}>{t.sell}</button>
      </div>
      <div style={{ padding: "0 14px 14px", display: "grid", gap: 12 }}>
        <Line label={t.leverage} value={`${vm.leverageInUse}x / max ${state.symbolConfig?.maxLeverage ?? vm.leverageDraft}x`} />
        <Line label={t.rollingMarket} value={state.simulator?.enabled ? `${t.running} · ${state.simulator.intervalMs}ms` : t.stopped} />
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ color: "#7e97a5", fontSize: 12 }}>{t.adjustLeverage}</span>
          <input type="range" min={1} max={state.symbolConfig?.maxLeverage ?? 10} step={1} value={vm.leverageDraft} onChange={(event) => vm.setLeverageDraft(Number(event.target.value))} />
          <div style={{ display: "flex", justifyContent: "space-between", color: "#7e97a5", fontSize: 12 }}><span>1x</span><strong style={{ color: "#f8fafc" }}>{vm.leverageDraft}x</strong><span>{state.symbolConfig?.maxLeverage ?? 10}x</span></div>
          <button onClick={() => void vm.updateLeverage()} style={btnGhost}>{t.applyLeverage}</button>
        </label>
        <div style={{ display: "grid", gap: 6 }}>
          <span style={{ color: "#7e97a5", fontSize: 12 }}>{t.type}</span>
          <div style={{ display: "flex", gap: 14, alignItems: "center", fontSize: 13 }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }} onClick={() => vm.selectOrderType("market")}>
              <input type="radio" name="trade-order-type" checked={vm.tab === "market"} readOnly />
              <span>{t.market}</span>
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }} onClick={() => vm.selectOrderType("limit")}>
              <input type="radio" name="trade-order-type" checked={vm.tab === "limit"} readOnly />
              <span>{t.limit}</span>
            </label>
          </div>
        </div>
        <Field label={t.contracts} value={vm.orderForm.quantity} onChange={(value) => vm.setOrderForm((current: any) => ({ ...current, quantity: value }))} inputMode="decimal" error={vm.quantityFieldError ?? undefined} />
        {vm.tab === "limit" ? <Field label={t.limitPrice} value={vm.orderForm.limitPrice} onChange={(value) => vm.setOrderForm((current: any) => ({ ...current, limitPrice: value }))} inputMode="decimal" error={vm.limitPriceFieldError ?? undefined} /> : null}
        <div style={{ color: "#7e97a5", fontSize: 12 }}>{t.oneContract.replace("{coin}", vm.contractCoin)}</div>
        <div style={{ display: "grid", gap: 8 }}>{vm.orderCheckItems.map((item: any) => <div key={item.label} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "9px 10px", borderRadius: 10, border: item.ok ? "1px solid #17433c" : "1px solid #4a2424", background: item.ok ? "rgba(19, 78, 74, 0.2)" : "rgba(127, 29, 29, 0.16)", fontSize: 12 }}><strong style={{ color: item.ok ? "#86efac" : "#fda4af" }}>{item.label}</strong><span style={{ color: item.ok ? "#d1fae5" : "#fecdd3", textAlign: "right" }}>{item.detail}</span></div>)}</div>
        {vm.pricingPreview ? <div style={{ display: "grid", gap: 6, padding: 12, borderRadius: 10, background: "#0f1c23", border: "1px solid #15262e", fontSize: 12 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span style={{ color: "#7e97a5" }}>{t.estimatedPrice}</span><strong>{fmt(vm.pricingPreview.referencePrice, vm.priceDigits)}</strong></div><div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span style={{ color: "#7e97a5" }}>{t.notional}</span><strong>{fmt(vm.pricingPreview.notional, 2)} USDC</strong></div><div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span style={{ color: "#7e97a5" }}>{t.requiredMargin}</span><strong>{fmt(vm.pricingPreview.estimatedMargin, 2)} USDC</strong></div><div style={{ display: "grid", gap: 6, marginTop: 4 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span style={{ color: "#7e97a5" }}>{t.marginUsage}</span><strong>{fmt(vm.marginUsageRatio * 100, 1)}%</strong></div><div style={{ height: 8, borderRadius: 999, background: "#0b151b", overflow: "hidden" }}><div style={{ width: `${vm.marginUsageRatio * 100}%`, height: "100%", background: vm.marginUsageRatio > 0.85 ? "#ef4444" : vm.marginUsageRatio > 0.6 ? "#f59e0b" : "#22c55e" }} /></div></div><div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span style={{ color: "#7e97a5" }}>{t.availableAfter}</span><strong style={{ color: vm.pricingPreview.remainingAvailable < 0 ? "#f87171" : "#dbe7ef" }}>{fmt(vm.pricingPreview.remainingAvailable, 2)} USDC</strong></div><div style={{ color: "#7e97a5" }}>{t.postTradeFreeMargin.replace("{ratio}", fmt(vm.postTradeAvailableRatio, 1))}</div></div> : null}
        {vm.orderError ? <div style={{ color: "#f87171", fontSize: 12 }}>{vm.orderError}</div> : <div style={{ color: "#7e97a5", fontSize: 12 }}>{t.checksPassed}</div>}
        <button disabled={Boolean(vm.orderError)} onClick={() => void vm.submitOrder()} style={{ ...(vm.side === "buy" ? btnBuySubmit : btnSellSubmit), opacity: vm.orderError ? 0.5 : 1, cursor: vm.orderError ? "not-allowed" : "pointer" }}>{vm.side === "buy" ? t.buy : t.sell} {vm.contractCoin} Perp</button>
      </div>
    </div>
  );

  if (!popup) {
    return panel;
  }

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 5,
        pointerEvents: open ? "auto" : "none",
        transform: open ? "translateX(0)" : "translateX(106%)",
        opacity: open ? 1 : 0,
        transition: "transform 220ms ease, opacity 220ms ease"
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(180deg, rgba(7, 17, 22, 0.08), rgba(7, 17, 22, 0.18))"
        }}
      />
      <div style={{ position: "absolute", inset: 0 }}>
        {panel}
      </div>
      <style>{`
        .trade-panel-scroll::-webkit-scrollbar {
          width: 0;
          height: 0;
          display: none;
        }
      `}</style>
    </div>
  );
}
