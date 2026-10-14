import type { Candle } from "@/lib/market-data/types";

/**
 * Smart-money zones found automatically from candles. Everything here only ever looks backwards: a zone is created
 * when the candle that confirms it has closed, so the same code is safe to run on the chart of a trade you are
 * reviewing, a replay, and a training scenario that must not reveal the future.
 */
export interface Zone {
  kind: "FVG" | "OB";
  side: "bull" | "bear";
  top: number;
  bottom: number;
  /** open time of the candle the zone is drawn from */
  startT: number;
  /** open time of the candle that mitigated (used up) the zone; null while it is still unmitigated */
  endT: number | null;
}

/** Average true range over `n` candles; null until there are enough candles. */
export function atr(candles: Candle[], n = 14): (number | null)[] {
  const out: (number | null)[] = [];
  const tr: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    tr.push(i === 0 ? c.h - c.l : Math.max(c.h - c.l, Math.abs(c.h - candles[i - 1].c), Math.abs(c.l - candles[i - 1].c)));
    out.push(i + 1 >= n ? tr.slice(i + 1 - n, i + 1).reduce((a, b) => a + b, 0) / n : null);
  }
  return out;
}

export interface FvgOptions {
  /** ignore gaps smaller than this share of the average true range, which are mostly noise */
  minAtr?: number;
}

/**
 * Fair value gaps: three candles where the first candle's high is below the third candle's low (bullish) or the
 * first candle's low is above the third candle's high (bearish), leaving a gap the middle candle's move did not trade through.
 * The zone is drawn from the middle candle and is mitigated when a later candle trades all the way through it.
 */
export function detectFvg(candles: Candle[], opts: FvgOptions = {}): Zone[] {
  const minAtr = opts.minAtr ?? 0.1;
  const a = atr(candles);
  const zones: Zone[] = [];
  for (let i = 1; i < candles.length - 1; i++) {
    const prev = candles[i - 1];
    const next = candles[i + 1];
    const floor = a[i] == null ? 0 : minAtr * (a[i] as number);
    let zone: Zone | null = null;
    if (next.l > prev.h && next.l - prev.h >= floor) zone = { kind: "FVG", side: "bull", bottom: prev.h, top: next.l, startT: candles[i].t, endT: null };
    else if (next.h < prev.l && prev.l - next.h >= floor) zone = { kind: "FVG", side: "bear", bottom: next.h, top: prev.l, startT: candles[i].t, endT: null };
    if (!zone) continue;
    for (let j = i + 2; j < candles.length; j++) {
      const filled = zone.side === "bull" ? candles[j].l <= zone.bottom : candles[j].h >= zone.top;
      if (filled) {
        zone.endT = candles[j].t;
        break;
      }
    }
    zones.push(zone);
  }
  return zones;
}

export interface ObOptions {
  /** candles either side that a swing high or low must beat (default 3) */
  pivot?: number;
  /** ignore order-block candles smaller than this share of the average true range */
  minAtr?: number;
}

interface Swing {
  idx: number;
  price: number;
  broken: boolean;
}

/**
 * Order blocks. A swing high or low is a candle whose high (low) beats `pivot` candles either side; it is only known
 * `pivot` candles later. When a candle closes beyond the latest unbroken swing, structure has broken: the order block is
 * the candle with the lowest low (for a break up) or highest high (for a break down) between that swing and the break,
 * that is, the last push the other way before the move. A bullish block is mitigated when a candle closes below its low, a
 * bearish one when a candle closes above its high.
 */
export function detectOb(candles: Candle[], opts: ObOptions = {}): Zone[] {
  const n = opts.pivot ?? 3;
  const minAtr = opts.minAtr ?? 0.2;
  const a = atr(candles);
  const zones: Zone[] = [];
  let high: Swing | null = null;
  let low: Swing | null = null;

  for (let j = 0; j < candles.length; j++) {
    // a swing is confirmed once `n` candles after it have closed
    const p = j - n;
    if (p >= n) {
      const win = candles.slice(p - n, p + n + 1);
      if (candles[p].h === Math.max(...win.map((c) => c.h)) && candles[p].h > Math.max(...win.filter((_, k) => k !== n).map((c) => c.h))) high = { idx: p, price: candles[p].h, broken: false };
      if (candles[p].l === Math.min(...win.map((c) => c.l)) && candles[p].l < Math.min(...win.filter((_, k) => k !== n).map((c) => c.l))) low = { idx: p, price: candles[p].l, broken: false };
    }

    const make = (side: "bull" | "bear", from: number): void => {
      let best = from;
      for (let k = from; k < j; k++) {
        if (side === "bull" ? candles[k].l <= candles[best].l : candles[k].h >= candles[best].h) best = k;
      }
      const c = candles[best];
      if (a[best] != null && c.h - c.l < minAtr * (a[best] as number)) return;
      const z: Zone = { kind: "OB", side, bottom: c.l, top: c.h, startT: c.t, endT: null };
      for (let m = j + 1; m < candles.length; m++) {
        if (side === "bull" ? candles[m].c < z.bottom : candles[m].c > z.top) {
          z.endT = candles[m].t;
          break;
        }
      }
      zones.push(z);
    };

    if (high && !high.broken && candles[j].c > high.price && j > high.idx) {
      high.broken = true;
      make("bull", high.idx);
    }
    if (low && !low.broken && candles[j].c < low.price && j > low.idx) {
      low.broken = true;
      make("bear", low.idx);
    }
  }
  return zones;
}

export interface ZoneChoice {
  fvg: boolean;
  ob: boolean;
}

/** The two timeframes these zones are shown on. */
export const ZONE_TIMEFRAMES = ["M5", "M15"] as const;
export const zonesAvailable = (tf: string) => (ZONE_TIMEFRAMES as readonly string[]).includes(tf);

/** Zones to draw for the chosen kinds, newest `limit` of each so a long chart stays readable. */
export function computeZones(candles: Candle[], choice: ZoneChoice, limit = 40): Zone[] {
  const newest = (z: Zone[]) => z.slice(-limit);
  return [...(choice.fvg ? newest(detectFvg(candles)) : []), ...(choice.ob ? newest(detectOb(candles)) : [])];
}
