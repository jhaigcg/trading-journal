import { describe, expect, it } from "vitest";
import { parseFilters } from "@/lib/filters/params";
import { describeFilters, describeRange } from "@/lib/reports/describe";
import { DEFAULT_CHARTS, addableMetrics, cleanMetrics, parseCharts } from "@/lib/reports/params";
import { CUMULATIVE_KEY } from "@/lib/reports/rollup";

describe("describeFilters", () => {
  const range = { from: "2026-10-01", to: "2026-10-31" };
  it("reads the way you would say it", () => {
    expect(describeFilters(parseFilters({ range: "month" }), range)).toBe("All accounts · This month (1 Oct 2026 – 31 Oct 2026)");
    expect(describeFilters(parseFilters({ range: "all" }), { from: null, to: null })).toBe("All accounts · All time");
    expect(describeFilters(parseFilters({ range: "custom", from: "2026-01-05", to: "2026-01-05" }), { from: "2026-01-05", to: "2026-01-05" })).toBe("All accounts · 5 Jan 2026");
  });

  it("names accounts, playbooks and tags, and spells out every other filter", () => {
    const f = parseFilters({ account: "a1", range: "30d", side: "SHORT", symbol: "xauusd", strategy: "s1,none", tags: "t1", dow: "1,5", hour: "9,10", session: "london", flags: "noStopLoss,unreviewed", result: "LOSS", status: "all", reviewed: "no", duration: "intraday", instrument: "FOREX_CFD" });
    const text = describeFilters(f, { from: "2026-09-11", to: "2026-10-10" }, { accounts: { a1: "MT4 main" }, strategies: { s1: "Key reversal" }, tags: { t1: "FVG" } });
    for (const part of ["MT4 main", "Last 30 days (11 Sep 2026 – 10 Oct 2026)", "Open and closed", "Forex/CFD", "XAUUSD", "Short only", "Losses only", "Intraday only", "Not reviewed", "Playbook: Key reversal, none", "Tags: FVG", "Weekdays: Mon, Fri", "Hours: 09, 10", "Sessions: London", "No stop loss, Not reviewed"]) expect(text).toContain(part);
  });

  it("unknown ids do not leak or crash", () => {
    expect(describeFilters(parseFilters({ account: "zzz", strategy: "q", tags: "w" }), range)).toContain("One account");
    expect(describeFilters(parseFilters({ strategy: "q", tags: "w" }), range)).toContain("Playbook: selected");
  });

  it("ranges", () => {
    expect(describeRange("2026-10-01", null)).toBe("from 1 Oct 2026");
    expect(describeRange(null, "2026-10-09")).toBe("to 9 Oct 2026");
  });
});

describe("chart configuration from the URL", () => {
  it("defaults when nothing is given", () => {
    expect(parseCharts({})).toEqual(DEFAULT_CHARTS);
  });

  it("reads metrics and granularity", () => {
    const [a, b] = parseCharts({ m1: "net,trades", g1: "month", m2: "winRate", g2: "day" });
    expect(a).toEqual({ metrics: ["net", "trades"], g: "month" });
    expect(b).toEqual({ metrics: ["winRate"], g: "day" });
  });

  it("drops unknown metrics, repeats and bad granularities", () => {
    const [a] = parseCharts({ m1: "net,nope,net,; DROP", g1: "decade" });
    expect(a).toEqual({ metrics: ["net"], g: "day" });
    expect(parseCharts({ m1: "nope" })[0].metrics).toEqual(DEFAULT_CHARTS[0].metrics);
  });

  it("allows at most four metrics and two different units", () => {
    expect(cleanMetrics(["net", "gross", "fees", "avgWin", "avgLoss"])).toEqual(["net", "gross", "fees", "avgWin"]);
    expect(cleanMetrics(["net", "winRate", "profitFactor"])).toEqual(["net", "winRate"]); // money, pct, then a third unit: refused
    expect(cleanMetrics(["net", "winRate", "dayWinRate"])).toEqual(["net", "winRate", "dayWinRate"]); // same unit as winRate
    expect(cleanMetrics([CUMULATIVE_KEY, "net"])).toEqual([CUMULATIVE_KEY, "net"]);
  });

  it("offers only metrics that still fit", () => {
    const add = addableMetrics(["net", "winRate"]);
    expect(add).toContain("dayWinRate");
    expect(add).toContain("gross");
    expect(add).not.toContain("profitFactor");
    expect(add).not.toContain("net");
    expect(addableMetrics(["net", "gross", "fees", "avgWin"])).toEqual([]); // already four
    expect(addableMetrics([])).toContain(CUMULATIVE_KEY);
  });
});
