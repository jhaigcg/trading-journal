import type { DayBucket } from "@/lib/metrics";

export interface CalendarCell {
  /** YYYY-MM-DD, or null for the blank cells before the 1st / after the last day */
  date: string | null;
  day: number | null;
  netPnl: number | null; // null = no trades that day
  trades: number;
  isToday: boolean;
  isFuture: boolean;
}

export interface CalendarWeek {
  cells: CalendarCell[]; // 7, Sunday first
  netPnl: number;
  trades: number;
  tradingDays: number;
}

export const isYearMonth = (s: string | undefined): s is string => !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Month grid (weeks start on Sunday) filled with each day's net P&L and trade count. */
export function buildMonthGrid(ym: string, buckets: DayBucket[], today: string): CalendarWeek[] {
  const [y, m] = ym.split("-").map(Number);
  const byDay = new Map(buckets.map((b) => [b.day, b]));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();

  const cells: CalendarCell[] = [];
  for (let i = 0; i < lead; i++) cells.push({ date: null, day: null, netPnl: null, trades: 0, isToday: false, isFuture: false });
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${ym}-${String(d).padStart(2, "0")}`;
    const b = byDay.get(date);
    cells.push({ date, day: d, netPnl: b ? b.netPnl : null, trades: b?.trades ?? 0, isToday: date === today, isFuture: date > today });
  }
  while (cells.length % 7) cells.push({ date: null, day: null, netPnl: null, trades: 0, isToday: false, isFuture: false });

  const weeks: CalendarWeek[] = [];
  for (let i = 0; i < cells.length; i += 7) {
    const row = cells.slice(i, i + 7);
    const traded = row.filter((c) => c.netPnl !== null);
    weeks.push({
      cells: row,
      netPnl: Math.round(traded.reduce((s, c) => s + (c.netPnl ?? 0), 0) * 100) / 100,
      trades: row.reduce((s, c) => s + c.trades, 0),
      tradingDays: traded.length,
    });
  }
  return weeks;
}

/** Compact signed money for calendar cells: A$484, -A$79.9, A$1.02K, A$1.2M (3 significant digits). */
export function compactMoney(n: number, symbol = "A$"): string {
  const abs = Math.abs(n);
  const sig = (v: number) => String(Number(v.toPrecision(3)));
  const body = abs >= 1_000_000 ? `${sig(abs / 1_000_000)}M` : abs >= 1000 ? `${Number((abs / 1000).toFixed(2))}K` : sig(abs);
  return `${n < 0 ? "−" : ""}${symbol}${body}`;
}
