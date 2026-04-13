"use client";

import type { AppLocale, AuthUser } from "../auth-client";
import { HeaderBar } from "./components/HeaderBar";
import { MarketPanel } from "./components/MarketPanel";
import { AccountPanel } from "./components/AccountPanel";
import { BalancePanel } from "./components/BalancePanel";
import { OrderEntryPanel } from "./components/OrderEntryPanel";
import { PositionTpslPanel } from "./components/PositionTpslPanel";
import { OcoOrderPanel } from "./components/OcoOrderPanel";

export function TradingDashboardView({
  locale,
  viewer,
  onLocaleChange,
  onLogout,
  vm
}: {
  locale: AppLocale;
  viewer: AuthUser;
  onLocaleChange: (locale: AppLocale) => void;
  onLogout: () => void;
  vm: any;
}) {
  return (
    <main style={{ minHeight: "100dvh", width: "100%", background: "#071116", color: "#dbe7ef", padding: 0, fontFamily: "\"Segoe UI\", sans-serif" }}>
      <div style={{ display: "grid", gap: 8, padding: 0, boxSizing: "border-box", position: "relative" }}>
        <HeaderBar locale={locale} viewer={viewer} onLocaleChange={onLocaleChange} onLogout={onLogout} vm={vm} />

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(300px,360px)", gap: 8, minHeight: 0, padding: "0 8px 8px", alignItems: "stretch" }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.8fr) minmax(300px,360px)", gap: 8, minHeight: 0, alignItems: "stretch" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0, height: "100%" }}>
              <MarketPanel locale={locale} vm={vm} chartOnly />
              <AccountPanel vm={vm} />
            </div>
            <MarketPanel locale={locale} vm={vm} bookOnly />
          </div>

          <div style={{ position: "sticky", top: 88, alignSelf: "stretch", minHeight: 0, height: "100%", overflow: "hidden" }}>
            <div style={{ position: "relative", height: "100%" }}>
              <BalancePanel vm={vm} />
              <OrderEntryPanel vm={vm} popup open={vm.tradePanelOpen} onClose={() => vm.setTradePanelOpen(false)} />
              <OcoOrderPanel vm={vm} open={vm.ocoPanelOpen} onClose={() => vm.setOcoPanelOpen(false)} />
            </div>
          </div>
        </div>
        <PositionTpslPanel vm={vm} open={vm.positionTpslPanelOpen} onClose={() => vm.setPositionTpslPanelOpen(false)} />
      </div>
    </main>
  );
}
