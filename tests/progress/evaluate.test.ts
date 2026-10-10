import { describe, expect, it } from "vitest";
import { dayScore, describeRule, eachDay, emptyFacts, evaluate, level, parseTime, perfectStreak, summarizeRule, tradingDaysIn, type DayFacts, type RuleLike } from "@/lib/progress/evaluate";

const rule = (kind: RuleLike["kind"], params: RuleLike["params"]): RuleLike => ({ id: "r", name: "x", kind, params });
const facts = (p: Partial<DayFacts>): DayFacts => ({ ...emptyFacts(), ...p });
const past = { isToday: false, nowMinute: 0 };

describe("TIME_BY", () => {
  const r = rule("TIME_BY", { time: "09:30" });
  it("followed when started by the deadline, inclusive", () => {
    expect(evaluate(r, facts({ startedMinute: 9 * 60 + 30 }), past)).toBe(true);
    expect(evaluate(r, facts({ startedMinute: 9 * 60 + 31 }), past)).toBe(false);
    expect(evaluate(r, facts({ startedMinute: 0 }), past)).toBe(true);
  });
  it("a past day without a start is broken", () => {
    expect(evaluate(r, undefined, past)).toBe(false);
  });
  it("today is pending until the deadline passes", () => {
    expect(evaluate(r, undefined, { isToday: true, nowMinute: 9 * 60 })).toBeNull();
    expect(evaluate(r, undefined, { isToday: true, nowMinute: 9 * 60 + 30 })).toBeNull();
    expect(evaluate(r, undefined, { isToday: true, nowMinute: 9 * 60 + 31 })).toBe(false);
  });
  it("a bad time does not apply", () => {
    expect(evaluate(rule("TIME_BY", { time: "25:99" }), undefined, past)).toBeNull();
    expect(parseTime("9:05")).toBe(545);
    expect(parseTime("nope")).toBeNull();
  });
});

describe("PERCENT_WITH_FIELD", () => {
  const stop = rule("PERCENT_WITH_FIELD", { field: "stopLoss", percent: 100 });
  it("does not apply without trades", () => {
    expect(evaluate(stop, facts({}), past)).toBeNull();
  });
  it("100% means every trade", () => {
    expect(evaluate(stop, facts({ trades: 4, withStopLoss: 4 }), past)).toBe(true);
    expect(evaluate(stop, facts({ trades: 4, withStopLoss: 3 }), past)).toBe(false);
  });
  it("a lower target allows some misses", () => {
    const r = rule("PERCENT_WITH_FIELD", { field: "strategyId", percent: 75 });
    expect(evaluate(r, facts({ trades: 4, withStrategy: 3 }), past)).toBe(true);
    expect(evaluate(r, facts({ trades: 4, withStrategy: 2 }), past)).toBe(false);
  });
  it("covers each field and ignores unknown ones", () => {
    expect(evaluate(rule("PERCENT_WITH_FIELD", { field: "profitTarget" }), facts({ trades: 2, withProfitTarget: 2 }), past)).toBe(true);
    expect(evaluate(rule("PERCENT_WITH_FIELD", { field: "reviewed" }), facts({ trades: 2, reviewed: 1 }), past)).toBe(false);
    expect(evaluate(rule("PERCENT_WITH_FIELD", { field: "bogus" }), facts({ trades: 2 }), past)).toBeNull();
  });
});

describe("loss limits", () => {
  it("per trade: the worst single trade must stay within the limit (boundary is allowed)", () => {
    const r = rule("MAX_LOSS_PER_TRADE", { amount: 100 });
    expect(evaluate(r, facts({ trades: 3, worstTradeNet: -100 }), past)).toBe(true);
    expect(evaluate(r, facts({ trades: 3, worstTradeNet: -100.01 }), past)).toBe(false);
    expect(evaluate(r, facts({ trades: 3, worstTradeNet: 40 }), past)).toBe(true);
    expect(evaluate(r, facts({}), past)).toBeNull();
  });
  it("per day: the day's net, not individual trades", () => {
    const r = rule("MAX_LOSS_PER_DAY", { amount: 100 });
    expect(evaluate(r, facts({ trades: 5, dayNet: -99.99 }), past)).toBe(true);
    expect(evaluate(r, facts({ trades: 5, dayNet: -250 }), past)).toBe(false);
    expect(evaluate(r, facts({ trades: 5, dayNet: 500 }), past)).toBe(true);
    expect(evaluate(r, facts({}), past)).toBeNull();
  });
});

describe("MANUAL_CHECK", () => {
  const r = rule("MANUAL_CHECK", {});
  it("uses the tick; unticked past days are broken, unticked today is pending", () => {
    expect(evaluate(r, undefined, { ...past, manual: true })).toBe(true);
    expect(evaluate(r, undefined, { ...past, manual: false })).toBe(false);
    expect(evaluate(r, undefined, past)).toBe(false);
    expect(evaluate(r, undefined, { isToday: true, nowMinute: 600 })).toBeNull();
  });
});

describe("summarizeRule", () => {
  const days = ["d1", "d2", "d3", "d4", "d5", "d6", "d7"].map((day, i) => ({ day, verdict: ([true, true, false, null, true, true, true] as const)[i] }));
  const net = (d: string) => ({ d1: 100, d2: 50, d3: -200, d4: null, d5: 10, d6: 20, d7: 30 })[d as "d1"] ?? null;
  const s = summarizeRule(days, net);

  it("counts followed, broken and the rate, ignoring days that did not apply", () => {
    expect(s).toMatchObject({ followed: 5, broken: 1, applicable: 6 });
    expect(s.rate).toBeCloseTo(5 / 6);
  });
  it("current streak skips non-applicable days and stops at a break; best streak is the longest run", () => {
    expect(s.currentStreak).toBe(3);
    expect(s.bestStreak).toBe(3);
  });
  it("compares results on followed against broken days", () => {
    expect(s.avgNetFollowed).toBeCloseTo((100 + 50 + 10 + 20 + 30) / 5);
    expect(s.avgNetBroken).toBe(-200);
  });
  it("nothing applicable gives nulls and zeros", () => {
    expect(summarizeRule([{ day: "a", verdict: null }], () => 0)).toMatchObject({ applicable: 0, rate: null, currentStreak: 0, bestStreak: 0, avgNetFollowed: null, avgNetBroken: null });
    expect(summarizeRule([], () => 0).rate).toBeNull();
  });
  it("a streak that ends on a break is zero", () => {
    expect(summarizeRule([{ day: "a", verdict: true }, { day: "b", verdict: false }], () => 0).currentStreak).toBe(0);
  });
});

describe("scores and levels", () => {
  it("day score is the share of applicable rules followed", () => {
    expect(dayScore([true, false, null, true])).toEqual({ followed: 2, total: 3, score: 2 / 3 });
    expect(dayScore([null]).score).toBeNull();
  });
  it("levels", () => {
    expect([null, 0.2, 0.5, 0.75, 1].map(level)).toEqual([0, 1, 2, 3, 4]);
  });
  it("perfect streak counts back over decided days", () => {
    expect(perfectStreak([{ day: "a", score: 1 }, { day: "b", score: 0.5 }, { day: "c", score: 1 }, { day: "d", score: null }, { day: "e", score: 1 }])).toBe(2);
    expect(perfectStreak([])).toBe(0);
  });
});

describe("calendar helpers", () => {
  it("lists days across month and year ends", () => {
    expect(eachDay("2026-12-30", "2027-01-02")).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  });
  it("keeps only configured weekdays (0 = Sunday)", () => {
    expect(tradingDaysIn("2026-10-05", "2026-10-11", [1, 2, 3, 4, 5])).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]);
    expect(tradingDaysIn("2026-10-05", "2026-10-11", [0, 6])).toEqual(["2026-10-10", "2026-10-11"]);
  });
  it("describes rules in words", () => {
    expect(describeRule(rule("TIME_BY", { time: "09:30" }))).toBe('Press "Start my day" by 09:30');
    expect(describeRule(rule("PERCENT_WITH_FIELD", { field: "stopLoss", percent: 100 }))).toBe("Every trade has a stop loss");
    expect(describeRule(rule("PERCENT_WITH_FIELD", { field: "strategyId", percent: 80 }))).toBe("At least 80% of trades have a playbook");
    expect(describeRule(rule("MAX_LOSS_PER_DAY", { amount: 100 }))).toContain("A$100");
  });
});
