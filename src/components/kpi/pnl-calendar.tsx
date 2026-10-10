import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { buildMonthGrid, compactMoney, shiftMonth } from "@/lib/calendar";
import { currencySymbol } from "@/lib/format";
import type { DayBucket } from "@/lib/metrics";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const nav = "flex h-9 w-9 items-center justify-center rounded-control text-muted hover:bg-nav-active hover:text-ink";

/**
 * Monthly P&L calendar. Server component: month navigation is plain links that set ?cal=YYYY-MM,
 * keeping every other filter in the URL. `hrefFor` builds the link for a given month (or null for the current month).
 */
export function PnlCalendar({
  month,
  currentMonth,
  today,
  buckets,
  currency = "AUD",
  hrefFor,
  dayHref,
}: {
  month: string;
  currentMonth: string;
  today: string;
  buckets: DayBucket[];
  currency?: string;
  hrefFor: (month: string | null) => string;
  /** link for a day with trades (opens the day pop-up) */
  dayHref: (day: string) => string;
}) {
  const sym = currencySymbol(currency);
  const weeks = buildMonthGrid(month, buckets, today);
  const [y, m] = month.split("-").map(Number);
  const monthNet = Math.round(buckets.reduce((s, b) => s + b.netPnl, 0) * 100) / 100;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Link href={hrefFor(shiftMonth(month, -1))} aria-label="Previous month" className={nav}>
            <ChevronLeft size={16} />
          </Link>
          <h2 className="min-w-[8.5rem] text-center text-[15px] font-semibold">
            {MONTHS[m - 1]} {y}
          </h2>
          <Link href={hrefFor(shiftMonth(month, 1))} aria-label="Next month" className={nav}>
            <ChevronRight size={16} />
          </Link>
          <Link
            href={hrefFor(null)}
            aria-disabled={month === currentMonth}
            className={cn("ml-2 flex min-h-9 items-center rounded-control border border-line-strong px-3 text-xs hover:bg-nav-active", month === currentMonth && "pointer-events-none opacity-50")}
          >
            This month
          </Link>
        </div>
        <span className="text-xs text-muted">
          Monthly:{" "}
          <span className={cn("num", monthNet > 0 ? "text-profit" : monthNet < 0 ? "text-loss" : "text-ink")}>{compactMoney(monthNet, sym)}</span> · {buckets.length}{" "}
          {buckets.length === 1 ? "day" : "days"}
        </span>
      </div>

      <div className="mt-3 overflow-x-auto">
        <div className="min-w-[560px]">
          <div className="grid grid-cols-[repeat(7,minmax(0,1fr))_minmax(0,1.1fr)] gap-1.5 text-center text-[11px] text-muted">
            {DOW.map((d) => (
              <span key={d} className="rounded-lg border border-line py-1.5 font-semibold text-ink-2">
                {d}
              </span>
            ))}
            <span className="rounded-lg border border-line py-1.5 font-semibold text-ink-2">Week</span>
          </div>

          <div className="mt-1.5 flex flex-col gap-1.5">
            {weeks.map((w, wi) => (
              <div key={wi} className="grid grid-cols-[repeat(7,minmax(0,1fr))_minmax(0,1.1fr)] gap-1.5">
                {w.cells.map((c, ci) => {
                  if (!c.date) return <div key={ci} className="min-h-[72px] rounded-lg border border-[var(--row-line)] bg-[var(--empty-cell)]" />;
                  const traded = c.netPnl !== null;
                  const win = traded && c.netPnl! > 0;
                  const loss = traded && c.netPnl! < 0;
                  const body = (
                    <>
                      <span className="flex justify-end">
                        {c.isToday ? (
                          <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-bg">{c.day}</span>
                        ) : (
                          <span className="text-[11px] text-muted">{c.day}</span>
                        )}
                      </span>
                      {traded && (
                        <span className="mt-auto flex flex-col items-end">
                          <span className={cn("num text-[13px] font-semibold", win && "text-profit", loss && "text-loss")}>{compactMoney(c.netPnl!, sym)}</span>
                          <span className="text-[10px] text-muted">
                            {c.trades} {c.trades === 1 ? "trade" : "trades"}
                          </span>
                        </span>
                      )}
                    </>
                  );
                  const cls = cn(
                    "flex min-h-[72px] flex-col rounded-lg border p-1.5",
                    win && "border-[var(--profit-border)] bg-profit-bg",
                    loss && "border-[var(--loss-border)] bg-loss-bg",
                    traded && !win && !loss && "border-line-strong bg-card",
                    !traded && "border-[var(--row-line)] bg-[var(--empty-cell)]",
                    c.isToday && "outline outline-1 outline-accent",
                  );
                  return traded ? (
                    <Link key={ci} href={dayHref(c.date)} scroll={false} aria-label={`${c.date}: ${c.trades} ${c.trades === 1 ? "trade" : "trades"}, open the day`} className={cn(cls, "hover:brightness-125")}>
                      {body}
                    </Link>
                  ) : (
                    <div key={ci} className={cls}>
                      {body}
                    </div>
                  );
                })}
                <div className="flex min-h-[72px] flex-col justify-between rounded-lg border border-line bg-inset p-1.5 text-right">
                  <span className="text-[10px] text-muted">W{wi + 1}</span>
                  {w.tradingDays > 0 && (
                    <span className="flex flex-col items-end">
                      <span className={cn("num text-[13px] font-semibold", w.netPnl > 0 ? "text-profit" : w.netPnl < 0 ? "text-loss" : "text-ink")}>{compactMoney(w.netPnl, sym)}</span>
                      <span className="text-[10px] text-muted">
                        {w.tradingDays} {w.tradingDays === 1 ? "day" : "days"} · {w.trades}
                      </span>
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
