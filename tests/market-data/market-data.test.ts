import * as LZMA from "lzma";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { aggregate } from "@/lib/market-data/aggregate";
import { getCandles } from "@/lib/market-data/candle-cache";
import { instrumentFor, lzmaDecode, parseCandles, periodUrl } from "@/lib/market-data/dukascopy";
import { periodRange, periodsFor } from "@/lib/market-data/periods";
import type { Candle, MarketDataProvider, NativeTimeframe } from "@/lib/market-data/types";

const T0 = Date.UTC(2026, 8, 7) / 1000; // Mon 2026-09-07 00:00 UTC
const bar = (t: number, o: number, h: number, l: number, c: number, v = 1): Candle => ({ t, o, h, l, c, v });

describe("aggregate", () => {
  const m1 = [bar(T0, 10, 12, 9, 11), bar(T0 + 60, 11, 15, 10, 14), bar(T0 + 120, 14, 14, 8, 9), bar(T0 + 300, 9, 10, 9, 10)];
  it("builds 5m bars aligned to the epoch", () => {
    const out = aggregate(m1, 300);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ t: T0, o: 10, h: 15, l: 8, c: 9, v: 3 });
    expect(out[1].t).toBe(T0 + 300);
  });
  it("handles empty input", () => {
    expect(aggregate([], 300)).toEqual([]);
  });
  it("4h and daily buckets", () => {
    const h1 = Array.from({ length: 30 }, (_, i) => bar(T0 + i * 3600, i, i + 1, i - 1, i + 0.5));
    expect(aggregate(h1, 14_400).map((c) => c.t)).toEqual([T0, T0 + 14_400, T0 + 28_800, T0 + 43_200, T0 + 57_600, T0 + 72_000, T0 + 86_400, T0 + 100_800].slice(0, 8).filter((t) => t < T0 + 30 * 3600));
    const d = aggregate(h1, 86_400);
    expect(d).toHaveLength(2);
    expect(d[0]).toMatchObject({ o: 0, c: 23.5, h: 24, l: -1 });
  });
});

describe("periods", () => {
  it("minute data is fetched per UTC day", () => {
    expect(periodsFor("M1", T0 + 3600, T0 + 2 * 86_400 + 60)).toEqual(["2026-09-07", "2026-09-08", "2026-09-09"]);
  });
  it("hourly data is fetched per month, across year ends", () => {
    expect(periodsFor("H1", Date.UTC(2026, 10, 20) / 1000, Date.UTC(2027, 0, 5) / 1000)).toEqual(["2026-11", "2026-12", "2027-01"]);
  });
  it("period ranges", () => {
    expect(periodRange("M1", "2026-09-07")).toEqual([T0, T0 + 86_400]);
    expect(periodRange("H1", "2026-12")).toEqual([Date.UTC(2026, 11, 1) / 1000, Date.UTC(2027, 0, 1) / 1000]);
  });
});

describe("dukascopy format", () => {
  it("decodes an LZMA-compressed candle file (scaled integers, big-endian)", async () => {
    // two records: sec offset, open, close, low, high (u32 BE, scale 1000), volume (f32 BE)
    const raw = Buffer.alloc(48);
    const put = (o: number, sec: number, op: number, cl: number, lo: number, hi: number, vol: number) => {
      raw.writeUInt32BE(sec, o);
      raw.writeUInt32BE(op, o + 4);
      raw.writeUInt32BE(cl, o + 8);
      raw.writeUInt32BE(lo, o + 12);
      raw.writeUInt32BE(hi, o + 16);
      raw.writeFloatBE(vol, o + 20);
    };
    put(0, 0, 4165_695, 4164_545, 4163_725, 4166_255, 0.5);
    put(24, 60, 4164_675, 4165_485, 4164_265, 4165_805, 0.25);
    const packed = await new Promise<Buffer>((res, rej) => LZMA.compress(Array.from(raw), 1, (r, e) => (r ? res(Buffer.from(r.map((b) => b & 255))) : rej(e))));
    const decoded = await lzmaDecode(packed);
    expect(decoded.equals(raw)).toBe(true);
    const c = parseCandles(decoded, T0, 1000);
    expect(c).toEqual([
      { t: T0, o: 4165.695, h: 4166.255, l: 4163.725, c: 4164.545, v: 0.5 },
      { t: T0 + 60, o: 4164.675, h: 4165.805, l: 4164.265, c: 4165.485, v: 0.25 },
    ]);
  });
  it("urls use zero-based months and know instrument scales", () => {
    expect(periodUrl("XAUUSD", "M1", "2026-09-07")).toBe("https://datafeed.dukascopy.com/datafeed/XAUUSD/2026/08/07/BID_candles_min_1.bi5");
    expect(periodUrl("XAUUSD", "H1", "2026-09")).toBe("https://datafeed.dukascopy.com/datafeed/XAUUSD/2026/08/BID_candles_hour_1.bi5");
    expect(instrumentFor("XAUUSD")).toEqual({ code: "XAUUSD", scale: 1000 });
    expect(instrumentFor("eurusd")).toEqual({ code: "EURUSD", scale: 100_000 });
    expect(instrumentFor("USDJPY")?.scale).toBe(1000);
    expect(instrumentFor("COTTON")).toBeNull();
  });
});

// ── cache against the real database with a fake data source ──
const SYM = "TESTFX";
let reachable = false;

class FakeProvider implements MarketDataProvider {
  readonly id = "fake";
  calls: string[] = [];
  failFor = new Set<string>();
  supports = (s: string) => s === SYM;
  async fetchPeriod(_s: string, native: NativeTimeframe, period: string): Promise<Candle[]> {
    this.calls.push(`${native}:${period}`);
    if (this.failFor.has(period)) throw new Error("boom");
    const [start, end] = periodRange(native, period);
    const step = native === "M1" ? 60 : 3600;
    const dow = new Date(start * 1000).getUTCDay();
    if (native === "M1" && (dow === 0 || dow === 6)) return []; // weekend: no data
    const out: Candle[] = [];
    for (let t = start; t < end; t += step) out.push(bar(t, 100 + (t % 7), 102, 99, 101, 1));
    return out;
  }
}

beforeAll(async () => {
  try {
    await db.$queryRaw`select 1`;
    reachable = true;
  } catch {
    reachable = false;
  }
});
afterAll(async () => {
  if (reachable) {
    await db.candle.deleteMany({ where: { symbol: SYM } });
    await db.candleCoverage.deleteMany({ where: { symbol: SYM } });
  }
  await db.$disconnect();
});

describe("getCandles (database cache)", () => {
  const NOW = new Date(Date.UTC(2026, 9, 1)); // far enough after the test periods that they are "complete"

  it("downloads missing days once, then serves from the database", async (ctx) => {
    if (!reachable) return ctx.skip();
    const p = new FakeProvider();
    const from = T0 + 9 * 3600;
    const to = T0 + 11 * 3600;
    const a = await getCandles(SYM, "M1", from, to, { provider: p, now: NOW, gapMs: 0 });
    expect(a.candles).toHaveLength(120);
    expect(a.candles[0].t).toBe(from);
    expect(p.calls).toEqual(["M1:2026-09-07"]);

    const b = await getCandles(SYM, "M1", from, to, { provider: p, now: NOW, gapMs: 0 });
    expect(b.candles).toHaveLength(120);
    expect(p.calls).toHaveLength(1); // nothing re-downloaded
  });

  it("aggregates to coarser timeframes from the same stored minutes", async (ctx) => {
    if (!reachable) return ctx.skip();
    const p = new FakeProvider();
    const m5 = await getCandles(SYM, "M5", T0 + 9 * 3600, T0 + 10 * 3600, { provider: p, now: NOW, gapMs: 0 });
    expect(m5.candles).toHaveLength(12);
    expect(m5.candles[1].t - m5.candles[0].t).toBe(300);
    const m15 = await getCandles(SYM, "M15", T0 + 9 * 3600, T0 + 10 * 3600, { provider: p, now: NOW, gapMs: 0 });
    expect(m15.candles).toHaveLength(4);
    expect(p.calls).toEqual([]); // all from the cache
  });

  it("remembers weekends have no data instead of re-asking", async (ctx) => {
    if (!reachable) return ctx.skip();
    const p = new FakeProvider();
    const sat = Date.UTC(2026, 8, 12) / 1000;
    const r = await getCandles(SYM, "M1", sat, sat + 7200, { provider: p, now: NOW, gapMs: 0 });
    expect(r.candles).toEqual([]);
    expect(r.incomplete).toBe(false);
    await getCandles(SYM, "M1", sat, sat + 7200, { provider: p, now: NOW, gapMs: 0 });
    expect(p.calls).toEqual(["M1:2026-09-12"]);
  });

  it("flags failed downloads as incomplete and retries them next time", async (ctx) => {
    if (!reachable) return ctx.skip();
    const p = new FakeProvider();
    p.failFor.add("2026-09-14");
    const mon = Date.UTC(2026, 8, 14) / 1000;
    const r1 = await getCandles(SYM, "M1", mon, mon + 3600, { provider: p, now: NOW, gapMs: 0 });
    expect(r1.incomplete).toBe(true);
    expect(r1.candles).toEqual([]);
    p.failFor.clear();
    const r2 = await getCandles(SYM, "M1", mon, mon + 3600, { provider: p, now: NOW, gapMs: 0 });
    expect(r2.incomplete).toBe(false);
    expect(r2.candles).toHaveLength(60);
  });

  it("hourly and daily bars come from monthly hourly files", async (ctx) => {
    if (!reachable) return ctx.skip();
    const p = new FakeProvider();
    const from = Date.UTC(2026, 7, 20) / 1000;
    const to = Date.UTC(2026, 8, 3) / 1000; // spans August and September
    const d1 = await getCandles(SYM, "D1", from, to, { provider: p, now: NOW, gapMs: 0 });
    expect(p.calls.sort()).toEqual(["H1:2026-08", "H1:2026-09"]);
    expect(d1.candles).toHaveLength(14);
    const h4 = await getCandles(SYM, "H4", from, from + 86_400, { provider: p, now: NOW, gapMs: 0 });
    expect(h4.candles).toHaveLength(6);
  });

  it("re-downloads a period that was still in progress once it is stale", async (ctx) => {
    if (!reachable) return ctx.skip();
    const p = new FakeProvider();
    const day = Date.UTC(2026, 8, 9) / 1000; // Wednesday
    const noon = new Date((day + 12 * 3600) * 1000); // "now" is mid-day, so the day is incomplete
    await getCandles(SYM, "M1", day, day + 3600, { provider: p, now: noon, gapMs: 0 });
    await getCandles(SYM, "M1", day, day + 3600, { provider: p, now: new Date(noon.getTime() + 60_000), gapMs: 0 });
    expect(p.calls).toHaveLength(1); // fresh enough
    await getCandles(SYM, "M1", day, day + 3600, { provider: p, now: new Date(noon.getTime() + 15 * 60_000), gapMs: 0 });
    expect(p.calls).toHaveLength(2); // stale: refreshed
  });

  it("a day fetched while it was still in progress is fetched again once it has ended, and then left alone", async (ctx) => {
    if (!reachable) return ctx.skip();
    const p = new FakeProvider();
    const day = Date.UTC(2026, 8, 10) / 1000; // Thursday
    const midDay = new Date((day + 12 * 3600) * 1000);
    await getCandles(SYM, "M1", day, day + 3600, { provider: p, now: midDay, gapMs: 0 }); // the source may have had nothing or only part of it
    expect(p.calls).toHaveLength(1);
    // the day ends; nobody asked in the meantime, so the stored copy is older than the finished day
    const nextDay = new Date((day + 86_400 + 2 * 3600) * 1000);
    await getCandles(SYM, "M1", day, day + 3600, { provider: p, now: nextDay, gapMs: 0 });
    expect(p.calls).toHaveLength(2);
    // that copy was taken after the day was complete: final
    await getCandles(SYM, "M1", day, day + 3600, { provider: p, now: new Date(nextDay.getTime() + 3 * 3600_000), gapMs: 0 });
    expect(p.calls).toHaveLength(2);
  });

  it("reports unsupported symbols", async () => {
    const r = await getCandles("COTTON", "M5", T0, T0 + 3600);
    expect(r).toEqual({ candles: [], incomplete: false, unsupported: true });
  });
});

describe("getCandles: the month in progress has no hourly file yet", () => {
  class MonthInProgress extends FakeProvider {
    async fetchPeriod(s: string, native: NativeTimeframe, period: string): Promise<Candle[]> {
      if (native === "H1" && period === "2026-10") {
        this.calls.push(`${native}:${period}`);
        return []; // not published until the month is over
      }
      return super.fetchPeriod(s, native, period);
    }
  }
  const NOW = new Date(Date.UTC(2026, 9, 9, 12, 0, 0)); // 9 Oct: October is still in progress

  it("builds hourly, 4-hour and daily bars from the minute files", async (ctx) => {
    if (!reachable) return ctx.skip();
    const p = new MonthInProgress();
    const from = Date.UTC(2026, 9, 6) / 1000; // Tuesday
    const to = Date.UTC(2026, 9, 8) / 1000;
    const h1 = await getCandles(SYM, "H1", from, to, { provider: p, now: NOW, gapMs: 0 });
    expect(h1.candles).toHaveLength(48);
    expect(h1.candles[0].t).toBe(from);
    expect(p.calls).toContain("M1:2026-10-06");
    expect(p.calls).toContain("M1:2026-10-07");
    const d1 = await getCandles(SYM, "D1", from, to, { provider: p, now: NOW, gapMs: 0 });
    expect(d1.candles).toHaveLength(2);
    const h4 = await getCandles(SYM, "H4", from, to, { provider: p, now: NOW, gapMs: 0 });
    expect(h4.candles).toHaveLength(12);
  });

  it("still uses the hourly file for finished months", async (ctx) => {
    if (!reachable) return ctx.skip();
    const p = new MonthInProgress();
    const from = Date.UTC(2026, 7, 3) / 1000;
    const r = await getCandles(SYM, "H1", from, from + 86_400, { provider: p, now: NOW, gapMs: 0 });
    expect(r.candles).toHaveLength(24);
    expect(p.calls.every((c) => c.startsWith("H1:"))).toBe(true); // no minute files needed
  });
});
