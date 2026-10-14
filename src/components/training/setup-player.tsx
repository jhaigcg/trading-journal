"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { rrOf, validateOrder, type Order } from "@/lib/training/sim";
import type { Answer, AttemptResult, Question } from "@/lib/training/service";
import { ZoneToggles } from "@/components/trades/zone-toggles";
import { ZONES_OFF, zonesAvailable, type ZoneChoice } from "@/lib/smc";
import { TrainingChart, type ChartLine, type TradeBox } from "./training-chart";
import { ResultPanel } from "./result-panel";
import { clockText, postJson, useApi } from "./use-api";

const TF_NAME: Record<string, string> = { S5: "5s", M1: "1m", M5: "5m", M15: "15m", H1: "1h" };
const BLUE = "#7FB7F0";
const RED = "#F26B6F";
const GREEN = "#3DD39A";
const input = "min-h-10 w-full rounded-control border border-line-strong bg-inset px-3 text-sm text-ink focus:border-accent focus:outline-none";

type Field = "entry" | "stop" | "target";
const STEPS: { id: Field; label: string; color: string }[] = [
  { id: "entry", label: "Entry", color: BLUE },
  { id: "stop", label: "Stop loss", color: RED },
  { id: "target", label: "Take profit", color: GREEN },
];

/**
 * "Mark the setup". The chart stops at the decision point; click to place the entry, the stop loss and the take profit,
 * then reveal. The real candles that follow decide how your trade did, and it is compared with the expert answer.
 */
export function SetupPlayer({ id, tzOffsetMin, nextHref }: { id: string; tzOffsetMin: number; nextHref: string | null }) {
  const [tf, setTf] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const [zoneChoice, setZoneChoice] = useState<ZoneChoice>(ZONES_OFF); // off by default: they would give away part of the exercise
  const { data: q, error, loading } = useApi<Question>(`/api/training/${id}/question${tf ? `?tf=${tf}` : ""}`, round);

  const [side, setSide] = useState<"LONG" | "SHORT">("LONG");
  const [vals, setVals] = useState<Record<Field, string>>({ entry: "", stop: "", target: "" });
  const [active, setActive] = useState<Field | null>("entry");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);

  const num = (s: string) => (s.trim() === "" ? NaN : Number(s));
  const order: Order = { side, entry: num(vals.entry), stopLoss: num(vals.stop), takeProfit: num(vals.target) };
  const filled = [order.entry, order.stopLoss, order.takeProfit].every(Number.isFinite);
  const invalid = filled ? validateOrder(order) : null;
  const ready = filled && !invalid;

  const onPick = useCallback(
    (price: number) => {
      if (!active || result || answer) return;
      setVals((v) => ({ ...v, [active]: price.toFixed(2) }));
      setActive(active === "entry" ? "stop" : active === "stop" ? "target" : null);
      setProblem(null);
    },
    [active, result, answer],
  );

  // the reveal plays the following candles one by one
  const revealCandles = result?.candles ?? answer?.candles ?? null;
  const decisionT = q?.decisionT ?? result?.decisionT ?? answer?.decisionT ?? 0;
  const firstFuture = useMemo(() => (revealCandles ? revealCandles.findIndex((c) => c.t >= decisionT) : -1), [revealCandles, decisionT]);
  const [shown, setShown] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [lastKey, setLastKey] = useState("");
  const revealKey = revealCandles ? `${revealCandles.length}:${revealCandles[0]?.t}` : "";
  if (revealKey && revealKey !== lastKey) {
    setLastKey(revealKey);
    setShown(firstFuture < 0 ? revealCandles!.length : firstFuture);
    setPlaying(true);
  }
  useEffect(() => {
    if (!playing || !revealCandles) return;
    const t = window.setInterval(() => setShown((n) => Math.min(n + 1, revealCandles.length)), 260);
    return () => window.clearInterval(t);
  }, [playing, revealCandles]);
  const finished = !!revealCandles && shown >= revealCandles.length;

  const submit = async () => {
    setBusy(true);
    setProblem(null);
    const r = await postJson<AttemptResult>(`/api/training/${id}/attempt`, { ...order, tf: q?.tf });
    setBusy(false);
    if (!r.ok) return setProblem(r.error);
    setResult(r.data);
  };
  const giveUp = async () => {
    setBusy(true);
    const r = await fetch(`/api/training/${id}/answer?tf=${q?.tf ?? ""}`).then((x) => x.json().then((b) => ({ ok: x.ok, b })));
    setBusy(false);
    if (!r.ok) return setProblem(r.b?.error ?? "Could not load the answer.");
    setAnswer(r.b as Answer);
  };
  const again = () => {
    setResult(null);
    setAnswer(null);
    setVals({ entry: "", stop: "", target: "" });
    setActive("entry");
    setPlaying(false);
    setLastKey("");
    setRound((n) => n + 1);
  };

  const lines: ChartLine[] = [];
  const bands: { low: number; high: number; rgb: string; alpha?: number; label?: string; fromT?: number }[] = [];
  const o = result?.order ?? (filled ? order : null);
  const fromT = result ? decisionT : q?.candles.at(-1)?.t;
  const entryNum = result ? result.order.entry : order.entry;
  if (Number.isFinite(entryNum)) lines.push({ price: entryNum, color: BLUE, title: "Your entry" });
  if (Number.isFinite(result ? result.order.stopLoss : order.stopLoss)) lines.push({ price: result ? result.order.stopLoss : order.stopLoss, color: RED, title: "Your SL" });
  if (Number.isFinite(result ? result.order.takeProfit : order.takeProfit)) lines.push({ price: result ? result.order.takeProfit : order.takeProfit, color: GREEN, title: "Your TP" });
  if (o && Number.isFinite(o.entry) && Number.isFinite(o.stopLoss) && Number.isFinite(o.takeProfit) && !validateOrder(o) && !result) {
    bands.push({ low: Math.min(o.entry, o.takeProfit), high: Math.max(o.entry, o.takeProfit), rgb: "61, 211, 154", fromT });
    bands.push({ low: Math.min(o.entry, o.stopLoss), high: Math.max(o.entry, o.stopLoss), rgb: "242, 107, 111", fromT });
  }
  const expert = result?.expert ?? answer?.expert ?? null;
  const showExpert = (result || answer) && finished && expert;
  if (showExpert && expert) {
    bands.push({ low: expert.entryLow, high: expert.entryHigh, rgb: "127, 183, 240", alpha: 0.2, label: "Expert entry zone", fromT: decisionT });
    lines.push({ price: expert.stopLoss, color: RED, title: "Expert SL", dashed: true }, { price: expert.takeProfit, color: GREEN, title: "Expert TP", dashed: true });
  }
  const box: TradeBox | null = result && finished && result.sim.filled && result.sim.fillT != null ? { openT: result.sim.fillT, closeT: result.sim.exitT, side: result.order.side, entry: result.order.entry, exit: result.sim.exitPrice, stopLoss: result.order.stopLoss, takeProfit: result.order.takeProfit } : null;

  const candles = revealCandles ? revealCandles.slice(0, shown) : (q?.candles ?? []);
  const revealing = !!revealCandles;

  if (error) return <p role="alert" className="rounded-card border border-line bg-card p-6 text-sm text-loss">{error}</p>;
  if (!q && loading) return <p className="rounded-card border border-line bg-card p-10 text-center text-sm text-muted">Downloading the prices for this scenario. The first time can take a little while.</p>;
  if (!q) return null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-1" role="group" aria-label="Timeframe">
          {q.tfs.map((t) => (
            <button key={t} type="button" aria-pressed={q.tf === t} disabled={revealing} onClick={() => setTf(t)} className={cn("min-h-8 rounded-md px-2.5 text-xs disabled:opacity-50", q.tf === t ? "bg-line font-semibold text-ink" : "text-muted hover:text-ink")}>
              {TF_NAME[t] ?? t}
            </button>
          ))}
          {zonesAvailable(q.tf) && (
            <span className="ml-2">
              <ZoneToggles value={zoneChoice} onChange={setZoneChoice} />
            </span>
          )}
          {loading && <span className="ml-2 text-xs text-muted">Loading…</span>}
          <span className="ml-auto text-xs text-muted">
            {revealing ? (finished ? "Replay finished" : "Replaying what happened next…") : <>Decision point: <span className="num text-accent">{clockText(q.decisionT, tzOffsetMin)}</span></>}
          </span>
        </div>
        <TrainingChart candles={candles} tzOffsetMin={tzOffsetMin} height={480} lines={lines} bands={bands} decisionT={decisionT} decisionLabel={revealing ? "Decision point" : "You are here"} box={box} onPick={revealing ? undefined : onPick} crosshairCursor={!revealing && !!active} zones={zonesAvailable(q.tf) ? zoneChoice : null} />
        {revealing && !finished && (
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => setPlaying((p) => !p)} className="min-h-9 rounded-control border border-line-strong px-3 text-xs hover:bg-nav-active">
              {playing ? "Pause" : "Play"}
            </button>
            <button type="button" onClick={() => setShown(revealCandles!.length)} className="min-h-9 rounded-control border border-line-strong px-3 text-xs hover:bg-nav-active">
              Skip to the end
            </button>
          </div>
        )}
        {q.incomplete && !revealing && <p className="mt-2 text-xs text-muted">Some price data could not be downloaded, so the chart may have gaps.</p>}
      </div>

      <aside className="min-w-0">
        {revealing ? (
          finished ? (
            <ResultPanel result={result} answer={answer} onAgain={again} nextHref={nextHref} />
          ) : (
            <p className="rounded-card border border-line bg-card p-4 text-sm text-muted">Watch how it played out. The result appears when the replay ends.</p>
          )
        ) : (
          <div className="flex flex-col gap-4 rounded-card border border-line bg-card p-4">
            <div>
              <h2 className="text-[15px] font-semibold">{q.title}</h2>
              <p className="mt-1 text-xs text-muted">
                {q.symbol} · difficulty {"★".repeat(q.difficulty)}
                {"☆".repeat(3 - q.difficulty)}
                {q.attempts > 0 && ` · tried ${q.attempts} ${q.attempts === 1 ? "time" : "times"}`}
              </p>
              <p className="mt-2 text-sm text-ink-2">Nothing after the decision point is shown. Pick a direction, then click the chart to place your entry, stop loss and take profit.</p>
            </div>

            <div role="group" aria-label="Direction" className="grid grid-cols-2 gap-2">
              {(["LONG", "SHORT"] as const).map((s) => (
                <button key={s} type="button" aria-pressed={side === s} onClick={() => setSide(s)} className={cn("min-h-11 rounded-control border text-sm font-semibold", side === s ? (s === "LONG" ? "border-profit bg-profit-bg text-profit" : "border-loss bg-loss-bg text-loss") : "border-line-strong text-muted hover:text-ink")}>
                  {s === "LONG" ? "Buy (long)" : "Sell (short)"}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-3">
              {STEPS.map((s) => (
                <label key={s.id} className="flex flex-col gap-1.5 text-xs text-muted">
                  <span className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                      {s.label}
                    </span>
                    <button type="button" onClick={() => setActive(s.id)} className={cn("rounded px-1.5 py-0.5 text-[11px]", active === s.id ? "bg-accent/20 text-accent" : "hover:text-ink")}>
                      {active === s.id ? "Click the chart…" : "Pick on chart"}
                    </button>
                  </span>
                  <input inputMode="decimal" value={vals[s.id]} onFocus={() => setActive(null)} onChange={(e) => {
                      setVals((v) => ({ ...v, [s.id]: e.target.value }));
                      setProblem(null);
                    }} placeholder="price" className={input} />
                </label>
              ))}
            </div>

            {ready && (
              <p className="num text-xs text-muted">
                Risk {Math.abs(order.entry - order.stopLoss).toFixed(2)} · reward {Math.abs(order.takeProfit - order.entry).toFixed(2)} · risk to reward 1 : {rrOf(order).toFixed(2)}
              </p>
            )}
            {(invalid || problem) && (
              <p role="alert" className="rounded-control bg-loss-bg px-3 py-2 text-sm text-loss">
                {problem ?? invalid}
              </p>
            )}

            <button type="button" disabled={!ready || busy} onClick={submit} className="min-h-11 rounded-control bg-accent text-sm font-semibold text-bg hover:bg-[var(--accent-hover)] disabled:opacity-50">
              {busy ? "Working…" : "Place trade and reveal"}
            </button>
            <button type="button" disabled={busy} onClick={() => window.confirm("Show the answer without trading? Nothing is recorded.") && giveUp()} className="text-xs text-muted underline hover:text-ink">
              Show me the answer without trading
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
