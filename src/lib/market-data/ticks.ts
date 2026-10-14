import { db } from "@/lib/db";
import { BASE, fetchBi5, instrumentFor, lzmaDecode } from "./dukascopy";
import type { Candle } from "./types";

/**
 * Seconds-level candles for news events (CPI, NFP), built from Dukascopy's tick files: one file per hour, each record
 * 20 bytes, big-endian: milliseconds since the hour began, ask, bid (both scaled integers), ask volume, bid volume.
 * Candles are made from the bid price and stored in the same table as the other timeframes under "S5".
 */
export const TICK_TF = "S5";
export const TICK_STEP = 5;

export interface Tick {
  /** unix seconds, with milliseconds as the fraction */
  t: number;
  bid: number;
  ask: number;
}

export function parseTicks(raw: Buffer, hourStartSec: number, scale: number): Tick[] {
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.length);
  const out: Tick[] = [];
  for (let o = 0; o + 20 <= raw.length; o += 20) {
    out.push({ t: hourStartSec + dv.getUint32(o) / 1000, ask: dv.getUint32(o + 4) / scale, bid: dv.getUint32(o + 8) / scale });
  }
  return out;
}

/** Bid candles of `stepSec` seconds. Seconds without a tick have no candle (the chart simply has a gap). Ticks must be in time order. */
export function ticksToCandles(ticks: Tick[], stepSec = TICK_STEP): Candle[] {
  const out: Candle[] = [];
  let cur: Candle | null = null;
  for (const k of ticks) {
    const bucket = Math.floor(k.t / stepSec) * stepSec;
    if (!cur || cur.t !== bucket) {
      if (cur) out.push(cur);
      cur = { t: bucket, o: k.bid, h: k.bid, l: k.bid, c: k.bid, v: 1 };
    } else {
      cur.h = Math.max(cur.h, k.bid);
      cur.l = Math.min(cur.l, k.bid);
      cur.c = k.bid;
      cur.v += 1;
    }
  }
  if (cur) out.push(cur);
  return out;
}

const pad = (n: number) => String(n).padStart(2, "0");
const HOUR = 3600;

/** The UTC hours ("2026-10-14T12") that overlap [fromSec, toSec). */
export function hoursBetween(fromSec: number, toSec: number): string[] {
  const out: string[] = [];
  for (let t = Math.floor(fromSec / HOUR) * HOUR; t < toSec; t += HOUR) out.push(new Date(t * 1000).toISOString().slice(0, 13));
  return out;
}

export function tickUrl(code: string, hour: string): string {
  const d = new Date(`${hour}:00:00Z`);
  return `${BASE}/${code}/${d.getUTCFullYear()}/${pad(d.getUTCMonth())}/${pad(d.getUTCDate())}/${pad(d.getUTCHours())}h_ticks.bi5`;
}

export interface TickCandleResult {
  candles: Candle[];
  incomplete: boolean;
  unsupported: boolean;
}

/**
 * 5-second candles for [fromSec, toSec). Hours not stored yet are downloaded (a few at a time) and kept, so every later
 * view is instant. The hour still in progress is never marked as complete.
 */
export async function getTickCandles(symbol: string, fromSec: number, toSec: number, opts: { now?: Date; fetchHour?: (hour: string) => Promise<Candle[]> } = {}): Promise<TickCandleResult> {
  const inst = instrumentFor(symbol);
  if (!inst) return { candles: [], incomplete: false, unsupported: true };
  const now = opts.now ?? new Date();
  const nowSec = now.getTime() / 1000;
  const hours = hoursBetween(fromSec, Math.min(toSec, nowSec));
  let incomplete = false;

  if (hours.length) {
    const have = new Set((await db.candleCoverage.findMany({ where: { symbol, timeframe: TICK_TF, period: { in: hours } } })).map((c) => c.period));
    const todo = hours.filter((h) => !have.has(h)).slice(0, 8);
    if (hours.filter((h) => !have.has(h)).length > todo.length) incomplete = true;
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(3, todo.length) }, async () => {
        while (next < todo.length) {
          const hour = todo[next++];
          try {
            const start = Date.parse(`${hour}:00:00Z`) / 1000;
            const candles = opts.fetchHour
              ? await opts.fetchHour(hour)
              : await (async () => {
                  const buf = await fetchBi5(tickUrl(inst.code, hour));
                  return buf && buf.length ? ticksToCandles(parseTicks(await lzmaDecode(buf), start, inst.scale)) : [];
                })();
            const rows = candles.filter((c) => c.t >= start && c.t < start + HOUR).map((c) => ({ symbol, timeframe: TICK_TF, t: new Date(c.t * 1000), open: c.o, high: c.h, low: c.l, close: c.c, volume: c.v }));
            const hourComplete = start + HOUR + 300 <= nowSec;
            await db.$transaction(async (tx) => {
              await tx.candle.deleteMany({ where: { symbol, timeframe: TICK_TF, t: { gte: new Date(start * 1000), lt: new Date((start + HOUR) * 1000) } } });
              for (let k = 0; k < rows.length; k += 2000) await tx.candle.createMany({ data: rows.slice(k, k + 2000), skipDuplicates: true });
              if (hourComplete) await tx.candleCoverage.upsert({ where: { symbol_timeframe_period: { symbol, timeframe: TICK_TF, period: hour } }, update: { fetchedAt: now, count: rows.length }, create: { symbol, timeframe: TICK_TF, period: hour, fetchedAt: now, count: rows.length } });
            });
          } catch {
            incomplete = true;
          }
        }
      }),
    );
  }

  const rows = await db.candle.findMany({ where: { symbol, timeframe: TICK_TF, t: { gte: new Date(fromSec * 1000), lt: new Date(toSec * 1000) } }, orderBy: { t: "asc" } });
  const candles: Candle[] = rows.map((r) => ({ t: r.t.getTime() / 1000, o: Number(r.open), h: Number(r.high), l: Number(r.low), c: Number(r.close), v: Number(r.volume ?? 0) }));
  return { candles, incomplete, unsupported: false };
}
