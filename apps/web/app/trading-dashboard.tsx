"use client";

import type { DashboardViewProps } from "./trading-dashboard/types";
import { useTradingDashboard } from "./trading-dashboard/use-trading-dashboard";
import { TradingDashboardView } from "./trading-dashboard/TradingDashboardView";

export function TradingDashboard(props: DashboardViewProps) {
  const viewModel = useTradingDashboard(props);

  return (
    <TradingDashboardView
      locale={props.locale}
      viewer={props.viewer}
      onLocaleChange={props.onLocaleChange}
      onLogout={props.onLogout}
      vm={viewModel}
    />
  );
}
