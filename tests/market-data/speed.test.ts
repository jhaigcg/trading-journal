import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getCandles } from "@/lib/market-data/candle-cache";
import { periodRange } from "@/lib/market-data/periods";
import type { Candle, MarketDataProvider, NativeTimeframe } from "@/lib/market-data/types";
import { contextBars } from "@/lib/queries/trade-chart";

const SYM = "SPEEDFX";
let reachable = false;

/** A data source where every day takes 200 ms to "download", and which counts how many run at the same time. */
class SlowProvider implements MarketDataProvider {
  readonly id = "slow";
  running = 0;
  peak = 0;
  calls: string[] = [];
  supports = (s: string) => s === SYM;
  async fetchPeriod(_s: string, native: NativeTimeframe, period: string): Promise<Candle[]> {
    this.calls.push(period);
    this.running++;
    this.peak = Math.max(this.peak, this.running);
    await new Promise((r) => setTimeout(r, 200));
    this.running--;
    const [start, end] = periodRange(native, period);
    const out: Candle[] = [];
    for (let t = start; t < end; t += 60) out.push({ t, o: 100, h: 101, l: 99, c: 100, v: 1 });
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

describe("missing days download side by side", () => {
  it("five days take about as long as one, every day is still stored once, in order", async (ctx) => {
    if (!reachable) return ctx.skip();
    const p = new SlowProvider();
    const from = Date.UTC(2026, 6, 6) / 1000; // Mon 6 Jul .. Fri 10 Jul 2026
    const t0 = performance.now();
    const r = await getCandles(SYM, "M1", from, from + 5 * 86_400 - 1, { provider: p, now: new Date(Date.UTC(2026, 9, 1)) });
    const ms = performance.now() - t0;
    expect(p.calls.sort()).toEqual(["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10"]);
    expect(p.peak).toBeGreaterThan(1); // really parallel
    expect(p.peak).toBeLessThanOrEqual(4); // but not unbounded
    expect(ms).toBeLessThan(1500); // downloading one after another would be at least 5 x 200 ms plus saving each day
    expect(r.candles).toHaveLength(5 * 1440);
    expect(r.candles.every((c, i, a) => i === 0 || c.t > a[i - 1].t)).toBe(true);
    expect(r.incomplete).toBe(false);

    const again = await getCandles(SYM, "M1", from, from + 5 * 86_400 - 1, { provider: p, now: new Date(Date.UTC(2026, 9, 1)) });
    expect(again.candles).toHaveLength(5 * 1440);
    expect(p.calls).toHaveLength(5); // the second view downloaded nothing
  }, 30_000);

  it("one failing day does not lose the others", async (ctx) => {
    if (!reachable) return ctx.skip();
    class Flaky extends SlowProvider {
      override async fetchPeriod(s: string, n: NativeTimeframe, period: string) {
        if (period === "2026-07-15") throw new Error("down");
        return super.fetchPeriod(s, n, period);
      }
    }
    const p = new Flaky();
    const from = Date.UTC(2026, 6, 14) / 1000; // Tue 14 .. Thu 16
    const r = await getCandles(SYM, "M1", from, from + 3 * 86_400 - 1, { provider: p, now: new Date(Date.UTC(2026, 9, 1)) });
    expect(r.incomplete).toBe(true);
    expect(r.candles).toHaveLength(2 * 1440);
  }, 30_000);
});

describe("context around a trade", () => {
  it("caps minute-based charts at about eight hours either side, and leaves hourly and coarser alone", () => {
    expect(contextBars(60)).toBe(60); // 1m: one hour
    expect(contextBars(300)).toBe(60); // 5m: five hours
    expect(contextBars(900)).toBe(32); // 15m: eight hours, not fifteen
    expect(contextBars(3600)).toBe(60);
    expect(contextBars(86_400)).toBe(60);
  });
});

describe("warming the cache in the background", () => {
  it("quietly does nothing for bad dates and for days without trades", async (ctx) => {
    if (!reachable) return ctx.skip();
    const { warmDay } = await import("@/lib/market-data/warm");
    await expect(warmDay("not-a-day")).resolves.toBeUndefined();
    await expect(warmDay("2026-02-30")).resolves.toBeUndefined();
    await expect(warmDay("2001-01-01")).resolves.toBeUndefined(); // no trades that day: no downloads
  });
});
