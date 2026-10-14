"use client";

import { ColorType, CandlestickSeries, LineSeries, LineStyle, createChart, createSeriesMarkers, type IChartApi, type ISeriesApi, type MouseEventParams, type Time, type UTCTimestamp } from "lightweight-charts";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";
import { hits } from "@/lib/drawings/hit";
import { DRAWING_COLORS, MAX_DRAWINGS, POINTS_NEEDED, type Drawing, type DrawingKind, type DrawingPoint } from "@/lib/drawings/types";
import { INDICATORS, WARMUP, ema, isIndicatorKey, rsi, vwap, type IndicatorKey, type Series } from "@/lib/indicators";
import { TF_LABEL, TF_SECONDS, TIMEFRAMES, type Timeframe } from "@/lib/market-data/types";
import type { ChartData } from "@/lib/queries/trade-chart";
import { ChartToolbar, toolHint, type Tool } from "./chart-toolbar";
import { DrawingsLayer } from "./drawings-layer";
import { computeZones, NO_OVERLAYS, ZONES_ON, zonesAvailable, type ZoneChoice } from "@/lib/smc";
import { PositionBox } from "./position-box";
import { ZonesLayer } from "./zones-layer";
import { ZoneToggles } from "./zone-toggles";
import { useJson } from "./use-json";

// lightweight-charts needs concrete colours (it cannot read CSS variables), so these mirror the design tokens
const C = { text: "#9AA4B2", grid: "#1D232C", border: "#222934", up: "#3DD39A", down: "#F26B6F", entry: "#7FB7F0", sl: "#F26B6F", tp: "#3DD39A", exit: "#E0B04E" };
const IND_STORE = "tj_chart_indicators";

interface Live {
  chart: IChartApi;
  series: ISeriesApi<"Candlestick">;
  layer: DrawingsLayer;
  shift: number;
  step: number;
}

const newId = () => `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

// The chosen indicators live in this browser's storage. Reading it through useSyncExternalStore keeps the server render
// and the first browser render identical (nothing chosen), then switches to the saved choice without a hydration mismatch.
const indListeners = new Set<() => void>();
let indMemory: string | null = null; // the choice for this page view, so it still works when storage is blocked
const subscribeInd = (cb: () => void) => {
  indListeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    indListeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
};
const readInd = () => {
  if (indMemory) return indMemory;
  try {
    return localStorage.getItem(IND_STORE) ?? "[]";
  } catch {
    return "[]";
  }
};
const parseInd = (raw: string): Set<IndicatorKey> => {
  try {
    const list = JSON.parse(raw);
    return new Set(Array.isArray(list) ? list.filter((k): k is IndicatorKey => typeof k === "string" && isIndicatorKey(k)) : []);
  } catch {
    return new Set();
  }
};

/**
 * Candlestick chart for one trade: entry/exit markers, the entry-to-exit box, entry / exit / stop / target lines and a
 * timeframe switcher. `src` is the chart endpoint (the logged-in or the public share route). When `tradeId` is given the
 * chart is editable: you can draw on it (saved with the trade) and switch on indicators.
 */
export function TradeChart({
  src,
  defaultTf,
  height = 340,
  tzOffsetMin = 0,
  tradeId,
  initialDrawings = [],
}: {
  src: string;
  defaultTf: Timeframe;
  height?: number;
  tzOffsetMin?: number;
  tradeId?: string;
  initialDrawings?: Drawing[];
}) {
  const editable = !!tradeId;
  const box = useRef<HTMLDivElement>(null);
  const live = useRef<Live | null>(null);
  const [tf, setTf] = useState<Timeframe>(defaultTf);
  const [attempt, setAttempt] = useState(0);
  const [zones, setZones] = useState(true);
  const [toolsOpen, setToolsOpen] = useState(false); // phones: the drawing tools stay folded away until asked for
  const zonesRef = useRef(true);
  const boxRef = useRef<PositionBox | null>(null);
  const zoneLayer = useRef<ZonesLayer | null>(null);
  const [zoneChoice, setZoneChoice] = useState<ZoneChoice>(ZONES_ON);

  // drawing state: React state for the UI, refs for the chart's event handlers
  const [tool, setToolState] = useState<Tool>("cursor");
  const [color, setColorState] = useState<string>(DRAWING_COLORS[0]);
  const [drawings, setDrawings] = useState<Drawing[]>(initialDrawings);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const toolRef = useRef<Tool>("cursor");
  const colorRef = useRef<string>(DRAWING_COLORS[0]);
  const drawingsRef = useRef<Drawing[]>(initialDrawings);
  const selectedRef = useRef<string | null>(null);
  const pending = useRef<DrawingPoint[]>([]);
  const dirty = useRef(false);

  // indicators: remembered in this browser; extra history is requested only as far as the chosen ones need
  const indRaw = useSyncExternalStore(subscribeInd, readInd, () => "[]");
  const indicators = useMemo(() => parseInd(indRaw), [indRaw]);
  const [warmed, setWarm] = useState(0);
  const warm = Math.max(warmed, ...[...indicators].map((k) => WARMUP[k]));

  const { data, status: state } = useJson<ChartData>(`${src}?tf=${tf}${warm ? `&warm=${warm}` : ""}`, attempt);

  // ───────────── drawing state changes (called from handlers) ─────────────
  const commit = useCallback((next: Drawing[], select: string | null = selectedRef.current) => {
    drawingsRef.current = next;
    selectedRef.current = select;
    dirty.current = true;
    setDrawings(next);
    setSelectedId(select);
  }, []);
  const select = useCallback((id: string | null) => {
    selectedRef.current = id;
    setSelectedId(id);
  }, []);
  const setTool = useCallback((t: Tool) => {
    toolRef.current = t;
    setToolState(t);
    pending.current = [];
    const l = live.current?.layer;
    if (l) {
      l.preview = null;
      if (t !== "ruler") l.ruler = null;
      l.update();
    }
  }, []);
  const setColor = useCallback(
    (c: string) => {
      colorRef.current = c;
      setColorState(c);
      const id = selectedRef.current;
      if (id) commit(drawingsRef.current.map((d) => (d.id === id ? { ...d, color: c } : d)));
    },
    [commit],
  );
  const removeSelected = useCallback(() => {
    const id = selectedRef.current;
    if (id) commit(drawingsRef.current.filter((d) => d.id !== id), null);
  }, [commit]);

  const toggleIndicator = (k: IndicatorKey, on: boolean) => {
    const next = new Set(indicators);
    if (on) next.add(k);
    else next.delete(k);
    if (on) setWarm((w) => Math.max(w, WARMUP[k]));
    indMemory = JSON.stringify([...next]);
    try {
      localStorage.setItem(IND_STORE, indMemory);
    } catch {
      /* private mode: the choice just is not remembered */
    }
    indListeners.forEach((l) => l());
  };

  // ───────────── the chart ─────────────
  const draw = useCallback(() => {
    const el = box.current;
    if (!el || !data || data.candles.length === 0) return () => undefined;
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: C.text, fontFamily: "var(--font-plex-sans), system-ui, sans-serif", fontSize: 11 },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      rightPriceScale: { borderColor: C.border },
      timeScale: { borderColor: C.border, timeVisible: tf !== "D1", secondsVisible: false },
      crosshair: { mode: 0 },
    });
    const series = chart.addSeries(CandlestickSeries, { upColor: C.up, downColor: C.down, borderVisible: false, wickUpColor: C.up, wickDownColor: C.down });
    const shift = tzOffsetMin * 60; // the chart draws UTC; shifting the timestamps shows wall-clock time in the display timezone
    const step = TF_SECONDS[tf];
    series.setData(data.candles.map((c) => ({ time: (c.t + shift) as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c })));

    const times = new Set(data.candles.map((c) => c.t));
    const markers = data.markers
      .filter((m) => times.has(m.t))
      .sort((a, b) => a.t - b.t)
      .map((m) => ({
        time: (m.t + shift) as UTCTimestamp,
        position: m.action === "buy" ? ("belowBar" as const) : ("aboveBar" as const),
        shape: m.action === "buy" ? ("arrowUp" as const) : ("arrowDown" as const),
        color: m.kind === "entry" ? C.entry : C.exit,
        text: `${m.kind === "entry" ? "Entry" : "Exit"} ${m.lots} @ ${m.price}`,
      }));
    createSeriesMarkers(series, markers);

    const line = (price: number | null, color: string, title: string, style = LineStyle.Dashed) =>
      price != null && series.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title });
    line(data.lines.entry, C.entry, "Entry", LineStyle.Solid);
    line(data.lines.exit, C.exit, "Exit", LineStyle.Dotted);
    line(data.lines.stopLoss, C.sl, "SL");
    line(data.lines.profitTarget, C.tp, "TP");

    // the trade as a shaded box from entry to exit, and the view framed around it
    const shiftT = (t: number) => t + shift;
    const entryM = data.markers.find((m) => m.kind === "entry");
    const exitM = [...data.markers].reverse().find((m) => m.kind === "exit");
    const lastT = data.candles[data.candles.length - 1].t;
    boxRef.current = null;
    if (entryM && times.has(entryM.t)) {
      const pbox = new PositionBox({
        openTime: shiftT(entryM.t),
        closeTime: exitM && times.has(exitM.t) ? shiftT(exitM.t) : null,
        lastTime: shiftT(lastT),
        side: entryM.action === "buy" ? "LONG" : "SHORT",
        entry: data.lines.entry,
        exit: data.lines.exit,
        stopLoss: data.lines.stopLoss,
        profitTarget: data.lines.profitTarget,
      });
      pbox.visible = zonesRef.current;
      series.attachPrimitive(pbox);
      boxRef.current = pbox;
      const i0 = data.candles.findIndex((c) => c.t === entryM.t);
      const i1 = exitM ? data.candles.findIndex((c) => c.t === exitM.t) : data.candles.length - 1;
      const pad = Math.max(12, Math.round((i1 - i0) * 0.6));
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(-2, i0 - pad), to: Math.min(data.candles.length + 4, i1 + pad) });
    } else chart.timeScale().fitContent();

    // the user's own drawings and the click handling that creates and selects them
    const zl = new ZonesLayer(shift);
    series.attachPrimitive(zl);
    zoneLayer.current = zl;
    const layer = new DrawingsLayer(shift, step);
    layer.drawings = drawingsRef.current;
    layer.selectedId = selectedRef.current;
    series.attachPrimitive(layer);
    live.current = { chart, series, layer, shift, step };

    const pointFrom = (param: MouseEventParams<Time>): DrawingPoint | null => {
      if (!param.point || param.time == null) return null;
      const price = series.coordinateToPrice(param.point.y);
      return price == null ? null : { t: Number(param.time) - shift, p: round5(price) };
    };
    const screenPts = (d: Drawing) => (d.kind === "hline" ? [{ x: 0, y: series.priceToCoordinate(d.points[0].p) ?? -1e9 }] : layer.screenPoints(d));

    const onClick = (param: MouseEventParams<Time>) => {
      if (!editable || !param.point) return;
      const t = toolRef.current;
      if (t === "cursor") {
        const p = param.point;
        const hit = [...drawingsRef.current].reverse().find((d) => hits(d.kind, screenPts(d), { x: p.x, y: p.y }));
        select(hit?.id ?? null);
        return;
      }
      const pt = pointFrom(param);
      if (!pt) return;
      if (t === "ruler") {
        if (pending.current.length === 0) {
          layer.ruler = null;
          pending.current = [pt];
        } else {
          layer.ruler = { a: pending.current[0], b: pt };
          pending.current = [];
        }
        layer.update();
        return;
      }
      pending.current = [...pending.current, pt];
      if (pending.current.length < POINTS_NEEDED[t as DrawingKind]) return;
      let text: string | undefined;
      if (t === "note") {
        text = window.prompt("Note for this spot on the chart:")?.trim().slice(0, 200);
        if (!text) {
          pending.current = [];
          return;
        }
      }
      if (drawingsRef.current.length >= MAX_DRAWINGS) {
        pending.current = [];
        return;
      }
      const d: Drawing = { id: newId(), kind: t as DrawingKind, color: colorRef.current, points: pending.current, ...(text ? { text } : {}) };
      pending.current = [];
      layer.preview = null;
      commit([...drawingsRef.current, d], d.id);
      setTool("cursor");
    };
    const onMove = (param: MouseEventParams<Time>) => {
      if (!editable || pending.current.length === 0) return;
      const pt = pointFrom(param);
      if (!pt) return;
      const t = toolRef.current;
      if (t === "ruler") layer.ruler = { a: pending.current[0], b: pt };
      else if (t === "trend" || t === "rect") layer.preview = { id: "preview", kind: t, color: colorRef.current, points: [pending.current[0], pt] };
      layer.update();
    };
    chart.subscribeClick(onClick);
    chart.subscribeCrosshairMove(onMove);

    return () => {
      chart.unsubscribeClick(onClick);
      chart.unsubscribeCrosshairMove(onMove);
      live.current = null;
      boxRef.current = null;
      zoneLayer.current = null;
      chart.remove();
    };
  }, [data, tf, tzOffsetMin, editable, commit, select, setTool]);

  useEffect(() => draw(), [draw]);
  useEffect(() => {
    zonesRef.current = zones;
    boxRef.current?.setVisible(zones);
  }, [zones]);

  // fair value gaps and order blocks, found from the candles on the 5 and 15 minute charts
  useEffect(() => {
    zoneLayer.current?.set(data && zonesAvailable(tf) ? computeZones(data.candles, zoneChoice) : NO_OVERLAYS);
  }, [data, tf, zoneChoice, tzOffsetMin]);

  // keep the drawings layer in step with state
  useEffect(() => {
    const l = live.current?.layer;
    if (!l) return;
    l.sync(drawings, selectedId);
  }, [drawings, selectedId, data]);

  // indicators: lines on the price pane, RSI in a pane of its own underneath
  useEffect(() => {
    const lv = live.current;
    if (!lv || !data) return;
    const { chart, shift } = lv;
    const added: ISeriesApi<"Line">[] = [];
    const feed = (values: Series) => values.flatMap((v, i) => (v == null ? [] : [{ time: (data.candles[i].t + shift) as UTCTimestamp, value: v }]));
    for (const ind of INDICATORS) {
      if (!indicators.has(ind.key)) continue;
      const opts = { color: ind.color, lineWidth: 2 as const, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };
      const values = ind.key === "ema20" ? ema(data.candles, 20) : ind.key === "ema50" ? ema(data.candles, 50) : ind.key === "ema200" ? ema(data.candles, 200) : ind.key === "vwap" ? vwap(data.candles) : rsi(data.candles, 14);
      const s = chart.addSeries(LineSeries, ind.key === "rsi" ? { ...opts, lineWidth: 1, lastValueVisible: true, priceFormat: { type: "price", precision: 1, minMove: 0.1 } } : opts, ind.key === "rsi" ? 1 : 0);
      s.setData(feed(values));
      if (ind.key === "rsi") {
        s.createPriceLine({ price: 70, color: "#4A5262", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" });
        s.createPriceLine({ price: 30, color: "#4A5262", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" });
        const panes = chart.panes();
        panes[0]?.setStretchFactor(3);
        panes[1]?.setStretchFactor(1);
      }
      added.push(s);
    }
    return () => {
      try {
        for (const s of added) chart.removeSeries(s);
        const extra = chart.panes()[1];
        if (extra && extra.getSeries().length === 0) chart.removePane(1);
      } catch {
        /* the chart was already torn down with new data */
      }
    };
  }, [data, tf, tzOffsetMin, indicators]);

  // keyboard: Delete removes the selected drawing, Esc cancels what is being drawn
  useEffect(() => {
    if (!editable) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target as HTMLElement | null)?.isContentEditable) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedRef.current) {
          e.preventDefault();
          removeSelected();
        }
      } else if (e.key === "Escape") {
        setTool("cursor");
        select(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editable, removeSelected, setTool, select]);

  // saving: shortly after the last change, and straight away if the page is left first
  useEffect(() => {
    if (!tradeId || !dirty.current) return;
    const body = JSON.stringify({ drawings });
    const send = (keepalive: boolean) =>
      fetch(`/api/trades/${tradeId}/drawings`, { method: "PUT", headers: { "content-type": "application/json" }, body, keepalive })
        .then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          if (!keepalive) {
            dirty.current = false;
            setSaveState("saved");
          }
        })
        .catch(() => !keepalive && setSaveState("error"));
    let fired = false;
    const timer = window.setTimeout(() => {
      fired = true;
      setSaveState("saving");
      void send(false);
    }, 600);
    return () => {
      window.clearTimeout(timer);
      if (!fired) void send(true);
    };
  }, [drawings, tradeId]);

  const check = data?.priceCheck;
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1" role="group" aria-label="Timeframe">
        {TIMEFRAMES.map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tf === t}
            onClick={() => setTf(t)}
            className={cn("min-h-8 rounded-md px-2.5 text-xs", tf === t ? "bg-line font-semibold text-ink" : "text-muted hover:text-ink")}
          >
            {TF_LABEL[t]}
          </button>
        ))}
        {zonesAvailable(tf) && (
          <span className="ml-2">
            <ZoneToggles value={zoneChoice} onChange={setZoneChoice} />
          </span>
        )}
        <label className="ml-auto flex min-h-8 cursor-pointer items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={zones} onChange={(e) => setZones(e.target.checked)} className="accent-[var(--accent)]" />
          <span className="hidden sm:inline">Show entry to exit box</span>
          <span className="sm:hidden">Trade box</span>
        </label>
        {editable && (
          <button type="button" aria-expanded={toolsOpen} onClick={() => setToolsOpen((o) => !o)} className="inline-flex min-h-8 items-center rounded-md border border-line-strong px-2.5 text-xs text-ink-2 md:hidden">
            {toolsOpen ? "Hide tools" : "Draw & indicators"}
          </button>
        )}
        {state === "loading" && <span className="ml-2 text-xs text-muted">Loading prices…</span>}
      </div>

      {editable && (
        <div className={cn(!toolsOpen && "hidden md:block")}>
        <ChartToolbar
          tool={tool}
          onTool={setTool}
          color={color}
          onColor={setColor}
          hasSelection={!!selectedId}
          onDelete={removeSelected}
          count={drawings.length}
          onClear={() => commit([], null)}
          indicators={indicators}
          onIndicator={toggleIndicator}
          saveState={saveState}
        />
        </div>
      )}

      <div className={cn("relative rounded-control border border-line bg-inset", editable && tool !== "cursor" && "cursor-crosshair")} style={{ height }}>
        <div ref={box} className="absolute inset-0" />
        {state === "ready" && data && data.candles.length === 0 && (
          <Overlay>
            {data.unsupported
              ? "There is no price data source for this symbol, so no chart can be drawn."
              : data.pendingToday
                ? "Prices for today are published after the trading day ends (00:00 UTC). Check back tomorrow."
                : data.incomplete
                ? "Price data could not be downloaded right now."
                : "No price data for this period (market closed?)."}
            {!data.unsupported && data.incomplete && <RetryButton onClick={() => setAttempt((a) => a + 1)} />}
          </Overlay>
        )}
        {state === "error" && (
          <Overlay>
            Could not load the chart.
            <RetryButton onClick={() => setAttempt((a) => a + 1)} />
          </Overlay>
        )}
        {state === "loading" && !data && <Overlay>Downloading price history. The first view of a trade can take a little while.</Overlay>}
      </div>

      {editable && tool !== "cursor" && <p className="mt-1.5 text-xs text-accent">{toolHint(tool)} Press Esc to cancel.</p>}

      {state === "ready" && data && data.candles.length > 0 && (
        <div className="mt-2 flex flex-col gap-1 text-[11px] text-muted">
          {check && !check.matches && (
            <p role="alert" className="rounded-md bg-loss-bg px-2.5 py-1.5 text-loss">
              The price feed shows about {check.feedPrice?.toFixed(2)} at the time of entry, {check.diffPct?.toFixed(1)}% away from this trade&rsquo;s entry. The chart is for context only: the feed may use a different symbol or contract than your broker.
            </p>
          )}
          {data.pendingToday && <p>Prices for today are published after the day ends, so the chart stops at the end of yesterday.</p>}
          {data.incomplete && (
            <p>
              Some price data could not be downloaded, so the chart may have gaps. <button className="text-accent underline" onClick={() => setAttempt((a) => a + 1)}>Retry</button>
            </p>
          )}
          <p>Prices come from Dukascopy and can differ slightly from your broker&rsquo;s feed.</p>
        </div>
      )}
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted">{children}</div>;
}

function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="min-h-9 rounded-control border border-line-strong px-4 text-xs text-ink hover:bg-nav-active">
      Try again
    </button>
  );
}
