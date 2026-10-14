import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/market-data/types";
import { computeLuxFvg, computeLuxSmc } from "@/lib/lux-smc";

const STEP = 300;
const T0 = 1_000_000;

/** Straight lines between waypoints, one candle per price step, with a small wick. */
function walk(points: number[], wick = 0.4): Candle[] {
  const closes: number[] = [points[0]];
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1];
    const b = points[k];
    const steps = Math.max(1, Math.round(Math.abs(b - a)));
    for (let s = 1; s <= steps; s++) closes.push(a + ((b - a) * s) / steps);
  }
  return closes.map((c, i) => {
    const o = i === 0 ? c : closes[i - 1];
    return { t: T0 + i * STEP, o, h: Math.max(o, c) + wick, l: Math.min(o, c) - wick, c, v: 1 };
  });
}

function random(seed: number, bars: number): Candle[] {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  let price = 1000;
  return Array.from({ length: bars }, (_, i) => {
    const o = price;
    price += (rnd() - 0.5) * 6;
    return { t: T0 + i * STEP, o, h: Math.max(o, price) + rnd() * 2, l: Math.min(o, price) - rnd() * 2, c: price, v: 1 };
  });
}

const at = (cs: Candle[], t: number) => cs.find((c) => c.t === t)!;
const opts = { swing: 3, internal: 2, showSwingOb: true, showInternalOb: true, swingObCount: 20, internalObCount: 20 };

// an up trend with higher highs and higher lows, then a drop through everything and a bounce
const trendThenDrop = walk([100, 110, 104, 114, 108, 120, 112, 124, 90, 100, 94, 104]);

describe("structure", () => {
  const r = computeLuxSmc(trendThenDrop, opts);

  it("finds breaks, and every break is a real close beyond a real swing candle", () => {
    expect(r.structure.length).toBeGreaterThan(3);
    for (const e of r.structure) {
      const from = at(trendThenDrop, e.fromT);
      const broke = at(trendThenDrop, e.toT);
      expect(e.toT).toBeGreaterThan(e.fromT);
      if (e.bias === "bull") {
        expect(from.h).toBe(e.level);
        expect(broke.c).toBeGreaterThan(e.level);
      } else {
        expect(from.l).toBe(e.level);
        expect(broke.c).toBeLessThan(e.level);
      }
    }
  });

  it("calls a break BOS when it follows the trend and CHoCH when it turns it", () => {
    for (const internal of [false, true]) {
      let bias = 0;
      for (const e of r.structure.filter((x) => x.internal === internal)) {
        const turns = (e.bias === "bull" && bias === -1) || (e.bias === "bear" && bias === 1);
        expect(e.tag).toBe(turns ? "CHoCH" : "BOS");
        bias = e.bias === "bull" ? 1 : -1;
      }
    }
    expect(r.structure.some((e) => !e.internal && e.bias === "bull" && e.tag === "BOS")).toBe(true);
    expect(r.structure.some((e) => !e.internal && e.bias === "bear" && e.tag === "CHoCH")).toBe(true);
  });

  it("breaks each swing level once", () => {
    const seen = new Set<string>();
    for (const e of r.structure.filter((x) => !x.internal)) {
      const key = `${e.bias}:${e.fromT}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("the label sits between the swing and the break", () => {
    for (const e of r.structure) {
      expect(e.midT).toBeGreaterThanOrEqual(e.fromT);
      expect(e.midT).toBeLessThanOrEqual(e.toT);
    }
  });
});

describe("order blocks", () => {
  it("a bullish break makes a block from the lowest candle after the swing high, and a bearish one from the highest", () => {
    const r = computeLuxSmc(trendThenDrop, { ...opts, obMitigation: "close", swingObCount: 100, internalObCount: 100 });
    const all = computeLuxSmc(trendThenDrop, { ...opts, obMitigation: "highlow", swingObCount: 100, internalObCount: 100 });
    expect(all.orderBlocks.length + r.orderBlocks.length).toBeGreaterThan(0);
    for (const b of [...r.orderBlocks, ...all.orderBlocks]) {
      const c = at(trendThenDrop, b.startT);
      expect(b.top).toBe(c.h);
      expect(b.bottom).toBe(c.l);
    }
  });

  it("only blocks that price has not traded through are left", () => {
    const r = computeLuxSmc(trendThenDrop, { ...opts, swingObCount: 100, internalObCount: 100 });
    for (const b of r.orderBlocks) {
      for (const c of trendThenDrop.filter((k) => k.t > b.startT)) {
        if (b.side === "bull") expect(c.l).toBeGreaterThanOrEqual(b.bottom);
        else expect(c.h).toBeLessThanOrEqual(b.top);
      }
    }
  });

  it("respects the number of blocks asked for and the switches", () => {
    const some = computeLuxSmc(trendThenDrop, { ...opts, obMitigation: "close" });
    const one = computeLuxSmc(trendThenDrop, { ...opts, obMitigation: "close", internalObCount: 1, swingObCount: 1 });
    expect(one.orderBlocks.filter((b) => b.internal).length).toBeLessThanOrEqual(1);
    expect(one.orderBlocks.filter((b) => !b.internal).length).toBeLessThanOrEqual(1);
    expect(one.orderBlocks.length).toBeLessThanOrEqual(some.orderBlocks.length);
    expect(computeLuxSmc(trendThenDrop, { ...opts, showSwingOb: false, showInternalOb: false }).orderBlocks).toEqual([]);
    expect(computeLuxSmc(trendThenDrop, { ...opts, showSwingOb: false }).orderBlocks.every((b) => b.internal)).toBe(true);
  });
});

describe("strong and weak highs and lows", () => {
  it("tracks the swing extremes and the swing trend", () => {
    const r = computeLuxSmc(trendThenDrop, opts);
    expect(r.trailing.top).not.toBeNull();
    expect(r.trailing.bottom).not.toBeNull();
    // it restarts at each newly confirmed swing and then follows price: the high since the last swing high, the low since the last swing low
    expect(r.trailing.top!).toBe(Math.max(...trendThenDrop.filter((c) => c.t >= r.trailing.topT!).map((c) => c.h)));
    expect(r.trailing.bottom!).toBe(Math.min(...trendThenDrop.filter((c) => c.t >= r.trailing.bottomT!).map((c) => c.l)));
    expect(at(trendThenDrop, r.trailing.topT!).h).toBe(r.trailing.top);
    expect(at(trendThenDrop, r.trailing.bottomT!).l).toBe(r.trailing.bottom);
    expect(["bull", "bear"]).toContain(r.trailing.trend);
  });
  it("has nothing before the first swing", () => {
    const r = computeLuxSmc(walk([100, 101]), opts);
    expect(r.trailing).toEqual({ top: null, bottom: null, topT: null, bottomT: null, trend: null });
    expect(r.structure).toEqual([]);
  });
});

describe("equal highs and lows", () => {
  // a triangle wave between 100 and 110: every peak and trough is exactly equal
  const wave = walk(Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 100 : 110)), 0.5);
  it("are found, but only once the 200-bar ATR they are measured against exists", () => {
    const r = computeLuxSmc(wave, { eqLength: 3 });
    expect(r.eq.some((e) => e.kind === "EQH")).toBe(true);
    expect(r.eq.some((e) => e.kind === "EQL")).toBe(true);
    const first = wave.findIndex((c) => c.t === Math.min(...r.eq.map((e) => e.confirmT)));
    expect(first).toBeGreaterThanOrEqual(199);
    for (const e of r.eq) {
      expect(Math.abs(e.fromLevel - e.toLevel)).toBeLessThan(0.1 * 5);
      expect(e.toT).toBeGreaterThan(e.fromT);
    }
  });
  it("are not reported when the two extremes are far apart", () => {
    const stairs = walk(Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 100 + i * 3 : 112 + i * 3)), 0.5);
    expect(computeLuxSmc(stairs, { eqLength: 3 }).eq).toEqual([]);
  });
});

describe("never looks ahead", () => {
  it("a run on the first k candles gives exactly what the full run had signalled by then", () => {
    for (const seed of [1, 2, 3]) {
      const cs = random(seed, 420);
      const full = computeLuxSmc(cs, opts);
      for (const k of [120, 230, 333]) {
        const part = computeLuxSmc(cs.slice(0, k), opts);
        const cut = cs[k - 1].t;
        expect(part.structure).toEqual(full.structure.filter((e) => e.toT <= cut));
        expect(part.eq).toEqual(full.eq.filter((e) => e.confirmT <= cut));
      }
    }
  });
});

describe("fair value gaps (Fair Value Gap [LuxAlgo])", () => {
  const k = (i: number, o: number, h: number, l: number, cl: number): Candle => ({ t: T0 + i * STEP, o, h, l, c: cl, v: 1 });
  const bull = [k(0, 9, 10, 8, 9.5), k(1, 9.5, 13, 9.4, 12.8), k(2, 12.8, 14, 12, 13.5)];

  it("a bullish gap: the third low is above the first high, and the middle candle closed above it", () => {
    expect(computeLuxFvg(bull)).toEqual([{ side: "bull", top: 12, bottom: 10, startIdx: 0, formedIdx: 2, endIdx: 22, startT: bull[0].t, formedT: bull[2].t, mitigatedIdx: null }]);
  });
  it("the mirror image is a bearish gap", () => {
    const bear = [k(0, 12, 13, 11, 11.5), k(1, 11.5, 11.6, 8, 8.2), k(2, 8.2, 9, 7, 7.5)];
    expect(computeLuxFvg(bear)).toMatchObject([{ side: "bear", top: 11, bottom: 9, startIdx: 0, formedIdx: 2, mitigatedIdx: null }]);
  });
  it("no gap when the middle candle did not close beyond the first candle, even if the outer candles do not overlap", () => {
    expect(computeLuxFvg([k(0, 9, 10, 8, 9.5), k(1, 9.5, 13, 9.4, 9.9), k(2, 9.9, 14, 12, 13.5)])).toEqual([]);
  });
  it("overlapping candles leave no gap", () => {
    expect(computeLuxFvg([k(0, 9, 10, 8, 9.5), k(1, 9.5, 12, 9, 11.5), k(2, 11.5, 12.5, 9.8, 12)])).toEqual([]);
  });
  it("a wick through the gap does not use it up, a close through it does", () => {
    const wick = computeLuxFvg([...bull, k(3, 13, 13.5, 9.8, 10.5)]);
    expect(wick[0].mitigatedIdx).toBeNull(); // low 9.8 is below the gap but it closed at 10.5
    const closed = computeLuxFvg([...bull, k(3, 13, 13.5, 9.8, 10.5), k(4, 10.5, 10.6, 9.5, 9.9)]);
    expect(closed[0].mitigatedIdx).toBe(4);
  });
  it("the threshold ignores small gaps, a share of the price in percent", () => {
    expect(computeLuxFvg(bull, { thresholdPct: 30 })).toEqual([]); // the gap is 20% of 10
    expect(computeLuxFvg(bull, { thresholdPct: 10 })).toHaveLength(1);
  });
  it("auto threshold uses the average candle range", () => {
    const wide = Array.from({ length: 20 }, (_, i) => k(i, 100, 105, 95, 100)); // about 10.5% a candle
    const small = [k(20, 100, 105, 99, 104), k(21, 104, 110, 103, 109), k(22, 109, 111, 105.5, 110)]; // 0.5% gap
    expect(computeLuxFvg([...wide, ...small]).some((g) => g.startIdx === 20)).toBe(true);
    expect(computeLuxFvg([...wide, ...small], { auto: true }).some((g) => g.startIdx === 20)).toBe(false);
  });
  it("the box extends the number of bars asked for", () => {
    expect(computeLuxFvg(bull, { extend: 5 })[0].endIdx).toBe(7);
  });
  it("never looks ahead: a prefix of the candles gives what the full run had by then", () => {
    for (const seed of [4, 5]) {
      const cs = random(seed, 400);
      const full = computeLuxFvg(cs);
      for (const n of [100, 250, 399]) {
        const part = computeLuxFvg(cs.slice(0, n));
        const expected = full.filter((g) => g.formedIdx < n).map((g) => (g.mitigatedIdx != null && g.mitigatedIdx >= n ? { ...g, mitigatedIdx: null } : g));
        expect(part).toEqual(expected);
      }
    }
  });
});
