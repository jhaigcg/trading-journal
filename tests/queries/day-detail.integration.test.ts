/**
 * The calendar day pop-up must agree with the calendar cell it was opened from and with the trades themselves.
 * Runs against the seeded demo account; skipped if it is absent.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { parseFilters } from "@/lib/filters/params";
import { loadCalendarMonth } from "@/lib/queries/dashboard";
import { loadDayDetail } from "@/lib/queries/day-detail";

let accountId = "";
let ready = false;
let day = "";
const F = (extra: Record<string, string> = {}) => parseFilters({ account: accountId, range: "all", ...extra });

beforeAll(async () => {
  try {
    const acc = await db.account.findFirst({ where: { name: { startsWith: "MT4 · Main account (demo data)" } } });
    if (!acc) return;
    accountId = acc.id;
    const last = await db.trade.findFirst({ where: { accountId, status: "CLOSED", closeDay: { not: null } }, orderBy: { closeDay: "desc" } });
    if (!last) return;
    day = last.closeDay!.toISOString().slice(0, 10);
    ready = true;
  } catch {
    ready = false;
  }
});
afterAll(async () => {
  await db.$disconnect();
});

describe("loadDayDetail", () => {
  it("matches the trades of that day and the calendar cell", async (ctx) => {
    if (!ready) return ctx.skip();
    const d = (await loadDayDetail(day, F()))!;
    const trades = await db.trade.findMany({ where: { accountId, status: "CLOSED", closeDay: new Date(`${day}T00:00:00Z`) }, orderBy: { closedAt: "asc" } });
    expect(d.trades.length).toBe(trades.length);
    expect(d.summary.count).toBe(trades.length);
    const net = trades.reduce((s, t) => s + Number(t.netPnl), 0);
    expect(d.summary.netPnl).toBeCloseTo(net, 1);
    expect(d.summary.wins).toBe(trades.filter((t) => Number(t.netPnl) > 0).length);
    expect(d.summary.losses).toBe(trades.filter((t) => Number(t.netPnl) < 0).length);

    // the running line ends on the day's net, one point per trade, in closing order
    expect(d.running.length).toBe(trades.length);
    expect(d.running.at(-1)!.value).toBeCloseTo(net, 1);

    // newest open time first, as in the table the user sees
    const opens = d.trades.map((t) => t.openedAt);
    expect([...opens].sort().reverse()).toEqual(opens);

    // the calendar cell for the same day shows the same totals
    const cell = (await loadCalendarMonth(F(), day.slice(0, 7))).find((b) => b.day === day)!;
    expect(d.summary.count).toBe(cell.trades);
    expect(d.summary.netPnl).toBeCloseTo(cell.netPnl, 1);
  });

  it("follows the active filters", async (ctx) => {
    if (!ready) return ctx.skip();
    const all = (await loadDayDetail(day, F()))!;
    const longs = await loadDayDetail(day, F({ side: "LONG" }));
    expect(longs!.trades.every((t) => t.side === "LONG")).toBe(true);
    expect(longs!.trades.length).toBeLessThanOrEqual(all.trades.length);
    const cell = (await loadCalendarMonth(F({ side: "LONG" }), day.slice(0, 7))).find((b) => b.day === day);
    expect(longs!.summary.count).toBe(cell?.trades ?? 0);
  });

  it("days without trades, bad dates and injection attempts return nothing", async (ctx) => {
    if (!ready) return ctx.skip();
    expect(await loadDayDetail("2020-01-01", F())).toBeNull();
    expect(await loadDayDetail("not-a-day", F())).toBeNull();
    expect(await loadDayDetail("2026-02-30", F())).toBeNull();
    expect(await loadDayDetail("2026-10-08'; drop table \"Trade\";--", F())).toBeNull();
  });
});
