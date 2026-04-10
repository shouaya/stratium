"use client";

import { APP_LOCALES, LOCALE_LABELS } from "../../i18n";
import type { AppLocale, AuthUser } from "../../auth-client";
import { box, btnInline, selectStyle } from "../styles";
import { Metric } from "./primitives";
import { clock, fmt, getLocaleText } from "../utils";

export function HeaderBar({
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
  const { ui, state } = vm;

  return (
    <div style={{ ...box("12px 16px"), position: "sticky", top: 0, zIndex: 20, borderRadius: 0, backdropFilter: "blur(10px)", background: "rgba(11, 22, 29, 0.92)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "320px minmax(0,1fr) auto", gap: 16, alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src="/favicon.png" alt="Stratium" width={48} height={48} style={{ width: 48, height: 48, borderRadius: 12, objectFit: "cover", boxShadow: "0 8px 24px rgba(15, 23, 42, 0.28)" }} />
          <div>
            <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.1 }}>Stratium</div>
            <div style={{ color: "#7e97a5", fontSize: 12, marginTop: 2 }}>{vm.contractCoin} perpetual market replica</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          <Metric label={getLocaleText(locale, "价格", "価格", "Price")} value={fmt(vm.stats.last, vm.priceDigits)} strong />
          <Metric label="24h Change" value={`${fmt(vm.stats.change, 2)}%`} tone={vm.stats.change && vm.stats.change < 0 ? "down" : "up"} />
          <Metric label="24h Low" value={fmt(vm.stats.low, vm.priceDigits)} />
          <Metric label="24h High" value={fmt(vm.stats.high, vm.priceDigits)} />
          <Metric label="Mark" value={fmt(state.market?.assetCtx?.markPrice ?? state.market?.markPrice, vm.priceDigits)} />
          <Metric label="Oracle" value={fmt(state.market?.assetCtx?.oraclePrice, vm.priceDigits)} />
          <Metric label="Funding" value={state.market?.assetCtx?.fundingRate != null ? `${fmt(state.market.assetCtx.fundingRate * 100, 4)}%` : "-"} />
          <Metric label="OI" value={fmt(state.market?.assetCtx?.openInterest, 3)} />
          <Metric label="24h Volume" value={state.market?.assetCtx?.dayNotionalVolume != null ? `$${fmt(state.market.assetCtx.dayNotionalVolume, 2)}` : "-"} />
          <Metric label={getLocaleText(locale, "时间", "時刻", "Clock")} value={clock(state.latestTick?.tickTime)} />
        </div>
        <div style={{ justifySelf: "end", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", justifyContent: "flex-end", textAlign: "right" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#7e97a5", fontSize: 11 }}>{ui.common.language}</span>
            <select value={locale} onChange={(event) => onLocaleChange(event.target.value as AppLocale)} style={selectStyle}>
              {APP_LOCALES.map((entry) => <option key={entry} value={entry}>{LOCALE_LABELS[entry]}</option>)}
            </select>
          </div>
          <div>
            <div style={{ color: "#56d7c4", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.16em" }}>{viewer.displayName}</div>
            <div style={{ color: "#9ab0bc", fontSize: 12 }}>{viewer.username}</div>
          </div>
          <button onClick={onLogout} style={btnInline}>{ui.trader.signOut}</button>
        </div>
      </div>
    </div>
  );
}
