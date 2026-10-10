import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { aggregate } from "./aggregate";
import { dukascopy } from "./dukascopy";
import { periodRange, periodsFor } from "./periods";
import { NATIVE, TF_SECONDS, type Candle, type MarketDataProvider, type Timeframe } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const STALE_PARTIAL_MS = 10 * 60_000; // a period that is still in progress is re-downloaded after this long
const COMPLETE_AFTER_S = 3600; // a period counts as complete one hour after it ends

export interface CandleResult {
  candles: Candle[];
  /** some periods could not be downloaded (rate limit / network): what is shown may have gaps */
  incomplete: boolean;
  /** no data source exists for this symbol */
  unsupported: boolean;
}

/**
 * Candles for [fromSec, toSec) on any timeframe. Downloads happen only for periods not already in the
 * database (one request per UTC day for minute data, per month for hourly), a few at a time, and are stored forever. Coarser timeframes are aggregated from the native ones.
 */
export async function getCandles(
  symbol: string,
  tf: Timeframe,
  fromSec: number,
  toSec: number,
  opts: { provider?: MarketDataProvider; now?: Date; maxFetch?: number; gapMs?: number; concurrency?: number } = {},
): Promise<CandleResult> {
  const provider = opts.provider ?? dukascopy;
  if (!provider.supports(symbol)) return { candles: [], incomplete: false, unsupported: true };

  const now = opts.now ?? new Date();
  const nowSec = now.getTime() / 1000;
  const native = NATIVE[tf];
  const periods = periodsFor(native, fromSec, Math.min(toSec, nowSec));
  let incomplete = false;

  if (periods.length) {
    const have = new Map((await db.candleCoverage.findMany({ where: { symbol, timeframe: native, period: { in: periods } } })).map((c) => [c.period, c]));
    const todo = periods.filter((p) => {
      const c = have.get(p);
      if (!c) return true;
      const [, end] = periodRange(native, p);
      const complete = end + COMPLETE_AFTER_S <= nowSec;
      return !complete && now.getTime() - c.fetchedAt.getTime() > STALE_PARTIAL_MS;
    });

    const limit = opts.maxFetch ?? 14;
    if (todo.length > limit) incomplete = true;
    // a few downloads at a time: a window spanning several days takes as long as the slowest day, not the sum of them
    await mapPool(todo.slice(0, limit), opts.concurrency ?? 4, async (period) => {
      if (opts.gapMs) await sleep(opts.gapMs);
      try {
        const candles = await provider.fetchPeriod(symbol, native, period);
        const [start, end] = periodRange(native, period);
        const rows = candles
          .filter((c) => c.t >= start && c.t < end)
          .map((c) => ({ symbol, timeframe: native, t: new Date(c.t * 1000), open: c.o, high: c.h, low: c.l, close: c.c, volume: c.v }));
        await db.$transaction(async (tx) => {
          // a period that was only partly available is replaced wholesale on refresh
          await tx.candle.deleteMany({ where: { symbol, timeframe: native, t: { gte: new Date(start * 1000), lt: new Date(end * 1000) } } });
          for (let k = 0; k < rows.length; k += 2000) await tx.candle.createMany({ data: rows.slice(k, k + 2000), skipDuplicates: true });
          await tx.candleCoverage.upsert({
            where: { symbol_timeframe_period: { symbol, timeframe: native, period } },
            update: { fetchedAt: now, count: rows.length },
            create: { symbol, timeframe: native, period, fetchedAt: now, count: rows.length },
          });
        });
      } catch {
        incomplete = true; // leave uncovered so the next request retries it
      }
    });
  }

  const rows = await db.candle.findMany({
    where: { symbol, timeframe: native, t: { gte: new Date(fromSec * 1000), lt: new Date(toSec * 1000) } },
    orderBy: { t: "asc" },
  });
  let base: Candle[] = rows.map((r) => ({ t: r.t.getTime() / 1000, o: n(r.open), h: n(r.high), l: n(r.low), c: n(r.close), v: n(r.volume) }));

  // The data source publishes a month of hourly bars only once the month is over. For the month in progress,
  // build the hourly bars from the daily minute files instead.
  if (native === "H1") {
    const derived: Candle[] = [];
    for (const period of periods) {
      const [start, end] = periodRange("H1", period);
      if (end + COMPLETE_AFTER_S <= nowSec) continue;
      const lo = Math.max(start, fromSec);
      const hi = Math.min(end, toSec, nowSec);
      if (hi <= lo || base.some((c) => c.t >= lo && c.t < hi)) continue;
      const minutes = await getCandles(symbol, "M1", lo, hi, opts);
      if (minutes.incomplete) incomplete = true;
      derived.push(...aggregate(minutes.candles, 3600));
    }
    if (derived.length) base = [...base, ...derived].sort((a, b) => a.t - b.t);
  }
  const candles = tf === native ? base : aggregate(base, TF_SECONDS[tf]);
  // aggregation can start mid-bucket at the window edge: keep only bars whose open lies inside the window
  return { candles: candles.filter((c) => c.t >= Math.floor(fromSec / TF_SECONDS[tf]) * TF_SECONDS[tf] && c.t < toSec), incomplete, unsupported: false };
}

const n = (v: Prisma.Decimal | null) => (v == null ? 0 : Number(v));

/** Run `fn` over the items with at most `size` running at once. */
async function mapPool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}
