import Link from "next/link";
import { openDayNote } from "@/app/(app)/trades/actions";
import { Card } from "@/components/ui/card";
import { Pnl } from "@/components/ui/pnl";
import { money, pct, ratio } from "@/lib/format";
import type { PeriodCard } from "@/lib/queries/trade-list";
import { Spark } from "./spark";

const profitFactor = (c: PeriodCard) => (c.grossLoss === 0 ? null : c.grossWin / Math.abs(c.grossLoss));
const winRate = (c: PeriodCard) => (c.wins + c.losses ? c.wins / (c.wins + c.losses) : 0);

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="num mt-0.5 truncate text-[13px]">{children}</dd>
    </div>
  );
}

const longDate = (key: string) => new Date(`${key}T00:00:00Z`).toLocaleDateString("en-AU", { weekday: "short", day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

/** One trading day: net P&L, the intraday curve and the numbers for that day. */
export function DayCard({ c, currency, viewHref }: { c: PeriodCard; currency: string; viewHref: string }) {
  return (
    <Card id={`day-${c.key}`} className="scroll-mt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold">{longDate(c.key)}</h3>
          <Pnl value={c.netPnl} currency={currency} className="text-xl font-semibold" />
        </div>
        <Spark values={c.intraday} width={150} height={44} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-3 sm:grid-cols-4">
        <Stat label="Total trades">{c.trades}</Stat>
        <Stat label="Gross P&L">
          <Pnl value={c.grossPnl} currency={currency} />
        </Stat>
        <Stat label="Winners">
          <span className="text-profit">{c.wins}</span>
        </Stat>
        <Stat label="Losers">
          <span className="text-loss">{c.losses}</span>
        </Stat>
        <Stat label="Commissions">{money(c.costs, currency, { signed: false })}</Stat>
        <Stat label="Win rate">{pct(winRate(c), 0)}</Stat>
        <Stat label="Volume">{c.volume.toFixed(2)} lots</Stat>
        <Stat label="Profit factor">{ratio(profitFactor(c))}</Stat>
      </dl>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-xs">
        <span className="text-muted">
          {c.notes} {c.notes === 1 ? "note" : "notes"}
        </span>
        <span className="flex items-center gap-2">
          <form action={openDayNote.bind(null, c.key)}>
            <button className="min-h-9 rounded-control border border-line-strong px-3 hover:bg-nav-active">Add note</button>
          </form>
          <Link href={viewHref} className="inline-flex min-h-9 items-center rounded-control border border-line-strong px-3 hover:bg-nav-active">
            View trades
          </Link>
        </span>
      </div>
    </Card>
  );
}

/** One trading week (Monday start). */
export function WeekCard({ c, currency, viewHref }: { c: PeriodCard; currency: string; viewHref: string }) {
  const start = new Date(`${c.key}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const short = (d: Date) => d.toLocaleDateString("en-AU", { day: "2-digit", month: "short", timeZone: "UTC" });
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[15px] font-semibold">
            Week of {short(start)} – {short(end)}
          </h3>
          <Pnl value={c.netPnl} currency={currency} className="text-xl font-semibold" />
        </div>
        <Link href={viewHref} className="inline-flex min-h-9 items-center rounded-control border border-line-strong px-3 text-xs hover:bg-nav-active">
          View days
        </Link>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-3 sm:grid-cols-4">
        <Stat label="Total trades">{c.trades}</Stat>
        <Stat label="Days traded">{c.days}</Stat>
        <Stat label="Win rate">{pct(winRate(c), 0)}</Stat>
        <Stat label="Profit factor">{ratio(profitFactor(c))}</Stat>
        <Stat label="Best day">
          <Pnl value={c.bestDay} currency={currency} />
        </Stat>
        <Stat label="Worst day">
          <Pnl value={c.worstDay} currency={currency} />
        </Stat>
        <Stat label="Commissions">{money(c.costs, currency, { signed: false })}</Stat>
        <Stat label="Volume">{c.volume.toFixed(2)} lots</Stat>
      </dl>
    </Card>
  );
}
