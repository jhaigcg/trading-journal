import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getTickCandles, hoursBetween, parseTicks, tickUrl, ticksToCandles } from "@/lib/market-data/ticks";
import type { Candle } from "@/lib/market-data/types";

/** One 20-byte record: ms offset, ask, bid (scaled integers), two float volumes. */
function record(ms: number, ask: number, bid: number): Buffer {
  const b = Buffer.alloc(20);
  b.writeUInt32BE(ms, 0);
  b.writeUInt32BE(ask, 4);
  b.writeUInt32BE(bid, 8);
  b.writeFloatBE(1, 12);
  b.writeFloatBE(1, 16);
  return b;
}

describe("tick files", () => {
  const hour = Date.UTC(2025, 9, 14, 12) / 1000; // 14 Oct 2025 12:00 UTC
  const raw = Buffer.concat([record(0, 4_100_300, 4_100_000), record(2_000, 4_100_700, 4_100_400), record(4_900, 4_099_800, 4_099_500), record(5_000, 4_101_300, 4_101_000), record(12_500, 4_102_300, 4_102_000)]);

  it("reads time, bid and ask with the price scale applied", () => {
    const t = parseTicks(raw, hour, 1000);
    expect(t).toHaveLength(5);
    expect(t[0]).toEqual({ t: hour, bid: 4100, ask: 4100.3 });
    expect(t[2].t).toBeCloseTo(hour + 4.9);
    expect(t[4]).toEqual({ t: hour + 12.5, bid: 4102, ask: 4102.3 });
  });
  it("ignores a trailing partial record", () => {
    expect(parseTicks(Buffer.concat([raw, Buffer.alloc(7)]), hour, 1000)).toHaveLength(5);
  });
  it("builds 5-second bid candles", () => {
    const c = ticksToCandles(parseTicks(raw, hour, 1000));
    expect(c).toEqual([
      { t: hour, o: 4100, h: 4100.4, l: 4099.5, c: 4099.5, v: 3 },
      { t: hour + 5, o: 4101, h: 4101, l: 4101, c: 4101, v: 1 },
      { t: hour + 10, o: 4102, h: 4102, l: 4102, c: 4102, v: 1 },
    ]);
  });
  it("no ticks, no candles", () => {
    expect(ticksToCandles([])).toEqual([]);
  });
  it("lists the hours a window touches and builds the file address", () => {
    expect(hoursBetween(hour + 30, hour + 2 * 3600 + 1)).toEqual(["2025-10-14T12", "2025-10-14T13", "2025-10-14T14"]);
    expect(hoursBetween(hour, hour + 3600)).toEqual(["2025-10-14T12"]);
    expect(tickUrl("XAUUSD", "2025-10-14T12")).toBe("https://datafeed.dukascopy.com/datafeed/XAUUSD/2025/09/14/12h_ticks.bi5");
  });
});

const SYM = "XAUUSD";
const T0 = Date.UTC(2031, 2, 3, 12) / 1000; // far-future hours that no real data uses
let reachable = false;
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
    await db.candle.deleteMany({ where: { symbol: SYM, timeframe: "S5", t: { gte: new Date(T0 * 1000), lt: new Date((T0 + 86_400) * 1000) } } });
    await db.candleCoverage.deleteMany({ where: { symbol: SYM, timeframe: "S5", period: { startsWith: "2031-03-03" } } });
  }
  await db.$disconnect();
});

describe("getTickCandles (database cache)", () => {
  it("downloads each missing hour once, side by side, and serves the next view from the database", async (ctx) => {
    if (!reachable) return ctx.skip();
    const calls: string[] = [];
    const fetchHour = async (h: string): Promise<Candle[]> => {
      calls.push(h);
      const start = Date.parse(`${h}:00:00Z`) / 1000;
      return [0, 5, 10].map((o, i) => ({ t: start + o, o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i, v: 2 }));
    };
    const now = new Date((T0 + 86_400) * 1000);
    const a = await getTickCandles(SYM, T0, T0 + 2 * 3600, { now, fetchHour });
    expect(calls.sort()).toEqual(["2031-03-03T12", "2031-03-03T13"]);
    expect(a.candles).toHaveLength(6);
    expect(a.incomplete).toBe(false);
    const b = await getTickCandles(SYM, T0, T0 + 2 * 3600, { now, fetchHour });
    expect(b.candles).toHaveLength(6);
    expect(calls).toHaveLength(2); // nothing downloaded again
  });
  it("a failing hour is reported, not hidden", async (ctx) => {
    if (!reachable) return ctx.skip();
    const r = await getTickCandles(SYM, T0 + 5 * 3600, T0 + 6 * 3600, {
      now: new Date((T0 + 86_400) * 1000),
      fetchHour: async () => {
        throw new Error("down");
      },
    });
    expect(r.incomplete).toBe(true);
    expect(r.candles).toEqual([]);
  });
  it("unknown symbols are flagged", async () => {
    expect((await getTickCandles("COTTON", T0, T0 + 3600)).unsupported).toBe(true);
  });
});
