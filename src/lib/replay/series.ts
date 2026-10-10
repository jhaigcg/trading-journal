import { TF_SECONDS, TIMEFRAMES, type Candle, type Timeframe } from "@/lib/market-data/types";
import type { PnlPoint } from "@/lib/trades/derive";

export interface PnlTrade {
  open: number; // unix seconds
  close: number | null;
  /** floating + realised P&L over the trade's life (from runningPnl), time ascending */
  points: PnlPoint[];
  /** final gross P&L once closed */
  final: number;
}

/** P&L of one trade at time `t`: zero before it opens, its running value while open, its final value after it closes. */
export function pnlAt(tr: PnlTrade, t: number): number {
  if (t < tr.open) return 0;
  if (tr.close != null && t >= tr.close) return tr.final;
  let v = 0;
  for (const p of tr.points) {
    if (p.t > t) break;
    v = p.pnl;
  }
  return v;
}

/** Total P&L across trades at the close of every candle: the line the replay draws as it steps. */
export function combinedPnl(candles: Candle[], stepSec: number, trades: PnlTrade[]): number[] {
  return candles.map((c) => {
    const t = c.t + stepSec;
    return Math.round(trades.reduce((s, tr) => s + pnlAt(tr, t), 0) * 100) / 100;
  });
}

/** Smallest timeframe, no finer than the one asked for, that keeps the window within `maxBars` candles. */
export function chooseTimeframe(requested: Timeframe, spanSec: number, maxBars = 2500): Timeframe {
  for (const tf of TIMEFRAMES.slice(TIMEFRAMES.indexOf(requested))) if (spanSec / TF_SECONDS[tf] <= maxBars) return tf;
  return "D1";
}

/** Index of the candle containing `sec` (across a gap such as a weekend: the latest candle not after it), or -1 before the first. */
export function indexAt(candles: Candle[], sec: number): number {
  let lo = 0;
  let hi = candles.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].t <= sec) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/**
 * Where playback starts: the candle just before the first entry, so the lead-in bars are already on screen
 * and the first step reveals the entry candle.
 */
export function startIndex(candles: Candle[], firstOpenSec: number): number {
  return Math.max(0, indexAt(candles, firstOpenSec) - 1);
}
