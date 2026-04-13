"use client";

import { box, btnBuyActive, btnGhost, btnModeActive, btnModeIdle, btnSellActive, btnSide } from "../styles";
import { Field, Line } from "./primitives";
import { fmt } from "../utils";

export function OcoOrderPanel({ vm, open, onClose }: { vm: any; open: boolean; onClose: () => void }) {
  const { t } = vm;

  const panel = (
    <div
      className="trade-panel-scroll"
      style={{
        ...box(),
        height: "100%",
        overflowY: "auto",
        boxShadow: "-18px 0 36px rgba(3, 8, 12, 0.4)",
        scrollbarWidth: "none",
        msOverflowStyle: "none"
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", padding: "12px 14px", borderBottom: "1px solid #16262f" }}>
        <strong style={{ fontSize: 16 }}>{t.ocoPanel}</strong>
        <button onClick={onClose} style={btnGhost}>{t.closeTradePanel}</button>
      </div>
      <div style={{ display: "grid", gap: 12, padding: "14px 14px 24px" }}>
        <div style={{ display: "grid", gap: 8, padding: 12, borderRadius: 10, background: "#0f1c23", border: "1px solid #15262e" }}>
          <Line label={t.leverage} value={`${vm.leverageInUse}x / max ${vm.state.symbolConfig?.maxLeverage ?? vm.leverageDraft}x`} />
          <Line label={t.referencePrice} value={fmt(vm.ocoReferencePrice, vm.priceDigits)} />
          <div style={{ color: "#7e97a5", fontSize: 12 }}>{t.ocoHint}</div>
        </div>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ color: "#7e97a5", fontSize: 12 }}>{t.adjustLeverage}</span>
          <input type="range" min={1} max={vm.state.symbolConfig?.maxLeverage ?? 10} step={1} value={vm.leverageDraft} onChange={(event) => vm.setLeverageDraft(Number(event.target.value))} />
          <div style={{ display: "flex", justifyContent: "space-between", color: "#7e97a5", fontSize: 12 }}><span>1x</span><strong style={{ color: "#f8fafc" }}>{vm.leverageDraft}x</strong><span>{vm.state.symbolConfig?.maxLeverage ?? 10}x</span></div>
          <button onClick={() => void vm.updateLeverage()} style={btnGhost}>{t.applyLeverage}</button>
        </label>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <button onClick={() => vm.setOcoForm((current: any) => ({ ...current, side: "buy" }))} style={vm.ocoForm.side === "buy" ? btnBuyActive : btnSide}>{t.buy}</button>
          <button onClick={() => vm.setOcoForm((current: any) => ({ ...current, side: "sell" }))} style={vm.ocoForm.side === "sell" ? btnSellActive : btnSide}>{t.sell}</button>
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          <span style={{ color: "#7e97a5", fontSize: 12 }}>{t.type}</span>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <button onClick={() => vm.setOcoForm((current: any) => ({ ...current, parentOrderType: "market" }))} style={vm.ocoForm.parentOrderType === "market" ? btnModeActive : btnModeIdle}>{t.market}</button>
            <button onClick={() => vm.setOcoForm((current: any) => ({ ...current, parentOrderType: "limit" }))} style={vm.ocoForm.parentOrderType === "limit" ? btnModeActive : btnModeIdle}>{t.limit}</button>
          </div>
        </div>

        <Field
          label={t.contracts}
          value={vm.ocoForm.quantity}
          onChange={(value) => vm.setOcoForm((current: any) => ({ ...current, quantity: value }))}
          inputMode="decimal"
          hint={t.oneContract.replace("{coin}", vm.contractCoin)}
        />
        {vm.ocoForm.parentOrderType === "limit" ? (
          <Field
            label={t.limitPrice}
            value={vm.ocoForm.limitPrice}
            onChange={(value) => vm.setOcoForm((current: any) => ({ ...current, limitPrice: value }))}
            inputMode="decimal"
          />
        ) : null}

        {[
          ["takeProfit", t.takeProfit, "takeProfitEnabled", "takeProfitTriggerPrice", "takeProfitExecution", "takeProfitLimitPrice"],
          ["stopLoss", t.stopLoss, "stopLossEnabled", "stopLossTriggerPrice", "stopLossExecution", "stopLossLimitPrice"]
        ].map(([key, label, enabledKey, triggerKey, executionKey, limitKey]) => (
          <label key={key} style={{ display: "grid", gap: 8, padding: 12, borderRadius: 10, background: "#0f1c23", border: "1px solid #15262e" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <strong>{label}</strong>
              <input type="checkbox" checked={vm.ocoForm[enabledKey]} onChange={(event) => vm.setOcoForm((current: any) => ({ ...current, [enabledKey]: event.target.checked }))} />
            </div>
            {vm.ocoForm[enabledKey] ? (
              <div style={{ display: "grid", gap: 8 }}>
                <Field
                  label={t.triggerPrice}
                  value={vm.ocoForm[triggerKey]}
                  onChange={(value) => vm.setOcoForm((current: any) => ({ ...current, [triggerKey]: value }))}
                  inputMode="decimal"
                />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <button onClick={() => vm.setOcoForm((current: any) => ({ ...current, [executionKey]: "market" }))} style={vm.ocoForm[executionKey] === "market" ? btnModeActive : btnModeIdle}>{t.marketExecution}</button>
                  <button onClick={() => vm.setOcoForm((current: any) => ({ ...current, [executionKey]: "limit" }))} style={vm.ocoForm[executionKey] === "limit" ? btnModeActive : btnModeIdle}>{t.limitExecution}</button>
                </div>
                {vm.ocoForm[executionKey] === "limit" ? (
                  <Field
                    label={t.limitPrice}
                    value={vm.ocoForm[limitKey]}
                    onChange={(value) => vm.setOcoForm((current: any) => ({ ...current, [limitKey]: value }))}
                    inputMode="decimal"
                  />
                ) : null}
              </div>
            ) : null}
          </label>
        ))}

        <div style={{ display: "grid", gap: 8 }}>
          {vm.ocoCheckItems.map((item: any) => <div key={item.label} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "9px 10px", borderRadius: 10, border: item.ok ? "1px solid #17433c" : "1px solid #4a2424", background: item.ok ? "rgba(19, 78, 74, 0.2)" : "rgba(127, 29, 29, 0.16)", fontSize: 12 }}><strong style={{ color: item.ok ? "#86efac" : "#fda4af" }}>{item.label}</strong><span style={{ color: item.ok ? "#d1fae5" : "#fecdd3", textAlign: "right" }}>{item.detail}</span></div>)}
        </div>

        {vm.ocoPricingPreview ? <div style={{ display: "grid", gap: 6, padding: 12, borderRadius: 10, background: "#0f1c23", border: "1px solid #15262e", fontSize: 12 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span style={{ color: "#7e97a5" }}>{t.estimatedPrice}</span><strong>{fmt(vm.ocoPricingPreview.referencePrice, vm.priceDigits)}</strong></div><div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span style={{ color: "#7e97a5" }}>{t.notional}</span><strong>{fmt(vm.ocoPricingPreview.notional, 2)} USDC</strong></div><div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span style={{ color: "#7e97a5" }}>{t.requiredMargin}</span><strong>{fmt(vm.ocoPricingPreview.estimatedMargin, 2)} USDC</strong></div><div style={{ display: "grid", gap: 6, marginTop: 4 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span style={{ color: "#7e97a5" }}>{t.marginUsage}</span><strong>{fmt(vm.ocoMarginUsageRatio * 100, 1)}%</strong></div><div style={{ height: 8, borderRadius: 999, background: "#0b151b", overflow: "hidden" }}><div style={{ width: `${vm.ocoMarginUsageRatio * 100}%`, height: "100%", background: vm.ocoMarginUsageRatio > 0.85 ? "#ef4444" : vm.ocoMarginUsageRatio > 0.6 ? "#f59e0b" : "#22c55e" }} /></div></div><div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span style={{ color: "#7e97a5" }}>{t.availableAfter}</span><strong style={{ color: vm.ocoPricingPreview.remainingAvailable < 0 ? "#f87171" : "#dbe7ef" }}>{fmt(vm.ocoPricingPreview.remainingAvailable, 2)} USDC</strong></div><div style={{ color: "#7e97a5" }}>{t.postTradeFreeMargin.replace("{ratio}", fmt(vm.ocoPostTradeAvailableRatio, 1))}</div></div> : null}

        <div style={{ color: vm.ocoOrderError ? "#f87171" : "#7e97a5", fontSize: 12 }}>
          {vm.ocoOrderError ?? t.ocoReady}
        </div>
        <button disabled={Boolean(vm.ocoOrderError)} onClick={() => void vm.submitOcoOrders()} style={{ ...btnGhost, opacity: vm.ocoOrderError ? 0.5 : 1, cursor: vm.ocoOrderError ? "not-allowed" : "pointer" }}>
          {t.placeOcoOrders}
        </button>
      </div>
    </div>
  );

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 7,
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
