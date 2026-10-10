import { classify, cumulative, drawdown, round2, summaryFromAggregates, type Aggregates, type Summary } from "@/lib/metrics";
import { duration, money, pct, ratio } from "@/lib/format";

/** One trading day's totals (the unit everything else is rolled up from). */
export interface DayRow {
  day: string; // YYYY-MM-DD
  agg: Aggregates;
}

export type Granularity = "day" | "week" | "month";
export const GRANULARITIES: Granularity[] = ["day", "week", "month"];
export const isGranularity = (v: string | undefined): v is Granularity => !!v && (GRANULARITIES as string[]).includes(v);

export const emptyAgg = (): Aggregates => ({ count: 0, wins: 0, losses: 0, breakevens: 0, netPnl: 0, grossPnl: 0, costs: 0, grossWin: 0, grossLoss: 0, holdSum: 0, holdCount: 0, plannedSum: 0, plannedCount: 0, realizedSum: 0, realizedCount: 0, volume: 0 });

export function addAgg(a: Aggregates, b: Aggregates): Aggregates {
  const out = { ...a };
  for (const k of Object.keys(b) as (keyof Aggregates)[]) out[k] = a[k] + b[k];
  return out;
}

/** Monday (UTC date arithmetic on a plain calendar date) of the week containing `day`. */
export function weekStart(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

export const periodKey = (day: string, g: Granularity) => (g === "day" ? day : g === "week" ? weekStart(day) : day.slice(0, 7));

export interface PeriodStats {
  key: string;
  agg: Aggregates;
  summary: Summary;
  /** net P&L of each trading day inside the period, in date order */
  dayNets: number[];
  days: number;
  green: number;
  red: number;
  flat: number;
  /** worst fall from a running peak of daily net P&L inside the period (<= 0) */
  maxDrawdown: number;
}

/** Aggregate per-day rows into periods. Input may be in any order; output is sorted by period. */
export function rollup(rows: DayRow[], g: Granularity, breakevenThreshold = 0): PeriodStats[] {
  const groups = new Map<string, DayRow[]>();
  for (const r of rows) {
    const k = periodKey(r.day, g);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, list]) => {
      const sorted = [...list].sort((a, b) => a.day.localeCompare(b.day));
      const agg = sorted.reduce((s, r) => addAgg(s, r.agg), emptyAgg());
      const dayNets = sorted.map((r) => round2(r.agg.netPnl));
      const results = dayNets.map((n) => classify(n, breakevenThreshold));
      return {
        key,
        agg,
        summary: summaryFromAggregates(agg),
        dayNets,
        days: sorted.length,
        green: results.filter((x) => x === "WIN").length,
        red: results.filter((x) => x === "LOSS").length,
        flat: results.filter((x) => x === "BE").length,
        maxDrawdown: drawdown(cumulative(dayNets), 0).max,
      };
    });
}

// ───────────── metric registry (what the Performance charts can plot) ─────────────

export type Unit = "money" | "pct" | "ratio" | "duration" | "count" | "lots" | "r";

export interface MetricDef {
  key: string;
  label: string;
  unit: Unit;
  /** bars suit totals per period; lines suit rates and ratios */
  chart: "bar" | "line";
  value: (p: PeriodStats) => number | null;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export const METRICS: MetricDef[] = [
  { key: "net", label: "Net P&L", unit: "money", chart: "bar", value: (p) => p.summary.netPnl },
  { key: "gross", label: "Gross P&L", unit: "money", chart: "bar", value: (p) => p.summary.grossPnl },
  { key: "fees", label: "Fees", unit: "money", chart: "bar", value: (p) => p.summary.fees },
  { key: "winRate", label: "Win %", unit: "pct", chart: "line", value: (p) => (p.summary.wins + p.summary.losses ? p.summary.winRate * 100 : null) },
  { key: "dayWinRate", label: "Day win %", unit: "pct", chart: "line", value: (p) => (p.green + p.red ? (p.green / (p.green + p.red)) * 100 : null) },
  { key: "profitFactor", label: "Profit factor", unit: "ratio", chart: "line", value: (p) => p.summary.profitFactor },
  { key: "expectancy", label: "Expectancy per trade", unit: "money", chart: "line", value: (p) => (p.summary.count ? p.summary.expectancy : null) },
  { key: "avgWin", label: "Avg winning trade", unit: "money", chart: "line", value: (p) => (p.summary.wins ? p.summary.avgWin : null) },
  { key: "avgLoss", label: "Avg losing trade", unit: "money", chart: "line", value: (p) => (p.summary.losses ? p.summary.avgLoss : null) },
  { key: "avgWinLoss", label: "Avg win / avg loss", unit: "ratio", chart: "line", value: (p) => p.summary.avgWinLossRatio },
  { key: "avgNet", label: "Avg net per trade", unit: "money", chart: "line", value: (p) => (p.summary.count ? p.summary.avgNetPerTrade : null) },
  { key: "trades", label: "Trades", unit: "count", chart: "bar", value: (p) => p.summary.count },
  { key: "volume", label: "Volume (lots)", unit: "lots", chart: "bar", value: (p) => round2(p.summary.volume) },
  { key: "avgHold", label: "Avg hold time", unit: "duration", chart: "line", value: (p) => (p.agg.holdCount ? p.summary.avgHoldSeconds : null) },
  { key: "avgPlannedR", label: "Avg planned R", unit: "r", chart: "line", value: (p) => p.summary.avgPlannedR },
  { key: "avgRealizedR", label: "Avg realized R", unit: "r", chart: "line", value: (p) => p.summary.avgRealizedR },
  { key: "avgDaily", label: "Avg daily net P&L", unit: "money", chart: "line", value: (p) => avg(p.dayNets) },
  { key: "maxDrawdown", label: "Max drawdown", unit: "money", chart: "bar", value: (p) => p.maxDrawdown },
];
export const METRIC_BY_KEY = new Map(METRICS.map((m) => [m.key, m]));
export const isMetricKey = (k: string) => METRIC_BY_KEY.has(k);

/** Cumulative net P&L is not a per-period value: it needs the periods before it. */
export const CUMULATIVE_KEY = "cumNet";
export const CUMULATIVE_LABEL = "Cumulative net P&L";

export interface Series {
  key: string;
  label: string;
  unit: Unit;
  chart: "bar" | "line";
  values: (number | null)[];
}
export interface SeriesResult {
  labels: string[];
  series: Series[];
}

export function buildSeries(rows: DayRow[], metricKeys: string[], g: Granularity, breakevenThreshold = 0): SeriesResult {
  const periods = rollup(rows, g, breakevenThreshold);
  const series: Series[] = [];
  for (const key of metricKeys) {
    if (key === CUMULATIVE_KEY) {
      const cum = cumulative(periods.map((p) => p.summary.netPnl));
      series.push({ key, label: CUMULATIVE_LABEL, unit: "money", chart: "line", values: cum });
      continue;
    }
    const def = METRIC_BY_KEY.get(key);
    if (def) series.push({ key, label: def.label, unit: def.unit, chart: def.chart, values: periods.map((p) => def.value(p)) });
  }
  return { labels: periods.map((p) => p.key), series };
}

// ───────────── formatting ─────────────

export function formatValue(unit: Unit, v: number | null, currency = "AUD"): string {
  if (v == null || Number.isNaN(v)) return "—";
  switch (unit) {
    case "money":
      return money(v, currency);
    case "pct":
      return pct(v / 100, 1);
    case "ratio":
      return ratio(v);
    case "duration":
      return duration(v);
    case "lots":
      return `${v.toFixed(2)} lots`;
    case "r":
      return `${v > 0 ? "+" : ""}${v.toFixed(2)}R`;
    default:
      return String(Math.round(v));
  }
}

// ───────────── the headline summary table ─────────────

export interface SummaryRow {
  key: string;
  label: string;
  unit: Unit | "text";
  value: number | null;
  /** extra text, e.g. the W/BE/L day split */
  note?: string;
  tone?: "pnl" | "loss";
}

/** The sixteen-plus numbers in the Reports summary. `journaledDays` comes from the notebook, not from trades. */
export function summaryRows(rows: DayRow[], breakevenThreshold: number, journaledDays: number): SummaryRow[] {
  const [all] = rollup(rows.map((r) => ({ day: "all", agg: r.agg })), "day", breakevenThreshold); // totals over every trade
  const days = rollup(rows, "day", breakevenThreshold);
  const s = all?.summary ?? summaryFromAggregates(emptyAgg());
  const nets = days.map((d) => d.summary.netPnl);
  const greens = nets.filter((n) => classify(n, breakevenThreshold) === "WIN");
  const reds = nets.filter((n) => classify(n, breakevenThreshold) === "LOSS");
  const flat = nets.length - greens.length - reds.length;
  const dd = drawdown(cumulative(nets), 0);
  const avgGreen = avg(greens);
  const avgRed = avg(reds);
  const decidedDays = greens.length + reds.length;

  return [
    { key: "net", label: "Net P&L", unit: "money", value: s.netPnl, tone: "pnl" },
    { key: "winRate", label: "Win %", unit: "pct", value: s.wins + s.losses ? s.winRate * 100 : null, note: `${s.wins} W · ${s.breakevens} BE · ${s.losses} L` },
    { key: "dayWinRate", label: "Avg daily win %", unit: "pct", value: decidedDays ? (greens.length / decidedDays) * 100 : null, note: `${greens.length} W · ${flat} BE · ${reds.length} L days` },
    { key: "profitFactor", label: "Profit factor", unit: "ratio", value: s.profitFactor },
    { key: "expectancy", label: "Trade expectancy", unit: "money", value: s.count ? s.expectancy : null, tone: "pnl" },
    { key: "avgDailyWinLoss", label: "Avg daily win/loss", unit: "ratio", value: avgGreen != null && avgRed ? avgGreen / Math.abs(avgRed) : null },
    { key: "avgTradeWinLoss", label: "Avg trade win/loss", unit: "ratio", value: s.avgWinLossRatio },
    { key: "avgHold", label: "Avg hold time", unit: "duration", value: s.count && all?.agg.holdCount ? s.avgHoldSeconds : null },
    { key: "avgNet", label: "Avg net trade P&L", unit: "money", value: s.count ? s.avgNetPerTrade : null, tone: "pnl" },
    { key: "avgDaily", label: "Avg daily net P&L", unit: "money", value: avg(nets), tone: "pnl" },
    { key: "avgPlannedR", label: "Avg planned R", unit: "r", value: s.avgPlannedR },
    { key: "avgRealizedR", label: "Avg realized R", unit: "r", value: s.avgRealizedR },
    { key: "avgDailyVolume", label: "Avg daily volume", unit: "lots", value: days.length ? s.volume / days.length : null },
    { key: "loggedDays", label: "Logged days", unit: "count", value: days.length },
    { key: "journaledDays", label: "Journaled days", unit: "count", value: journaledDays },
    { key: "maxDrawdown", label: "Max daily net drawdown", unit: "money", value: dd.max, tone: "loss" },
    { key: "avgDrawdown", label: "Avg daily net drawdown", unit: "money", value: days.length ? dd.avg : null, tone: "loss" },
  ];
}
