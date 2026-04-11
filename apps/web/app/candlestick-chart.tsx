"use client";

import { useEffect, useRef } from "react";
import {
  ColorType,
  CrosshairMode,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  TickMarkType,
  type UTCTimestamp
} from "lightweight-charts";
import type { PositionView } from "@stratium/shared";
import type { FrontendOpenOrder } from "./trading-dashboard/types";

const TOKYO_TIMEZONE = "Asia/Tokyo";

const formatTokyoTime = (unixSeconds: number, withDate = false) => new Intl.DateTimeFormat("ja-JP", {
  timeZone: TOKYO_TIMEZONE,
  month: withDate ? "2-digit" : undefined,
  day: withDate ? "2-digit" : undefined,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
}).format(new Date(unixSeconds * 1000));

export function CandlestickChart({
  data,
  volumeData = [],
  dark = false,
  priceDigits = 4,
  position,
  triggerOrders = []
}: {
  data: CandlestickData<UTCTimestamp>[];
  volumeData?: HistogramData<UTCTimestamp>[];
  dark?: boolean;
  priceDigits?: number;
  position?: PositionView | null;
  triggerOrders?: FrontendOpenOrder[];
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const legendRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const hasFitInitialContentRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: {
          type: ColorType.Solid,
          color: dark ? "#0b161d" : "#fffaf2"
        },
        textColor: dark ? "#8ca1ad" : "#3b2f25"
      },
      grid: {
        vertLines: { color: dark ? "#15252d" : "#eadfcc" },
        horzLines: { color: dark ? "#15252d" : "#eadfcc" }
      },
      rightPriceScale: {
        borderColor: dark ? "#16262f" : "#d2c4ae",
        autoScale: true
      },
      timeScale: {
        borderColor: dark ? "#16262f" : "#d2c4ae",
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: Time, tickMarkType: TickMarkType) => {
          const unixSeconds = Number(time);

          if (!Number.isFinite(unixSeconds)) {
            return "";
          }

          return formatTokyoTime(
            unixSeconds,
            tickMarkType === TickMarkType.DayOfMonth || tickMarkType === TickMarkType.Month
          );
        }
      },
      localization: {
        timeFormatter: (time: Time) => {
          const unixSeconds = Number(time);

          return Number.isFinite(unixSeconds) ? formatTokyoTime(unixSeconds, true) : "";
        }
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true
      },
      handleScale: {
        axisPressedMouseMove: {
          time: true,
          price: true
        },
        mouseWheel: true,
        pinch: true
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: dark ? "#496170" : "#8e7f69" },
        horzLine: { color: dark ? "#496170" : "#8e7f69" }
      }
    });

    const candles = chart.addCandlestickSeries({
      upColor: "#2dd4bf",
      borderUpColor: "#2dd4bf",
      wickUpColor: "#2dd4bf",
      downColor: "#f87171",
      borderDownColor: "#f87171",
      wickDownColor: "#f87171"
    });

    const volumes = chart.addHistogramSeries({
      priceScaleId: "",
      base: 0
    });

    chart.priceScale("").applyOptions({
      scaleMargins: {
        top: 0.78,
        bottom: 0
      }
    });

    chartRef.current = chart;
    candleRef.current = candles;
    volumeRef.current = volumes;

    const formatPrice = (value: number) => value.toLocaleString("en-US", {
      minimumFractionDigits: priceDigits,
      maximumFractionDigits: priceDigits
    });

    const updateLegend = (param?: MouseEventParams<Time>) => {
      if (!legendRef.current) {
        return;
      }

      const pointData = param?.seriesData
        ? (param.seriesData.get(candles as unknown as ISeriesApi<"Candlestick">) as CandlestickData<UTCTimestamp> | undefined)
        : undefined;
      const active = pointData ?? data[data.length - 1];

      if (!active) {
        legendRef.current.textContent = "";
        return;
      }

      const previousClose = data.length > 1
        ? data[Math.max(data.findIndex((entry) => entry.time === active.time) - 1, 0)]?.close
        : undefined;
      const change = previousClose ? active.close - previousClose : 0;
      const changePct = previousClose ? (change / previousClose) * 100 : 0;
      legendRef.current.style.color = change > 0
        ? "#2dd4bf"
        : change < 0
          ? "#f87171"
          : dark
            ? "#8ca1ad"
            : "#34545d";

      const activeLabel = active.time ? formatTokyoTime(Number(active.time), true) : "";
      legendRef.current.textContent = `${activeLabel}  O ${formatPrice(active.open)}  H ${formatPrice(active.high)}  L ${formatPrice(active.low)}  C ${formatPrice(active.close)}  ${change >= 0 ? "+" : ""}${formatPrice(change)} (${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%)`;
    };

    chart.subscribeCrosshairMove(updateLegend);
    updateLegend();

    const resizeObserver = new ResizeObserver(() => {
      chart.resize(container.clientWidth, container.clientHeight);
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.unsubscribeCrosshairMove(updateLegend);
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
    };
  }, [dark, priceDigits, data]);

  useEffect(() => {
    candleRef.current?.setData(data);
    volumeRef.current?.setData(volumeData);

    const chart = chartRef.current;

    if (!chart) {
      return;
    }

    if (!hasFitInitialContentRef.current && data.length > 0) {
      chart.timeScale().fitContent();
      hasFitInitialContentRef.current = true;
    }
  }, [data, volumeData]);

  useEffect(() => {
    const candles = candleRef.current;

    if (!candles) {
      return;
    }

    for (const line of priceLinesRef.current) {
      candles.removePriceLine(line);
    }
    priceLinesRef.current = [];

    if (!position || position.side === "flat" || position.quantity <= 0) {
      return;
    }

    const sideColor = position.side === "long" ? "#2dd4bf" : "#f87171";
    const liqColor = dark ? "#fbbf24" : "#d97706";
    const lineOptions = [
      {
        price: position.averageEntryPrice,
        color: sideColor,
        title: position.side === "long" ? "Long Entry" : "Short Entry",
        lineStyle: 0 as const
      },
      ...(position.liquidationPrice > 0 ? [{
        price: position.liquidationPrice,
        color: liqColor,
        title: "Est. Liq.",
        lineStyle: 3 as const
      }] : [])
    ];

    for (const line of lineOptions) {
      priceLinesRef.current.push(candles.createPriceLine({
        price: line.price,
        color: line.color,
        lineWidth: 1,
        lineStyle: line.lineStyle,
        axisLabelVisible: true,
        title: line.title
      }));
    }

    for (const order of triggerOrders) {
      const triggerPx = Number(order.triggerCondition?.triggerPx);
      if (!Number.isFinite(triggerPx) || triggerPx <= 0) {
        continue;
      }

      const isTakeProfit = order.triggerCondition?.tpsl === "tp";
      priceLinesRef.current.push(candles.createPriceLine({
        price: triggerPx,
        color: isTakeProfit ? "#22c55e" : "#f59e0b",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: isTakeProfit ? "TP Trigger" : "SL Trigger"
      }));
    }
  }, [dark, position, triggerOrders]);

  return (
    <div style={{ position: "relative" }}>
      <div
        ref={legendRef}
        style={{
          position: "absolute",
          top: 8,
          left: 12,
          zIndex: 3,
          fontSize: 13,
          color: dark ? "#8ca1ad" : "#34545d",
          pointerEvents: "none",
          fontVariantNumeric: "tabular-nums"
        }}
      />
      <div ref={containerRef} style={{ width: "100%", height: 360, borderRadius: 12, overflow: "hidden" }} />
    </div>
  );
}
