"use client";

import { CandlestickSeries, ColorType, LineStyle, createChart, createSeriesMarkers, type IChartApi, type IPriceLine, type ISeriesApi, type ISeriesMarkersPluginApi, type Time, type UTCTimestamp } from "lightweight-charts";
import { Pause, Play, RotateCcw, SkipBack, SkipForward, StepForward } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useJson } from "@/components/trades/use-json";
import { cn } from "@/lib/cn";
import { money, pnlTone } from "@/lib/format";
import { TF_LABEL, TF_SECONDS, TIMEFRAMES, type Timeframe } from "@/lib/market-data/types";
import type { ReplayData } from "@/lib/queries/replay";

const C = { text: "#9AA4B2", grid: "#1D232C", border: "#222934", up: "#3DD39A", down: "#F26B6F", entry: "#7FB7F0", sl: "#F26B6F", tp: "#3DD39A", exit: "#E0B04E" };
const SPEEDS = [1, 2, 5, 10, 30] as const;
const TONE = { profit: "text-profit", loss: "text-loss", neutral: "text-ink" } as const;
const VISIBLE_BARS = 110;

const clock = (sec: number, offMin: number) => new Date((sec + offMin * 60) * 1000).toISOString().slice(0, 16).replace("T", " ");

/**
 * Candle-by-candle replay of one trade or one whole day. Future candles are never sent to the chart, and a
 * trade's result stays hidden until the replay reaches its exit. Keyboard: Space plays or pauses, arrow keys step.
 */
export function ReplayPlayer({ src, tzOffsetMin }: { src: string; tzOffsetMin: number }) {
  const [tf, setTf] = useState<Timeframe | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { data, status } = useJson<ReplayData>(`${src}${tf ? `&tf=${tf}` : ""}`, attempt);

  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(2);

  // a new data set (different trade, day or timeframe) starts again at its own start
  const dataId = data ? `${data.title}|${data.tf}|${data.candles.length}` : "";
  const [seen, setSeen] = useState("");
  if (data && seen !== dataId) {
    setSeen(dataId);
    setIdx(data.start);
    setPlaying(false);
  }

  const last = data ? data.candles.length - 1 : 0;
  const step = data ? TF_SECONDS[data.tf] : 60;
  const atEnd = idx >= last;
  const running = playing && !atEnd;

  useEffect(() => {
    if (!running || !data) return;
    const id = window.setInterval(() => setIdx((i) => Math.min(i + 1, last)), 1000 / speed);
    return () => window.clearInterval(id);
  }, [running, speed, data, last]);

  // ───────────── chart ─────────────
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<{ chart: IChartApi; series: ISeriesApi<"Candlestick">; markers: ISeriesMarkersPluginApi<Time>; shown: number; lines: IPriceLine[]; linesKey: string } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el || !data || data.candles.length === 0) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: C.text, fontFamily: "var(--font-plex-sans), system-ui, sans-serif", fontSize: 11 },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      rightPriceScale: { borderColor: C.border },
      timeScale: { borderColor: C.border, timeVisible: true, secondsVisible: false, rightOffset: 8 },
      crosshair: { mode: 0 },
    });
    const series = chart.addSeries(CandlestickSeries, { upColor: C.up, downColor: C.down, borderVisible: false, wickUpColor: C.up, wickDownColor: C.down });
    chartRef.current = { chart, series, markers: createSeriesMarkers(series, []), shown: -1, lines: [], linesKey: "" };
    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [data]);

  const shift = tzOffsetMin * 60;
  useEffect(() => {
    const c = chartRef.current;
    if (!c || !data || data.candles.length === 0) return;
    const i = Math.min(idx, last);
    const bar = (k: number) => ({ time: (data.candles[k].t + shift) as UTCTimestamp, open: data.candles[k].o, high: data.candles[k].h, low: data.candles[k].l, close: data.candles[k].c });
    if (i === c.shown + 1) c.series.update(bar(i));
    else if (i !== c.shown) c.series.setData(data.candles.slice(0, i + 1).map((_, k) => bar(k)));
    c.shown = i;

    const now = data.candles[i].t;
    const tc = now + step;
    c.markers.setMarkers(
      data.markers
        .filter((m) => m.t <= now)
        .sort((a, b) => a.t - b.t)
        .map((m) => ({
          time: (m.t + shift) as UTCTimestamp,
          position: m.action === "buy" ? ("belowBar" as const) : ("aboveBar" as const),
          shape: m.action === "buy" ? ("arrowUp" as const) : ("arrowDown" as const),
          color: m.kind === "entry" ? C.entry : C.exit,
          text: `${m.kind === "entry" ? "Entry" : "Exit"} ${m.lots} @ ${m.price}`,
        })),
    );

    // price lines for the trades that are open right now (never for trades that have not started or have finished)
    const open = data.trades.filter((t) => t.open < tc && (t.close == null || t.close >= tc));
    const key = open.map((t) => t.id).join(",");
    if (key !== c.linesKey) {
      c.lines.forEach((l) => c.series.removePriceLine(l));
      const add = (price: number | null, color: string, title: string, style: LineStyle) => (price == null ? [] : [c.series.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title })]);
      c.lines = open.flatMap((t) => [...add(t.avgEntry, C.entry, "Entry", LineStyle.Solid), ...add(t.stopLoss, C.sl, "SL", LineStyle.Dashed), ...add(t.profitTarget, C.tp, "TP", LineStyle.Dashed)]);
      c.linesKey = key;
    }
    c.chart.timeScale().setVisibleLogicalRange({ from: i - VISIBLE_BARS, to: i + 12 });
  }, [data, idx, last, shift, step]);

  // ───────────── controls ─────────────
  const goto = useCallback((n: number) => setIdx(Math.max(0, Math.min(n, last))), [last]);
  const toggle = useCallback(() => {
    if (atEnd && data) {
      setIdx(data.start);
      setPlaying(true);
    } else setPlaying(!running);
  }, [atEnd, data, running]);

  const events = useMemo(() => (data ? [...new Set(data.markers.map((m) => m.t))].sort((a, b) => a - b).map((t) => data.candles.findIndex((c) => c.t === t)).filter((k) => k >= 0) : []), [data]);
  const jump = (dir: 1 | -1) => {
    const next = dir === 1 ? events.find((k) => k > idx) : [...events].reverse().find((k) => k < idx);
    if (next != null) goto(next);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || tag === "BUTTON" || e.metaKey || e.ctrlKey) return;
      if (e.key === " ") {
        e.preventDefault();
        toggle();
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        setPlaying(false);
        goto(idx + (e.key === "ArrowRight" ? 1 : -1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, goto, idx]);

  // ───────────── states with nothing to play ─────────────
  if (!data && status === "loading") return <Box>Downloading price history. The first replay of a day can take a little while.</Box>;
  if (status === "error" || !data)
    return (
      <Box>
        Could not load this replay. <Retry onClick={() => setAttempt((a) => a + 1)} />
      </Box>
    );
  if (data.candles.length === 0)
    return (
      <Box>
        {data.unsupported ? "There is no price data source for this symbol, so it cannot be replayed." : data.pendingToday ? "Prices for today are published after the trading day ends (00:00 UTC). Replay it tomorrow." : data.incomplete ? "Price data could not be downloaded right now." : "No price data for this period."}
        {!data.unsupported && data.incomplete && <Retry onClick={() => setAttempt((a) => a + 1)} />}
      </Box>
    );

  const i = Math.min(idx, last);
  const candle = data.candles[i];
  const tc = candle.t + step;
  const pnl = data.pnl[i] ?? 0;
  const soFar = data.pnl.slice(0, i + 1);
  const best = Math.max(0, ...soFar.slice(data.start));
  const worst = Math.min(0, ...soFar.slice(data.start));
  const status_ = (t: ReplayData["trades"][number]) => (tc <= t.open ? "waiting" : t.close != null && tc >= t.close ? "closed" : "open");
  const finished = data.trades.every((t) => t.close != null && tc >= t.close);
  const net = data.trades.reduce((s, t) => s + t.netPnl, 0);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold">{data.title}</h2>
          {data.otherSymbols.length > 0 && <p className="text-xs text-muted">Also traded that day: {data.otherSymbols.join(", ")}</p>}
        </div>
        <div role="group" aria-label="Timeframe" className="flex items-center gap-1">
          {TIMEFRAMES.slice(0, 5).map((t) => (
            <button key={t} type="button" aria-pressed={data.tf === t} onClick={() => setTf(t)} className={cn("min-h-8 rounded-md px-2.5 text-xs", data.tf === t ? "bg-line font-semibold text-ink" : "text-muted hover:text-ink")}>
              {TF_LABEL[t]}
            </button>
          ))}
          {status === "loading" && <span className="ml-1 text-xs text-muted">Loading…</span>}
        </div>
      </div>

      <div className="relative h-[400px] rounded-control border border-line bg-inset">
        <div ref={box} className="absolute inset-0" />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Replay controls">
        <IconBtn label="Previous entry or exit" onClick={() => (setPlaying(false), jump(-1))}>
          <SkipBack size={15} aria-hidden />
        </IconBtn>
        <IconBtn label="Back one candle" onClick={() => (setPlaying(false), goto(i - 1))}>
          <StepForward size={15} aria-hidden className="rotate-180" />
        </IconBtn>
        <button type="button" onClick={toggle} aria-label={running ? "Pause" : atEnd ? "Replay from the start" : "Play"} className="inline-flex min-h-10 min-w-24 items-center justify-center gap-1.5 rounded-control bg-accent px-4 text-[13px] font-semibold text-bg hover:bg-[var(--accent-hover)]">
          {running ? <Pause size={15} aria-hidden /> : atEnd ? <RotateCcw size={15} aria-hidden /> : <Play size={15} aria-hidden />}
          {running ? "Pause" : atEnd ? "Again" : "Play"}
        </button>
        <IconBtn label="Forward one candle" onClick={() => (setPlaying(false), goto(i + 1))}>
          <StepForward size={15} aria-hidden />
        </IconBtn>
        <IconBtn label="Next entry or exit" onClick={() => (setPlaying(false), jump(1))}>
          <SkipForward size={15} aria-hidden />
        </IconBtn>
        <IconBtn label="Back to the start" onClick={() => (setPlaying(false), goto(data.start))}>
          <RotateCcw size={15} aria-hidden />
        </IconBtn>
        <div role="group" aria-label="Speed" className="ml-auto flex items-center gap-1">
          {SPEEDS.map((s) => (
            <button key={s} type="button" aria-pressed={speed === s} onClick={() => setSpeed(s)} className={cn("min-h-9 min-w-9 rounded-md px-2 text-xs", speed === s ? "bg-line font-semibold text-ink" : "text-muted hover:text-ink")}>
              {s}×
            </button>
          ))}
        </div>
      </div>
      <input type="range" min={0} max={last} value={i} onChange={(e) => (setPlaying(false), goto(Number(e.target.value)))} aria-label="Position in the replay" aria-valuetext={clock(candle.t, tzOffsetMin)} className="mt-2 w-full accent-[var(--accent)]" />
      <p className="mt-1 text-[11px] text-muted">Space plays or pauses; the arrow keys step one candle. Times are in your display timezone.</p>

      <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
        <Stat label="Time" value={clock(candle.t, tzOffsetMin)} />
        <Stat label="Price" value={`${candle.c}`} sub={`O ${candle.o} · H ${candle.h} · L ${candle.l}`} />
        <Stat label="Running P&L (before fees)" value={<span className={TONE[pnlTone(pnl)]}>{money(pnl, data.currency)}</span>} sub={`Best ${money(best, data.currency)} · Worst ${money(worst, data.currency)}`} />
      </div>

      {data.trades.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-card border border-line">
          <table className="w-full min-w-[560px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="px-3 py-2 font-medium">Opened</th>
                <th className="px-3 py-2 font-medium">Side</th>
                <th className="px-3 py-2 text-right font-medium">Lots</th>
                <th className="px-3 py-2 text-right font-medium">Entry</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {data.trades.map((t) => {
                const s = status_(t);
                return (
                  <tr key={t.id} className="border-b border-line last:border-0">
                    <td className="num px-3 py-2">{clock(t.open, tzOffsetMin)}</td>
                    <td className="px-3 py-2">{t.side === "LONG" ? "Long" : "Short"}</td>
                    <td className="num px-3 py-2 text-right">{t.quantity}</td>
                    <td className="num px-3 py-2 text-right">{s === "waiting" ? "—" : t.avgEntry}</td>
                    <td className={cn("px-3 py-2", s === "open" ? "text-accent" : "text-muted")}>{s === "waiting" ? "Not yet" : s === "open" ? "Open" : "Closed"}</td>
                    <td className="num px-3 py-2 text-right">{s === "closed" ? <Link href={`/trades/${t.id}`} className={cn("hover:underline", TONE[pnlTone(t.netPnl)])}>{money(t.netPnl, data.currency)}</Link> : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {finished && <p className="mt-3 rounded-control bg-nav-active px-3 py-2 text-sm">Replay finished. Net result after fees: <span className={cn("num font-semibold", TONE[pnlTone(net)])}>{money(net, data.currency)}</span></p>}

      <div className="mt-3 flex flex-col gap-1 text-[11px] text-muted">
        {!data.priceCheck.matches && (
          <p role="alert" className="rounded-md bg-loss-bg px-2.5 py-1.5 text-loss">
            The price feed shows about {data.priceCheck.feedPrice?.toFixed(2)} at the time of entry, {data.priceCheck.diffPct?.toFixed(1)}% away from this trade&rsquo;s entry, so the running P&amp;L is not shown. The chart is for context only.
          </p>
        )}
        {data.coarsened && <p>This window is long, so a coarser timeframe was chosen to keep the replay a sensible length.</p>}
        {data.incomplete && <p>Some price data could not be downloaded, so the chart may have gaps. <Retry onClick={() => setAttempt((a) => a + 1)} /></p>}
        {data.pendingToday && <p>Prices for today are published after the day ends, so the replay stops at the end of yesterday.</p>}
        <p>Prices come from Dukascopy and can differ slightly from your broker&rsquo;s feed.</p>
      </div>
    </div>
  );
}

function Box({ children }: { children: React.ReactNode }) {
  return <div className="flex h-[400px] flex-col items-center justify-center gap-3 rounded-control border border-line bg-inset px-6 text-center text-sm text-muted">{children}</div>;
}

function Retry({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-accent underline">
      Try again
    </button>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="flex h-10 w-10 items-center justify-center rounded-control border border-line-strong text-muted hover:bg-nav-active hover:text-ink">
      {children}
    </button>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-card border border-line bg-card px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="num mt-1 text-lg font-semibold">{value}</div>
      {sub && <div className="num mt-0.5 text-[11px] text-muted">{sub}</div>}
    </div>
  );
}
