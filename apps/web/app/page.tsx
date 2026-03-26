import { TradingDashboard } from "./trading-dashboard";

export default function HomePage() {
  return <TradingDashboard apiBaseUrl={process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000"} />;
}
