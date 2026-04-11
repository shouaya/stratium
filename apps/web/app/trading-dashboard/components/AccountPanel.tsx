"use client";

import { box, btnInline, td, th } from "../styles";
import { TabButton } from "./primitives";
import { dateTime, fmt } from "../utils";

export function AccountPanel({ vm }: { vm: any }) {
  const { state, t } = vm;
  const renderHistoricalTriggerPrice = (order: any) => {
    if (order.triggerCondition?.triggerPx) {
      return fmt(Number(order.triggerCondition.triggerPx), vm.priceDigits);
    }

    if (order.limitPrice != null && Number.isFinite(order.limitPrice)) {
      return fmt(Number(order.limitPrice), vm.priceDigits);
    }

    return "N/A";
  };

  const renderHistoricalTpsl = (order: any) => {
    if (order.triggerCondition?.tpsl === "tp") {
      return `${t.takeProfitShort}${order.limitPrice != null ? ` (${fmt(Number(order.limitPrice), vm.priceDigits)})` : ""}`;
    }

    if (order.triggerCondition?.tpsl === "sl") {
      return `${t.stopLossShort}${order.limitPrice != null ? ` (${fmt(Number(order.limitPrice), vm.priceDigits)})` : ""}`;
    }

    return "--";
  };

  return (
    <div style={{ ...box(), display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <div style={{ display: "flex", gap: 4, padding: "0 10px", borderBottom: "1px solid #16262f" }}>
        <TabButton active={vm.accountTab === "positions"} label={t.positions} onClick={() => vm.setAccountTab("positions")} />
        <TabButton active={vm.accountTab === "openOrders"} label={t.openOrders} onClick={() => vm.setAccountTab("openOrders")} />
        <TabButton active={vm.accountTab === "orderHistory"} label={t.orderHistory} onClick={() => vm.setAccountTab("orderHistory")} />
        <TabButton active={vm.accountTab === "fills"} label={t.fillHistory} onClick={() => vm.setAccountTab("fills")} />
      </div>
      <div style={{ overflowX: "auto", overflowY: "auto", flex: 1, minHeight: 0 }}>
        {vm.accountTab === "positions" ? (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ color: "#7e97a5", textAlign: "left" }}><th style={th}>{t.symbol}</th><th style={th}>{t.side}</th><th style={th}>{t.contracts}</th><th style={th}>{t.entry}</th><th style={th}>{t.takeProfitShort}</th><th style={th}>{t.mark}</th><th style={th}>{t.stopLossShort}</th><th style={th}>{t.estimatedLiquidation}</th><th style={th}>{t.unrealizedPnl}</th><th style={th}>{t.action}</th></tr></thead>
            <tbody>{!state.position || state.position.side === "flat" ? <tr><td colSpan={10} style={{ padding: 18, color: "#60727f", textAlign: "center" }}>{t.noPosition}</td></tr> : <tr style={{ borderTop: "1px solid #13212a" }}><td style={td}>{state.position.symbol}</td><td style={{ ...td, color: state.position.side === "long" ? "#2dd4bf" : "#f87171" }}>{state.position.side}</td><td style={td}>{fmt(state.position.quantity, 4)}</td><td style={td}>{fmt(state.position.averageEntryPrice, vm.priceDigits)}</td><td style={{ ...td, color: vm.takeProfitOrder ? "#22c55e" : "#60727f", fontWeight: vm.takeProfitOrder ? 700 : 400 }}>{vm.takeProfitOrder?.triggerCondition?.triggerPx ? fmt(Number(vm.takeProfitOrder.triggerCondition.triggerPx), vm.priceDigits) : "-"}</td><td style={td}>{fmt(state.position.markPrice, vm.priceDigits)}</td><td style={{ ...td, color: vm.stopLossOrder ? "#f59e0b" : "#60727f", fontWeight: vm.stopLossOrder ? 700 : 400 }}>{vm.stopLossOrder?.triggerCondition?.triggerPx ? fmt(Number(vm.stopLossOrder.triggerCondition.triggerPx), vm.priceDigits) : "-"}</td><td style={td}>{state.position.liquidationPrice > 0 ? fmt(state.position.liquidationPrice, vm.priceDigits) : "-"}</td><td style={{ ...td, color: state.position.unrealizedPnl > 0 ? "#2dd4bf" : state.position.unrealizedPnl < 0 ? "#f87171" : "#dbe7ef" }}>{fmt(state.position.unrealizedPnl, 4)} USDC</td><td style={td}><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button onClick={() => vm.openPositionTpslPanel()} style={btnInline}>{vm.hasPositionTpsl ? t.managePositionTpsl : t.addPositionTpsl}</button><button onClick={() => void vm.closePosition()} style={btnInline}>{t.closePosition}</button></div></td></tr>}</tbody>
          </table>
        ) : vm.accountTab === "openOrders" ? (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ color: "#7e97a5", textAlign: "left" }}><th style={th}>{t.order}</th><th style={th}>{t.side}</th><th style={th}>{t.type}</th><th style={th}>{t.contracts}</th><th style={th}>{t.filled}</th><th style={th}>{t.status}</th><th style={th}>{t.action}</th></tr></thead>
            <tbody>{vm.activeOrders.length === 0 ? <tr><td colSpan={7} style={{ padding: 18, color: "#60727f", textAlign: "center" }}>{t.noOpenOrders}</td></tr> : vm.activeOrders.map((order: any) => <tr key={order.id} style={{ borderTop: "1px solid #13212a" }}><td style={td}>{order.id}</td><td style={{ ...td, color: order.side === "buy" ? "#2dd4bf" : "#f87171" }}>{order.side}</td><td style={td}>{order.orderType}</td><td style={td}>{fmt(order.quantity)}</td><td style={td}>{fmt(order.filledQuantity)}</td><td style={td}>{order.status}</td><td style={td}><button onClick={() => void vm.cancelOrder(order.id)} style={btnInline}>{t.cancel}</button></td></tr>)}</tbody>
          </table>
        ) : vm.accountTab === "orderHistory" ? (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ color: "#7e97a5", textAlign: "left" }}><th style={th}>{t.time}</th><th style={th}>{t.type}</th><th style={th}>{t.side}</th><th style={th}>{t.contracts}</th><th style={th}>{t.price}</th><th style={th}>{t.triggerPrice}</th><th style={th}>{t.takeProfitShort}/{t.stopLossShort}</th><th style={th}>{t.status}</th><th style={th}>{t.order}</th></tr></thead>
            <tbody>{vm.historicalOrders.length === 0 ? <tr><td colSpan={9} style={{ padding: 18, color: "#60727f", textAlign: "center" }}>{t.noOrderHistory}</td></tr> : vm.historicalOrders.map((order: any) => <tr key={`${order.kind}-${order.orderId}-${order.updatedAt}`} style={{ borderTop: "1px solid #13212a" }}><td style={td}>{dateTime(order.updatedAt)}</td><td style={td}>{order.kind === "trigger" ? `${order.triggerCondition?.tpsl === "tp" ? "Take Profit" : "Stop Loss"} ${order.orderType === "market" ? "Market" : "Limit"}` : order.orderType}</td><td style={{ ...td, color: order.side === "buy" ? "#2dd4bf" : "#f87171" }}>{order.side}</td><td style={td}>{fmt(order.quantity, 4)}</td><td style={td}>{order.limitPrice != null ? fmt(order.limitPrice, vm.priceDigits) : order.orderType === "market" ? "Market" : "-"}</td><td style={{ ...td, color: order.triggerCondition?.tpsl === "tp" ? "#22c55e" : order.triggerCondition?.tpsl === "sl" ? "#f59e0b" : "#dbe7ef" }}>{renderHistoricalTriggerPrice(order)}</td><td style={{ ...td, color: order.triggerCondition?.tpsl === "tp" ? "#22c55e" : order.triggerCondition?.tpsl === "sl" ? "#f59e0b" : "#60727f" }}>{renderHistoricalTpsl(order)}</td><td style={td}>{order.status}</td><td style={td}>{order.orderId}</td></tr>)}</tbody>
          </table>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ color: "#7e97a5", textAlign: "left" }}><th style={th}>{t.time}</th><th style={th}>{t.order}</th><th style={th}>{t.side}</th><th style={th}>{t.type}</th><th style={th}>{t.role}</th><th style={th}>{t.entryPrice}</th><th style={th}>{t.exitPrice}</th><th style={th}>{t.contracts}</th><th style={th}>{t.realizedPnl}</th><th style={th}>{t.fee}</th><th style={th}>{t.slippage}</th></tr></thead>
            <tbody>{vm.personalFills.length === 0 ? <tr><td colSpan={11} style={{ padding: 18, color: "#60727f", textAlign: "center" }}>{t.noFills}</td></tr> : vm.personalFills.map((fill: any) => <tr key={fill.id} style={{ borderTop: "1px solid #13212a" }}><td style={td}>{dateTime(fill.filledAt)}</td><td style={td}>{fill.orderId}</td><td style={{ ...td, color: fill.side === "buy" ? "#2dd4bf" : "#f87171" }}>{fill.side}</td><td style={td}>{fill.orderType}</td><td style={{ ...td, textTransform: "uppercase", color: fill.liquidityRole === "maker" ? "#22c55e" : "#f59e0b" }}>{fill.liquidityRole}</td><td style={td}>{fmt(fill.entryPrice, vm.priceDigits)}</td><td style={td}>{fill.exitPrice != null ? fmt(fill.exitPrice, vm.priceDigits) : "-"}</td><td style={td}>{fmt(fill.quantity, 4)}</td><td style={{ ...td, color: fill.realizedPnl > 0 ? "#2dd4bf" : fill.realizedPnl < 0 ? "#f87171" : "#dbe7ef" }}>{fmt(fill.realizedPnl, 4)} USDC</td><td style={td}>{fmt(fill.fee, 6)} <span style={{ color: "#60727f" }}>({fmt(fill.feeRate * 100, 3)}%)</span></td><td style={td}>{fmt(fill.slippage, 6)}</td></tr>)}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}
