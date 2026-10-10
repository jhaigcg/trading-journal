/**
 * Report queries against the seeded demo account, checked against independent JavaScript calculations.
 * Skipped automatically if the database or demo data is absent.
 */
import { TZDate } from "@date-fns/tz";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { parseFilters } from "@/lib/filters/params";
import { SESSION_HOURS } from "@/lib/filters/params";
import { byHour, bySession, byStrategy, bySymbol, byTag, byWeekday, heatmap, histogram, loadDayRows, loadJournaledDays, pnlDistribution, riskReport, winsVsLosses } from "@/lib/queries/reports";
import { rollup, summaryRows } from "@/lib/reports/rollup";

const TZ = "Asia/Hong_Kong";
let accountId = "";
let ready = false;
type T = Awaited<ReturnType<typeof load>>[number];
const load = (id: string) => db.trade.findMany({ where: { accountId: id, status: "CLOSED" }, include: { tags: true } });
const F = (extra: Record<string, string> = {}) => parseFilters({ account: accountId, range: "all", ...extra });
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const near = (a: number, b: number, d = 1) => expect(a).toBeCloseTo(b, d);
let trades: T[] = [];

beforeAll(async () => {
  try {
    const acc = await db.account.findFirst({ where: { name: { startsWith: "MT4 · Main account (demo data)" } } });
    if (acc) {
      accountId = acc.id;
      trades = await load(accountId);
      ready = trades.length > 100;
    }
  } catch {
    ready = false;
  }
});
afterAll(async () => {
  await db.$disconnect();
});

const net = (t: T) => Number(t.netPnl);
const hk = (d: Date) => new TZDate(d, TZ);
const totalNet = () => sum(trades.map(net));

describe("day rows and the summary", () => {
  it("one row per trading day whose totals match the trades", async (ctx) => {
    if (!ready) return ctx.skip();
    const rows = await loadDayRows(F());
    expect(rows.length).toBe(new Set(trades.map((t) => t.closeDay!.toISOString().slice(0, 10))).size);
    expect(rows.map((r) => r.day)).toEqual([...rows.map((r) => r.day)].sort());
    near(sum(rows.map((r) => r.agg.netPnl)), totalNet());
    expect(sum(rows.map((r) => r.agg.count))).toBe(trades.length);
    const d = rows[Math.floor(rows.length / 2)];
    const mine = trades.filter((t) => t.closeDay!.toISOString().slice(0, 10) === d.day);
    expect(d.agg.count).toBe(mine.length);
    near(d.agg.netPnl, sum(mine.map(net)));
    near(d.agg.grossWin, sum(mine.filter((t) => net(t) > 0).map(net)));
  });

  it("the summary table agrees with the dashboard-style numbers", async (ctx) => {
    if (!ready) return ctx.skip();
    const rows = await loadDayRows(F());
    const s = Object.fromEntries(summaryRows(rows, 0, 0).map((r) => [r.key, r.value]));
    near(s.net as number, totalNet());
    const wins = trades.filter((t) => net(t) > 0).length;
    const losses = trades.filter((t) => net(t) < 0).length;
    near(s.winRate as number, (wins / (wins + losses)) * 100, 6);
    expect(s.loggedDays).toBe(rows.length);
    const gw = sum(trades.filter((t) => net(t) > 0).map(net));
    const gl = sum(trades.filter((t) => net(t) < 0).map(net));
    near(s.profitFactor as number, gw / Math.abs(gl), 6);
    // weekly rollup must add up to the same total
    near(sum(rollup(rows, "week").map((w) => w.summary.netPnl)), totalNet());
    near(sum(rollup(rows, "month").map((w) => w.summary.netPnl)), totalNet());
  });

  it("journaled days only count days with something written", async (ctx) => {
    if (!ready) return ctx.skip();
    const before = await loadJournaledDays(F());
    const day = new Date("2026-10-01T00:00:00Z");
    const blank = await db.note.create({ data: { kind: "DAILY", title: "TEST-j blank", day, content: {}, plainText: "" } });
    const full = await db.note.create({ data: { kind: "DAILY", title: "TEST-j full", day: new Date("2026-10-02T00:00:00Z"), content: {}, plainText: "worked" } });
    try {
      expect(await loadJournaledDays(F({ range: "custom", from: "2026-10-01", to: "2026-10-02" }))).toBe(1);
      expect(await loadJournaledDays(F())).toBe(before + 1);
    } finally {
      await db.note.deleteMany({ where: { id: { in: [blank.id, full.id] } } });
    }
  });
});

describe("day and time", () => {
  it("weekday and hour use the entry time in the display timezone", async (ctx) => {
    if (!ready) return ctx.skip();
    const wd = await byWeekday(F());
    expect(wd.map((w) => w.label)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    for (const dow of [1, 3, 5]) {
      const mine = trades.filter((t) => hk(t.openedAt).getDay() === dow);
      const row = wd.find((w) => w.key === String(dow))!;
      expect(row.summary.count).toBe(mine.length);
      near(row.summary.netPnl, sum(mine.map(net)));
    }
    near(sum(wd.map((w) => w.summary.netPnl)), totalNet());

    const hr = await byHour(F());
    expect(hr).toHaveLength(24);
    expect(sum(hr.map((h) => h.summary.count))).toBe(trades.length);
    for (const h of [9, 15, 22]) expect(hr.find((x) => x.key === String(h))!.summary.count).toBe(trades.filter((t) => hk(t.openedAt).getHours() === h).length);
  });

  it("sessions are by UTC hour of entry and cover every trade", async (ctx) => {
    if (!ready) return ctx.skip();
    const ses = await bySession(F());
    expect(ses.map((s) => s.key)).toEqual(["asia", "london", "newyork", "other"]);
    const inSession = (t: T, [a, b]: readonly [number, number]) => t.openedAt.getUTCHours() >= a && t.openedAt.getUTCHours() < b;
    expect(ses[1].summary.count).toBe(trades.filter((t) => inSession(t, SESSION_HOURS.london)).length);
    expect(ses[2].summary.count).toBe(trades.filter((t) => inSession(t, SESSION_HOURS.newyork)).length);
    expect(sum(ses.map((s) => s.summary.count))).toBe(trades.length);
  });

  it("heatmap cells add up to the total", async (ctx) => {
    if (!ready) return ctx.skip();
    const h = await heatmap(F());
    expect(sum(h.map((c) => c.trades))).toBe(trades.length);
    near(sum(h.map((c) => c.net)), totalNet());
    const cell = h.find((c) => c.dow === 2 && c.hour === 10);
    if (cell) expect(cell.trades).toBe(trades.filter((t) => hk(t.openedAt).getDay() === 2 && hk(t.openedAt).getHours() === 10).length);
  });
});

describe("symbols, playbooks, tags", () => {
  it("by symbol", async (ctx) => {
    if (!ready) return ctx.skip();
    const rows = await bySymbol(F());
    expect(rows.map((r) => r.label)).toEqual(["XAUUSD"]);
    expect(rows[0].summary.count).toBe(trades.length);
    near(rows[0].summary.netPnl, totalNet());
  });

  it("by playbook includes the trades without one, and they add up", async (ctx) => {
    if (!ready) return ctx.skip();
    const rows = await byStrategy(F());
    const none = rows.find((r) => r.key === "none");
    expect(none?.label).toBe("No playbook");
    expect(none?.summary.count).toBe(trades.filter((t) => !t.strategyId).length);
    expect(sum(rows.map((r) => r.summary.count))).toBe(trades.length);
    near(sum(rows.map((r) => r.summary.netPnl)), totalNet());
    const first = rows.find((r) => r.key !== "none")!;
    near(first.summary.netPnl, sum(trades.filter((t) => t.strategyId === first.key).map(net)));
    expect(rows.map((r) => r.summary.netPnl)).toEqual([...rows.map((r) => r.summary.netPnl)].sort((a, b) => b - a)); // best first
  });

  it("by tag: a trade counts once under each of its tags", async (ctx) => {
    if (!ready) return ctx.skip();
    const rows = await byTag(F());
    expect(rows.length).toBeGreaterThan(3);
    expect(sum(rows.map((r) => r.summary.count))).toBe(sum(trades.map((t) => t.tags.length)));
    const one = rows[0];
    const mine = trades.filter((t) => t.tags.some((x) => x.tagId === one.key));
    expect(one.summary.count).toBe(mine.length);
    near(one.summary.netPnl, sum(mine.map(net)));
    expect(one.category).toBeTruthy();
  });

  it("the filters narrow every breakdown", async (ctx) => {
    if (!ready) return ctx.skip();
    const shorts = trades.filter((t) => t.side === "SHORT");
    const rows = await bySymbol(F({ side: "SHORT" }));
    expect(rows[0].summary.count).toBe(shorts.length);
    near(rows[0].summary.netPnl, sum(shorts.map(net)));
  });
});

describe("risk and wins vs losses", () => {
  it("R buckets partition the trades that have a realized R", async (ctx) => {
    if (!ready) return ctx.skip();
    const r = await riskReport(F());
    const withR = trades.filter((t) => t.realizedR != null);
    expect(r.withRealizedR).toBe(withR.length);
    expect(sum(r.buckets.map((b) => b.summary.count))).toBe(withR.length);
    const inRange = (lo: number, hi: number) => withR.filter((t) => Number(t.realizedR) >= lo && Number(t.realizedR) < hi).length;
    expect(r.buckets.find((b) => b.key === "0..1")!.summary.count).toBe(inRange(0, 1));
    expect(r.buckets.find((b) => b.key === "-1..0")!.summary.count).toBe(inRange(-1, 0));
    expect(r.buckets.find((b) => b.key === "lt-2")!.summary.count).toBe(inRange(-Infinity, -2));
    expect(r.buckets.find((b) => b.key === "gt3")!.summary.count).toBe(inRange(3, Infinity));
    expect(r.withStop).toBe(trades.filter((t) => t.stopLoss != null).length);
    near(r.avgRealizedR!, sum(withR.map((t) => Number(t.realizedR))) / withR.length, 4);
    expect(r.avgWinR!).toBeGreaterThan(0);
    expect(r.avgLossR!).toBeLessThan(0);
  });

  it("winners, losers and breakevens", async (ctx) => {
    if (!ready) return ctx.skip();
    const p = await winsVsLosses(F());
    const w = trades.filter((t) => net(t) > 0);
    const l = trades.filter((t) => net(t) < 0);
    expect(p.map((x) => x.result)).toEqual(["WIN", "LOSS", "BREAKEVEN"]);
    expect(p[0].trades).toBe(w.length);
    expect(p[1].trades).toBe(l.length);
    near(p[0].totalNet, sum(w.map(net)));
    near(p[1].avgNet!, sum(l.map(net)) / l.length, 4);
    near(p[0].pctWithStop!, w.filter((t) => t.stopLoss != null).length / w.length, 6);
    near(p[1].pctWithPlaybook!, l.filter((t) => t.strategyId).length / l.length, 6);
    near(p[0].avgHoldSeconds!, sum(w.map((t) => t.holdSeconds ?? 0)) / w.length, 3);
    expect(p[2].trades).toBe(trades.length - w.length - l.length);
    expect(p[0].topHour).not.toBeNull();
  });

  it("histogram buckets contain every trade", async (ctx) => {
    if (!ready) return ctx.skip();
    const h = await pnlDistribution(F(), 16);
    expect(h).toHaveLength(16);
    expect(sum(h.map((b) => b.count))).toBe(trades.length);
    expect(h[0].from).toBeCloseTo(Math.min(...trades.map(net)), 6);
    expect(h[15].to).toBeCloseTo(Math.max(...trades.map(net)), 6);
  });

  it("histogram edge cases", () => {
    expect(histogram([], 5)).toEqual([]);
    expect(histogram([3, 3, 3], 5)).toEqual([{ from: 3, to: 3, count: 3 }]);
    expect(histogram([0, 10], 2).map((b) => b.count)).toEqual([1, 1]); // the maximum falls in the last bucket
  });
});
