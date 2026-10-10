import { describe, expect, it } from "vitest";
import { buildProgress, type BuildInput } from "@/lib/progress/build";
import { emptyFacts, type DayFacts, type RuleLike } from "@/lib/progress/evaluate";

const stop: RuleLike = { id: "stop", name: "Stop loss", kind: "PERCENT_WITH_FIELD", params: { field: "stopLoss", percent: 100 } };
const daily: RuleLike = { id: "cap", name: "Daily cap", kind: "MAX_LOSS_PER_DAY", params: { amount: 100 } };
const tick: RuleLike = { id: "tick", name: "Plan reviewed", kind: "MANUAL_CHECK", params: {} };
const f = (p: Partial<DayFacts>): DayFacts => ({ ...emptyFacts(), ...p });

// Mon 5 Oct … Fri 9 Oct 2026, today is Fri 9 Oct (weekend 10/11 not reached)
const base = (over: Partial<BuildInput> = {}): BuildInput => ({
  rules: [stop, daily],
  facts: new Map([
    ["2026-10-05", f({ trades: 2, withStopLoss: 2, dayNet: 50 })],
    ["2026-10-06", f({ trades: 2, withStopLoss: 1, dayNet: -30 })],
    ["2026-10-07", f({ trades: 3, withStopLoss: 3, dayNet: -250 })],
    ["2026-10-08", f({})],
    ["2026-10-09", f({ trades: 1, withStopLoss: 1, dayNet: 10 })],
  ]),
  manual: new Map(),
  tradingWeekdays: [1, 2, 3, 4, 5],
  today: "2026-10-09",
  nowMinute: 600,
  windowFrom: "2026-10-05",
  periodFrom: "2026-10-05",
  focusDay: "2026-10-09",
  ...over,
});

describe("buildProgress", () => {
  const p = buildProgress(base());
  const row = (id: string) => p.rows.find((r) => r.rule.id === id)!;

  it("evaluates each rule per trading day, skipping days that do not apply", () => {
    expect(row("stop").summary).toMatchObject({ followed: 3, broken: 1, applicable: 4, currentStreak: 2, bestStreak: 2 });
    expect(row("cap").summary).toMatchObject({ followed: 3, broken: 1, applicable: 4 });
  });

  it("heatmap days carry score and level; empty days have level 0", () => {
    const h = Object.fromEntries(p.heat.map((d) => [d.day, d]));
    expect(h["2026-10-05"]).toMatchObject({ followed: 2, total: 2, score: 1, level: 4 });
    expect(h["2026-10-06"]).toMatchObject({ followed: 1, total: 2, score: 0.5, level: 2 });
    expect(h["2026-10-07"]).toMatchObject({ followed: 1, total: 2, level: 2 });
    expect(h["2026-10-08"]).toMatchObject({ total: 0, score: null, level: 0 });
  });

  it("period score, perfect days and streak", () => {
    expect(p.period.followed).toBe(6);
    expect(p.period.total).toBe(8);
    expect(p.period.score).toBeCloseTo(0.75);
    expect(p.period.tradingDays).toBe(5);
    expect(p.period.perfectDays).toBe(2); // Mon and Fri
    expect(p.period.streak).toBe(1); // Fri; Thu had nothing to judge and is skipped, Wed was not perfect
  });

  it("the focus day panel", () => {
    expect(p.focusProgress).toEqual({ followed: 2, total: 2, pending: 0 });
    expect(p.focusIsTrading).toBe(true);
  });

  it("average result on followed versus broken days", () => {
    expect(row("cap").summary.avgNetFollowed).toBeCloseTo((50 - 30 + 10) / 3);
    expect(row("cap").summary.avgNetBroken).toBe(-250);
  });

  it("weekends and future days are never evaluated", () => {
    const w = buildProgress(base({ today: "2026-10-11", focusDay: "2026-10-11" }));
    expect(w.heat.find((d) => d.day === "2026-10-10")).toMatchObject({ trading: false, total: 0 });
    expect(w.focusIsTrading).toBe(false);
    expect(w.heat.at(-1)!.day).toBe("2026-10-11");
  });

  it("manual rules follow the ticks; today stays pending until ticked", () => {
    const manual = new Map([["tick", new Map([["2026-10-05", true], ["2026-10-06", false]])]]);
    const m = buildProgress(base({ rules: [tick], manual }));
    const r = m.rows[0];
    expect(r.summary).toMatchObject({ followed: 1, broken: 3, applicable: 4 }); // Tue ticked off, Wed/Thu never ticked = broken; today pending
    expect(r.focus).toBeNull();
    expect(m.focusProgress).toEqual({ followed: 0, total: 0, pending: 1 });
    const ticked = buildProgress(base({ rules: [tick], manual: new Map([["tick", new Map([["2026-10-09", true]])]]) }));
    expect(ticked.rows[0].focus).toBe(true);
    expect(ticked.rows[0].focusManual).toBe(true);
  });

  it("the period only counts days from periodFrom, while the heatmap keeps the whole window", () => {
    const short = buildProgress(base({ periodFrom: "2026-10-08" }));
    expect(short.heat.length).toBe(5);
    expect(short.period.tradingDays).toBe(2);
    expect(short.period.total).toBe(2);
  });

  it("start-my-day rule uses the recorded minute", () => {
    const start: RuleLike = { id: "s", name: "Start", kind: "TIME_BY", params: { time: "09:30" } };
    const facts = new Map([["2026-10-05", f({ startedMinute: 9 * 60 })], ["2026-10-06", f({ startedMinute: 11 * 60 })]]);
    const r = buildProgress(base({ rules: [start], facts, nowMinute: 8 * 60 }));
    expect(r.rows[0].summary).toMatchObject({ followed: 1, broken: 3, applicable: 4 }); // Mon ok, Tue late, Wed/Thu never started; today pending
    expect(r.rows[0].focus).toBeNull();
  });

  it("habit rules only count from the day they were first used; automatic rules still judge all of history", () => {
    const start: RuleLike = { id: "s", name: "Start", kind: "TIME_BY", params: { time: "09:30" } };
    const facts = new Map([["2026-10-07", f({ trades: 3, withStopLoss: 3, dayNet: -250, startedMinute: 9 * 60 })]]);
    const activeFrom = new Map([["s", "2026-10-07"]]);
    const r = buildProgress(base({ rules: [start, stop], facts: new Map([...base().facts, ...facts]), activeFrom, nowMinute: 8 * 60 }));
    expect(r.rows[0].summary).toMatchObject({ followed: 1, broken: 1, applicable: 2 }); // Wed on time, Thu never started; Fri (today) pending
    expect(r.rows[1].summary.applicable).toBe(4);
    const mon = r.heat.find((h) => h.day === "2026-10-05")!;
    expect(mon.total).toBe(1); // only the stop-loss rule
  });

  it("a habit rule with no history yet only shows today, pending", () => {
    const m = buildProgress(base({ rules: [tick], activeFrom: new Map() }));
    expect(m.rows[0].summary.applicable).toBe(0);
    expect(m.rows[0].focus).toBeNull();
  });
});
