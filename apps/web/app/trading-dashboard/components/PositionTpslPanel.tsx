"use client";

import { box, btnGhost, btnModeActive, btnModeIdle } from "../styles";
import { Field, Line } from "./primitives";
import { fmt } from "../utils";

export function PositionTpslPanel({ vm, open, onClose }: { vm: any; open: boolean; onClose: () => void }) {
  const { state, t } = vm;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 8,
        pointerEvents: open ? "auto" : "none",
        opacity: open ? 1 : 0,
        transition: "opacity 180ms ease"
      }}
    >
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(3, 8, 12, 0.58)"
        }}
      />
      <div
        style={{
          position: "absolute",
          right: 16,
          bottom: 16,
          width: "min(420px, calc(100% - 32px))",
          maxHeight: "calc(100% - 32px)",
          overflowY: "auto",
          ...box(),
          boxShadow: "0 20px 48px rgba(3, 8, 12, 0.45)"
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", padding: "12px 14px", borderBottom: "1px solid #16262f" }}>
          <strong style={{ fontSize: 16 }}>{vm.editingOcoChildren ? t.editOcoChildren : vm.hasPositionTpsl ? t.managePositionTpsl : t.addPositionTpsl}</strong>
          <button onClick={onClose} style={btnGhost}>{t.closeTradePanel}</button>
        </div>
        <div style={{ display: "grid", gap: 12, padding: 14 }}>
          <div style={{ display: "grid", gap: 8, padding: 12, borderRadius: 10, background: "#0f1c23", border: "1px solid #15262e" }}>
            <Line label={t.currentPosition} value={!state.position || state.position.side === "flat" ? t.noPosition : `${state.position.side} · ${fmt(state.position.quantity, 4)} ${vm.contractCoin}`} />
            <Line label={t.referencePrice} value={fmt(vm.referenceTriggerPrice, vm.priceDigits)} />
          </div>
          {[
            ["takeProfit", t.takeProfit, "takeProfitEnabled", "takeProfitQuantity", "takeProfitTriggerPrice", "takeProfitExecution", "takeProfitLimitPrice", t.takeProfitQuantity],
            ["stopLoss", t.stopLoss, "stopLossEnabled", "stopLossQuantity", "stopLossTriggerPrice", "stopLossExecution", "stopLossLimitPrice", t.stopLossQuantity]
          ].map(([key, label, enabledKey, quantityKey, triggerKey, executionKey, limitKey, quantityLabel]) => (
            <label key={key} style={{ display: "grid", gap: 8, padding: 12, borderRadius: 10, background: "#0f1c23", border: "1px solid #15262e" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <strong>{label}</strong>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {((key === "takeProfit" && vm.takeProfitOrder) || (key === "stopLoss" && vm.stopLossOrder)) ? (
                    <button
                      onClick={() => void vm.cancelPositionTpsl(key === "takeProfit" ? "tp" : "sl")}
                      style={btnGhost}
                      type="button"
                    >
                      {t.cancel}
                    </button>
                  ) : null}
                  <input type="checkbox" checked={vm.advancedForm[enabledKey]} onChange={(event) => vm.setAdvancedForm((current: any) => ({ ...current, [enabledKey]: event.target.checked }))} />
                </div>
              </div>
              {vm.advancedForm[enabledKey] ? (
                <div style={{ display: "grid", gap: 8 }}>
                  <Field label={quantityLabel} value={vm.advancedForm[quantityKey]} onChange={(value) => vm.setAdvancedForm((current: any) => ({ ...current, [quantityKey]: value }))} inputMode="decimal" hint={t.advancedContractsHint.replace("{quantity}", fmt(state.position?.quantity, vm.quantityDecimals))} />
                  <Field label={t.triggerPrice} value={vm.advancedForm[triggerKey]} onChange={(value) => vm.setAdvancedForm((current: any) => ({ ...current, [triggerKey]: value }))} inputMode="decimal" />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <button onClick={() => vm.setAdvancedForm((current: any) => ({ ...current, [executionKey]: "market" }))} style={vm.advancedForm[executionKey] === "market" ? btnModeActive : btnModeIdle}>{t.marketExecution}</button>
                    <button onClick={() => vm.setAdvancedForm((current: any) => ({ ...current, [executionKey]: "limit" }))} style={vm.advancedForm[executionKey] === "limit" ? btnModeActive : btnModeIdle}>{t.limitExecution}</button>
                  </div>
                  {vm.advancedForm[executionKey] === "limit" ? <Field label={t.limitPrice} value={vm.advancedForm[limitKey]} onChange={(value) => vm.setAdvancedForm((current: any) => ({ ...current, [limitKey]: value }))} inputMode="decimal" /> : null}
                </div>
              ) : null}
            </label>
          ))}
          <div style={{ color: vm.advancedOrderError ? "#f87171" : "#7e97a5", fontSize: 12 }}>{vm.advancedOrderError ?? t.advancedReady}</div>
          <button disabled={Boolean(vm.advancedOrderError)} onClick={() => void vm.submitPositionTpsl()} style={{ ...btnGhost, opacity: vm.advancedOrderError ? 0.5 : 1, cursor: vm.advancedOrderError ? "not-allowed" : "pointer" }}>{vm.editingOcoChildren ? t.saveOcoChildren : vm.hasPositionTpsl ? t.savePositionTpsl : t.placeAdvancedOrders}</button>
        </div>
      </div>
    </div>
  );
}
