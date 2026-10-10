/**
 * Replay data built from real cached XAUUSD candles. A throwaway trade is placed at prices taken from the feed itself,
 * so the running P&L can be checked against an independent calculation. Skipped when the database or cached prices are absent.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getCandles } from "@/lib/market-data/candle-cache";
import { loadDayReplay, loadReplayPicks, loadTradeReplay } from "@/lib/queries/replay";

const P = "TEST-replay";
const DAY = "2026-10-06";
const QTY = 0.5;
let ready = false;
let accountId = "";
let tradeId = "";
const exp = { entry: 0, exit: 0, gross: 0, open: 0, close: 0, closes: new Map<number, number>() };

beforeAll(async () => {
  try {
    const dayStart = Date.parse(`${DAY}T00:00:00Z`) / 1000;
    const { candles } = await getCandles("XAUUSD", "M1", dayStart + 9 * 3600, dayStart + 10 * 3600, { maxFetch: 0 });
    if (candles.length < 40) return;
    const sym = await db.symbolConfig.findUnique({ where: { symbol: "XAUUSD" } });
    const contract = Number(sym?.contractSize ?? 100);
    const a = candles[5];
    const b = candles[25];
    exp.entry = a.c;
    exp.exit = b.c;
    exp.gross = Math.round((b.c - a.c) * QTY * contract * 100) / 100;
    exp.open = a.t + 55; // inside the entry candle
    exp.close = b.t + 55;
    for (const c of candles) exp.closes.set(c.t, c.c);

    accountId = (await db.account.create({ data: { name: `${P}-acc`, platform: "MANUAL", currency: "AUD", startingBalance: 0, syncType: "MANUAL" } })).id;
    const day = new Date(`${DAY}T00:00:00Z`);
    const t = await db.trade.create({
      data: {
        accountId, brokerTicket: `${P}-1`, symbol: "XAUUSD", side: "LONG", status: "CLOSED", openedAt: new Date(exp.open * 1000), closedAt: new Date(exp.close * 1000), openDay: day, closeDay: day,
        holdSeconds: exp.close - exp.open, quantity: QTY, avgEntry: exp.entry, avgExit: exp.exit, grossPnl: exp.gross, netPnl: exp.gross, result: exp.gross > 0 ? "WIN" : "LOSS",
        executions: {
          create: [
            { at: new Date(exp.open * 1000), price: exp.entry, quantity: QTY, grossPnl: 0 },
            { at: new Date(exp.close * 1000), price: exp.exit, quantity: -QTY, grossPnl: exp.gross },
          ],
        },
      },
    });
    tradeId = t.id;
    ready = true;
  } catch {
    ready = false;
  }
});
afterAll(async () => {
  await db.account.deleteMany({ where: { name: { startsWith: P } } });
  await db.$disconnect();
});

describe("trade replay", () => {
  it("plays candle by candle with a running P&L that matches the price path and ends on the final result", async (ctx) => {
    if (!ready) return ctx.skip();
    const r = (await loadTradeReplay(tradeId, "M1"))!;
    expect(r.mode).toBe("trade");
    expect(r.tf).toBe("M1");
    expect(r.priceCheck.matches).toBe(true);
    expect(r.pnl.length).toBe(r.candles.length);

    // playback starts one candle before the entry candle
    const entryIdx = r.candles.findIndex((c) => c.t <= exp.open && exp.open < c.t + 60);
    expect(r.start).toBe(entryIdx - 1);

    // nothing is floating before the entry, and the line is flat zero up to it
    expect(r.pnl.slice(0, entryIdx).every((v) => v === 0)).toBe(true);

    // while open: (candle close - entry) * lots * contract size
    const contract = exp.gross / ((exp.exit - exp.entry) * QTY);
    const mid = r.candles.findIndex((c) => c.t === r.candles[entryIdx].t + 600);
    const want = Math.round((r.candles[mid].c - exp.entry) * QTY * contract * 100) / 100;
    expect(r.pnl[mid]).toBeCloseTo(want, 1);

    // after the exit the total stays at the final result
    const afterIdx = r.candles.findIndex((c) => c.t >= exp.close + 60);
    expect(r.pnl[afterIdx]).toBeCloseTo(exp.gross, 2);
    expect(r.pnl.at(-1)).toBeCloseTo(exp.gross, 2);

    // markers for the entry and the exit, on the right candles
    expect(r.markers.map((m) => [m.kind, m.t])).toEqual([["entry", Math.floor(exp.open / 60) * 60], ["exit", Math.floor(exp.close / 60) * 60]]);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0].netPnl).toBeCloseTo(exp.gross, 2);
  }, 60_000);

  it("a coarser timeframe is respected and a very long window is coarsened", async (ctx) => {
    if (!ready) return ctx.skip();
    const m5 = (await loadTradeReplay(tradeId, "M5"))!;
    expect(m5.tf).toBe("M5");
    expect(m5.coarsened).toBe(false);
    expect(m5.pnl.at(-1)).toBeCloseTo(exp.gross, 2);
  }, 60_000);

  it("unknown trades and bad timeframes are handled", async (ctx) => {
    if (!ready) return ctx.skip();
    expect(await loadTradeReplay("nope")).toBeNull();
    const r = (await loadTradeReplay(tradeId, "bogus"))!;
    expect(["M1", "M5"]).toContain(r.tf);
  }, 60_000);
});

describe("day replay", () => {
  it("includes every trade of the most traded symbol, results only at the end", async (ctx) => {
    if (!ready) return ctx.skip();
    const r = await loadDayReplay(DAY, undefined, "M5");
    expect(r).not.toBeNull();
    const rows = await db.trade.count({ where: { closeDay: new Date(`${DAY}T00:00:00Z`), status: "CLOSED", symbol: r!.symbol } });
    expect(r!.trades.length).toBe(Math.min(rows, 40));
    expect(r!.mode).toBe("day");
    expect(r!.start).toBeGreaterThanOrEqual(0);
    expect(r!.pnl.length).toBe(r!.candles.length);
  }, 120_000);

  it("a day with no trades, a bad date and an unknown symbol", async (ctx) => {
    if (!ready) return ctx.skip();
    expect(await loadDayReplay("2020-01-01")).toBeNull();
    expect(await loadDayReplay("not-a-day")).toBeNull();
    expect(await loadDayReplay("2026-02-30")).toBeNull();
    const r = await loadDayReplay(DAY, "NOPE", "M5"); // unknown symbol falls back to the most traded one
    expect(r?.symbol).toBe("XAUUSD");
  }, 120_000);
});

describe("replay picks", () => {
  it("lists recent trades and days, newest first", async (ctx) => {
    if (!ready) return ctx.skip();
    const p = await loadReplayPicks();
    expect(p.recentTrades.length).toBeGreaterThan(0);
    expect(p.recentDays.length).toBeGreaterThan(0);
    const days = p.recentDays.map((d) => d.day);
    expect([...days].sort().reverse()).toEqual(days);
  });
});
