import { describe, expect, it } from "vitest";
import {
  classify,
  consistency,
  cumulative,
  dailyBuckets,
  drawdown,
  holdSeconds,
  performanceScore,
  pips,
  plannedR,
  realizedR,
  recoveryFactor,
  riskAmount,
  summarize,
  summarizeDays,
  type TradeInput,
} from "@/lib/metrics";

const t = (netPnl: number, day = "2026-10-01", extra: Partial<TradeInput> = {}): TradeInput => ({ netPnl, day, ...extra });

describe("classify", () => {
  it("uses the breakeven threshold", () => {
    expect(classify(5)).toBe("WIN");
    expect(classify(-5)).toBe("LOSS");
    expect(classify(0)).toBe("BE");
    expect(classify(3, 5)).toBe("BE");
    expect(classify(-5, 5)).toBe("BE");
    expect(classify(5.01, 5)).toBe("WIN");
  });
});

describe("summarize", () => {
  const trades = [t(100), t(200), t(-50), t(-100), t(0)];
  const s = summarize(trades);

  it("counts results", () => {
    expect(s).toMatchObject({ count: 5, wins: 2, losses: 2, breakevens: 1 });
  });
  it("win % excludes breakevens", () => {
    expect(s.winRate).toBeCloseTo(0.5);
  });
  it("profit factor = Σ wins / |Σ losses|", () => {
    expect(s.profitFactor).toBeCloseTo(300 / 150);
  });
  it("avg win / loss and ratio", () => {
    expect(s.avgWin).toBe(150);
    expect(s.avgLoss).toBe(-75);
    expect(s.avgWinLossRatio).toBeCloseTo(2);
  });
  it("expectancy = win% × avg win − loss% × |avg loss|", () => {
    expect(s.expectancy).toBeCloseTo(0.5 * 150 - 0.5 * 75);
  });
  it("net P&L and average", () => {
    expect(s.netPnl).toBe(150);
    expect(s.avgNetPerTrade).toBe(30);
  });
  it("profit factor is null with no losses; empty set is safe", () => {
    expect(summarize([t(10)]).profitFactor).toBeNull();
    const e = summarize([]);
    expect(e.count).toBe(0);
    expect(e.winRate).toBe(0);
    expect(e.expectancy).toBe(0);
  });
  it("fees are reported as a positive cost; hold time and volume average/sum", () => {
    const s2 = summarize([
      t(10, "d", { grossPnl: 12, commission: -1.5, swap: -0.5, holdSeconds: 60, quantity: 0.1 }),
      t(-5, "d", { grossPnl: -3, commission: -1.5, swap: -0.5, holdSeconds: 120, quantity: 0.2 }),
    ]);
    expect(s2.fees).toBe(4);
    expect(s2.grossPnl).toBe(9);
    expect(s2.avgHoldSeconds).toBe(90);
    expect(s2.volume).toBeCloseTo(0.3);
  });
  it("respects the breakeven threshold", () => {
    expect(summarize([t(3), t(-3), t(50)], 5)).toMatchObject({ wins: 1, losses: 0, breakevens: 2 });
  });
  it("averages R multiples that exist", () => {
    const s3 = summarize([t(1, "d", { plannedR: 2, realizedR: 1 }), t(1, "d", { plannedR: 4 }), t(1)]);
    expect(s3.avgPlannedR).toBe(3);
    expect(s3.avgRealizedR).toBe(1);
  });
});

describe("daily buckets", () => {
  const trades = [t(100, "2026-10-02"), t(-30, "2026-10-01"), t(-20, "2026-10-01"), t(0, "2026-10-03")];
  const days = dailyBuckets(trades);

  it("groups and sorts by day", () => {
    expect(days.map((d) => d.day)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(days[0]).toMatchObject({ trades: 2, netPnl: -50 });
  });
  it("day win % uses daily net buckets", () => {
    const ds = summarizeDays(days);
    expect(ds).toMatchObject({ days: 3, green: 1, red: 1, flat: 1 });
    expect(ds.dayWinRate).toBeCloseTo(0.5);
    expect(ds.bestDay).toBe(100);
    expect(ds.worstDay).toBe(-50);
  });
});

describe("equity & drawdown", () => {
  it("cumulative", () => {
    expect(cumulative([100, -40, 10], 1000)).toEqual([1100, 1060, 1070]);
  });
  it("drawdown is measured from the running peak", () => {
    const dd = drawdown([1100, 1050, 1200, 1000, 1300], 1000);
    expect(dd.series).toEqual([0, -50, 0, -200, 0]);
    expect(dd.max).toBe(-200);
    expect(dd.avg).toBe(-50);
  });
  it("a first-day loss counts when seeded with the starting value", () => {
    expect(drawdown([950], 1000).max).toBe(-50);
  });
  it("no drawdown", () => {
    expect(drawdown([1, 2, 3], 0).max).toBe(0);
    expect(drawdown([]).max).toBe(0);
  });
  it("recovery factor", () => {
    expect(recoveryFactor(500, -200)).toBe(2.5);
    expect(recoveryFactor(500, 0)).toBeNull();
  });
});

describe("consistency", () => {
  it("is 1 − best day ÷ net profit", () => {
    const days = dailyBuckets([t(100, "a"), t(100, "b"), t(100, "c"), t(100, "d")]);
    expect(consistency(days)).toBeCloseTo(0.75);
  });
  it("is 0 when not profitable", () => {
    expect(consistency(dailyBuckets([t(-10, "a"), t(5, "b")]))).toBe(0);
  });
});

describe("performance score", () => {
  it("scales components to 0–100 and averages them", () => {
    const trades = [t(200, "a"), t(100, "b"), t(-100, "c"), t(100, "d"), t(-50, "e")];
    const summary = summarize(trades);
    const days = dailyBuckets(trades);
    const dd = drawdown(cumulative(days.map((d) => d.netPnl), 10000), 10000);
    const res = performanceScore({ summary, days, maxDrawdown: dd.max, startingBalance: 10000 });

    const byKey = Object.fromEntries(res.components.map((c) => [c.key, c.value]));
    expect(byKey.winPct).toBe(60);
    expect(byKey.profitFactor).toBe(100); // 2.67 ÷ 2.5, capped
    expect(byKey.avgWinLoss).toBe(Math.round(((400 / 3) / 75 / 2) * 100));
    expect(byKey.maxDrawdown).toBe(Math.round((1 - 0.01 / 0.2) * 100)); // max drawdown 100 on 10k
    expect(res.score).toBe(Math.round(res.components.reduce((a, c) => a + c.value, 0) / 6));
  });
  it("is 0..100 for degenerate input", () => {
    const res = performanceScore({ summary: summarize([]), days: [], maxDrawdown: 0, startingBalance: 0 });
    expect(res.score).toBeGreaterThanOrEqual(0);
    expect(res.score).toBeLessThanOrEqual(100);
  });
});

describe("pips", () => {
  it("XAUUSD defaults to 0.01 per pip", () => {
    expect(pips(2000, 2001.5, "LONG")).toBe(150);
    expect(pips(2000, 1998, "SHORT")).toBe(200);
    expect(pips(2000, 2001, "SHORT")).toBe(-100);
  });
  it("configurable pip size", () => {
    expect(pips(1.1, 1.1025, "LONG", 0.0001)).toBe(25);
  });
});

describe("R multiples", () => {
  it("planned R long and short", () => {
    expect(plannedR(100, 95, 110)).toBe(2);
    expect(plannedR(100, 105, 90)).toBe(2);
  });
  it("planned R null when undefined", () => {
    expect(plannedR(100, null, 110)).toBeNull();
    expect(plannedR(100, 100, 110)).toBeNull();
    expect(plannedR(100, 95, undefined)).toBeNull();
  });
  it("risk amount: gold 0.10 lot, $5 stop, contract 100 oz", () => {
    expect(riskAmount({ entry: 2000, stop: 1995, lots: 0.1, contractSize: 100 })).toBe(50);
    expect(riskAmount({ entry: 2000, stop: 1995, lots: 0.1, contractSize: 100, fxToAccount: 1.5 })).toBe(75);
    expect(riskAmount({ entry: 2000, stop: null, lots: 1, contractSize: 100 })).toBeNull();
  });
  it("realized R", () => {
    expect(realizedR(100, 50)).toBe(2);
    expect(realizedR(-25, 50)).toBe(-0.5);
    expect(realizedR(10, 0)).toBeNull();
  });
});

describe("holdSeconds", () => {
  it("computes and handles open trades", () => {
    expect(holdSeconds(new Date("2026-10-01T00:00:00Z"), new Date("2026-10-01T00:05:30Z"))).toBe(330);
    expect(holdSeconds(new Date(), null)).toBeNull();
  });
});
