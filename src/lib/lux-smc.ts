/**
 * Market structure, order blocks, equal highs/lows and fair value gaps, ported to TypeScript from the Pine Script
 * indicators "Smart Money Concepts [LuxAlgo]" and "Fair Value Gap [LuxAlgo]" (© LuxAlgo).
 *
 * This work is a derivative of those indicators and is licensed under the same terms:
 * Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0), https://creativecommons.org/licenses/by-nc-sa/4.0/
 * It is for personal, non-commercial use. Keep this notice if you copy or change this file.
 *
 * What is ported: swing and internal structure (BOS / CHoCH), internal and swing order blocks with their volatility
 * filter and mitigation, equal highs / lows, and the strong / weak high and low. Not ported: candle colouring, fair
 * value gaps of the Smart Money Concepts script (see computeLuxFvg for the separate gap indicator), multi-timeframe
 * levels and premium / discount zones.
 *
 * Everything is causal: each signal uses only candles up to and including the one that confirms it, so running this on
 * a prefix of the candles gives exactly the signals the full run had by that point (nothing from the future).
 */
import type { Candle } from "@/lib/market-data/types";

export interface LuxOptions {
  /** swing structure length (the indicator's default is 50; 10 is a common choice) */
  swing: number;
  /** internal structure length */
  internal: number;
  /** bars used to confirm equal highs / lows */
  eqLength: number;
  /** sensitivity of equal highs / lows, a share of the 200-bar ATR */
  eqThreshold: number;
  showInternalOb: boolean;
  internalObCount: number;
  showSwingOb: boolean;
  swingObCount: number;
  /** how bars that are too volatile are screened out of order-block selection */
  obFilter: "atr" | "range";
  /** what price mitigates (removes) an order block */
  obMitigation: "highlow" | "close";
  /** only count internal breaks that have a bar leaning the same way */
  confluence: boolean;
}

export const LUX_DEFAULTS: LuxOptions = {
  swing: 10,
  internal: 5,
  eqLength: 3,
  eqThreshold: 0.1,
  showInternalOb: true,
  internalObCount: 5,
  showSwingOb: false,
  swingObCount: 5,
  obFilter: "atr",
  obMitigation: "highlow",
  confluence: false,
};

export interface StructureEvent {
  tag: "BOS" | "CHoCH";
  bias: "bull" | "bear";
  internal: boolean;
  /** the broken level */
  level: number;
  /** the swing candle the level came from, and the candle whose close broke it */
  fromT: number;
  toT: number;
  /** candle in the middle of the line, where its label sits */
  midT: number;
}

export interface EqEvent {
  kind: "EQH" | "EQL";
  /** the earlier and the later of the two equal extremes */
  fromT: number;
  fromLevel: number;
  toT: number;
  toLevel: number;
  midT: number;
  /** the candle that confirmed it */
  confirmT: number;
}

export interface OrderBlock {
  side: "bull" | "bear";
  top: number;
  bottom: number;
  /** open time of the candle the block is drawn from */
  startT: number;
  internal: boolean;
}

export interface Trailing {
  top: number | null;
  bottom: number | null;
  topT: number | null;
  bottomT: number | null;
  /** swing trend: a bullish trend has a strong low and a weak high */
  trend: "bull" | "bear" | null;
}

export interface LuxResult {
  structure: StructureEvent[];
  eq: EqEvent[];
  /** unmitigated blocks at the last candle, newest first, already limited to the chosen counts */
  orderBlocks: OrderBlock[];
  trailing: Trailing;
}

interface Pivot {
  level: number | null;
  crossed: boolean;
  t: number;
  idx: number;
}
const newPivot = (): Pivot => ({ level: null, crossed: false, t: 0, idx: 0 });

interface Leg {
  size: number;
  leg: 0 | 1;
}

/** True range for every candle. */
function trueRange(c: Candle[]): number[] {
  return c.map((k, i) => (i === 0 ? k.h - k.l : Math.max(k.h - k.l, Math.abs(k.h - c[i - 1].c), Math.abs(k.l - c[i - 1].c))));
}

/** Wilder's moving average (what Pine's ta.atr uses); null until `len` candles exist. */
function rma(values: number[], len: number): (number | null)[] {
  const out: (number | null)[] = [];
  let prev: number | null = null;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    if (i < len - 1) {
      sum += values[i];
      out.push(null);
    } else if (i === len - 1) {
      sum += values[i];
      prev = sum / len;
      out.push(prev);
    } else {
      prev = ((prev as number) * (len - 1) + values[i]) / len;
      out.push(prev);
    }
  }
  return out;
}

export function computeLuxSmc(candles: Candle[], partial: Partial<LuxOptions> = {}): LuxResult {
  const o = { ...LUX_DEFAULTS, ...partial };
  const n = candles.length;
  const tr = trueRange(candles);
  const atr200 = rma(tr, 200);
  let cumTr = 0;

  const parsedHighs: number[] = [];
  const parsedLows: number[] = [];

  const swingHigh = newPivot();
  const swingLow = newPivot();
  const internalHigh = newPivot();
  const internalLow = newPivot();
  const equalHigh = newPivot();
  const equalLow = newPivot();
  const swingTrend = { bias: 0 };
  const internalTrend = { bias: 0 };
  const trailing: { top: number | null; bottom: number | null; topT: number | null; bottomT: number | null } = { top: null, bottom: null, topT: null, bottomT: null };

  const legs = { swing: { size: o.swing, leg: 0 } as Leg, internal: { size: o.internal, leg: 0 } as Leg, eq: { size: o.eqLength, leg: 0 } as Leg };
  // each level check compares with the level as it stood on the previous candle
  const prevLevel = { swingHigh: null as number | null, swingLow: null as number | null, internalHigh: null as number | null, internalLow: null as number | null };

  const structure: StructureEvent[] = [];
  const eq: EqEvent[] = [];
  const swingBlocks: OrderBlock[] = [];
  const internalBlocks: OrderBlock[] = [];

  /** Does a new leg start on this candle? +1 = a pivot low was just confirmed, -1 = a pivot high. */
  const legChange = (lg: Leg, i: number): -1 | 0 | 1 => {
    const before = lg.leg;
    if (i >= lg.size) {
      const cand = candles[i - lg.size];
      let hi = -Infinity;
      let lo = Infinity;
      for (let k = i - lg.size + 1; k <= i; k++) {
        if (candles[k].h > hi) hi = candles[k].h;
        if (candles[k].l < lo) lo = candles[k].l;
      }
      if (cand.h > hi) lg.leg = 0;
      else if (cand.l < lo) lg.leg = 1;
    }
    return lg.leg === before ? 0 : lg.leg === 1 ? 1 : -1;
  };

  const confirmPivots = (kind: "swing" | "internal" | "eq", i: number) => {
    const lg = legs[kind];
    const change = legChange(lg, i);
    if (change === 0) return;
    const size = lg.size;
    const src = candles[i - size];
    const atr = atr200[i];
    if (change === 1) {
      const p = kind === "eq" ? equalLow : kind === "internal" ? internalLow : swingLow;
      if (kind === "eq" && p.level != null && atr != null && Math.abs(p.level - src.l) < o.eqThreshold * atr) {
        eq.push({ kind: "EQL", fromT: p.t, fromLevel: p.level, toT: src.t, toLevel: src.l, midT: candles[Math.min(n - 1, Math.round(0.5 * (p.idx + i - size)))].t, confirmT: candles[i].t });
      }
      p.level = src.l;
      p.crossed = false;
      p.t = src.t;
      p.idx = i - size;
      if (kind === "swing") {
        trailing.bottom = p.level;
        trailing.bottomT = p.t;
      }
    } else {
      const p = kind === "eq" ? equalHigh : kind === "internal" ? internalHigh : swingHigh;
      if (kind === "eq" && p.level != null && atr != null && Math.abs(p.level - src.h) < o.eqThreshold * atr) {
        eq.push({ kind: "EQH", fromT: p.t, fromLevel: p.level, toT: src.t, toLevel: src.h, midT: candles[Math.min(n - 1, Math.round(0.5 * (p.idx + i - size)))].t, confirmT: candles[i].t });
      }
      p.level = src.h;
      p.crossed = false;
      p.t = src.t;
      p.idx = i - size;
      if (kind === "swing") {
        trailing.top = p.level;
        trailing.topT = p.t;
      }
    }
  };

  const storeBlock = (p: Pivot, internal: boolean, bias: "bull" | "bear", i: number) => {
    if (internal ? !o.showInternalOb : !o.showSwingOb) return;
    let at = p.idx;
    if (bias === "bear") {
      let best = -Infinity;
      for (let k = p.idx; k < i; k++) {
        if (parsedHighs[k] > best) {
          best = parsedHighs[k];
          at = k;
        }
      }
    } else {
      let best = Infinity;
      for (let k = p.idx; k < i; k++) {
        if (parsedLows[k] < best) {
          best = parsedLows[k];
          at = k;
        }
      }
    }
    const list = internal ? internalBlocks : swingBlocks;
    if (list.length >= 100) list.pop();
    list.unshift({ side: bias, top: parsedHighs[at], bottom: parsedLows[at], startT: candles[at].t, internal });
  };

  const display = (internal: boolean, i: number) => {
    const c = candles[i];
    const prev = i > 0 ? candles[i - 1] : null;
    let bullishBar = true;
    let bearishBar = true;
    if (o.confluence) {
      // the indicator's own formula, quirks included
      bullishBar = c.h - Math.max(c.c, c.o) > Math.min(c.c, c.o - c.l);
      bearishBar = c.h - Math.max(c.c, c.o) < Math.min(c.c, c.o - c.l);
    }
    const trend = internal ? internalTrend : swingTrend;

    const hi = internal ? internalHigh : swingHigh;
    const prevHi = internal ? prevLevel.internalHigh : prevLevel.swingHigh;
    const extraUp = internal ? internalHigh.level !== swingHigh.level && bullishBar : true;
    if (hi.level != null && prev && c.c > hi.level && prevHi != null && prev.c <= prevHi && !hi.crossed && extraUp) {
      const tag = trend.bias === -1 ? "CHoCH" : "BOS";
      hi.crossed = true;
      trend.bias = 1;
      structure.push({ tag, bias: "bull", internal, level: hi.level, fromT: hi.t, toT: c.t, midT: candles[Math.round(0.5 * (hi.idx + i))].t });
      storeBlock(hi, internal, "bull", i);
    }

    const lo = internal ? internalLow : swingLow;
    const prevLo = internal ? prevLevel.internalLow : prevLevel.swingLow;
    const extraDown = internal ? internalLow.level !== swingLow.level && bearishBar : true;
    if (lo.level != null && prev && c.c < lo.level && prevLo != null && prev.c >= prevLo && !lo.crossed && extraDown) {
      const tag = trend.bias === 1 ? "CHoCH" : "BOS";
      lo.crossed = true;
      trend.bias = -1;
      structure.push({ tag, bias: "bear", internal, level: lo.level, fromT: lo.t, toT: c.t, midT: candles[Math.round(0.5 * (lo.idx + i))].t });
      storeBlock(lo, internal, "bear", i);
    }
  };

  const mitigate = (list: OrderBlock[], i: number): OrderBlock[] => {
    const c = candles[i];
    const bearSrc = o.obMitigation === "close" ? c.c : c.h;
    const bullSrc = o.obMitigation === "close" ? c.c : c.l;
    return list.filter((b) => !(b.side === "bear" ? bearSrc > b.top : bullSrc < b.bottom));
  };

  for (let i = 0; i < n; i++) {
    const c = candles[i];
    cumTr += tr[i];
    const measure = o.obFilter === "atr" ? atr200[i] : i > 0 ? cumTr / i : null;
    const volatile = measure != null && c.h - c.l >= 2 * measure;
    parsedHighs.push(volatile ? c.l : c.h);
    parsedLows.push(volatile ? c.h : c.l);

    // trailing extremes follow price once the first swing has set them
    if (trailing.top != null) {
      trailing.top = Math.max(c.h, trailing.top);
      if (trailing.top === c.h) trailing.topT = c.t;
    }
    if (trailing.bottom != null) {
      trailing.bottom = Math.min(c.l, trailing.bottom);
      if (trailing.bottom === c.l) trailing.bottomT = c.t;
    }

    confirmPivots("swing", i);
    confirmPivots("internal", i);
    confirmPivots("eq", i);

    display(true, i);
    display(false, i);

    // blocks are mitigated as they happen; the lists keep only what is still standing
    internalBlocks.splice(0, internalBlocks.length, ...mitigate(internalBlocks, i));
    swingBlocks.splice(0, swingBlocks.length, ...mitigate(swingBlocks, i));

    prevLevel.internalHigh = internalHigh.level;
    prevLevel.internalLow = internalLow.level;
    prevLevel.swingHigh = swingHigh.level;
    prevLevel.swingLow = swingLow.level;
  }

  const orderBlocks = [...(o.showInternalOb ? internalBlocks.slice(0, o.internalObCount) : []), ...(o.showSwingOb ? swingBlocks.slice(0, o.swingObCount) : [])];
  return {
    structure,
    eq,
    orderBlocks,
    trailing: { ...trailing, trend: swingTrend.bias === 1 ? "bull" : swingTrend.bias === -1 ? "bear" : null },
  };
}

export interface FvgOptions {
  /** ignore gaps smaller than this share of the price, in percent (the indicator's "Threshold %") */
  thresholdPct: number;
  /** use the average candle range as the threshold instead */
  auto: boolean;
  /** how many bars to the right of the candle that formed the gap its box is drawn */
  extend: number;
}

export const FVG_DEFAULTS: FvgOptions = { thresholdPct: 0, auto: false, extend: 20 };

export interface LuxFvg {
  side: "bull" | "bear";
  top: number;
  bottom: number;
  /** candle indexes: the first of the three candles, the candle that completed the gap, and where its box ends */
  startIdx: number;
  formedIdx: number;
  endIdx: number;
  startT: number;
  formedT: number;
  /** index of the candle that closed through the gap and removed it; null while it stands */
  mitigatedIdx: number | null;
}

/**
 * Fair value gaps as in "Fair Value Gap [LuxAlgo]": the middle candle of three leaves a gap (the third candle's low is
 * above the first candle's high, or the mirror image), and the middle candle closed beyond the first candle's extreme.
 * A gap is mitigated, and removed, as soon as a candle CLOSES through it. Returns every gap that formed, with
 * `mitigatedIdx` set for the ones already used up; draw the ones where it is null.
 */
export function computeLuxFvg(candles: Candle[], partial: Partial<FvgOptions> = {}): LuxFvg[] {
  const o = { ...FVG_DEFAULTS, ...partial };
  const all: LuxFvg[] = [];
  const standing: LuxFvg[] = [];
  let cumRange = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    cumRange += (c.h - c.l) / c.l;
    if (i >= 2) {
      const first = candles[i - 2];
      const mid = candles[i - 1];
      const threshold = o.auto ? (i > 0 ? cumRange / i : Infinity) : o.thresholdPct / 100;
      let gap: LuxFvg | null = null;
      if (c.l > first.h && mid.c > first.h && (c.l - first.h) / first.h > threshold) {
        gap = { side: "bull", top: c.l, bottom: first.h, startIdx: i - 2, formedIdx: i, endIdx: i + o.extend, startT: first.t, formedT: c.t, mitigatedIdx: null };
      } else if (c.h < first.l && mid.c < first.l && (first.l - c.h) / c.h > threshold) {
        gap = { side: "bear", top: first.l, bottom: c.h, startIdx: i - 2, formedIdx: i, endIdx: i + o.extend, startT: first.t, formedT: c.t, mitigatedIdx: null };
      }
      if (gap) {
        all.push(gap);
        standing.push(gap);
      }
    }
    // a close through the gap uses it up (on the candle that formed it this cannot happen)
    for (let k = standing.length - 1; k >= 0; k--) {
      const g = standing[k];
      if (g.side === "bull" ? c.c < g.bottom : c.c > g.top) {
        g.mitigatedIdx = i;
        standing.splice(k, 1);
      }
    }
  }
  return all;
}
