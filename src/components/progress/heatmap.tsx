import Link from "next/link";
import { cn } from "@/lib/cn";
import type { HeatDay } from "@/lib/progress/build";
import { addDays } from "@/lib/progress/evaluate";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ROWS = ["Mon", "", "Wed", "", "Fri", "", "Sun"];
const SHADE = ["transparent", "color-mix(in srgb, var(--profit) 22%, transparent)", "color-mix(in srgb, var(--profit) 42%, transparent)", "color-mix(in srgb, var(--profit) 68%, transparent)", "var(--profit)"];

const mondayIndex = (day: string) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;

/** A year of discipline scores, one square per day (GitHub style). Each square links to that day's details. */
export function Heatmap({ days, focusDay, href }: { days: HeatDay[]; focusDay: string; href: (day: string) => string }) {
  if (!days.length) return null;
  const lead = mondayIndex(days[0].day);
  const start = addDays(days[0].day, -lead);
  const byDay = new Map(days.map((d) => [d.day, d]));
  const last = days[days.length - 1].day;
  const weeks: string[][] = [];
  for (let w = start; w <= last; w = addDays(w, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => addDays(w, i)));

  return (
    <div className="overflow-x-auto pb-1">
      <div className="inline-flex gap-1" role="grid" aria-label="Discipline score by day over the last year">
        <div className="flex flex-col gap-[3px] pt-5 pr-1 text-[10px] text-muted">
          {ROWS.map((r, i) => (
            <span key={i} className="h-[13px] leading-[13px]">
              {r}
            </span>
          ))}
        </div>
        {weeks.map((week, wi) => {
          const first = week.find((d) => byDay.has(d));
          const showMonth = first && (wi === 0 || first.slice(0, 7) !== weeks[wi - 1].find((d) => byDay.has(d))?.slice(0, 7));
          return (
            <div key={week[0]} className="flex flex-col gap-[3px]" role="row">
              <span className="h-4 text-[10px] leading-4 text-muted">{showMonth ? MONTHS[Number(first.slice(5, 7)) - 1] : ""}</span>
              {week.map((day) => {
                const d = byDay.get(day);
                if (!d) return <span key={day} className="h-[13px] w-[13px]" />;
                const label = !d.trading ? `${day}: not a trading day` : d.total ? `${day}: ${d.followed} of ${d.total} rules followed` : `${day}: nothing to judge`;
                return (
                  <Link
                    key={day}
                    role="gridcell"
                    href={href(day)}
                    title={label}
                    aria-label={label}
                    className={cn("h-[13px] w-[13px] rounded-[3px] border", day === focusDay ? "border-ink" : "border-line", !d.trading && "opacity-40")}
                    style={{ background: SHADE[d.level] }}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-muted">
        Fewer rules followed
        {SHADE.map((s, i) => (
          <span key={i} className="h-[13px] w-[13px] rounded-[3px] border border-line" style={{ background: s }} />
        ))}
        All followed
      </div>
    </div>
  );
}
