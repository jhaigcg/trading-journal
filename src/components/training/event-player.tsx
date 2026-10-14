"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import type { Candle } from "@/lib/market-data/types";
import { limitProblem, rMultiple, simulate, type Order, type SimResult } from "@/lib/training/sim";
import type { Answer, AttemptResult, Question } from "@/lib/training/service";
import { ResultPanel } from "./result-panel";
import { TrainingChart, type ChartLine, type TradeBox } from "./training-chart";
import { clockText, postJson, useApi } from "./use-api";

const SPEEDS: [string, number][] = [["Real time", 5000], ["×5", 1000], ["×10", 500], ["×25", 200], ["×50", 100]];
const STORE = "ledger.training.distances";
const BLUE = "#7FB7F0";
const RED = "#F26B6F";
const GREEN = "#3DD39A";
const input = "min-h-10 w-full rounded-control border border-line-strong bg-inset px-3 text-sm text-ink focus:border-accent focus:outline-none";

const NO_CANDLES: Candle[] = [];

interface Position {
  type: "market" | "limit";
  side: "LONG" | "SHORT";
  entry: number;
  stopLoss: number;
  takeProfit: number;
  entryT: number;
  entryIdx: number;
}

/**
 * How a trade placed on candle `position.entryIdx` plays out over the whole window, using the same rules as the server:
 * a market order fills at that candle's close, a limit order rests and fills the first time a later candle touches it.
 */
function playOut(position: Position | null, candles: Candle[]): SimResult | null {
  if (!position || candles.length === 0) return null;
  const o: Order = { side: position.side, entry: position.entry, stopLoss: position.stopLoss, takeProfit: position.takeProfit };
  return position.type === "limit" ? simulate(o, candles.slice(position.entryIdx + 1), "touch") : simulate(o, candles.slice(position.entryIdx), "market");
}

function savedDistances(): { sl: string; tp: string } {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? "null");
    if (v && typeof v.sl === "string" && typeof v.tp === "string") return v;
  } catch {
    /* defaults */
  }
  return { sl: "3", tp: "6" };
}

/**
 * Live event replay (CPI, NFP): the chart plays forward second by second from the decision moment and you trade it.
 * Buy or sell, with a stop and a target set as distances. The server then re-plays your trade on the stored candles
 * and gives the verdict, so the result cannot be bent by the browser. The trade runs to its stop, its target or the end
 * of the window; there is no manual close in this version.
 */
export function EventPlayer({ id, tzOffsetMin, nextHref }: { id: string; tzOffsetMin: number; nextHref: string | null }) {
  const [round, setRound] = useState(0);
  const { data: q, error, loading } = useApi<Question>(`/api/training/${id}/question?tf=S5`, round);

  const [pos, setPos] = useState(-1); // index of the newest candle shown; -1 until the data arrives
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(500);
  const [position, setPosition] = useState<Position | null>(null);
  const [dist, setDist] = useState<{ sl: string; tp: string }>(() => (typeof window === "undefined" ? { sl: "3", tp: "6" } : savedDistances()));
  const [orderType, setOrderType] = useState<"market" | "limit">("limit"); // limit first: the news-pullback entry
  const [limitPrice, setLimitPrice] = useState("");
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitted = useRef(false);

  const candles = q?.candles ?? NO_CANDLES;
  const startIdx = useMemo(() => {
    if (!q) return 0;
    let i = -1;
    candles.forEach((c, k) => {
      if (c.t < q.decisionT) i = k;
    });
    return Math.max(0, i);
  }, [q, candles]);
  const last = candles.length - 1;
  const now = pos < 0 ? startIdx : pos;

  // how the trade plays out over the whole window (used for the live status and for "skip ahead")
  const plan = playOut(position, candles);
  const fillIdx = plan?.fillT != null ? candles.findIndex((c) => c.t === plan.fillT) : -1;
  const exitIdx = plan?.exitT != null ? candles.findIndex((c) => c.t === plan.exitT) : -1;
  const filled = fillIdx >= 0 && now >= fillIdx;
  const closed = !!position && exitIdx >= 0 && now >= exitIdx;
  const atEnd = now >= last;
  const running = playing && !closed && !atEnd && !result && !answer;

  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setPos((p) => Math.min((p < 0 ? startIdx : p) + 1, last)), speed);
    return () => window.clearInterval(t);
  }, [running, speed, startIdx, last]);

  const finish = async (p: Position) => {
    setBusy(true);
    const r = await postJson<AttemptResult>(`/api/training/${id}/attempt`, { side: p.side, entry: p.entry, stopLoss: p.stopLoss, takeProfit: p.takeProfit, entryT: p.entryT, orderType: p.type, tf: "S5" });
    setBusy(false);
    if (!r.ok) return setProblem(r.error);
    setResult(r.data);
  };
  // the trade is over (stop, target, or the end of the window, even if a limit never filled): hand it to the server exactly once
  useEffect(() => {
    if (position && (closed || atEnd) && !submitted.current) {
      submitted.current = true;
      void finish(position);
    }
  });

  const decisionStarted = !!q && candles[now] && candles[now].t >= q.decisionT;
  const place = (side: "LONG" | "SHORT") => {
    const sl = Number(dist.sl);
    const tp = Number(dist.tp);
    if (!(sl > 0) || !(tp > 0)) return setProblem("Enter a stop and a target distance above 0.");
    const c = candles[now];
    const type = orderType;
    const entry = type === "limit" ? Number(limitPrice) : c.c;
    if (type === "limit") {
      const wrong = limitProblem(side, entry, c.c);
      if (wrong) return setProblem(wrong);
    }
    try {
      localStorage.setItem(STORE, JSON.stringify(dist));
    } catch {
      /* not remembered */
    }
    setProblem(null);
    setPosition({ type, side, entry, stopLoss: side === "LONG" ? entry - sl : entry + sl, takeProfit: side === "LONG" ? entry + tp : entry - tp, entryT: c.t, entryIdx: now });
    setPlaying(true);
  };
  // a limit that has not filled can be withdrawn and replaced; once it has filled it is a trade
  const cancelOrder = () => {
    if (filled) return;
    setPosition(null);
    setPlaying(false);
  };
  const giveUp = async () => {
    setBusy(true);
    const r = await fetch(`/api/training/${id}/answer?tf=S5`).then((x) => x.json().then((b) => ({ ok: x.ok, b })));
    setBusy(false);
    if (!r.ok) return setProblem(r.b?.error ?? "Could not load the answer.");
    setAnswer(r.b as Answer);
  };
  const again = () => {
    setResult(null);
    setAnswer(null);
    setPosition(null);
    setPos(-1);
    setPlaying(false);
    setProblem(null);
    submitted.current = false;
    setRound((n) => n + 1);
  };

  if (error) return <p role="alert" className="rounded-card border border-line bg-card p-6 text-sm text-loss">{error}</p>;
  if (!q && loading) return <p className="rounded-card border border-line bg-card p-10 text-center text-sm text-muted">Building 5-second candles for this event from tick data. The first time can take a little while.</p>;
  if (!q) return null;

  const revealed = !!result || !!answer;
  const shownCandles = revealed ? (result?.candles ?? answer?.candles ?? candles) : candles.slice(0, now + 1);
  const cur = candles[now];
  const floating = position && filled && cur ? (position.side === "LONG" ? 1 : -1) * (cur.c - position.entry) : 0;
  const risk = position ? Math.abs(position.entry - position.stopLoss) : 0;

  const lines: ChartLine[] = [];
  if (position) lines.push({ price: position.entry, color: BLUE, title: position.type === "limit" ? "Limit" : "Entry" }, { price: position.stopLoss, color: RED, title: "SL" }, { price: position.takeProfit, color: GREEN, title: "TP" });
  const expert = result?.expert ?? answer?.expert;
  const bands: { low: number; high: number; rgb: string; alpha?: number; label?: string; fromT?: number }[] = [];
  if (revealed && expert) {
    bands.push({ low: expert.entryLow, high: expert.entryHigh, rgb: "127, 183, 240", alpha: 0.2, label: "Expert entry zone", fromT: q.decisionT });
    lines.push({ price: expert.stopLoss, color: RED, title: "Expert SL", dashed: true }, { price: expert.takeProfit, color: GREEN, title: "Expert TP", dashed: true });
  }
  const showFill = plan?.fillT != null && (filled || revealed);
  const box: TradeBox | null = position && showFill && plan?.fillT != null ? { openT: plan.fillT, closeT: closed || revealed ? plan.exitT : null, side: position.side, entry: position.entry, exit: closed || revealed ? plan.exitPrice : null, stopLoss: position.stopLoss, takeProfit: position.takeProfit } : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className="rounded-md bg-line px-2 py-1 font-semibold text-ink">5s</span>
          <span className="num">{cur ? clockText(cur.t, tzOffsetMin) + `:${String(cur.t % 60).padStart(2, "0")}` : ""}</span>
          <span className="ml-auto">
            Decision moment <span className="num text-accent">{clockText(q.decisionT, tzOffsetMin)}</span>
          </span>
        </div>
        <TrainingChart candles={shownCandles} tzOffsetMin={tzOffsetMin} height={480} lines={lines} bands={bands} decisionT={q.decisionT} decisionLabel="Replay starts" box={box} visibleBars={140} />
        {!revealed && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" disabled={closed || atEnd} onClick={() => setPlaying((p) => !p)} className="min-h-10 min-w-24 rounded-control bg-accent px-4 text-[13px] font-semibold text-bg hover:bg-[var(--accent-hover)] disabled:opacity-50">
              {running ? "Pause" : "Play"}
            </button>
            <button type="button" disabled={closed || atEnd || running} onClick={() => setPos(Math.min(now + 1, last))} className="min-h-10 rounded-control border border-line-strong px-3 text-[13px] hover:bg-nav-active disabled:opacity-50">
              Step 5s
            </button>
            {position && !closed && (
              <button type="button" onClick={() => setPos(exitIdx >= 0 ? exitIdx : last)} className="min-h-10 rounded-control border border-line-strong px-3 text-[13px] hover:bg-nav-active">
                {exitIdx >= 0 ? "Skip to the end of the trade" : "Skip to the end of the window"}
              </button>
            )}
            <div role="group" aria-label="Speed" className="ml-auto flex items-center gap-1">
              {SPEEDS.map(([label, ms]) => (
                <button key={label} type="button" aria-pressed={speed === ms} onClick={() => setSpeed(ms)} className={cn("min-h-9 rounded-md px-2 text-xs", speed === ms ? "bg-line font-semibold text-ink" : "text-muted hover:text-ink")}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <aside className="min-w-0">
        {revealed ? (
          <ResultPanel result={result} answer={answer} onAgain={again} nextHref={nextHref} />
        ) : (
          <div className="flex flex-col gap-4 rounded-card border border-line bg-card p-4">
            <div>
              <h2 className="text-[15px] font-semibold">{q.title}</h2>
              <p className="mt-1 text-xs text-muted">
                {q.symbol} · live event · difficulty {"★".repeat(q.difficulty)}
                {"☆".repeat(3 - q.difficulty)}
              </p>
              <p className="mt-2 text-sm text-ink-2">The chart plays forward from the decision moment. Press Play and let the break happen. Then place a limit order where you expect the pullback (it waits and fills only if price returns), or trade at market. The trade runs to its stop or target.</p>
            </div>

            {!position ? (
              <>
                <div role="group" aria-label="Order type" className="grid grid-cols-2 gap-1 rounded-control bg-inset p-1 text-xs">
                  {(["limit", "market"] as const).map((t) => (
                    <button key={t} type="button" aria-pressed={orderType === t} onClick={() => setOrderType(t)} className={cn("min-h-9 rounded-md", orderType === t ? "bg-line font-semibold text-ink" : "text-muted hover:text-ink")}>
                      {t === "limit" ? "Limit (wait for pullback)" : "At market"}
                    </button>
                  ))}
                </div>
                {orderType === "limit" && (
                  <label className="flex flex-col gap-1.5 text-xs text-muted">
                    Limit price{cur ? ` (price now ${cur.c.toFixed(2)})` : ""}
                    <input inputMode="decimal" value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} placeholder="Where the order waits" className={input} />
                  </label>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1.5 text-xs text-muted">
                    Stop distance
                    <input inputMode="decimal" value={dist.sl} onChange={(e) => setDist((d) => ({ ...d, sl: e.target.value }))} className={input} />
                  </label>
                  <label className="flex flex-col gap-1.5 text-xs text-muted">
                    Target distance
                    <input inputMode="decimal" value={dist.tp} onChange={(e) => setDist((d) => ({ ...d, tp: e.target.value }))} className={input} />
                  </label>
                </div>
                <p className="num text-xs text-muted">Distances are in price (for gold, 3 means $3). Risk to reward 1 : {Number(dist.sl) > 0 ? (Number(dist.tp) / Number(dist.sl)).toFixed(2) : "—"}</p>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" disabled={!decisionStarted || busy} onClick={() => place("LONG")} className="min-h-12 rounded-control border border-profit bg-profit-bg text-sm font-semibold text-profit disabled:opacity-40">
                    {orderType === "limit" ? "Buy limit" : "Buy"}
                  </button>
                  <button type="button" disabled={!decisionStarted || busy} onClick={() => place("SHORT")} className="min-h-12 rounded-control border border-loss bg-loss-bg text-sm font-semibold text-loss disabled:opacity-40">
                    {orderType === "limit" ? "Sell limit" : "Sell"}
                  </button>
                </div>
                {!decisionStarted && <p className="text-xs text-muted">Press Play first: orders open once the replay passes the decision moment.</p>}
                <button type="button" disabled={busy} onClick={() => window.confirm("Show the answer without trading? Nothing is recorded.") && giveUp()} className="text-xs text-muted underline hover:text-ink">
                  End without trading and show the answer
                </button>
              </>
            ) : (
              <div className="flex flex-col gap-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className={cn("font-semibold", position.side === "LONG" ? "text-profit" : "text-loss")}>
                    {position.side === "LONG" ? "Long" : "Short"} {filled ? "open" : "limit waiting"}
                  </span>
                  <span className="num text-xs text-muted">
                    {filled ? "in at" : "limit at"} {position.entry.toFixed(2)}
                  </span>
                </div>
                <div className="num grid grid-cols-2 gap-2 text-xs">
                  <span className="text-loss">SL {position.stopLoss.toFixed(2)}</span>
                  <span className="text-right text-profit">TP {position.takeProfit.toFixed(2)}</span>
                </div>
                {!filled && (
                  <div className="rounded-control border border-line bg-inset p-3 text-xs text-muted">
                    Waiting for price to come back to {position.entry.toFixed(2)}. Keep playing: it fills the first time price touches it, and if it never does you finish with no trade.
                    <button type="button" onClick={cancelOrder} className="mt-2 block text-ink underline">
                      Cancel the order and place a different one
                    </button>
                  </div>
                )}
                {filled && <div className="rounded-control border border-line bg-inset p-3">
                  <div className="text-xs text-muted">Floating</div>
                  <div className={cn("num text-xl font-semibold", floating >= 0 ? "text-profit" : "text-loss")}>
                    {floating >= 0 ? "+" : "−"}
                    {Math.abs(floating).toFixed(2)} <span className="text-sm">({risk ? `${rMultiple({ side: position.side, entry: position.entry, stopLoss: position.stopLoss, takeProfit: position.takeProfit }, cur.c) >= 0 ? "+" : "−"}${Math.abs(rMultiple({ side: position.side, entry: position.entry, stopLoss: position.stopLoss, takeProfit: position.takeProfit }, cur.c)).toFixed(2)}R` : ""})</span>
                  </div>
                </div>}
                {busy && <p className="text-xs text-muted">Checking your trade against the stored prices…</p>}
              </div>
            )}
            {problem && (
              <p role="alert" className="rounded-control bg-loss-bg px-3 py-2 text-sm text-loss">
                {problem}
              </p>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
