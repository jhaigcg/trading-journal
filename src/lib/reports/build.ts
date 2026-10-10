import { displayCurrency } from "@/lib/fx";
import type { Filters } from "@/lib/filters/params";
import { resolveRange } from "@/lib/filters/range";
import {
  bySession,
  bySymbol,
  byStrategy,
  byTag,
  byHour,
  byWeekday,
  heatmap,
  loadDayRows,
  loadJournaledDays,
  pnlDistribution,
  riskReport,
  winsVsLosses,
  type Breakdown,
} from "@/lib/queries/reports";
import { settingsFor } from "@/lib/queries/trade-list";
import { describeFilters, describeRange, type Names } from "./describe";
import type { Cell, ChartSection, Col, ReportDoc, Section, TableSection } from "./doc";
import type { ChartConfig } from "./params";
import { CUMULATIVE_KEY, buildSeries, formatValue, rollup, summaryRows, type DayRow, type Unit } from "./rollup";

export const REPORT_TABS = [
  { id: "overview", label: "Overview" },
  { id: "performance", label: "Performance" },
  { id: "time", label: "Day & time" },
  { id: "symbols", label: "Symbols" },
  { id: "risk", label: "Risk (R)" },
  { id: "playbooks", label: "Playbooks" },
  { id: "tags", label: "Tags" },
  { id: "winloss", label: "Wins vs losses" },
  { id: "compare", label: "Compare" },
  { id: "calendar", label: "Calendar" },
  { id: "recap", label: "Recap" },
] as const;
export type ReportTab = (typeof REPORT_TABS)[number]["id"];
export const isReportTab = (v: string | undefined): v is ReportTab => !!v && REPORT_TABS.some((t) => t.id === v);

export interface BuildInput {
  tab: ReportTab;
  filters: Filters;
  charts: [ChartConfig, ChartConfig];
  /** calendar tab: which year to show; defaults to the year of the end of the range */
  year?: number;
  names?: Names;
  now?: Date;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const scale = (fx: number) => (v: number | null | undefined): number | null => (v == null ? null : r2(v * fx));
const pctOf = (v: number | null | undefined): number | null => (v == null ? null : Math.round(v * 1000) / 10);

/** Everything the builders share: money scaling, the resolved range and settings. */
async function context(f: Filters, now: Date) {
  const [cur, settings] = await Promise.all([displayCurrency(f.ccy), settingsFor()]);
  const range = resolveRange(f.range, { from: f.from, to: f.to }, now, settings.tz);
  return { ...cur, ...settings, range, m: scale(cur.fx), now };
}
type Ctx = Awaited<ReturnType<typeof context>>;

const withRange = (f: Filters, range: { from: string | null; to: string | null }): Filters => ({ ...f, range: "custom", from: range.from ?? undefined, to: range.to ?? undefined });

// ───────────── breakdown tables ─────────────

const BREAKDOWN_COLS: Col[] = [
  { key: "label", label: "" },
  { key: "trades", label: "Trades", unit: "count" },
  { key: "win", label: "Win %", unit: "pct" },
  { key: "net", label: "Net P&L", unit: "money" },
  { key: "pf", label: "Profit factor", unit: "ratio" },
  { key: "exp", label: "Expectancy", unit: "money" },
  { key: "avgWin", label: "Avg win", unit: "money" },
  { key: "avgLoss", label: "Avg loss", unit: "money" },
  { key: "lots", label: "Volume", unit: "lots" },
];

function breakdownRow(b: Breakdown, c: Ctx): Cell[] {
  const s = b.summary;
  return [b.label, s.count, s.wins + s.losses ? pctOf(s.winRate) : null, c.m(s.netPnl), s.profitFactor, s.count ? c.m(s.expectancy) : null, s.wins ? c.m(s.avgWin) : null, s.losses ? c.m(s.avgLoss) : null, r2(s.volume)];
}

function breakdownTable(title: string, firstLabel: string, rows: Breakdown[], c: Ctx, note?: string): TableSection {
  const columns = BREAKDOWN_COLS.map((col, i) => (i === 0 ? { ...col, label: firstLabel } : col));
  return { kind: "table", title, columns, rows: rows.map((b) => breakdownRow(b, c)), ...(note ? { note } : {}) };
}

function breakdownChart(title: string, axis: string, rows: Breakdown[], c: Ctx): ChartSection {
  return {
    kind: "chart",
    title,
    axis,
    labels: rows.map((b) => b.label),
    series: [
      { key: "net", label: "Net P&L", unit: "money", type: "bar", values: rows.map((b) => c.m(b.summary.netPnl)) },
      { key: "trades", label: "Trades", unit: "count", type: "line", values: rows.map((b) => b.summary.count) },
    ],
  };
}

// ───────────── sections ─────────────

async function summarySection(rows: DayRow[], f: Filters, c: Ctx, title = "Summary"): Promise<Section> {
  const journaled = await loadJournaledDays(f);
  return {
    kind: "kv",
    title,
    rows: summaryRows(rows, c.thr, journaled).map((r) => ({ label: r.label, unit: r.unit, value: r.unit === "money" && r.value != null ? c.m(r.value) : r.value, ...(r.note ? { note: r.note } : {}), ...(r.tone ? { tone: r.tone } : {}) })),
  };
}

function chartSection(rows: DayRow[], cfg: ChartConfig, c: Ctx, title?: string): ChartSection {
  const { labels, series } = buildSeries(rows, cfg.metrics, cfg.g, c.thr);
  return {
    kind: "chart",
    title: title ?? series.map((s) => s.label).join(" · "),
    axis: cfg.g === "day" ? "Day" : cfg.g === "week" ? "Week starting" : "Month",
    labels,
    series: series.map((s) => ({ key: s.key, label: s.label, unit: s.unit, type: s.chart, values: s.unit === "money" ? s.values.map((v) => c.m(v)) : s.values })),
  };
}

async function overview(f: Filters, c: Ctx): Promise<Section[]> {
  const rows = await loadDayRows(f);
  const equity = chartSection(rows, { metrics: [CUMULATIVE_KEY], g: "day" }, c, "Cumulative net P&L");
  const daily = chartSection(rows, { metrics: ["net"], g: "day" }, c, "Net P&L per day");
  return [await summarySection(rows, f, c), equity, daily];
}

async function time(f: Filters, c: Ctx): Promise<Section[]> {
  const [wd, hr, ses, heat] = await Promise.all([byWeekday(f), byHour(f), bySession(f), heatmap(f)]);
  const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const order = [1, 2, 3, 4, 5, 6, 0];
  const values: (number | null)[][] = order.map(() => Array.from({ length: 24 }, () => null));
  const counts = order.map(() => Array.from({ length: 24 }, () => 0));
  for (const h of heat) {
    const r = order.indexOf(h.dow);
    if (r < 0 || h.hour < 0 || h.hour > 23) continue;
    values[r][h.hour] = c.m(h.net);
    counts[r][h.hour] = h.trades;
  }
  return [
    breakdownChart("Net P&L by weekday of entry", "Weekday", wd, c),
    breakdownTable("By weekday", "Weekday", wd, c),
    breakdownChart("Net P&L by hour of entry", `Hour (${c.tz})`, hr, c),
    breakdownTable("By hour", `Hour (${c.tz})`, hr.filter((b) => b.summary.count > 0), c, hr.some((b) => b.summary.count === 0) ? "Hours with no trades are left out of the table." : undefined),
    breakdownTable("By session", "Session", ses, c, "Sessions are in UTC, whatever display timezone is chosen."),
    { kind: "heatmap", title: `Net P&L by weekday and hour (${c.tz})`, rowLabels: labels, colLabels: Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0")), values, counts },
  ];
}

async function symbols(f: Filters, c: Ctx): Promise<Section[]> {
  const rows = await bySymbol(f);
  return [breakdownChart("Net P&L by symbol", "Symbol", rows, c), breakdownTable("By symbol", "Symbol", rows, c)];
}

async function playbooks(f: Filters, c: Ctx): Promise<Section[]> {
  const rows = await byStrategy(f);
  return [breakdownChart("Net P&L by playbook", "Playbook", rows, c), breakdownTable("By playbook", "Playbook", rows, c)];
}

async function tags(f: Filters, c: Ctx): Promise<Section[]> {
  const rows = await byTag(f);
  const labelled = rows.map((r) => ({ ...r, label: `${r.category}: ${r.label}` }));
  return [breakdownChart("Net P&L by tag", "Tag", labelled, c), breakdownTable("By tag", "Tag", labelled, c, "A trade with several tags counts once under each of them, so rows overlap and do not add up to the total.")];
}

async function risk(f: Filters, c: Ctx): Promise<Section[]> {
  const [r, dist] = await Promise.all([riskReport(f), pnlDistribution(f)]);
  const pctStop = r.trades ? (r.withStop / r.trades) * 100 : null;
  return [
    {
      kind: "kv",
      title: "Risk summary",
      rows: [
        { label: "Closed trades", unit: "count", value: r.trades },
        { label: "With a stop loss", unit: "pct", value: pctStop == null ? null : Math.round(pctStop * 10) / 10, note: `${r.withStop} of ${r.trades}` },
        { label: "With a realized R", unit: "count", value: r.withRealizedR },
        { label: "Avg risk per trade", unit: "money", value: c.m(r.avgRisk) },
        { label: "Avg planned R", unit: "r", value: r.avgPlannedR },
        { label: "Avg realized R", unit: "r", value: r.avgRealizedR },
        { label: "Avg R on winners", unit: "r", value: r.avgWinR },
        { label: "Avg R on losers", unit: "r", value: r.avgLossR },
      ],
    },
    { kind: "chart", title: "Trades by realized R", axis: "Realized R", labels: r.buckets.map((b) => b.label), series: [{ key: "n", label: "Trades", unit: "count", type: "bar", values: r.buckets.map((b) => b.summary.count) }] },
    breakdownTable("By realized R", "Realized R", r.buckets, c, `Only trades with a stop loss have an R value (${r.withRealizedR} of ${r.trades}).`),
    {
      kind: "chart",
      title: "Net P&L per trade distribution",
      axis: "Net P&L per trade",
      labels: dist.map((b) => `${formatValue("money", c.m(b.from), c.currency)} to ${formatValue("money", c.m(b.to), c.currency)}`),
      series: [{ key: "n", label: "Trades", unit: "count", type: "bar", values: dist.map((b) => b.count) }],
    },
  ];
}

async function winloss(f: Filters, c: Ctx): Promise<Section[]> {
  const p = await winsVsLosses(f);
  const col = (fn: (x: (typeof p)[number]) => Cell): Cell[] => p.map(fn);
  const lines: { label: string; unit: Unit | "text"; cells: Cell[] }[] = [
    { label: "Trades", unit: "count", cells: col((x) => x.trades) },
    { label: "Total net P&L", unit: "money", cells: col((x) => c.m(x.totalNet)) },
    { label: "Avg net P&L", unit: "money", cells: col((x) => c.m(x.avgNet)) },
    { label: "Avg hold time", unit: "duration", cells: col((x) => x.avgHoldSeconds) },
    { label: "Avg lots", unit: "lots", cells: col((x) => (x.avgLots == null ? null : r2(x.avgLots))) },
    { label: "Avg pips", unit: "ratio", cells: col((x) => (x.avgPips == null ? null : r2(x.avgPips))) },
    { label: "With a stop loss", unit: "pct", cells: col((x) => pctOf(x.pctWithStop)) },
    { label: "Linked to a playbook", unit: "pct", cells: col((x) => pctOf(x.pctWithPlaybook)) },
    { label: "Reviewed", unit: "pct", cells: col((x) => pctOf(x.pctReviewed)) },
    { label: "Most common entry hour", unit: "text", cells: col((x) => (x.topHour == null ? null : `${String(x.topHour).padStart(2, "0")}:00`)) },
  ];
  return [
    {
      kind: "table",
      title: "Winners, losers and breakevens compared",
      columns: [{ key: "m", label: "" }, { key: "w", label: "Winners", unit: "text" }, { key: "l", label: "Losers", unit: "text" }, { key: "b", label: "Breakevens", unit: "text" }],
      rows: lines.map((l) => [l.label, ...l.cells]),
      rowUnits: lines.map((l) => l.unit),
      note: `Breakeven means within ±${formatValue("money", c.m(c.thr), c.currency)} net.`,
    },
  ];
}

async function calendar(f: Filters, year: number | undefined, c: Ctx): Promise<Section[]> {
  const y = year ?? Number((c.range.to ?? c.now.toISOString().slice(0, 10)).slice(0, 4));
  const rows = await loadDayRows(withRange(f, { from: `${y}-01-01`, to: `${y}-12-31` }));
  const days: Record<string, { net: number; trades: number }> = {};
  for (const r of rows) days[r.day] = { net: c.m(r.agg.netPnl) ?? 0, trades: r.agg.count };
  const months = rollup(rows, "month", c.thr);
  return [
    { kind: "calendar", title: String(y), year: y, days },
    {
      kind: "table",
      title: `Months of ${y}`,
      columns: [{ key: "m", label: "Month" }, { key: "d", label: "Days", unit: "count" }, { key: "t", label: "Trades", unit: "count" }, { key: "w", label: "Win %", unit: "pct" }, { key: "n", label: "Net P&L", unit: "money" }],
      rows: months.map((p) => [p.key, p.days, p.summary.count, p.summary.wins + p.summary.losses ? pctOf(p.summary.winRate) : null, c.m(p.summary.netPnl)]),
    },
  ];
}

// ───────────── compare ─────────────

/** The period of equal length that ends the day before `range` starts. Null when the range is open-ended. */
export function previousRange(range: { from: string | null; to: string | null }): { from: string; to: string } | null {
  if (!range.from || !range.to) return null;
  const a = Date.parse(`${range.from}T00:00:00Z`);
  const b = Date.parse(`${range.to}T00:00:00Z`);
  const len = Math.round((b - a) / 86_400_000) + 1;
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  return { from: iso(a - len * 86_400_000), to: iso(a - 86_400_000) };
}

async function compare(f: Filters, c: Ctx): Promise<Section[]> {
  const prev = previousRange(c.range);
  if (!prev) return [{ kind: "text", title: "Compare", lines: ["Pick a date range (not All time) to compare it with the period just before it."] }];
  const fp = withRange(f, prev);
  const [now, before] = await Promise.all([loadDayRows(f), loadDayRows(fp)]);
  const [jn, jp] = await Promise.all([loadJournaledDays(f), loadJournaledDays(fp)]);
  const a = summaryRows(now, c.thr, jn);
  const b = summaryRows(before, c.thr, jp);
  const rows: Cell[][] = [];
  const units: (Unit | "text")[] = [];
  a.forEach((x, i) => {
    const y = b[i];
    const va = x.unit === "money" ? c.m(x.value) : x.value;
    const vb = y.unit === "money" ? c.m(y.value) : y.value;
    const change = va != null && vb != null && x.unit !== "duration" ? r2(va - vb) : null;
    rows.push([x.label, va, vb, change]);
    units.push(x.unit);
  });
  return [
    {
      kind: "table",
      title: `${describeRange(c.range.from, c.range.to)} compared with ${describeRange(prev.from, prev.to)}`,
      columns: [{ key: "m", label: "" }, { key: "a", label: "This period", unit: "text" }, { key: "b", label: "Previous period", unit: "text" }, { key: "c", label: "Change", unit: "text" }],
      rows,
      rowUnits: units,
      note: "Change is this period minus the previous one, in the same unit as the metric (percentage points for percentages).",
    },
    chartSection(now, { metrics: [CUMULATIVE_KEY], g: "day" }, c, "This period: cumulative net P&L"),
    chartSection(before, { metrics: [CUMULATIVE_KEY], g: "day" }, c, "Previous period: cumulative net P&L"),
  ];
}

// ───────────── recap ─────────────

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const dayLabel = (iso: string) => `${WEEKDAY_NAMES[new Date(`${iso}T00:00:00Z`).getUTCDay()].slice(0, 3)} ${describeRange(iso, iso)}`;

/** A short written recap of the period: facts only, no advice. Exposed so tests can check the arithmetic. */
export function recapLines(rows: DayRow[], c: { thr: number; currency: string; m: (v: number) => number | null }, wd: Breakdown[], hr: Breakdown[], plays: Breakdown[], mistakes: { noStop: number; total: number }): string[] {
  const money = (v: number) => formatValue("money", c.m(v), c.currency);
  if (!rows.length) return ["No closed trades in this period."];
  const [all] = rollup(rows.map((r) => ({ day: "all", agg: r.agg })), "day", c.thr);
  const days = rollup(rows, "day", c.thr);
  const s = all.summary;
  const best = days.reduce((x, y) => (y.summary.netPnl > x.summary.netPnl ? y : x));
  const worst = days.reduce((x, y) => (y.summary.netPnl < x.summary.netPnl ? y : x));
  const green = days.filter((d) => d.green).length;
  const red = days.filter((d) => d.red).length;
  const out: string[] = [
    "What happened:",
    `${s.count} trades over ${days.length} trading days, net ${money(s.netPnl)} (${s.wins} W · ${s.breakevens} BE · ${s.losses} L${s.wins + s.losses ? `, win rate ${(s.winRate * 100).toFixed(1)}%` : ""}).`,
    `${green} green ${green === 1 ? "day" : "days"} and ${red} red ${red === 1 ? "day" : "days"}.`,
    `Best day: ${dayLabel(best.key)}, ${money(best.summary.netPnl)}. Worst day: ${dayLabel(worst.key)}, ${money(worst.summary.netPnl)}.`,
  ];
  const withTrades = (list: Breakdown[]) => list.filter((b) => b.summary.count > 0);
  const top = (list: Breakdown[], dir: 1 | -1) => [...withTrades(list)].sort((x, y) => dir * (y.summary.netPnl - x.summary.netPnl))[0];
  const pieces: string[] = [];
  const bd = top(wd, 1), wdw = top(wd, -1);
  if (bd && wdw && bd.key !== wdw.key) pieces.push(`Strongest weekday: ${bd.label} (${money(bd.summary.netPnl)}). Weakest: ${wdw.label} (${money(wdw.summary.netPnl)}).`);
  const bh = top(hr, 1), wh = top(hr, -1);
  if (bh && wh && bh.key !== wh.key) pieces.push(`Strongest entry hour: ${bh.label}:00 (${money(bh.summary.netPnl)}). Weakest: ${wh.label}:00 (${money(wh.summary.netPnl)}).`);
  const bp = top(plays, 1), wp = top(plays, -1);
  if (bp && wp && bp.key !== wp.key) pieces.push(`Best playbook: ${bp.label} (${money(bp.summary.netPnl)}). Worst: ${wp.label} (${money(wp.summary.netPnl)}).`);
  if (pieces.length) out.push("Where it came from:", ...pieces);
  if (mistakes.total) {
    out.push("Process:", `${mistakes.noStop} of ${mistakes.total} trades had no stop loss.`);
  }
  return out;
}

async function recap(f: Filters, c: Ctx): Promise<Section[]> {
  const [rows, wd, hr, plays, risk] = await Promise.all([loadDayRows(f), byWeekday(f), byHour(f), byStrategy(f), riskReport(f)]);
  const lines = recapLines(rows, c, wd, hr, plays, { noStop: risk.trades - risk.withStop, total: risk.trades });
  return [
    { kind: "text", title: "Recap", lines },
    await summarySection(rows, f, c, "Numbers behind the recap"),
    chartSection(rows, { metrics: ["net"], g: rows.length > 62 ? "week" : "day" }, c, "Net P&L"),
  ];
}

// ───────────── entry point ─────────────

const TITLES: Record<ReportTab, string> = {
  overview: "Overview report",
  performance: "Performance report",
  time: "Day and time report",
  symbols: "Symbols report",
  risk: "Risk report",
  playbooks: "Playbook report",
  tags: "Tag report",
  winloss: "Wins versus losses report",
  compare: "Period comparison",
  calendar: "Calendar report",
  recap: "Period recap",
};

/** Build one report as a document. Closed trades only; money in the display currency. */
export async function buildReportDoc(input: BuildInput): Promise<ReportDoc> {
  const now = input.now ?? new Date();
  const f = input.filters;
  const c = await context(f, now);
  let sections: Section[];
  switch (input.tab) {
    case "overview":
      sections = await overview(f, c);
      break;
    case "performance": {
      const rows = await loadDayRows(f);
      sections = [chartSection(rows, input.charts[0], c), chartSection(rows, input.charts[1], c), await summarySection(rows, f, c)];
      break;
    }
    case "time":
      sections = await time(f, c);
      break;
    case "symbols":
      sections = await symbols(f, c);
      break;
    case "risk":
      sections = await risk(f, c);
      break;
    case "playbooks":
      sections = await playbooks(f, c);
      break;
    case "tags":
      sections = await tags(f, c);
      break;
    case "winloss":
      sections = await winloss(f, c);
      break;
    case "compare":
      sections = await compare(f, c);
      break;
    case "calendar":
      sections = await calendar(f, input.year, c);
      break;
    case "recap":
      sections = await recap(f, c);
      break;
  }
  return {
    slug: input.tab,
    title: TITLES[input.tab],
    subtitle: describeFilters(f, c.range, input.names),
    currency: c.currency,
    generatedAt: now.toISOString(),
    sections,
  };
}
