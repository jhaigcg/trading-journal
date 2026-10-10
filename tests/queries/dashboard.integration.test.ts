/**
 * Integration tests against the local Postgres (docker compose) using the seeded demo account.
 * Skipped automatically when the database or demo data is not there.
 */
import { TZDate } from "@date-fns/tz";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { parseFilters } from "@/lib/filters/params";
import { tradeWhere } from "@/lib/filters/where";
import { dailyBuckets, summarize, summarizeDays } from "@/lib/metrics";
import { loadCalendarMonth, loadDashboard } from "@/lib/queries/dashboard";

const TZ = "Asia/Hong_Kong";
const PERF = "TEST perf account (vitest)";
let ready = false;
let accountId = "";
type T = Awaited<ReturnType<typeof loadTrades>>[number];

const loadTrades = (id: string) =>
  db.trade.findMany({ where: { accountId: id, status: "CLOSED" }, include: { tags: true } });

const filters = (extra: Record<string, string> = {}) => parseFilters({ account: accountId, range: "all", ...extra });
const count = async (extra: Record<string, string>) => {
  const f = filters(extra);
  const rows = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "Trade" t ${tradeWhere(f, { tz: TZ })}`;
  return rows[0].n;
};

beforeAll(async () => {
  try {
    const acc = await db.account.findFirst({ where: { name: { startsWith: "MT4 · Main account (demo data)" } } });
    if (acc) {
      accountId = acc.id;
      ready = (await db.trade.count({ where: { accountId, status: "CLOSED" } })) > 100;
    }
  } catch {
    ready = false;
  }
});

afterAll(async () => {
  const ids = (await db.account.findMany({ where: { name: PERF }, select: { id: true } }).catch(() => [])).map((a) => a.id);
  if (ids.length) {
    await db.dailySummary.deleteMany({ where: { accountId: { in: ids } } });
    await db.account.deleteMany({ where: { name: PERF } });
  }
  await db.$disconnect();
});

describe("dashboard SQL aggregates agree with the metrics module", () => {
  it("summary, day summary and curves", async (ctx) => {
    if (!ready) return ctx.skip();
    const trades = await loadTrades(accountId);
    const inputs = trades.map((t) => ({
      netPnl: Number(t.netPnl), grossPnl: Number(t.grossPnl), commission: Number(t.commission), swap: Number(t.swap), fees: Number(t.fees),
      quantity: Number(t.quantity), holdSeconds: t.holdSeconds, day: t.closeDay!.toISOString().slice(0, 10),
      plannedR: t.plannedR == null ? null : Number(t.plannedR), realizedR: t.realizedR == null ? null : Number(t.realizedR),
    }));
    const expected = summarize(inputs);
    const days = dailyBuckets(inputs);
    const expDays = summarizeDays(days);

    const d = await loadDashboard(filters({ cum: "x" }));
    expect(d.summary).toMatchObject({ count: expected.count, wins: expected.wins, losses: expected.losses, breakevens: expected.breakevens, netPnl: expected.netPnl, grossPnl: expected.grossPnl, fees: expected.fees });
    expect(d.summary.profitFactor).toBeCloseTo(expected.profitFactor!, 6);
    expect(d.summary.winRate).toBeCloseTo(expected.winRate, 9);
    expect(d.summary.expectancy).toBeCloseTo(expected.expectancy, 2);
    expect(d.summary.avgWin).toBeCloseTo(expected.avgWin, 2);
    expect(d.summary.avgLoss).toBeCloseTo(expected.avgLoss, 2);
    expect(d.summary.avgHoldSeconds).toBeCloseTo(expected.avgHoldSeconds, 4);
    expect(d.daySummary).toMatchObject({ days: expDays.days, green: expDays.green, red: expDays.red });
    expect(d.dailyNet.map((p) => p.label)).toEqual(days.map((x) => x.day));
    expect(d.cumulative.at(-1)!.value).toBeCloseTo(expected.netPnl, 1);
    expect(d.drawdown.every((p) => p.value <= 0)).toBe(true);
    expect(d.score.score).toBeGreaterThan(0);
    expect(d.balance.at(-1)!.balance).toBeCloseTo(10_000 + expected.netPnl, 0); // seeded account starts at 10,000 with no deposits
  });

  it("trade-by-trade cumulative series", async (ctx) => {
    if (!ready) return ctx.skip();
    const d = await loadDashboard(filters(), { cum: "trade" });
    expect(d.cumulativeMode).toBe("trade");
    expect(d.cumulative).toHaveLength(d.summary.count);
    expect(d.cumulative.at(-1)!.value).toBeCloseTo(d.summary.netPnl, 1);
  });

  it("recent trades are the latest closed ones; open positions listed separately", async (ctx) => {
    if (!ready) return ctx.skip();
    const d = await loadDashboard(filters());
    expect(d.recent).toHaveLength(8);
    const times = d.recent.map((r) => r.at.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(d.open.length).toBeGreaterThanOrEqual(1); // the seed leaves two trades open
  });

  it("currency conversion scales money but not ratios", async (ctx) => {
    if (!ready) return ctx.skip();
    const rate = await db.fxRate.findFirst({ where: { base: "USD", quote: "AUD" } });
    if (!rate) return ctx.skip();
    const aud = await loadDashboard(filters());
    const usd = await loadDashboard(filters({ ccy: "USD" }));
    expect(usd.currency).toBe("USD");
    expect(usd.summary.netPnl).toBeCloseTo(aud.summary.netPnl / Number(rate.rate), 0);
    expect(usd.summary.winRate).toBe(aud.summary.winRate);
    expect(usd.summary.profitFactor).toBe(aud.summary.profitFactor);
    const unknown = await loadDashboard(filters({ ccy: "XYZ" }));
    expect(unknown.currency).toBe("AUD"); // no rate known: falls back instead of inventing one
    expect(unknown.summary.netPnl).toBe(aud.summary.netPnl);
  });

  it("calendar month matches the daily buckets", async (ctx) => {
    if (!ready) return ctx.skip();
    const trades = await loadTrades(accountId);
    const month = trades.at(-1)!.closeDay!.toISOString().slice(0, 7);
    const expected = dailyBuckets(trades.filter((t) => t.closeDay!.toISOString().startsWith(month)).map((t) => ({ netPnl: Number(t.netPnl), day: t.closeDay!.toISOString().slice(0, 10) })));
    const got = await loadCalendarMonth(filters(), month);
    expect(got.map((g) => [g.day, g.trades, g.netPnl])).toEqual(expected.map((e) => [e.day, e.trades, e.netPnl]));
  });
});

describe("every filter selects exactly what an independent JS calculation selects", () => {
  let trades: T[] = [];
  beforeAll(async () => {
    if (ready) trades = await loadTrades(accountId);
  });
  const hk = (d: Date) => new TZDate(d, TZ);

  it("general filters", async (ctx) => {
    if (!ready) return ctx.skip();
    expect(await count({})).toBe(trades.length);
    expect(await count({ side: "LONG" })).toBe(trades.filter((t) => t.side === "LONG").length);
    expect(await count({ side: "SHORT" })).toBe(trades.filter((t) => t.side === "SHORT").length);
    expect(await count({ result: "WIN" })).toBe(trades.filter((t) => t.result === "WIN").length);
    expect(await count({ result: "LOSS" })).toBe(trades.filter((t) => t.result === "LOSS").length);
    expect(await count({ reviewed: "yes" })).toBe(trades.filter((t) => t.reviewed).length);
    expect(await count({ reviewed: "no" })).toBe(trades.filter((t) => !t.reviewed).length);
    expect(await count({ symbol: "xauusd" })).toBe(trades.filter((t) => t.symbol === "XAUUSD").length);
    expect(await count({ symbol: "EURUSD" })).toBe(0);
    expect(await count({ instrument: "FOREX_CFD" })).toBe(trades.filter((t) => t.instrumentType === "FOREX_CFD").length);
    expect(await count({ instrument: "STOCK" })).toBe(0);
    expect(await count({ duration: "intraday" })).toBe(trades.filter((t) => t.intraday).length);
    expect(await count({ status: "all" })).toBe(await db.trade.count({ where: { accountId } }));
    expect(await count({ status: "open" })).toBe(await db.trade.count({ where: { accountId, status: "OPEN" } }));
  });

  it("day & time filters (weekday and hour in the display timezone, session in UTC)", async (ctx) => {
    if (!ready) return ctx.skip();
    expect(await count({ dow: "1,3" })).toBe(trades.filter((t) => [1, 3].includes(hk(t.openedAt).getDay())).length);
    expect(await count({ hour: "9,10,15" })).toBe(trades.filter((t) => [9, 10, 15].includes(hk(t.openedAt).getHours())).length);
    expect(await count({ session: "london" })).toBe(trades.filter((t) => t.openedAt.getUTCHours() >= 7 && t.openedAt.getUTCHours() < 13).length);
    expect(await count({ session: "asia,newyork" })).toBe(trades.filter((t) => t.openedAt.getUTCHours() < 7 || (t.openedAt.getUTCHours() >= 13 && t.openedAt.getUTCHours() < 21)).length);
    expect(await count({ dow: "1", hour: "9" })).toBe(trades.filter((t) => hk(t.openedAt).getDay() === 1 && hk(t.openedAt).getHours() === 9).length);
  });

  it("tags, strategy and insight flags", async (ctx) => {
    if (!ready) return ctx.skip();
    const tag = await db.tag.findFirstOrThrow({ where: { name: "Order block" } });
    expect(await count({ tags: tag.id })).toBe(trades.filter((t) => t.tags.some((x) => x.tagId === tag.id)).length);
    const strat = await db.strategy.findFirstOrThrow();
    expect(await count({ strategy: strat.id })).toBe(trades.filter((t) => t.strategyId === strat.id).length);
    expect(await count({ strategy: "none" })).toBe(trades.filter((t) => !t.strategyId).length);
    expect(await count({ strategy: `${strat.id},none` })).toBe(trades.filter((t) => t.strategyId === strat.id || !t.strategyId).length);
    expect(await count({ flags: "noStopLoss" })).toBe(trades.filter((t) => t.stopLoss == null).length);
    expect(await count({ flags: "noTarget" })).toBe(trades.filter((t) => t.profitTarget == null).length);
    expect(await count({ flags: "noStrategy" })).toBe(trades.filter((t) => !t.strategyId).length);
    expect(await count({ flags: "untagged" })).toBe(trades.filter((t) => t.tags.length === 0).length);
    expect(await count({ flags: "unreviewed" })).toBe(trades.filter((t) => !t.reviewed).length);
    const mistakeTags = (await db.tag.findMany({ where: { category: { name: "Mistakes" } } })).map((m) => m.id);
    expect(await count({ flags: "hasMistake" })).toBe(trades.filter((t) => t.tags.some((x) => mistakeTags.includes(x.tagId))).length);
    expect(await count({ flags: "noStopLoss,unreviewed", side: "LONG" })).toBe(trades.filter((t) => t.stopLoss == null && !t.reviewed && t.side === "LONG").length);
  });

  it("date ranges use the trading day in the display timezone", async (ctx) => {
    if (!ready) return ctx.skip();
    const sorted = [...trades].sort((a, b) => a.closeDay!.getTime() - b.closeDay!.getTime());
    const mid = sorted[Math.floor(sorted.length / 2)].closeDay!.toISOString().slice(0, 10);
    expect(await count({ range: "custom", from: mid })).toBe(trades.filter((t) => t.closeDay!.toISOString().slice(0, 10) >= mid).length);
    expect(await count({ range: "custom", to: mid })).toBe(trades.filter((t) => t.closeDay!.toISOString().slice(0, 10) <= mid).length);
    expect(await count({ range: "custom", from: mid, to: mid })).toBe(trades.filter((t) => t.closeDay!.toISOString().slice(0, 10) === mid).length);
  });

  it("hostile input cannot change the query", async (ctx) => {
    if (!ready) return ctx.skip();
    expect(await count({ symbol: "XAUUSD'; DROP TABLE \"Trade\"; --" })).toBe(trades.length); // dropped by the whitelist, filter not applied
    expect(await db.trade.count()).toBeGreaterThan(0);
  });
});

describe("performance at 10,000 trades", () => {
  it("dashboard loads in under a second", async (ctx) => {
    let acc;
    try {
      acc = await db.account.create({ data: { name: PERF, platform: "MANUAL", currency: "AUD", startingBalance: 10_000, syncType: "MANUAL" } });
    } catch {
      return ctx.skip();
    }
    const base = Date.UTC(2023, 0, 2, 7, 0, 0);
    const rows = Array.from({ length: 10_000 }, (_, i) => {
      const opened = new Date(base + Math.floor(i / 20) * 86_400_000 + (i % 20) * 1_800_000);
      const closed = new Date(opened.getTime() + 300_000);
      const net = ((i * 7919) % 400) - 170; // deterministic mix of wins and losses
      const day = new Date(Date.UTC(closed.getUTCFullYear(), closed.getUTCMonth(), closed.getUTCDate() + (closed.getUTCHours() >= 16 ? 1 : 0)));
      return {
        accountId: acc.id, brokerTicket: `perf-${i}`, symbol: "XAUUSD", side: (i % 2 ? "LONG" : "SHORT") as "LONG" | "SHORT", status: "CLOSED" as const,
        openedAt: opened, closedAt: closed, holdSeconds: 300, openDay: day, closeDay: day, quantity: 0.1, avgEntry: 2000, avgExit: 2001,
        grossPnl: net, netPnl: net, result: (net > 0 ? "WIN" : net < 0 ? "LOSS" : "BREAKEVEN") as "WIN" | "LOSS" | "BREAKEVEN",
      };
    });
    for (let i = 0; i < rows.length; i += 1000) await db.trade.createMany({ data: rows.slice(i, i + 1000) });

    const f = parseFilters({ account: acc.id, range: "all" });
    await loadDashboard(f); // warm the connection / plan cache
    const t0 = performance.now();
    const d = await loadDashboard(f);
    const ms = performance.now() - t0;
    const t1 = performance.now();
    await loadDashboard(parseFilters({ account: acc.id, range: "all", dow: "1,2,3", session: "london", flags: "noStopLoss" }));
    const msFiltered = performance.now() - t1;
    console.log(`dashboard @10k trades: ${ms.toFixed(0)} ms (unfiltered), ${msFiltered.toFixed(0)} ms (advanced filters)`);

    expect(d.summary.count).toBe(10_000);
    expect(ms).toBeLessThan(1000);
    expect(msFiltered).toBeLessThan(1000);
  }, 60_000);
});
