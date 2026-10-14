import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/market-data/types";
import { atr, computeZones, detectFvg, detectOb, zonesAvailable } from "@/lib/smc";

const c = (i: number, o: number, h: number, l: number, cl: number): Candle => ({ t: 1000 + i * 300, o, h, l, c: cl, v: 1 });

describe("detectFvg", () => {
  it("a bullish gap: the third candle's low is above the first candle's high", () => {
    const k = [c(0, 9, 10, 8, 9.5), c(1, 9.5, 13, 9.4, 12.8), c(2, 12.8, 14, 12, 13.5), c(3, 13.5, 14, 13, 13.8)];
    const z = detectFvg(k);
    expect(z).toEqual([{ kind: "FVG", side: "bull", bottom: 10, top: 12, startT: k[1].t, endT: null }]);
  });
  it("a bearish gap: the third candle's high is below the first candle's low", () => {
    const k = [c(0, 12, 13, 11, 11.5), c(1, 11.5, 11.6, 8, 8.2), c(2, 8.2, 9, 7, 7.5)];
    expect(detectFvg(k)).toEqual([{ kind: "FVG", side: "bear", bottom: 9, top: 11, startT: k[1].t, endT: null }]);
  });
  it("touching the gap does not use it up; trading all the way through does", () => {
    const base = [c(0, 9, 10, 8, 9.5), c(1, 9.5, 13, 9.4, 12.8), c(2, 12.8, 14, 12, 13.5)];
    expect(detectFvg([...base, c(3, 13, 13.5, 11, 12)])[0].endT).toBeNull(); // dipped into the gap (low 11), not through it
    const through = detectFvg([...base, c(3, 13, 13.5, 11, 12), c(4, 12, 12.5, 9.8, 10.5)]);
    expect(through[0].endT).toBe(1000 + 4 * 300); // low 9.8 is below the bottom of the gap (10)
  });
  it("overlapping candles leave no gap", () => {
    expect(detectFvg([c(0, 9, 10, 8, 9.5), c(1, 9.5, 12, 9, 11.5), c(2, 11.5, 12.5, 9.8, 12)])).toEqual([]);
  });
  it("gaps much smaller than the average range are ignored as noise", () => {
    const flat = Array.from({ length: 20 }, (_, i) => c(i, 100, 105, 95, 100)); // range 10 everywhere
    const k = [...flat, c(20, 100, 105, 99, 104), c(21, 104, 110, 103, 109), c(22, 109, 111, 105.05, 110)]; // gap 105 to 105.05
    expect(detectFvg(k).filter((z) => z.startT === k[21].t)).toEqual([]);
    expect(detectFvg(k, { minAtr: 0 }).filter((z) => z.startT === k[21].t)).toHaveLength(1);
  });
  it("never looks ahead: a zone only exists once its third candle is in the data", () => {
    const k = [c(0, 9, 10, 8, 9.5), c(1, 9.5, 13, 9.4, 12.8), c(2, 12.8, 14, 12, 13.5)];
    expect(detectFvg(k.slice(0, 2))).toEqual([]);
    expect(detectFvg(k)).toHaveLength(1);
  });
});

describe("detectOb", () => {
  // pivot 1: a swing high at index 1 (12), the lowest push at index 3 (low 8), then a close above 12 at index 5
  const k = [c(0, 10, 11, 9, 10), c(1, 10, 12, 9.5, 11.5), c(2, 11.5, 11.8, 10, 10.5), c(3, 10.5, 10.8, 8, 8.5), c(4, 8.5, 10, 8.4, 9.9), c(5, 9.9, 13, 9.8, 12.9), c(6, 12.9, 13.5, 12.5, 13)];

  it("a break above a swing high makes a bullish block out of the lowest candle of the move", () => {
    const z = detectOb(k, { pivot: 1 });
    expect(z).toEqual([{ kind: "OB", side: "bull", bottom: 8, top: 10.8, startT: k[3].t, endT: null }]);
  });
  it("is mitigated once a candle closes below the block", () => {
    const z = detectOb([...k, c(7, 13, 13, 7.5, 7.9)], { pivot: 1 });
    expect(z[0].endT).toBe(1000 + 7 * 300);
  });
  it("a close that does not exceed the swing makes nothing", () => {
    expect(detectOb([...k.slice(0, 5), c(5, 9.9, 12.5, 9.8, 11.9)], { pivot: 1 })).toEqual([]);
  });
  it("the mirror image: a break below a swing low makes a bearish block", () => {
    const m = k.map((x, i) => c(i, 20 - x.o, 20 - x.l, 20 - x.h, 20 - x.c));
    const z = detectOb(m, { pivot: 1 });
    expect(z).toHaveLength(1);
    expect(z[0]).toMatchObject({ kind: "OB", side: "bear", startT: m[3].t, endT: null });
    expect(z[0].top).toBeCloseTo(12);
    expect(z[0].bottom).toBeCloseTo(9.2);
  });
  it("never looks ahead: before the breaking candle exists there is no block", () => {
    expect(detectOb(k.slice(0, 5), { pivot: 1 })).toEqual([]);
  });
  it("tiny candles compared with the average range are not blocks", () => {
    const flat = Array.from({ length: 20 }, (_, i) => c(i, 100, 110, 90, 100)); // range 20
    const tiny = [c(20, 105, 112, 105, 110), c(21, 105, 105.4, 104.9, 105), c(22, 105, 105.3, 104.8, 105), c(23, 105, 120, 104, 119)];
    expect(detectOb([...flat, ...tiny], { pivot: 1 }).filter((z) => z.startT >= 1000 + 20 * 300)).toEqual([]);
  });
});

describe("helpers", () => {
  it("atr needs enough candles and averages the true range", () => {
    const k = Array.from({ length: 16 }, (_, i) => c(i, 10, 12, 8, 10));
    const a = atr(k);
    expect(a.slice(0, 13).every((v) => v === null)).toBe(true);
    expect(a[13]).toBeCloseTo(4);
  });
  it("computeZones honours the choice and keeps only the newest ones", () => {
    const k = [c(0, 9, 10, 8, 9.5), c(1, 9.5, 13, 9.4, 12.8), c(2, 12.8, 14, 12, 13.5)];
    expect(computeZones(k, { fvg: false, ob: false })).toEqual([]);
    expect(computeZones(k, { fvg: true, ob: false })).toHaveLength(1);
    const many = Array.from({ length: 30 }, (_, i) => [c(i * 3, 10 + i * 5, 11 + i * 5, 9 + i * 5, 10.5 + i * 5), c(i * 3 + 1, 11 + i * 5, 15 + i * 5, 10.9 + i * 5, 14.9 + i * 5), c(i * 3 + 2, 14.9 + i * 5, 17 + i * 5, 13 + i * 5, 16 + i * 5)]).flat();
    expect(computeZones(many, { fvg: true, ob: false }, 5).length).toBeLessThanOrEqual(5);
  });
  it("only the 5 and 15 minute charts offer zones", () => {
    expect(zonesAvailable("M5")).toBe(true);
    expect(zonesAvailable("M15")).toBe(true);
    for (const tf of ["M1", "H1", "H4", "D1", "S5"]) expect(zonesAvailable(tf)).toBe(false);
  });
});
