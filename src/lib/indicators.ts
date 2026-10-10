import type { Candle } from "@/lib/market-data/types";

export type Series = (number | null)[];

/** Exponential moving average of the closes. The first value is the simple average of the first `n` closes; before that, null. */
export function ema(candles: Candle[], n: number): Series {
  const out: Series = candles.map(() => null);
  if (n < 1 || candles.length < n) return out;
  const k = 2 / (n + 1);
  let prev = candles.slice(0, n).reduce((s, c) => s + c.c, 0) / n;
  out[n - 1] = prev;
  for (let i = n; i < candles.length; i++) {
    prev = candles[i].c * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/**
 * Volume-weighted average price, restarting each UTC day. Uses typical price (high + low + close) / 3.
 * If the feed carries no volume the average is unweighted, so the line still draws.
 */
export function vwap(candles: Candle[]): Series {
  const out: Series = [];
  let day = -1;
  let pv = 0;
  let vol = 0;
  let plain = 0;
  let count = 0;
  for (const c of candles) {
    const d = Math.floor(c.t / 86_400);
    if (d !== day) {
      day = d;
      pv = vol = plain = count = 0;
    }
    const typical = (c.h + c.l + c.c) / 3;
    const w = c.v > 0 ? c.v : 0;
    pv += typical * w;
    vol += w;
    plain += typical;
    count++;
    out.push(vol > 0 ? pv / vol : plain / count);
  }
  return out;
}

/** Relative strength index with Wilder smoothing. Null until `n` changes exist. */
export function rsi(candles: Candle[], n = 14): Series {
  const out: Series = candles.map(() => null);
  if (candles.length <= n) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = candles[i].c - candles[i - 1].c;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= n;
  loss /= n;
  const value = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
  out[n] = value();
  for (let i = n + 1; i < candles.length; i++) {
    const d = candles[i].c - candles[i - 1].c;
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = value();
  }
  return out;
}

export const INDICATORS = [
  { key: "ema20", label: "EMA 20", color: "#7FB7F0" },
  { key: "ema50", label: "EMA 50", color: "#E0B04E" },
  { key: "ema200", label: "EMA 200", color: "#C084FC" },
  { key: "vwap", label: "VWAP", color: "#F0A35E" },
  { key: "rsi", label: "RSI 14", color: "#3DD39A" },
] as const;
export type IndicatorKey = (typeof INDICATORS)[number]["key"];
export const isIndicatorKey = (k: string): k is IndicatorKey => INDICATORS.some((i) => i.key === k);

/** Bars of history an indicator needs before its first value is trustworthy. */
export const WARMUP: Record<IndicatorKey, number> = { ema20: 60, ema50: 150, ema200: 600, vwap: 0, rsi: 100 };
