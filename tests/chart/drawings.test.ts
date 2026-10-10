import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { distToSegment, hits, measure } from "@/lib/drawings/hit";
import { loadDrawings, saveDrawings } from "@/lib/drawings/store";
import { MAX_DRAWINGS } from "@/lib/drawings/types";
import { parseDrawings, readDrawings } from "@/lib/drawings/validate";
import { WARMUP, ema, rsi, vwap } from "@/lib/indicators";
import type { Candle } from "@/lib/market-data/types";

const trend = { id: "a1", kind: "trend", color: "#E0B04E", points: [{ t: 1_700_000_000, p: 4100 }, { t: 1_700_000_600, p: 4110.5 }] };

describe("parseDrawings", () => {
  it("accepts each kind and drops unknown fields", () => {
    const r = parseDrawings([
      { ...trend, evil: "x" },
      { id: "h", kind: "hline", color: "#3DD39A", points: [{ t: 1_700_000_000, p: 4105 }] },
      { id: "r", kind: "rect", color: "#F26B6F", points: trend.points },
      { id: "n", kind: "note", color: "#7FB7F0", points: [{ t: 1_700_000_100, p: 4102 }], text: "  entered too early " },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toHaveLength(4);
      expect(r.value[0]).not.toHaveProperty("evil");
      expect(r.value[3].text).toBe("entered too early");
    }
  });
  it("refuses wrong point counts, missing text, bad colours, duplicates and too many", () => {
    const bad = (x: unknown) => expect(parseDrawings(x).ok).toBe(false);
    bad([{ ...trend, points: [trend.points[0]] }]);
    bad([{ id: "n", kind: "note", color: "#E0B04E", points: [trend.points[0]] }]);
    bad([{ ...trend, color: "red" }]);
    bad([{ ...trend, kind: "arrow" }]);
    bad([{ ...trend, points: [{ t: 1, p: NaN }, trend.points[1]] }]);
    bad([trend, trend]);
    bad("nope");
    bad(Array.from({ length: MAX_DRAWINGS + 1 }, (_, i) => ({ ...trend, id: `d${i}` })));
    bad([{ id: "n", kind: "note", color: "#E0B04E", points: [trend.points[0]], text: "x".repeat(201) }]);
  });
  it("reading back skips anything invalid instead of throwing", () => {
    expect(readDrawings([trend, { junk: 1 }, null])).toHaveLength(1);
    expect(readDrawings(null)).toEqual([]);
    expect(readDrawings({})).toEqual([]);
  });
});

describe("hit testing", () => {
  it("distance to a segment, including beyond its ends", () => {
    expect(distToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
    expect(distToSegment({ x: -4, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distToSegment({ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 2, y: 2 })).toBeCloseTo(Math.SQRT2);
  });
  it("lines, horizontal lines, boxes and notes", () => {
    expect(hits("trend", [{ x: 0, y: 0 }, { x: 100, y: 100 }], { x: 50, y: 53 })).toBe(true);
    expect(hits("trend", [{ x: 0, y: 0 }, { x: 100, y: 100 }], { x: 50, y: 70 })).toBe(false);
    expect(hits("hline", [{ x: 10, y: 40 }], { x: 900, y: 44 })).toBe(true);
    expect(hits("hline", [{ x: 10, y: 40 }], { x: 900, y: 60 })).toBe(false);
    expect(hits("rect", [{ x: 10, y: 10 }, { x: 60, y: 50 }], { x: 30, y: 30 })).toBe(true);
    expect(hits("rect", [{ x: 60, y: 50 }, { x: 10, y: 10 }], { x: 30, y: 30 })).toBe(true); // corners in any order
    expect(hits("rect", [{ x: 10, y: 10 }, { x: 60, y: 50 }], { x: 200, y: 30 })).toBe(false);
    expect(hits("note", [{ x: 10, y: 10 }], { x: 15, y: 14 })).toBe(true);
    expect(hits("note", [{ x: 10, y: 10 }], { x: 80, y: 80 })).toBe(false);
    expect(hits("trend", [], { x: 0, y: 0 })).toBe(false);
  });
  it("the ruler reports price, percent, bars and time", () => {
    const m = measure({ t: 1000, p: 4000 }, { t: 1000 + 300 * 7, p: 4020 }, 300);
    expect(m.diff).toBe(20);
    expect(m.pct).toBeCloseTo(0.5);
    expect(m.bars).toBe(7);
    expect(m.seconds).toBe(2100);
    expect(measure({ t: 0, p: 0 }, { t: 60, p: 5 }, 60).pct).toBe(0);
  });
});

const bars = (closes: number[], v = 10): Candle[] => closes.map((c, i) => ({ t: 1_700_000_000 + i * 60, o: c, h: c + 1, l: c - 1, c, v }));

describe("indicators", () => {
  it("EMA starts with the simple average and then follows the recursive formula", () => {
    const e = ema(bars([1, 2, 3, 4, 5, 6]), 3);
    expect(e.slice(0, 2)).toEqual([null, null]);
    expect(e[2]).toBe(2);
    const k = 2 / 4;
    expect(e[3]).toBeCloseTo(4 * k + 2 * (1 - k));
    expect(e[5]).toBeCloseTo(6 * k + e[4]! * (1 - k));
    expect(ema(bars([1, 2]), 3)).toEqual([null, null]);
  });
  it("EMA of a constant is that constant", () => {
    expect(ema(bars(Array(30).fill(7)), 10).slice(9).every((v) => Math.abs(v! - 7) < 1e-9)).toBe(true);
  });
  it("VWAP weights by volume and restarts every UTC day", () => {
    const day = 86_400;
    const base = Math.floor(1_700_000_000 / day) * day;
    const c: Candle[] = [
      { t: base + 100, o: 10, h: 10, l: 10, c: 10, v: 1 },
      { t: base + 160, o: 20, h: 20, l: 20, c: 20, v: 3 },
      { t: base + day + 100, o: 50, h: 50, l: 50, c: 50, v: 5 },
    ];
    const v = vwap(c);
    expect(v[0]).toBe(10);
    expect(v[1]).toBeCloseTo((10 * 1 + 20 * 3) / 4);
    expect(v[2]).toBe(50);
  });
  it("VWAP falls back to a plain average when there is no volume", () => {
    const v = vwap(bars([10, 20, 30], 0));
    expect(v[2]).toBeCloseTo(20);
  });
  it("RSI is 100 for a rising market, 0 for a falling one, 50 when flat; always within 0 to 100", () => {
    expect(rsi(bars(Array.from({ length: 30 }, (_, i) => i + 1)))[29]).toBe(100);
    expect(rsi(bars(Array.from({ length: 30 }, (_, i) => 100 - i)))[29]).toBe(0);
    expect(rsi(bars(Array(30).fill(5)))[29]).toBe(50);
    const noisy = rsi(bars(Array.from({ length: 200 }, (_, i) => 100 + Math.sin(i / 3) * 5 + (i % 7))));
    expect(noisy.slice(14).every((v) => v! >= 0 && v! <= 100)).toBe(true);
    expect(noisy[13]).toBeNull();
    expect(rsi(bars([1, 2, 3]))).toEqual([null, null, null]);
  });
  it("RSI matches a hand calculation (Wilder)", () => {
    // 14 changes: seven +1 and seven -1 → avg gain = avg loss = 0.5 → RSI 50; then one more +2
    const closes = [10];
    for (let i = 0; i < 14; i++) closes.push(closes[i] + (i % 2 === 0 ? 1 : -1));
    closes.push(closes[14] + 2);
    const r = rsi(bars(closes));
    expect(r[14]).toBeCloseTo(50);
    const gain = (0.5 * 13 + 2) / 14;
    const loss = (0.5 * 13) / 14;
    expect(r[15]).toBeCloseTo(100 - 100 / (1 + gain / loss));
  });
  it("warm-up needs are positive for the averages", () => {
    expect(WARMUP.ema200).toBeGreaterThan(WARMUP.ema50);
  });
});

describe("saving drawings on a trade", () => {
  const P = "TEST-draw";
  let ready = false;
  let tradeId = "";
  beforeAll(async () => {
    try {
      const acc = await db.account.create({ data: { name: `${P}-acc`, platform: "MANUAL", currency: "AUD", startingBalance: 0, syncType: "MANUAL" } });
      const day = new Date("2031-07-01T00:00:00Z");
      tradeId = (await db.trade.create({ data: { accountId: acc.id, brokerTicket: `${P}-1`, symbol: "XAUUSD", side: "LONG", status: "CLOSED", openedAt: new Date("2031-07-01T01:00:00Z"), closedAt: new Date("2031-07-01T01:10:00Z"), openDay: day, closeDay: day, quantity: 0.1, avgEntry: 1, avgExit: 1, grossPnl: 0, netPnl: 0 } })).id;
      ready = true;
    } catch {
      ready = false;
    }
  });
  afterAll(async () => {
    if (ready) await db.account.deleteMany({ where: { name: { startsWith: P } } });
    await db.$disconnect();
  });

  it("round-trips, replaces, clears, and refuses bad input without touching what is saved", async (ctx) => {
    if (!ready) return ctx.skip();
    expect(await loadDrawings(tradeId)).toEqual([]);
    expect(await saveDrawings(tradeId, [trend])).toEqual({ ok: true, count: 1 });
    expect(await loadDrawings(tradeId)).toEqual([trend]);
    const bad = await saveDrawings(tradeId, [{ ...trend, color: "red" }]);
    expect(bad).toMatchObject({ ok: false, status: 400 });
    expect(await loadDrawings(tradeId)).toEqual([trend]);
    expect(await saveDrawings(tradeId, [])).toEqual({ ok: true, count: 0 });
    expect(await loadDrawings(tradeId)).toEqual([]);
    expect(await saveDrawings("missing-trade", [trend])).toMatchObject({ ok: false, status: 404 });
  });
});
