"use client";

import { CandlestickChart } from "../../candlestick-chart";
import type { AppLocale } from "../../auth-client";
import { bookHead, box, chipButton, tabActive, tabIdle } from "../styles";
import { BookRow } from "./primitives";
import { clock, fmt, getLocaleText } from "../utils";

export function MarketPanel({
  locale,
  vm,
  chartOnly = false,
  bookOnly = false
}: {
  locale: AppLocale;
  vm: any;
  chartOnly?: boolean;
  bookOnly?: boolean;
}) {
  const { state, message, t, ui } = vm;
  const panelShellStyle = bookOnly
    ? {
      ...box(),
      position: "sticky" as const,
      top: 88,
      height: "calc(100dvh - 96px)",
      display: "flex",
      flexDirection: "column" as const,
      minHeight: 0
    }
    : {
      ...box(),
      display: "flex",
      flexDirection: "column" as const,
      minHeight: 0
    };

  return (
    <>
      {!bookOnly ? (
        <div style={box()}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid #16262f", color: "#7e97a5", fontSize: 12 }}>
            <div style={{ display: "flex", gap: 10 }}>
              {vm.timeframes.map((entry: any) => (
                <button key={entry.id} onClick={() => vm.setTimeframe(entry.id)} style={chipButton(vm.timeframe === entry.id)} title={entry.hint}>
                  {entry.label}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <span>{getLocaleText(locale, "指标", "指標", "Indicators")}</span>
              <span>{getLocaleText(locale, "绘图", "描画", "Drawing")}</span>
              <span>{getLocaleText(locale, "布局", "レイアウト", "Layout")}</span>
            </div>
          </div>
          <div style={{ padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{vm.contractCoin} Perp</div>
                <div style={{ color: "#7e97a5", fontSize: 12 }}>
                  {message || state.platform?.platformAnnouncement || `${getLocaleText(locale, "已就绪", "準備完了", "Ready")} · ${vm.selectedTimeframe.label} mode · Hyperliquid`}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: vm.stats.change && vm.stats.change < 0 ? "#f87171" : "#2dd4bf", fontSize: 22, fontWeight: 700 }}>{fmt(vm.stats.last, vm.priceDigits)}</div>
                <div style={{ color: "#7e97a5", fontSize: 12 }}>
                  {getLocaleText(locale, "点差", "スプレッド", "Spread")} {fmt(state.latestTick?.spread, 4)} · {state.market?.connected ? "Hyperliquid live" : getLocaleText(locale, "等待实时行情", "ライブ相場待機中", "waiting for live market")} · {vm.selectedTimeframe.hint}
                </div>
              </div>
            </div>
            <CandlestickChart data={vm.candles} volumeData={vm.volume} dark priceDigits={vm.priceDigits} position={state.position} triggerOrders={[...vm.activeOcoOrders, ...vm.activePositionTpslOrders]} />
          </div>
        </div>
      ) : null}

      {!chartOnly ? (
        <div style={panelShellStyle}>
          <div style={{ display: "flex", gap: 2, padding: 10, borderBottom: "1px solid #16262f" }}>
            <button onClick={() => vm.setBookTab("book")} style={vm.bookTab === "book" ? tabActive : tabIdle}>{t.orderBook}</button>
            <button onClick={() => vm.setBookTab("trades")} style={vm.bookTab === "trades" ? tabActive : tabIdle}>{t.trades}</button>
        </div>
        {vm.bookTab === "book" ? (
          <div style={{ padding: 14, flex: 1, overflowY: "auto", minHeight: 0 }}>
            <div style={bookHead}><span>{t.price}</span><span>{t.sizeContracts}</span><span>{t.totalContracts}</span></div>
            {vm.bookWithDepth.asks.map((row: any) => <BookRow key={`a-${row.price}`} price={row.price} size={row.size} total={row.total} tone="ask" maxTotal={vm.bookWithDepth.maxAskTotal} priceDigits={vm.priceDigits} />)}
            <div style={{ display: "flex", justifyContent: "space-between", margin: "10px 0", padding: "8px 10px", borderRadius: 8, background: "#10222c", fontSize: 12 }}><span>{ui.admin.spread}</span><strong>{fmt(state.latestTick?.spread, 4)}</strong></div>
            {vm.bookWithDepth.bids.map((row: any) => <BookRow key={`b-${row.price}`} price={row.price} size={row.size} total={row.total} tone="bid" maxTotal={vm.bookWithDepth.maxBidTotal} priceDigits={vm.priceDigits} />)}
          </div>
        ) : (
          <div style={{ padding: 14, display: "grid", gap: 8, flex: 1, overflowY: "auto", minHeight: 0 }}>
            <div style={bookHead}><span>{t.time}</span><span>{t.price}</span><span>{t.contracts}</span></div>
            {vm.trades.length === 0 ? <div style={{ color: "#60727f" }}>{t.noTrades}</div> : vm.trades.map((trade: any) => <div key={trade.id} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, opacity: trade.source === "tape" ? 0.84 : 1 }}><span>{clock(trade.time)}</span><strong style={{ color: trade.side === "sell" ? "#f87171" : "#2dd4bf" }}>{fmt(trade.price, vm.priceDigits)}</strong><span>{fmt(trade.size, 4)}</span></div>)}
          </div>
        )}
      </div>
      ) : null}
    </>
  );
}
