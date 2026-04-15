"use client";

import { box, btnInline, td, th } from "../styles";
import { TabButton } from "./primitives";
import { dateTime, fmt } from "../utils";

export function AccountPanel({ vm }: { vm: any }) {
  const { state, t } = vm;
  const renderHistoricalTriggerPrice = (order: any) => {
    if (order.status === "triggerPending" || order.status === "waitingForParent") {
      return "";
    }

    if (order.triggerCondition?.triggerPx) {
      return fmt(Number(order.triggerCondition.triggerPx), vm.priceDigits);
    }

    if (order.averageFillPrice != null && Number.isFinite(order.averageFillPrice)) {
      return fmt(Number(order.averageFillPrice), vm.priceDigits);
    }

    if (order.limitPrice != null && Number.isFinite(order.limitPrice)) {
      return fmt(Number(order.limitPrice), vm.priceDigits);
    }

    return "";
  };

  const renderHistoricalTpsl = (order: any) => {
    if (order.kind !== "trigger") {
      return "--";
    }

    const displayPrice = order.averageFillPrice != null && Number.isFinite(order.averageFillPrice)
      ? fmt(Number(order.averageFillPrice), vm.priceDigits)
      : order.limitPrice != null && Number.isFinite(order.limitPrice)
        ? fmt(Number(order.limitPrice), vm.priceDigits)
        : "";

    if (order.grouping === "normalTpsl") {
      return `${t.ocoTag}${displayPrice ? ` (${displayPrice})` : ""}`;
    }

    if (order.triggerCondition?.tpsl === "tp") {
      return `${t.takeProfitShort}${displayPrice ? ` (${displayPrice})` : ""}`;
    }

    if (order.triggerCondition?.tpsl === "sl") {
      return `${t.stopLossShort}${displayPrice ? ` (${displayPrice})` : ""}`;
    }

    return "--";
  };

  const renderHistoricalType = (order: any) => {
    if (order.kind !== "trigger") {
      return order.orderType;
    }

    if (order.grouping === "normalTpsl") {
      return `${t.ocoTag} ${order.orderType === "market" ? t.market : t.limit}`;
    }

    return `${order.triggerCondition?.tpsl === "tp" ? t.takeProfit : t.stopLoss} ${order.orderType === "market" ? t.market : t.limit}`;
  };

  const pagination = (page: number, total: number, onChange: (page: number) => void) => (
    <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, padding: "10px 12px", borderTop: "1px solid #16262f" }}>
      <button onClick={() => onChange(Math.max(1, page - 1))} disabled={page <= 1} style={{ ...btnInline, opacity: page <= 1 ? 0.45 : 1 }}>{t.previousPage}</button>
      <span style={{ color: "#7e97a5", fontSize: 12 }}>{t.pageIndicator.replace("{page}", String(page)).replace("{total}", String(total))}</span>
      <button onClick={() => onChange(Math.min(total, page + 1))} disabled={page >= total} style={{ ...btnInline, opacity: page >= total ? 0.45 : 1 }}>{t.nextPage}</button>
    </div>
  );

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
            <tbody>{!state.position || state.position.side === "flat" ? <tr><td colSpan={10} style={{ padding: 18, color: "#60727f", textAlign: "center" }}>{t.noPosition}</td></tr> : <tr style={{ borderTop: "1px solid #13212a" }}><td style={td}>{state.position.symbol}</td><td style={{ ...td, color: state.position.side === "long" ? "#2dd4bf" : "#f87171" }}>{state.position.side}</td><td style={td}>{fmt(state.position.quantity, 4)}</td><td style={td}>{fmt(state.position.averageEntryPrice, vm.priceDigits)}</td><td style={{ ...td, color: vm.takeProfitOrder ? "#22c55e" : "#60727f", fontWeight: vm.takeProfitOrder ? 700 : 400 }}>{vm.takeProfitOrder?.triggerCondition?.triggerPx ? fmt(Number(vm.takeProfitOrder.triggerCondition.triggerPx), vm.priceDigits) : "-"}</td><td style={td}>{fmt(state.position.markPrice, vm.priceDigits)}</td><td style={{ ...td, color: vm.stopLossOrder ? "#f59e0b" : "#60727f", fontWeight: vm.stopLossOrder ? 700 : 400 }}>{vm.stopLossOrder?.triggerCondition?.triggerPx ? fmt(Number(vm.stopLossOrder.triggerCondition.triggerPx), vm.priceDigits) : "-"}</td><td style={td}>{state.position.liquidationPrice > 0 ? fmt(state.position.liquidationPrice, vm.priceDigits) : "-"}</td><td style={{ ...td, color: state.position.unrealizedPnl > 0 ? "#2dd4bf" : state.position.unrealizedPnl < 0 ? "#f87171" : "#dbe7ef" }}>{fmt(state.position.unrealizedPnl, 4)} USDC</td><td style={td}><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button onClick={() => vm.openPositionTpslPanel()} style={btnInline}>{vm.hasActiveOcoChildren ? t.editOcoChildren : vm.hasPositionTpsl ? t.managePositionTpsl : t.addPositionTpsl}</button><button onClick={() => void vm.closePosition()} style={btnInline}>{t.closePosition}</button></div></td></tr>}</tbody>
          </table>
        ) : vm.accountTab === "openOrders" ? (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ color: "#7e97a5", textAlign: "left" }}><th style={th}>{t.order}</th><th style={th}>{t.side}</th><th style={th}>{t.type}</th><th style={th}>{t.contracts}</th><th style={th}>{t.filled}</th><th style={th}>{t.status}</th><th style={th}>{t.action}</th></tr></thead>
            <tbody>{vm.openOrderRows.length === 0 ? <tr><td colSpan={7} style={{ padding: 18, color: "#60727f", textAlign: "center" }}>{t.noOpenOrders}</td></tr> : vm.openOrderRows.map((order: any) => <tr key={order.id} style={{ borderTop: "1px solid #13212a" }}><td style={td}>{order.id}</td><td style={{ ...td, color: order.side === "buy" ? "#2dd4bf" : "#f87171" }}>{order.side}</td><td style={td}>{order.type}</td><td style={td}>{fmt(order.quantity)}</td><td style={td}>{fmt(order.filledQuantity)}</td><td style={td}>{order.status}</td><td style={td}><button onClick={() => void vm.cancelOrder(order.cancelOid)} style={btnInline}>{t.cancel}</button></td></tr>)}</tbody>
          </table>
        ) : vm.accountTab === "orderHistory" ? (
          <div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ color: "#7e97a5", textAlign: "left" }}><th style={th}>{t.time}</th><th style={th}>{t.type}</th><th style={th}>{t.side}</th><th style={th}>{t.contracts}</th><th style={th}>{t.price}</th><th style={th}>{t.triggerPrice}</th><th style={th}>{t.takeProfitShort}/{t.stopLossShort}</th><th style={th}>{t.status}</th><th style={th}>{t.order}</th></tr></thead>
              <tbody>{vm.historicalOrders.length === 0 ? <tr><td colSpan={9} style={{ padding: 18, color: "#60727f", textAlign: "center" }}>{t.noOrderHistory}</td></tr> : vm.pagedHistoricalOrders.map((order: any) => <tr key={`${order.kind}-${order.orderId}-${order.updatedAt}`} style={{ borderTop: "1px solid #13212a" }}><td style={td}>{dateTime(order.updatedAt)}</td><td style={td}>{renderHistoricalType(order)}</td><td style={{ ...td, color: order.side === "buy" ? "#2dd4bf" : "#f87171" }}>{order.side}</td><td style={td}>{fmt(order.quantity, 4)}</td><td style={td}>{order.limitPrice != null ? fmt(order.limitPrice, vm.priceDigits) : order.averageFillPrice != null ? fmt(order.averageFillPrice, vm.priceDigits) : order.orderType === "market" ? "Market" : "-"}</td><td style={{ ...td, color: order.grouping === "normalTpsl" ? "#60a5fa" : order.triggerCondition?.tpsl === "tp" ? "#22c55e" : order.triggerCondition?.tpsl === "sl" ? "#f59e0b" : "#dbe7ef" }}>{renderHistoricalTriggerPrice(order)}</td><td style={{ ...td, color: order.grouping === "normalTpsl" ? "#93c5fd" : order.triggerCondition?.tpsl === "tp" ? "#22c55e" : order.triggerCondition?.tpsl === "sl" ? "#f59e0b" : "#60727f" }}>{renderHistoricalTpsl(order)}</td><td style={td}>{order.status}</td><td style={td}>{order.orderId}</td></tr>)}</tbody>
            </table>
            {vm.historicalOrders.length > 0 ? pagination(vm.orderHistoryPage, vm.orderHistoryPageCount, vm.setOrderHistoryPage) : null}
          </div>
        ) : (
          <div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ color: "#7e97a5", textAlign: "left" }}><th style={th}>{t.time}</th><th style={th}>{t.order}</th><th style={th}>{t.side}</th><th style={th}>{t.type}</th><th style={th}>{t.role}</th><th style={th}>{t.entryPrice}</th><th style={th}>{t.exitPrice}</th><th style={th}>{t.contracts}</th><th style={th}>{t.realizedPnl}</th><th style={th}>{t.fee}</th><th style={th}>{t.slippage}</th><th style={th}>{t.action}</th></tr></thead>
              <tbody>{vm.personalFills.length === 0 ? <tr><td colSpan={12} style={{ padding: 18, color: "#60727f", textAlign: "center" }}>{t.noFills}</td></tr> : vm.pagedPersonalFills.map((fill: any) => <tr key={fill.id} style={{ borderTop: "1px solid #13212a" }}><td style={td}>{dateTime(fill.filledAt)}</td><td style={td}>{fill.orderId}</td><td style={{ ...td, color: fill.side === "buy" ? "#2dd4bf" : "#f87171" }}>{fill.side}</td><td style={td}>{fill.orderType}</td><td style={{ ...td, textTransform: "uppercase", color: fill.liquidityRole === "maker" ? "#22c55e" : "#f59e0b" }}>{fill.liquidityRole}</td><td style={td}>{fmt(fill.entryPrice, vm.priceDigits)}</td><td style={td}>{fill.exitPrice != null ? fmt(fill.exitPrice, vm.priceDigits) : "-"}</td><td style={td}>{fmt(fill.quantity, 4)}</td><td style={{ ...td, color: fill.realizedPnl > 0 ? "#2dd4bf" : fill.realizedPnl < 0 ? "#f87171" : "#dbe7ef" }}>{fmt(fill.realizedPnl, 4)} USDC</td><td style={td}>{fmt(fill.fee, 6)} <span style={{ color: "#60727f" }}>({fmt(fill.feeRate * 100, 3)}%)</span></td><td style={td}>{fmt(fill.slippage, 6)}</td><td style={td}>{fill.closesPosition ? <a href={`/trade/fills/${encodeURIComponent(fill.id)}/replay`} style={{ ...btnInline, textDecoration: "none", display: "inline-block" }}>Replay</a> : <span style={{ color: "#60727f" }}>--</span>}</td></tr>)}</tbody>
            </table>
            {vm.personalFills.length > 0 ? pagination(vm.fillsPage, vm.fillsPageCount, vm.setFillsPage) : null}
          </div>
        )}
      </div>
    </div>
  );
}
