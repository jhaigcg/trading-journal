/**
 * Integration tests for the Trades views against the seeded demo account. Skipped if the DB/demo data is absent.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { parseFilters } from "@/lib/filters/params";
import { dailyBuckets } from "@/lib/metrics";
import { loadTradeDetail } from "@/lib/queries/trade-detail";
import { listDayCards, listTrades, listWeekCards, loadListSummary, matchingIds, neighbours, type SortKey } from "@/lib/queries/trade-list";

let accountId = "";
let ready = false;
const F = (extra: Record<string, string> = {}) => parseFilters({ account: accountId, range: "all", ...extra });

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
  await db.$disconnect();
});

describe("All-trades table", () => {
  it("pages, counts and sorts server-side", async (ctx) => {
    if (!ready) return ctx.skip();
    const total = await db.trade.count({ where: { accountId, status: "CLOSED" } });
    const p1 = await listTrades(F(), { sort: "closedAt", dir: "desc", page: 1, size: 25 });
    const p2 = await listTrades(F(), { sort: "closedAt", dir: "desc", page: 2, size: 25 });
    expect(p1.total).toBe(total);
    expect(p1.rows).toHaveLength(25);
    expect(p2.rows).toHaveLength(25);
    expect(new Set([...p1.rows, ...p2.rows].map((r) => r.id)).size).toBe(50); // no overlap between pages
    const last = await listTrades(F(), { sort: "closedAt", dir: "desc", page: Math.ceil(total / 25), size: 25 });
    expect(last.rows).toHaveLength(total % 25 || 25);

    for (const sort of ["netPnl", "openedAt", "symbol", "netRoi", "insights", "quantity"] as SortKey[]) {
      const asc = await listTrades(F(), { sort, dir: "asc", page: 1, size: 50 });
      const desc = await listTrades(F(), { sort, dir: "desc", page: 1, size: 50 });
      const key = (r: (typeof asc.rows)[number]) => (sort === "insights" ? r.insights : sort === "openedAt" ? r.openedAt.getTime() : (r as unknown as Record<string, number | string | null>)[sort]);
      const a = asc.rows.map(key).filter((v) => v != null) as (number | string)[];
      const d = desc.rows.map(key).filter((v) => v != null) as (number | string)[];
      if (sort !== "symbol") {
        expect(a).toEqual([...a].sort((x, y) => Number(x) - Number(y)));
        expect(d).toEqual([...d].sort((x, y) => Number(y) - Number(x)));
      }
    }
  });

  it("insight counts and the scale yardstick are correct", async (ctx) => {
    if (!ready) return ctx.skip();
    const res = await listTrades(F(), { sort: "insights", dir: "desc", page: 1, size: 100 });
    for (const row of res.rows.slice(0, 20)) {
      const t = await db.trade.findUniqueOrThrow({ where: { id: row.id }, include: { tags: true } });
      expect(row.insights).toBe((t.stopLoss == null ? 1 : 0) + (t.strategyId == null ? 1 : 0) + (t.reviewed ? 0 : 1) + (t.tags.length === 0 ? 1 : 0));
    }
    const all = await db.trade.findMany({ where: { accountId, status: "CLOSED" }, select: { netPnl: true } });
    expect(res.avgAbs).toBeCloseTo(all.reduce((s, t) => s + Math.abs(Number(t.netPnl)), 0) / all.length, 4);
  });

  it("filters and matchingIds agree", async (ctx) => {
    if (!ready) return ctx.skip();
    const f = F({ side: "SHORT", result: "WIN" });
    const res = await listTrades(f, { sort: "closedAt", dir: "desc", page: 1, size: 100 });
    expect(res.total).toBe(await db.trade.count({ where: { accountId, status: "CLOSED", side: "SHORT", result: "WIN" } }));
    expect((await matchingIds(f)).length).toBe(res.total);
  });

  it("summary strip: aggregates and a short sparkline ending on the net P&L", async (ctx) => {
    if (!ready) return ctx.skip();
    const s = await loadListSummary(F());
    const sum = await db.trade.aggregate({ where: { accountId, status: "CLOSED" }, _sum: { netPnl: true }, _count: true });
    expect(s.summary.count).toBe(sum._count);
    expect(s.summary.netPnl).toBeCloseTo(Number(sum._sum.netPnl), 1);
    expect(s.spark.length).toBeGreaterThan(10);
    expect(s.spark.length).toBeLessThanOrEqual(61);
    expect(s.spark.at(-1)).toBeCloseTo(s.summary.netPnl, 1);
  });
});

describe("Day and week views", () => {
  it("day cards match per-day aggregates; intraday curve ends on the day's net", async (ctx) => {
    if (!ready) return ctx.skip();
    const trades = await db.trade.findMany({ where: { accountId, status: "CLOSED" } });
    const expected = dailyBuckets(trades.map((t) => ({ netPnl: Number(t.netPnl), grossPnl: Number(t.grossPnl), quantity: Number(t.quantity), day: t.closeDay!.toISOString().slice(0, 10) }))).reverse();
    const { cards, totalDays } = await listDayCards(F(), { page: 1, size: 10 });
    expect(totalDays).toBe(expected.length);
    expect(cards).toHaveLength(10);
    cards.forEach((c, i) => {
      expect(c.key).toBe(expected[i].day);
      expect(c.trades).toBe(expected[i].trades);
      expect(c.netPnl).toBeCloseTo(expected[i].netPnl, 1);
      expect(c.intraday).toHaveLength(c.trades);
      expect(c.intraday.at(-1)).toBeCloseTo(c.netPnl, 1);
      expect(c.wins + c.losses).toBeLessThanOrEqual(c.trades);
    });
    const p2 = await listDayCards(F(), { page: 2, size: 10 });
    expect(p2.cards[0].key).toBe(expected[10].day);
  });

  it("single-day filter", async (ctx) => {
    if (!ready) return ctx.skip();
    const t = await db.trade.findFirstOrThrow({ where: { accountId, status: "CLOSED" }, orderBy: { closedAt: "desc" } });
    const day = t.closeDay!.toISOString().slice(0, 10);
    const { cards } = await listDayCards(F({ range: "custom", from: day, to: day }), { page: 1, size: 10 });
    expect(cards.map((c) => c.key)).toEqual([day]);
  });

  it("week cards roll the days up (Monday-based)", async (ctx) => {
    if (!ready) return ctx.skip();
    const { cards, totalWeeks } = await listWeekCards(F(), { page: 1, size: 20 });
    expect(totalWeeks).toBeGreaterThan(3);
    for (const c of cards) expect(new Date(`${c.key}T00:00:00Z`).getUTCDay()).toBe(1);
    const trades = await db.trade.findMany({ where: { accountId, status: "CLOSED" } });
    const total = trades.reduce((s, t) => s + Number(t.netPnl), 0);
    const all = await listWeekCards(F(), { page: 1, size: 500 });
    expect(all.cards.reduce((s, c) => s + c.netPnl, 0)).toBeCloseTo(total, 1);
    expect(all.cards.reduce((s, c) => s + c.trades, 0)).toBe(trades.length);
    const wk = cards[0];
    expect(wk.bestDay).toBeGreaterThanOrEqual(wk.worstDay);
    expect(wk.days).toBeGreaterThan(0);
  });
});

describe("Trade details", () => {
  it("loads a full DTO with executions, strategy rules and ties out to the trade", async (ctx) => {
    if (!ready) return ctx.skip();
    const t = await db.trade.findFirstOrThrow({ where: { accountId, status: "CLOSED", strategyId: { not: null } } });
    const d = (await loadTradeDetail({ id: t.id }))!;
    expect(d.symbol).toBe("XAUUSD");
    expect(d.executions.length).toBeGreaterThanOrEqual(2);
    expect(d.executions.reduce((s, e) => s + e.quantity, 0)).toBeCloseTo(0, 6); // fully closed
    expect(d.strategy!.groups.length).toBeGreaterThan(0);
    expect(d.strategy!.groups[0].rules[0].followed).toBeNull(); // not answered yet
    expect(d.contractSize).toBe(100);
    expect(d.netPnl).toBeCloseTo(d.grossPnl + d.commission + d.swap + d.fees, 1);
    expect(await loadTradeDetail({ id: "nope" })).toBeNull();
    expect(await loadTradeDetail({ shareToken: "nope" })).toBeNull();
  });

  it("prev/next walk the same filtered set in entry order", async (ctx) => {
    if (!ready) return ctx.skip();
    const f = F({ side: "LONG" });
    const rows = await db.trade.findMany({ where: { accountId, status: "CLOSED", side: "LONG" }, orderBy: [{ openedAt: "asc" }, { id: "asc" }], select: { id: true } });
    const mid = Math.floor(rows.length / 2);
    const nb = await neighbours(rows[mid].id, f);
    expect(nb.prev).toBe(rows[mid - 1].id);
    expect(nb.next).toBe(rows[mid + 1].id);
    expect((await neighbours(rows[0].id, f)).prev).toBeNull();
    expect((await neighbours(rows.at(-1)!.id, f)).next).toBeNull();
  });
});
