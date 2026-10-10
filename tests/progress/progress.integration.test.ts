/**
 * loadProgress against the seeded demo trades, checked against independent JavaScript.
 * Skipped automatically if the database or demo data is absent.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { loadProgress } from "@/lib/queries/progress";

const now = new Date("2026-10-09T10:00:00Z"); // Friday evening in Hong Kong
let ready = false;
let stopId = "";
let capId = "";
let tradeCapId = "";
let startId = "";
let manualId = "";

beforeAll(async () => {
  try {
    ready = (await db.trade.count({ where: { status: "CLOSED" } })) > 100;
    if (!ready) return;
    await db.disciplineRule.deleteMany({ where: { name: { startsWith: "TEST-" } } });
    const mk = async (name: string, kind: "PERCENT_WITH_FIELD" | "MAX_LOSS_PER_DAY" | "MAX_LOSS_PER_TRADE" | "TIME_BY" | "MANUAL_CHECK", params: object) => (await db.disciplineRule.create({ data: { name: `TEST-${name}`, kind, params, position: 900 } })).id;
    stopId = await mk("stop", "PERCENT_WITH_FIELD", { field: "stopLoss", percent: 100 });
    capId = await mk("cap", "MAX_LOSS_PER_DAY", { amount: 100 });
    tradeCapId = await mk("tradecap", "MAX_LOSS_PER_TRADE", { amount: 50 });
    startId = await mk("start", "TIME_BY", { time: "09:30" });
    manualId = await mk("manual", "MANUAL_CHECK", {});
  } catch {
    ready = false;
  }
});
afterAll(async () => {
  await db.disciplineRule.deleteMany({ where: { name: { startsWith: "TEST-" } } });
  await db.$disconnect();
});

const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();

describe("loadProgress", () => {
  it("matches an independent calculation for the automatic rules", async (ctx) => {
    if (!ready) return ctx.skip();
    const p = await loadProgress({ period: "90d", now });
    const trades = await db.trade.findMany({ where: { status: "CLOSED", closeDay: { gte: new Date("2026-07-12T00:00:00Z"), lte: new Date("2026-10-09T00:00:00Z") } } });
    const byDay = new Map<string, typeof trades>();
    for (const t of trades) byDay.set(t.closeDay!.toISOString().slice(0, 10), [...(byDay.get(t.closeDay!.toISOString().slice(0, 10)) ?? []), t]);
    const days = [...byDay.entries()].filter(([d]) => weekday(d) >= 1 && weekday(d) <= 5);

    const row = (id: string) => p.rows.find((r) => r.rule.id === id)!;
    const stopFollowed = days.filter(([, ts]) => ts.every((t) => t.stopLoss != null)).length;
    expect(row(stopId).summary).toMatchObject({ applicable: days.length, followed: stopFollowed });
    const capFollowed = days.filter(([, ts]) => ts.reduce((s, t) => s + Number(t.netPnl), 0) >= -100).length;
    expect(row(capId).summary).toMatchObject({ applicable: days.length, followed: capFollowed });
    const tcFollowed = days.filter(([, ts]) => ts.every((t) => Number(t.netPnl) >= -50)).length;
    expect(row(tradeCapId).summary).toMatchObject({ applicable: days.length, followed: tcFollowed });
  });

  it("habit rules do not mark history as missed before they were first used", async (ctx) => {
    if (!ready) return ctx.skip();
    const p = await loadProgress({ period: "30d", now });
    const start = p.rows.find((r) => r.rule.id === startId)!;
    // nothing was ever started in the demo data, so the rule has not begun to count: history is not marked as missed
    expect(start.summary).toMatchObject({ followed: 0, applicable: 1 }); // only today (Fri, past 09:30 in Hong Kong, never started)
    expect(p.heat.find((h) => h.day === "2026-10-07")!.total).toBeLessThan(p.rows.length); // the habit rules do not judge that day
    expect(start.summary.currentStreak).toBe(0);
    expect(p.rows.find((r) => r.rule.id === manualId)!.focus).toBeNull(); // today (Fri 9 Oct, 18:00) not ticked yet
  });

  it("a manual tick and a started day change the result", async (ctx) => {
    if (!ready) return ctx.skip();
    await db.disciplineLog.create({ data: { ruleId: manualId, day: new Date("2026-10-09T00:00:00Z"), followed: true, auto: false } });
    await db.note.create({ data: { kind: "DAILY", title: "TEST-start", day: new Date("2026-10-08T00:00:00Z"), content: {}, plainText: "x", startedAt: new Date("2026-10-08T00:45:00Z") } }); // 08:45 in Hong Kong
    try {
      const p = await loadProgress({ period: "30d", now });
      expect(p.rows.find((r) => r.rule.id === manualId)!.focus).toBe(true);
      expect(p.rows.find((r) => r.rule.id === manualId)!.focusManual).toBe(true);
      const start = p.rows.find((r) => r.rule.id === startId)!;
      expect(start.summary).toMatchObject({ followed: 1, broken: 1, applicable: 2 }); // counts from Thu 8 Oct: Thu on time, Fri (today, past 09:30) never started
      const man = p.rows.find((r) => r.rule.id === manualId)!;
      expect(man.summary).toMatchObject({ followed: 1, applicable: 1 }); // counts from the day of the first tick
      const thu = p.heat.find((h) => h.day === "2026-10-08")!;
      expect(thu.total).toBeGreaterThan(0);
    } finally {
      await db.disciplineLog.deleteMany({ where: { ruleId: manualId } });
      await db.note.deleteMany({ where: { title: "TEST-start" } });
    }
  });

  it("the heatmap spans a year to today and never evaluates the weekend", async (ctx) => {
    if (!ready) return ctx.skip();
    const p = await loadProgress({ now: new Date("2026-10-11T04:00:00Z") }); // Sunday in Hong Kong
    expect(p.heat.length).toBe(365);
    expect(p.heat.at(-1)!.day).toBe("2026-10-11");
    expect(p.heat.at(-1)).toMatchObject({ trading: false, total: 0, level: 0 });
    expect(p.period.key).toBe("30d");
  });

  it("an unknown period or day falls back safely", async (ctx) => {
    if (!ready) return ctx.skip();
    const p = await loadProgress({ period: "drop table", day: "2099-01-01", now });
    expect(p.period.key).toBe("30d");
    expect(p.focusDay).toBe("2026-10-09");
    const q = await loadProgress({ day: "2026-10-01", now });
    expect(q.focusDay).toBe("2026-10-01");
  });

  it("inactive rules are listed but not evaluated", async (ctx) => {
    if (!ready) return ctx.skip();
    await db.disciplineRule.update({ where: { id: capId }, data: { active: false } });
    try {
      const p = await loadProgress({ now });
      expect(p.rows.some((r) => r.rule.id === capId)).toBe(false);
      expect(p.inactive.some((r) => r.id === capId)).toBe(true);
    } finally {
      await db.disciplineRule.update({ where: { id: capId }, data: { active: true } });
    }
  });
});
