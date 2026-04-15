import type { PlatformSettings } from "../auth-client";

export type TickPayload = {
  bid: number;
  ask: number;
  last: number;
  spread: number;
  tickTime: string;
  volatilityTag?: string;
  symbol?: string;
};

export type BatchJobId =
  | "db-bootstrap"
  | "batch-clear-kline"
  | "batch-import-hl-day"
  | "batch-refresh-hl-day"
  | "batch-switch-active-symbol";

export type BatchJobDefinition = {
  id: BatchJobId;
  label: string;
  description: string;
};

export type SymbolOption = {
  source: string;
  symbol: string;
  coin: string;
  leverage: number;
  maxLeverage: number;
  szDecimals: number;
  quoteAsset: string;
};

export type BatchFormState = {
  exchange: string;
  symbol: string;
  coin: string;
  date: string;
  interval: string;
};

export type TickFormState = {
  symbol: string;
  bid: string;
  ask: string;
  last: string;
  spread: string;
};

export const HIDDEN_BATCH_JOB_IDS: BatchJobId[] = [
  "db-bootstrap",
  "batch-clear-kline",
  "batch-import-hl-day"
];

export const filterVisibleBatchJobs = (jobs: BatchJobDefinition[]): BatchJobDefinition[] =>
  jobs.filter((job) => !HIDDEN_BATCH_JOB_IDS.includes(job.id));

export const buildExchangeSelectOptions = (
  symbolOptions: SymbolOption[],
  selectedExchange: string
): Array<{ value: string; label: string }> => {
  const options = [...new Set(symbolOptions.map((entry) => entry.source))]
    .map((value) => ({ value, label: value }));

  if (selectedExchange && !options.some((entry) => entry.value === selectedExchange)) {
    options.unshift({ value: selectedExchange, label: selectedExchange });
  }

  return options;
};

export const filterSymbolsForExchange = (
  symbolOptions: SymbolOption[],
  exchange: string
): SymbolOption[] => symbolOptions.filter((entry) => entry.source === exchange);

export const buildActiveSymbolSelectOptions = (
  symbolsForSelectedExchange: SymbolOption[],
  coin: string,
  symbol: string
): Array<{ value: string; label: string }> => {
  const scopedSymbols = symbolsForSelectedExchange.filter((entry) => entry.coin === coin);
  const options = (scopedSymbols.length > 0 ? scopedSymbols : symbolsForSelectedExchange)
    .map((entry) => ({ value: entry.symbol, label: entry.symbol }));

  if (symbol && !options.some((entry) => entry.value === symbol)) {
    options.unshift({ value: symbol, label: symbol });
  }

  return options;
};

export const buildCoinSelectOptions = (
  symbolsForSelectedExchange: SymbolOption[],
  coin: string
): Array<{ value: string; label: string }> => {
  const options = [...new Set(symbolsForSelectedExchange.map((entry) => entry.coin))]
    .map((value) => ({ value, label: value }));

  if (coin && !options.some((entry) => entry.value === coin)) {
    options.unshift({ value: coin, label: coin });
  }

  return options;
};

export const syncTickFormFromLatestTick = (
  current: TickFormState,
  latestTick?: TickPayload
): TickFormState => {
  if (!latestTick) {
    return current;
  }

  return {
    symbol: latestTick.symbol ?? current.symbol,
    bid: latestTick.bid.toFixed(2),
    ask: latestTick.ask.toFixed(2),
    last: latestTick.last.toFixed(2),
    spread: latestTick.spread.toFixed(2)
  };
};

export const syncBatchFormWithActiveSymbol = (
  current: BatchFormState,
  settingsForm: PlatformSettings,
  symbolOptions: SymbolOption[]
): BatchFormState => {
  if (!settingsForm.activeSymbol) {
    return current;
  }

  const symbolMeta = symbolOptions.find((entry) => entry.symbol === settingsForm.activeSymbol);
  const exchange = settingsForm.activeExchange || symbolMeta?.source || current.exchange;
  const coin = symbolMeta?.coin ?? settingsForm.activeSymbol.replace(/-USD$/i, "");

  if (
    current.exchange === exchange
    && current.symbol === settingsForm.activeSymbol
    && current.coin === coin
  ) {
    return current;
  }

  return {
    ...current,
    exchange,
    symbol: settingsForm.activeSymbol,
    coin
  };
};

export const normalizeBatchFormForSymbolOptions = (
  current: BatchFormState,
  settingsForm: PlatformSettings,
  symbolOptions: SymbolOption[],
  symbolsForSelectedExchange: SymbolOption[]
): BatchFormState => {
  if (symbolOptions.length === 0) {
    return current;
  }

  const activeSymbolMeta = symbolOptions.find((entry) => entry.symbol === settingsForm.activeSymbol);
  const exchange = symbolsForSelectedExchange.length > 0
    ? current.exchange
    : settingsForm.activeExchange && symbolOptions.some((entry) => entry.source === settingsForm.activeExchange)
      ? settingsForm.activeExchange
      : activeSymbolMeta?.source ?? symbolOptions[0]?.source ?? current.exchange;
  const exchangeSymbols = symbolOptions.filter((entry) => entry.source === exchange);
  const coin = exchangeSymbols.some((entry) => entry.coin === current.coin)
    ? current.coin
    : activeSymbolMeta?.source === exchange
      ? activeSymbolMeta.coin
      : exchangeSymbols[0]?.coin ?? current.coin;
  const coinSymbols = exchangeSymbols.filter((entry) => entry.coin === coin);
  const symbol = coinSymbols.some((entry) => entry.symbol === current.symbol)
    ? current.symbol
    : activeSymbolMeta?.source === exchange && activeSymbolMeta.coin === coin
      ? activeSymbolMeta.symbol
      : coinSymbols[0]?.symbol ?? exchangeSymbols[0]?.symbol ?? current.symbol;

  if (exchange === current.exchange && symbol === current.symbol && coin === current.coin) {
    return current;
  }

  return {
    ...current,
    exchange,
    symbol,
    coin
  };
};

export const updateBatchFormForExchange = (
  current: BatchFormState,
  symbolOptions: SymbolOption[],
  exchange: string
): BatchFormState => {
  const exchangeSymbols = symbolOptions.filter((entry) => entry.source === exchange);
  const coin = exchangeSymbols.some((entry) => entry.coin === current.coin)
    ? current.coin
    : exchangeSymbols[0]?.coin ?? current.coin;
  const symbol = exchangeSymbols.find((entry) => entry.coin === coin)?.symbol
    ?? exchangeSymbols[0]?.symbol
    ?? current.symbol;

  return {
    ...current,
    exchange,
    coin,
    symbol
  };
};

export const updateBatchFormForSymbol = (
  current: BatchFormState,
  symbolOptions: SymbolOption[],
  symbol: string
): BatchFormState => {
  const symbolMeta = symbolOptions.find((entry) => entry.symbol === symbol);

  return {
    ...current,
    exchange: symbolMeta?.source ?? current.exchange,
    symbol,
    coin: symbolMeta?.coin ?? symbol.replace(/-USD$/i, "")
  };
};

export const updateBatchFormForCoin = (
  current: BatchFormState,
  symbolOptions: SymbolOption[],
  coin: string
): BatchFormState => {
  const coinSymbols = symbolOptions.filter((entry) => entry.source === current.exchange && entry.coin === coin);

  return {
    ...current,
    coin,
    symbol: coinSymbols.find((entry) => entry.symbol === current.symbol)?.symbol ?? coinSymbols[0]?.symbol ?? current.symbol
  };
};
