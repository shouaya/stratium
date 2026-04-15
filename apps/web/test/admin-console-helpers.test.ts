import { describe, expect, it } from "vitest";
import {
  buildActiveSymbolSelectOptions,
  buildCoinSelectOptions,
  buildExchangeSelectOptions,
  filterSymbolsForExchange,
  filterVisibleBatchJobs,
  normalizeBatchFormForSymbolOptions,
  syncBatchFormWithActiveSymbol,
  syncTickFormFromLatestTick,
  updateBatchFormForCoin,
  updateBatchFormForExchange,
  updateBatchFormForSymbol,
  type BatchFormState,
  type BatchJobDefinition,
  type SymbolOption,
  type TickFormState
} from "../app/admin/admin-console-helpers";

const symbolOptions: SymbolOption[] = [
  { source: "hyperliquid", symbol: "BTC-USD", coin: "BTC", leverage: 10, maxLeverage: 20, szDecimals: 5, quoteAsset: "USDC" },
  { source: "hyperliquid", symbol: "ETH-USD", coin: "ETH", leverage: 10, maxLeverage: 20, szDecimals: 4, quoteAsset: "USDC" },
  { source: "binance", symbol: "SOL-USD", coin: "SOL", leverage: 5, maxLeverage: 10, szDecimals: 3, quoteAsset: "USDT" }
];

const baseBatchForm: BatchFormState = {
  exchange: "hyperliquid",
  symbol: "BTC-USD",
  coin: "BTC",
  date: "2026-04-15",
  interval: "1m"
};

describe("admin console helpers", () => {
  it("filters hidden jobs and keeps visible operational entries", () => {
    const jobs: BatchJobDefinition[] = [
      { id: "db-bootstrap", label: "DB Bootstrap", description: "" },
      { id: "batch-refresh-hl-day", label: "Refresh", description: "" },
      { id: "batch-switch-active-symbol", label: "Switch", description: "" }
    ];

    expect(filterVisibleBatchJobs(jobs).map((job) => job.id)).toEqual([
      "batch-refresh-hl-day",
      "batch-switch-active-symbol"
    ]);
  });

  it("builds select options and preserves currently selected fallback values", () => {
    expect(buildExchangeSelectOptions(symbolOptions, "bybit").map((entry) => entry.value)).toEqual([
      "bybit",
      "hyperliquid",
      "binance"
    ]);

    const exchangeSymbols = filterSymbolsForExchange(symbolOptions, "hyperliquid");
    expect(buildActiveSymbolSelectOptions(exchangeSymbols, "DOGE", "DOGE-USD").map((entry) => entry.value)).toEqual([
      "DOGE-USD",
      "BTC-USD",
      "ETH-USD"
    ]);
    expect(buildCoinSelectOptions(exchangeSymbols, "DOGE").map((entry) => entry.value)).toEqual([
      "DOGE",
      "BTC",
      "ETH"
    ]);
    expect(buildActiveSymbolSelectOptions(exchangeSymbols, "BTC", "BTC-USD").map((entry) => entry.value)).toEqual([
      "BTC-USD"
    ]);
    expect(buildCoinSelectOptions(exchangeSymbols, "BTC").map((entry) => entry.value)).toEqual([
      "BTC",
      "ETH"
    ]);
  });

  it("syncs forms from latest tick and active symbol settings", () => {
    const tickForm: TickFormState = {
      symbol: "BTC-USD",
      bid: "",
      ask: "",
      last: "",
      spread: ""
    };

    expect(syncTickFormFromLatestTick(tickForm, {
      symbol: "ETH-USD",
      bid: 99.1,
      ask: 100.2,
      last: 99.8,
      spread: 1.1,
      tickTime: "2026-04-15T08:00:00.000Z"
    })).toEqual({
      symbol: "ETH-USD",
      bid: "99.10",
      ask: "100.20",
      last: "99.80",
      spread: "1.10"
    });
    expect(syncTickFormFromLatestTick(tickForm, {
      bid: 88,
      ask: 89,
      last: 88.5,
      spread: 1,
      tickTime: "2026-04-15T08:00:00.000Z"
    })).toEqual({
      symbol: "BTC-USD",
      bid: "88.00",
      ask: "89.00",
      last: "88.50",
      spread: "1.00"
    });

    expect(syncBatchFormWithActiveSymbol(baseBatchForm, {
      platformName: "Stratium Demo",
      platformAnnouncement: "",
      activeExchange: "binance",
      activeSymbol: "SOL-USD",
      maintenanceMode: false,
      allowFrontendTrading: true,
      allowManualTicks: true
    }, symbolOptions)).toEqual({
      ...baseBatchForm,
      exchange: "binance",
      symbol: "SOL-USD",
      coin: "SOL"
    });
    expect(syncBatchFormWithActiveSymbol(baseBatchForm, {
      platformName: "Stratium Demo",
      platformAnnouncement: "",
      activeExchange: "",
      activeSymbol: "ETH-USD",
      maintenanceMode: false,
      allowFrontendTrading: true,
      allowManualTicks: true
    }, symbolOptions)).toEqual({
      ...baseBatchForm,
      exchange: "hyperliquid",
      symbol: "ETH-USD",
      coin: "ETH"
    });
    expect(syncBatchFormWithActiveSymbol(baseBatchForm, {
      platformName: "Stratium Demo",
      platformAnnouncement: "",
      activeExchange: "",
      activeSymbol: "SUI-USD",
      maintenanceMode: false,
      allowFrontendTrading: true,
      allowManualTicks: true
    }, symbolOptions)).toEqual({
      ...baseBatchForm,
      exchange: "hyperliquid",
      symbol: "SUI-USD",
      coin: "SUI"
    });
    expect(syncBatchFormWithActiveSymbol(baseBatchForm, {
      platformName: "Stratium Demo",
      platformAnnouncement: "",
      activeExchange: "hyperliquid",
      activeSymbol: "BTC-USD",
      maintenanceMode: false,
      allowFrontendTrading: true,
      allowManualTicks: true
    }, symbolOptions)).toBe(baseBatchForm);

    expect(syncTickFormFromLatestTick(tickForm)).toBe(tickForm);
    expect(syncBatchFormWithActiveSymbol(baseBatchForm, {
      platformName: "Stratium Demo",
      platformAnnouncement: "",
      activeExchange: "hyperliquid",
      activeSymbol: "",
      maintenanceMode: false,
      allowFrontendTrading: true,
      allowManualTicks: true
    }, symbolOptions)).toBe(baseBatchForm);
  });

  it("normalizes batch form against available symbols and keeps valid selections", () => {
    expect(normalizeBatchFormForSymbolOptions(baseBatchForm, {
      platformName: "Stratium Demo",
      platformAnnouncement: "",
      activeExchange: "hyperliquid",
      activeSymbol: "BTC-USD",
      maintenanceMode: false,
      allowFrontendTrading: true,
      allowManualTicks: true
    }, [], [])).toBe(baseBatchForm);

    expect(normalizeBatchFormForSymbolOptions({
      ...baseBatchForm,
      exchange: "bybit",
      symbol: "XRP-USD",
      coin: "XRP"
    }, {
      platformName: "Stratium Demo",
      platformAnnouncement: "",
      activeExchange: "hyperliquid",
      activeSymbol: "ETH-USD",
      maintenanceMode: false,
      allowFrontendTrading: true,
      allowManualTicks: true
    }, symbolOptions, [])).toEqual({
      ...baseBatchForm,
      exchange: "hyperliquid",
      symbol: "ETH-USD",
      coin: "ETH"
    });

    expect(normalizeBatchFormForSymbolOptions({
      ...baseBatchForm,
      exchange: "binance",
      symbol: "SOL-USD",
      coin: "BTC"
    }, {
      platformName: "Stratium Demo",
      platformAnnouncement: "",
      activeExchange: "binance",
      activeSymbol: "SOL-USD",
      maintenanceMode: false,
      allowFrontendTrading: true,
      allowManualTicks: true
    }, symbolOptions, filterSymbolsForExchange(symbolOptions, "binance"))).toEqual({
      ...baseBatchForm,
      exchange: "binance",
      symbol: "SOL-USD",
      coin: "SOL"
    });
    expect(normalizeBatchFormForSymbolOptions({
      ...baseBatchForm,
      exchange: "hyperliquid",
      symbol: "UNKNOWN-USD",
      coin: "DOGE"
    }, {
      platformName: "Stratium Demo",
      platformAnnouncement: "",
      activeExchange: "binance",
      activeSymbol: "SOL-USD",
      maintenanceMode: false,
      allowFrontendTrading: true,
      allowManualTicks: true
    }, symbolOptions, [])).toEqual({
      ...baseBatchForm,
      exchange: "binance",
      symbol: "SOL-USD",
      coin: "SOL"
    });
    expect(normalizeBatchFormForSymbolOptions({
      ...baseBatchForm,
      exchange: "binance",
      symbol: "UNKNOWN-USD",
      coin: "DOGE"
    }, {
      platformName: "Stratium Demo",
      platformAnnouncement: "",
      activeExchange: "",
      activeSymbol: "SOL-USD",
      maintenanceMode: false,
      allowFrontendTrading: true,
      allowManualTicks: true
    }, symbolOptions, filterSymbolsForExchange(symbolOptions, "binance"))).toEqual({
      ...baseBatchForm,
      exchange: "binance",
      symbol: "SOL-USD",
      coin: "SOL"
    });

    expect(normalizeBatchFormForSymbolOptions({
      ...baseBatchForm,
      exchange: "kraken",
      symbol: "UNKNOWN-USD",
      coin: "DOGE"
    }, {
      platformName: "Stratium Demo",
      platformAnnouncement: "",
      activeExchange: "kraken",
      activeSymbol: "UNKNOWN-USD",
      maintenanceMode: false,
      allowFrontendTrading: true,
      allowManualTicks: true
    }, symbolOptions, [])).toEqual({
      ...baseBatchForm,
      exchange: "hyperliquid",
      symbol: "BTC-USD",
      coin: "BTC"
    });

    expect(normalizeBatchFormForSymbolOptions(baseBatchForm, {
      platformName: "Stratium Demo",
      platformAnnouncement: "",
      activeExchange: "hyperliquid",
      activeSymbol: "BTC-USD",
      maintenanceMode: false,
      allowFrontendTrading: true,
      allowManualTicks: true
    }, symbolOptions, filterSymbolsForExchange(symbolOptions, "hyperliquid"))).toBe(baseBatchForm);
  });

  it("updates batch form for exchange, symbol, and coin selections", () => {
    expect(updateBatchFormForExchange(baseBatchForm, symbolOptions, "binance")).toEqual({
      ...baseBatchForm,
      exchange: "binance",
      coin: "SOL",
      symbol: "SOL-USD"
    });
    expect(updateBatchFormForExchange({
      ...baseBatchForm,
      exchange: "hyperliquid",
      symbol: "ETH-USD",
      coin: "ETH"
    }, symbolOptions, "hyperliquid")).toEqual({
      ...baseBatchForm,
      exchange: "hyperliquid",
      symbol: "ETH-USD",
      coin: "ETH"
    });

    expect(updateBatchFormForSymbol(baseBatchForm, symbolOptions, "ETH-USD")).toEqual({
      ...baseBatchForm,
      exchange: "hyperliquid",
      coin: "ETH",
      symbol: "ETH-USD"
    });

    expect(updateBatchFormForCoin({
      ...baseBatchForm,
      exchange: "hyperliquid",
      symbol: "BTC-USD",
      coin: "BTC"
    }, symbolOptions, "ETH")).toEqual({
      ...baseBatchForm,
      exchange: "hyperliquid",
      coin: "ETH",
      symbol: "ETH-USD"
    });

    expect(updateBatchFormForExchange(baseBatchForm, [], "okx")).toEqual({
      ...baseBatchForm,
      exchange: "okx",
      coin: "BTC",
      symbol: "BTC-USD"
    });

    expect(updateBatchFormForSymbol(baseBatchForm, [], "SUI-USD")).toEqual({
      ...baseBatchForm,
      exchange: "hyperliquid",
      coin: "SUI",
      symbol: "SUI-USD"
    });

    expect(updateBatchFormForCoin({
      ...baseBatchForm,
      exchange: "binance",
      symbol: "SOL-USD",
      coin: "SOL"
    }, symbolOptions, "BTC")).toEqual({
      ...baseBatchForm,
      exchange: "binance",
      symbol: "SOL-USD",
      coin: "BTC"
    });
  });
});
