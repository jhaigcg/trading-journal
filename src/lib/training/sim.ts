import type { Candle } from "@/lib/market-data/types";

export type Side = "LONG" | "SHORT";
export type Outcome = "TP" | "SL" | "TIMEOUT" | "NO_FILL";

export interface Order {
  side: Side;
  entry: number;
  stopLoss: number;
  takeProfit: number;
}

/** Plain-words reason an order cannot be placed, or null when it is fine. */
export function validateOrder(o: Order): string | null {
  const nums = [o.entry, o.stopLoss, o.takeProfit];
  if (!nums.every((n) => Number.isFinite(n) && n > 0)) return "Entry, stop loss and take profit must all be set.";
  if (o.side === "LONG") {
    if (!(o.stopLoss < o.entry)) return "For a long, the stop loss must be below the entry.";
    if (!(o.takeProfit > o.entry)) return "For a long, the take profit must be above the entry.";
  } else {
    if (!(o.stopLoss > o.entry)) return "For a short, the stop loss must be above the entry.";
    if (!(o.takeProfit < o.entry)) return "For a short, the take profit must be below the entry.";
  }
  return null;
}

export const riskOf = (o: Order) => Math.abs(o.entry - o.stopLoss);
export const rewardOf = (o: Order) => Math.abs(o.takeProfit - o.entry);
export const rrOf = (o: Order) => (riskOf(o) > 0 ? rewardOf(o) / riskOf(o) : 0);
const dir = (s: Side) => (s === "LONG" ? 1 : -1);

/** Result in R (multiples of the risk): +RR at the target, -1 at the stop. */
export const rMultiple = (o: Order, exit: number) => (dir(o.side) * (exit - o.entry)) / riskOf(o);

export interface Exit {
  outcome: "TP" | "SL";
  price: number;
}

/**
 * Did this candle close the trade? If the same candle reaches both the stop and the target we cannot know which came
 * first, so the stop is assumed: a simulation should never flatter you.
 */
export function exitIn(o: Order, c: Candle): Exit | null {
  const long = o.side === "LONG";
  const slHit = long ? c.l <= o.stopLoss : c.h >= o.stopLoss;
  const tpHit = long ? c.h >= o.takeProfit : c.l <= o.takeProfit;
  if (slHit) return { outcome: "SL", price: o.stopLoss };
  if (tpHit) return { outcome: "TP", price: o.takeProfit };
  return null;
}

export interface SimResult {
  filled: boolean;
  fillT: number | null;
  outcome: Outcome;
  exitPrice: number | null;
  exitT: number | null;
  /** result in R, null when the order never filled */
  r: number | null;
  /** worst and best the trade went, in R, while it was open */
  maeR: number | null;
  mfeR: number | null;
}

const none = (outcome: Outcome = "NO_FILL"): SimResult => ({ filled: false, fillT: null, outcome, exitPrice: null, exitT: null, r: null, maeR: null, mfeR: null });

/**
 * Run an order over the candles that follow the decision.
 *  - "touch": a resting order (limit or stop) that fills the first time price reaches the entry.
 *  - "market": filled at the entry price on the first candle given (live trading); the rest follow.
 * On the candle that fills a resting order only the stop is checked (a target on that candle may have been reached
 * before the entry was touched). If nothing closes the trade by the last candle it is closed there (TIMEOUT).
 */
export function simulate(o: Order, candles: Candle[], mode: "touch" | "market" = "touch"): SimResult {
  const bad = validateOrder(o);
  if (bad || candles.length === 0) return none();
  const risk = riskOf(o);
  const long = o.side === "LONG";
  let fillIdx = -1;

  if (mode === "market") fillIdx = 0;
  else {
    for (let i = 0; i < candles.length; i++) {
      if (candles[i].l <= o.entry && o.entry <= candles[i].h) {
        fillIdx = i;
        break;
      }
    }
  }
  if (fillIdx < 0) return none();

  let mae = 0;
  let mfe = 0;
  const track = (c: Candle) => {
    const against = long ? o.entry - c.l : c.h - o.entry;
    const toward = long ? c.h - o.entry : o.entry - c.l;
    mae = Math.max(mae, against / risk);
    mfe = Math.max(mfe, toward / risk);
  };
  const done = (idx: number, e: { outcome: Outcome; price: number }): SimResult => ({
    filled: true,
    fillT: candles[fillIdx].t,
    outcome: e.outcome,
    exitPrice: e.price,
    exitT: candles[idx].t,
    r: rMultiple(o, e.price),
    maeR: Math.min(mae, 99),
    mfeR: Math.min(mfe, 99),
  });

  // the fill candle: stop only (market orders are filled at the close of it, so nothing more happens in it)
  if (mode === "touch") {
    track(candles[fillIdx]);
    const slHit = long ? candles[fillIdx].l <= o.stopLoss : candles[fillIdx].h >= o.stopLoss;
    if (slHit) return done(fillIdx, { outcome: "SL", price: o.stopLoss });
  }
  for (let i = fillIdx + 1; i < candles.length; i++) {
    track(candles[i]);
    const e = exitIn(o, candles[i]);
    if (e) return done(i, e);
  }
  const last = candles.length - 1;
  return done(last, { outcome: "TIMEOUT", price: candles[last].c });
}
