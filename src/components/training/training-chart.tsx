"use client";

import { CandlestickSeries, ColorType, LineStyle, createChart, type IChartApi, type IPriceLine, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef } from "react";
import { PositionBox, type PositionBoxInput } from "@/components/trades/position-box";
import type { Candle } from "@/lib/market-data/types";
import { ZonesLayer } from "@/components/trades/zones-layer";
import { computeZones, type ZoneChoice } from "@/lib/smc";
import { TrainingLayer, type Band } from "./primitives";

const C = { text: "#9AA4B2", grid: "#1D232C", border: "#222934", up: "#3DD39A", down: "#F26B6F" };

export interface ChartLine {
  price: number;
  color: string;
  title: string;
  dashed?: boolean;
}

/** The trade drawn as a box once it has played out; times are real (UTC) seconds. */
export interface TradeBox {
  openT: number;
  closeT: number | null;
  side: "LONG" | "SHORT";
  entry: number;
  exit: number | null;
  stopLoss: number;
  takeProfit: number;
}

/** Latest candle at or before `t`: a time on the chart that is guaranteed to exist. */
export function alignTime(candles: Candle[], t: number): number {
  let ans = candles[0]?.t ?? t;
  for (const c of candles) {
    if (c.t <= t) ans = c.t;
    else break;
  }
  return ans;
}

/**
 * Candlestick chart for training: candles, price lines, shaded price bands, a dashed line at the decision moment,
 * the trade as a box, and clicks that report the price clicked. Draws the display-timezone clock by shifting times.
 */
export function TrainingChart({
  candles,
  tzOffsetMin,
  height = 460,
  lines = [],
  bands = [],
  decisionT,
  decisionLabel = "Decision point",
  box,
  onPick,
  crosshairCursor,
  visibleBars = 120,
  zones,
}: {
  candles: Candle[];
  tzOffsetMin: number;
  height?: number;
  lines?: ChartLine[];
  bands?: (Omit<Band, "fromTime"> & { fromT?: number })[];
  decisionT?: number;
  decisionLabel?: string;
  box?: TradeBox | null;
  onPick?: (price: number, t: number | null) => void;
  crosshairCursor?: boolean;
  visibleBars?: number;
  /** which kinds of fair value gap / order block to show, found from the candles given (so nothing from the future); omit for none */
  zones?: ZoneChoice | null;
}) {
  const el = useRef<HTMLDivElement>(null);
  const live = useRef<{ chart: IChartApi; series: ISeriesApi<"Candlestick">; layer: TrainingLayer; zoneLayer: ZonesLayer; lines: IPriceLine[]; box: PositionBox | null; count: number; lastT: number } | null>(null);
  const pick = useRef(onPick);
  const shift = tzOffsetMin * 60;
  const shiftRef = useRef(shift);

  useEffect(() => {
    pick.current = onPick;
    shiftRef.current = shift;
  }, [onPick, shift]);

  // create the chart once
  useEffect(() => {
    const host = el.current;
    if (!host) return;
    const chart = createChart(host, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: C.text, fontFamily: "var(--font-plex-sans), system-ui, sans-serif", fontSize: 11 },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      rightPriceScale: { borderColor: C.border },
      timeScale: { borderColor: C.border, timeVisible: true, secondsVisible: true, rightOffset: 10 },
      crosshair: { mode: 0 },
    });
    const series = chart.addSeries(CandlestickSeries, { upColor: C.up, downColor: C.down, borderVisible: false, wickUpColor: C.up, wickDownColor: C.down });
    const layer = new TrainingLayer();
    series.attachPrimitive(layer);
    const zoneLayer = new ZonesLayer(shiftRef.current);
    series.attachPrimitive(zoneLayer);
    live.current = { chart, series, layer, zoneLayer, lines: [], box: null, count: 0, lastT: 0 };
    const onClick = (p: { point?: { x: number; y: number }; time?: unknown }) => {
      if (!p.point || !pick.current) return;
      const price = series.coordinateToPrice(p.point.y);
      if (price != null) pick.current(Math.round(price * 100) / 100, p.time == null ? null : Number(p.time));
    };
    chart.subscribeClick(onClick);
    return () => {
      chart.unsubscribeClick(onClick);
      live.current = null;
      chart.remove();
    };
  }, []);

  // candles: append one at a time while a replay runs, otherwise load them all; frame the latest bars on first load
  useEffect(() => {
    const lv = live.current;
    if (!lv || candles.length === 0) return;
    const bar = (c: Candle) => ({ time: (c.t + shift) as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c });
    const last = candles[candles.length - 1];
    if (lv.count > 0 && candles.length === lv.count + 1 && lv.lastT === candles[candles.length - 2].t) lv.series.update(bar(last));
    else if (candles.length === lv.count && lv.lastT === last.t) lv.series.update(bar(last)); // the forming bar changed
    else {
      const first = lv.count === 0;
      lv.series.setData(candles.map(bar));
      if (first) lv.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, candles.length - visibleBars), to: candles.length + 12 });
    }
    lv.count = candles.length;
    lv.lastT = last.t;
  }, [candles, shift, visibleBars]);

  // price lines
  useEffect(() => {
    const lv = live.current;
    if (!lv) return;
    lv.lines.forEach((l) => lv.series.removePriceLine(l));
    lv.lines = lines.map((l) => lv.series.createPriceLine({ price: l.price, color: l.color, lineWidth: 1, lineStyle: l.dashed ? LineStyle.Dashed : LineStyle.Solid, axisLabelVisible: true, title: l.title }));
  }, [lines]);

  // bands and the decision line
  useEffect(() => {
    live.current?.layer.set(
      bands.map((b) => ({ ...b, fromTime: b.fromT == null ? undefined : b.fromT + shift })),
      decisionT == null ? null : { time: alignTime(candles, decisionT) + shift, label: decisionLabel },
    );
  }, [bands, decisionT, decisionLabel, candles, shift]);

  // fair value gaps and order blocks
  useEffect(() => {
    live.current?.zoneLayer.set(zones ? computeZones(candles, zones) : []);
  }, [zones, candles, shift]);

  // the trade box
  useEffect(() => {
    const lv = live.current;
    if (!lv) return;
    if (lv.box) lv.series.detachPrimitive(lv.box);
    lv.box = null;
    if (!box || candles.length === 0) return;
    const input: PositionBoxInput = {
      openTime: alignTime(candles, box.openT) + shift,
      closeTime: box.closeT == null ? null : alignTime(candles, box.closeT) + shift,
      lastTime: candles[candles.length - 1].t + shift,
      side: box.side,
      entry: box.entry,
      exit: box.exit,
      stopLoss: box.stopLoss,
      profitTarget: box.takeProfit,
    };
    lv.box = new PositionBox(input);
    lv.series.attachPrimitive(lv.box);
  }, [box, candles, shift]);

  return <div ref={el} className={`rounded-control border border-line bg-inset ${crosshairCursor ? "cursor-crosshair" : ""}`} style={{ height }} role="img" aria-label="Price chart" />;
}
