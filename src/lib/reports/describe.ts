import { FLAG_LABELS, type Filters } from "@/lib/filters/params";
import { RANGE_PRESETS } from "@/lib/filters/range";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SESSION_NAMES = { asia: "Asia", london: "London", newyork: "New York" } as const;

const day = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

/** "1 Oct 2026 – 31 Oct 2026", "from 1 Oct 2026", "to 9 Oct 2026" or "All time". */
export function describeRange(from: string | null, to: string | null): string {
  if (!from && !to) return "All time";
  if (from && to) return from === to ? day(from) : `${day(from)} – ${day(to)}`;
  return from ? `from ${day(from)}` : `to ${day(to!)}`;
}

export interface Names {
  accounts?: Record<string, string>;
  strategies?: Record<string, string>;
  tags?: Record<string, string>;
}

/**
 * The filters in plain words, for the subtitle of an exported report so a PDF still makes sense months later.
 * `range` is the already-resolved date range (the preset alone, such as "This month", would be ambiguous on paper).
 */
export function describeFilters(f: Filters, range: { from: string | null; to: string | null }, names: Names = {}): string {
  const parts: string[] = [];
  parts.push(f.account ? (names.accounts?.[f.account] ?? "One account") : "All accounts");
  const preset = RANGE_PRESETS.find((p) => p.value === f.range);
  parts.push(f.range === "custom" || f.range === "all" || !preset ? describeRange(range.from, range.to) : `${preset.label} (${describeRange(range.from, range.to)})`);
  if (f.status !== "closed") parts.push(f.status === "open" ? "Open positions" : "Open and closed");
  if (f.instrument) parts.push(f.instrument === "FOREX_CFD" ? "Forex/CFD" : f.instrument === "FUTURES" ? "Futures" : "Stocks");
  if (f.symbol) parts.push(f.symbol);
  if (f.side) parts.push(f.side === "LONG" ? "Long only" : "Short only");
  if (f.result) parts.push(f.result === "WIN" ? "Wins only" : f.result === "LOSS" ? "Losses only" : "Breakevens only");
  if (f.duration) parts.push(f.duration === "intraday" ? "Intraday only" : "Multi-day only");
  if (f.reviewed) parts.push(f.reviewed === "yes" ? "Reviewed" : "Not reviewed");
  if (f.strategy.length) parts.push(`Playbook: ${f.strategy.map((s) => (s === "none" ? "none" : (names.strategies?.[s] ?? "selected"))).join(", ")}`);
  if (f.tags.length) parts.push(`Tags: ${f.tags.map((t) => names.tags?.[t] ?? "selected").join(", ")}`);
  if (f.dow.length) parts.push(`Weekdays: ${f.dow.map((d) => WEEKDAYS[d]).join(", ")}`);
  if (f.hour.length) parts.push(`Hours: ${f.hour.map((h) => String(h).padStart(2, "0")).join(", ")}`);
  if (f.session.length) parts.push(`Sessions: ${f.session.map((s) => SESSION_NAMES[s]).join(", ")}`);
  if (f.flags.length) parts.push(f.flags.map((x) => FLAG_LABELS[x]).join(", "));
  return parts.join(" · ");
}
