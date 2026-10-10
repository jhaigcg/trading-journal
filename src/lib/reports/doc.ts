import { formatValue, type Unit } from "./rollup";

/**
 * A report as plain data. The web page, the CSV file and the PDF are all rendered from this one structure,
 * so an export always says exactly what the screen says. Money values are already in the display currency.
 */
export type Cell = string | number | null;
export type ColUnit = Unit | "text";

export interface Col {
  key: string;
  label: string;
  unit?: ColUnit;
}

export interface KvRow {
  label: string;
  unit: ColUnit;
  value: Cell;
  note?: string;
  tone?: "pnl" | "loss";
}

export interface KvSection {
  kind: "kv";
  title: string;
  rows: KvRow[];
}

export interface TableSection {
  kind: "table";
  title: string;
  columns: Col[];
  rows: Cell[][];
  /** shown under the table, e.g. "first 60 of 412 days" */
  note?: string;
  /** when each row has its own unit (a metric-by-metric comparison), this overrides the column unit for that row */
  rowUnits?: ColUnit[];
  /** links for the web view (row index → href) */
  hrefs?: (string | null)[];
}

export interface ChartSeries {
  key: string;
  label: string;
  unit: Unit;
  type: "bar" | "line";
  values: (number | null)[];
}

export interface ChartSection {
  kind: "chart";
  title: string;
  labels: string[];
  series: ChartSeries[];
  /** x axis name for table/CSV output */
  axis: string;
}

export interface HeatmapSection {
  kind: "heatmap";
  title: string;
  /** rows = weekdays (Mon..Sun), columns = hours 0..23 */
  rowLabels: string[];
  colLabels: string[];
  /** net P&L per cell, null where there were no trades */
  values: (number | null)[][];
  counts: number[][];
}

export interface CalendarSection {
  kind: "calendar";
  title: string;
  year: number;
  /** YYYY-MM-DD → net P&L and trade count */
  days: Record<string, { net: number; trades: number }>;
}

export interface TextSection {
  kind: "text";
  title: string;
  lines: string[];
}

export type Section = KvSection | TableSection | ChartSection | HeatmapSection | CalendarSection | TextSection;

export interface ReportDoc {
  /** machine name used in file names */
  slug: string;
  title: string;
  /** human description of the filters, e.g. "All accounts · 1 Oct – 31 Oct 2026 · Short only" */
  subtitle: string;
  currency: string;
  generatedAt: string; // ISO
  sections: Section[];
}

/** Text for one cell as it should read on screen and in a PDF. */
export function cellText(cell: Cell, unit: ColUnit | undefined, currency: string): string {
  if (cell == null) return "—";
  if (typeof cell === "string") return cell;
  if (!unit || unit === "text") return String(cell);
  return formatValue(unit, cell, currency);
}

/** Convert any section into rows of text, the shape both CSV and the "no JavaScript" fallbacks need. */
export function sectionAsTable(s: Section, currency: string): { title: string; header: string[]; rows: Cell[][] } | null {
  switch (s.kind) {
    case "kv":
      return { title: s.title, header: ["Metric", "Value", "Note"], rows: s.rows.map((r) => [r.label, r.value, r.note ?? null]) };
    case "table":
      return { title: s.title, header: s.columns.map((c) => c.label), rows: s.rows };
    case "chart":
      return { title: s.title, header: [s.axis, ...s.series.map((x) => x.label)], rows: s.labels.map((l, i) => [l, ...s.series.map((x) => x.values[i] ?? null)]) };
    case "heatmap":
      return { title: `${s.title} (net P&L, ${currency})`, header: ["", ...s.colLabels], rows: s.rowLabels.map((l, r) => [l, ...s.values[r]]) };
    case "calendar":
      return { title: s.title, header: ["Date", "Net P&L", "Trades"], rows: Object.entries(s.days).sort(([a], [b]) => a.localeCompare(b)).map(([d, v]) => [d, v.net, v.trades]) };
    case "text":
      return { title: s.title, header: ["Text"], rows: s.lines.map((l) => [l]) };
  }
}
