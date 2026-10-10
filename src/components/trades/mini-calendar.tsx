import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { buildMonthGrid, shiftMonth } from "@/lib/calendar";
import { cn } from "@/lib/cn";
import type { DayBucket } from "@/lib/metrics";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Compact month picker for the Day view: days with trades are tinted by result and link to that day. */
export function MiniCalendar({
  month,
  today,
  buckets,
  dayHref,
  monthHref,
  selected,
}: {
  month: string;
  today: string;
  buckets: DayBucket[];
  dayHref: (day: string) => string;
  monthHref: (m: string) => string;
  selected?: string;
}) {
  const weeks = buildMonthGrid(month, buckets, today);
  const [y, m] = month.split("-").map(Number);
  return (
    <Card className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <Link href={monthHref(shiftMonth(month, -1))} aria-label="Previous month" className="flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-nav-active hover:text-ink">
          <ChevronLeft size={15} />
        </Link>
        <span className="text-[13px] font-semibold">
          {MONTHS[m - 1]} {y}
        </span>
        <Link href={monthHref(shiftMonth(month, 1))} aria-label="Next month" className="flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-nav-active hover:text-ink">
          <ChevronRight size={15} />
        </Link>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-muted">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {weeks.flatMap((w, wi) =>
          w.cells.map((c, i) => {
            if (!c.date) return <span key={`blank-${wi}-${i}`} />;
            const traded = c.netPnl !== null;
            const cls = cn(
              "flex h-8 items-center justify-center rounded-md text-[11px]",
              !traded && "text-muted",
              traded && c.netPnl! > 0 && "bg-profit-bg text-profit",
              traded && c.netPnl! < 0 && "bg-loss-bg text-loss",
              traded && c.netPnl === 0 && "bg-line text-ink-2",
              c.isToday && "outline outline-1 outline-accent",
              selected === c.date && "ring-2 ring-ink",
            );
            return traded ? (
              <Link key={c.date} href={dayHref(c.date)} className={cn(cls, "num font-semibold hover:brightness-125")} title={`${c.trades} trades`}>
                {c.day}
              </Link>
            ) : (
              <span key={c.date} className={cls}>
                {c.day}
              </span>
            );
          }),
        )}
      </div>
    </Card>
  );
}
