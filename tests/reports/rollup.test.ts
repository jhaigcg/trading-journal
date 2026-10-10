import { describe, expect, it } from "vitest";
import type { Aggregates } from "@/lib/metrics";
import { CUMULATIVE_KEY, METRICS, addAgg, buildSeries, emptyAgg, formatValue, periodKey, rollup, summaryRows, weekStart, type DayRow } from "@/lib/reports/rollup";

const agg = (p: Partial<Aggregates>): Aggregates => ({ ...emptyAgg(), ...p });

// Mon 5 Oct: +100 +50 -30 · Tue 6 Oct: -80 -20 · Mon 12 Oct: +40
const rows: DayRow[] = [
  { day: "2026-10-12", agg: agg({ count: 1, wins: 1, netPnl: 40, grossPnl: 40, grossWin: 40, volume: 0.1, holdSum: 60, holdCount: 1 }) },
  { day: "2026-10-05", agg: agg({ count: 3, wins: 2, losses: 1, netPnl: 120, grossPnl: 120, grossWin: 150, grossLoss: -30, volume: 0.3, holdSum: 180, holdCount: 3, plannedSum: 4, plannedCount: 2, realizedSum: 1.5, realizedCount: 3 }) },
  { day: "2026-10-06", agg: agg({ count: 2, losses: 2, netPnl: -100, grossPnl: -100, grossLoss: -100, volume: 0.2, holdSum: 120, holdCount: 2 }) },
];

describe("period keys", () => {
  it("weeks start on Monday, including Sundays", () => {
    expect(weekStart("2026-10-05")).toBe("2026-10-05");
    expect(weekStart("2026-10-07")).toBe("2026-10-05");
    expect(weekStart("2026-10-11")).toBe("2026-10-05"); // Sunday belongs to the week that began on Monday 5th
    expect(weekStart("2026-10-12")).toBe("2026-10-12");
    expect(weekStart("2026-01-01")).toBe("2025-12-29"); // across a year boundary
  });
  it("granularities", () => {
    expect(periodKey("2026-10-07", "day")).toBe("2026-10-07");
    expect(periodKey("2026-10-07", "week")).toBe("2026-10-05");
    expect(periodKey("2026-10-07", "month")).toBe("2026-10");
  });
});

describe("rollup", () => {
  it("adds aggregates field by field", () => {
    const s = addAgg(agg({ count: 1, netPnl: 5.5 }), agg({ count: 2, netPnl: -1.5, wins: 1 }));
    expect(s).toMatchObject({ count: 3, netPnl: 4, wins: 1 });
  });

  it("weekly periods combine their days; metrics derive from the combined totals", () => {
    const weeks = rollup(rows, "week");
    expect(weeks.map((w) => w.key)).toEqual(["2026-10-05", "2026-10-12"]);
    const w1 = weeks[0];
    expect(w1.days).toBe(2);
    expect(w1.dayNets).toEqual([120, -100]);
    expect(w1.summary).toMatchObject({ count: 5, wins: 2, losses: 3, netPnl: 20 });
    expect(w1.summary.profitFactor).toBeCloseTo(150 / 130, 9);
    expect(w1.green).toBe(1);
    expect(w1.red).toBe(1);
    expect(w1.maxDrawdown).toBe(-100); // 120 peak, then 20
  });

  it("monthly and daily", () => {
    expect(rollup(rows, "month")).toHaveLength(1);
    expect(rollup(rows, "month")[0].summary.netPnl).toBe(60);
    expect(rollup(rows, "day").map((d) => d.key)).toEqual(["2026-10-05", "2026-10-06", "2026-10-12"]);
  });

  it("empty input is safe", () => {
    expect(rollup([], "week")).toEqual([]);
    expect(buildSeries([], ["net"], "week")).toEqual({ labels: [], series: [{ key: "net", label: "Net P&L", unit: "money", chart: "bar", values: [] }] });
  });
});

describe("series for the charts", () => {
  it("per-period values and a running total", () => {
    const r = buildSeries(rows, ["net", CUMULATIVE_KEY, "trades", "winRate", "dayWinRate"], "week");
    expect(r.labels).toEqual(["2026-10-05", "2026-10-12"]);
    const by = Object.fromEntries(r.series.map((s) => [s.key, s.values]));
    expect(by.net).toEqual([20, 40]);
    expect(by[CUMULATIVE_KEY]).toEqual([20, 60]);
    expect(by.trades).toEqual([5, 1]);
    expect(by.winRate[0]).toBeCloseTo((2 / 5) * 100, 9);
    expect(by.winRate[1]).toBeCloseTo(100, 9);
    expect(by.dayWinRate).toEqual([50, 100]);
  });

  it("metrics without data are null, not zero", () => {
    const r = buildSeries([{ day: "2026-10-06", agg: agg({ count: 2, losses: 2, netPnl: -100, grossLoss: -100 }) }], ["winRate", "avgWin", "profitFactor", "avgPlannedR", "avgHold"], "day");
    const by = Object.fromEntries(r.series.map((s) => [s.key, s.values[0]]));
    expect(by.winRate).toBe(0); // 0 wins of 2 decided trades is a real 0%
    expect(by.avgWin).toBeNull();
    expect(by.profitFactor).toBe(0);
    expect(by.avgPlannedR).toBeNull();
    expect(by.avgHold).toBeNull();
  });

  it("every registered metric can be computed", () => {
    const [p] = rollup(rows, "month");
    for (const m of METRICS) expect(() => m.value(p)).not.toThrow();
    expect(new Set(METRICS.map((m) => m.key)).size).toBe(METRICS.length);
  });

  it("ignores unknown metric keys", () => {
    expect(buildSeries(rows, ["nope", "net"], "day").series.map((s) => s.key)).toEqual(["net"]);
  });
});

describe("summary table", () => {
  const get = (journaled = 2) => Object.fromEntries(summaryRows(rows, 0, journaled).map((r) => [r.key, r]));

  it("matches hand-worked numbers", () => {
    const s = get();
    expect(s.net.value).toBe(60);
    expect(s.winRate.value).toBeCloseTo(50, 9); // 3 wins, 3 losses
    expect(s.winRate.note).toBe("3 W · 0 BE · 3 L");
    expect(s.dayWinRate.value).toBeCloseTo((2 / 3) * 100, 9);
    expect(s.dayWinRate.note).toBe("2 W · 0 BE · 1 L days");
    expect(s.profitFactor.value).toBeCloseTo(190 / 130, 9);
    expect(s.avgDailyWinLoss.value).toBeCloseTo(80 / 100, 9); // avg green day 80, avg red day 100
    expect(s.avgDaily.value).toBeCloseTo(20, 9);
    expect(s.loggedDays.value).toBe(3);
    expect(s.journaledDays.value).toBe(2);
    expect(s.avgDailyVolume.value).toBeCloseTo(0.6 / 3, 9);
    expect(s.maxDrawdown.value).toBe(-100);
    expect(s.avgDrawdown.value).toBeCloseTo((0 - 100 - 60) / 3, 2); // money is rounded to cents
    expect(s.avgHold.value).toBeCloseTo(360 / 6, 9);
    expect(s.avgPlannedR.value).toBe(2);
    expect(s.avgRealizedR.value).toBe(0.5);
  });

  it("has every row the report promises, in order, and is safe with no trades", () => {
    expect(summaryRows(rows, 0, 0).map((r) => r.label)).toEqual([
      "Net P&L", "Win %", "Avg daily win %", "Profit factor", "Trade expectancy", "Avg daily win/loss", "Avg trade win/loss", "Avg hold time",
      "Avg net trade P&L", "Avg daily net P&L", "Avg planned R", "Avg realized R", "Avg daily volume", "Logged days", "Journaled days", "Max daily net drawdown", "Avg daily net drawdown",
    ]);
    const empty = summaryRows([], 0, 0);
    expect(empty.find((r) => r.key === "loggedDays")?.value).toBe(0);
    expect(empty.find((r) => r.key === "winRate")?.value).toBeNull();
    expect(empty.find((r) => r.key === "net")?.value).toBe(0);
  });

  it("a breakeven threshold turns small days flat", () => {
    const s = Object.fromEntries(summaryRows([{ day: "2026-10-05", agg: agg({ count: 1, wins: 1, netPnl: 3, grossWin: 3 }) }, { day: "2026-10-06", agg: agg({ count: 1, wins: 1, netPnl: 50, grossWin: 50 }) }], 5, 0).map((r) => [r.key, r]));
    expect(s.dayWinRate.note).toBe("1 W · 1 BE · 0 L days");
  });
});

describe("formatting", () => {
  it("formats by unit and shows a dash for missing values", () => {
    expect(formatValue("money", 1234.5)).toBe("+A$1,234.50");
    expect(formatValue("money", -20)).toBe("−A$20.00");
    expect(formatValue("pct", 58.93)).toBe("58.9%");
    expect(formatValue("ratio", 1.3149)).toBe("1.31");
    expect(formatValue("duration", 840)).toBe("14m 0s");
    expect(formatValue("r", 0.4)).toBe("+0.40R");
    expect(formatValue("lots", 2.6)).toBe("2.60 lots");
    expect(formatValue("count", 58)).toBe("58");
    expect(formatValue("money", null)).toBe("—");
    expect(formatValue("money", 5, "USD")).toBe("+$5.00");
  });
});
