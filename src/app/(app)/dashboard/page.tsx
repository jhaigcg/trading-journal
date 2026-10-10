import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BalanceChart, CumulativeChart, DailyBars, DrawdownChart, ScoreRadar } from "@/components/charts/charts";
import { PnlRing, ScoreScale, SegmentGauge, WinLossBar } from "@/components/kpi/gauges";
import { KpiTile } from "@/components/kpi/kpi-tile";
import { DayModal } from "@/components/kpi/day-modal";
import { PnlCalendar } from "@/components/kpi/pnl-calendar";
import { RecentTrades, type TradeListRow } from "@/components/kpi/recent-trades";
import { FilterBar } from "@/components/layout/filter-bar";
import { PageHeader } from "@/components/layout/page-header";
import { ResyncButton } from "@/components/sync/sync-controls";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { isYearMonth } from "@/lib/calendar";
import { db } from "@/lib/db";
import { parseFilters, type Filters } from "@/lib/filters/params";
import { money, pct, ratio } from "@/lib/format";
import { PERFORMANCE_SCORE_FORMULA } from "@/lib/metrics";
import { loadDayDetail } from "@/lib/queries/day-detail";
import { loadCalendarMonth, loadDashboard, type TradeRow } from "@/lib/queries/dashboard";
import { loadFilterOptions } from "@/lib/queries/options";
import { dayKey, fmtDateTime, fmtShortDateTime } from "@/lib/time";
import { startMyDay } from "./actions";

export const metadata: Metadata = { title: "Dashboard" };

type Params = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const f = parseFilters(sp);
  const options = await loadFilterOptions();

  const accounts = await db.account.findMany({ where: { archived: false }, select: { id: true, lastSyncAt: true, metaapiAccountId: true, syncType: true } });
  const auto = accounts.filter((a) => a.syncType !== "MANUAL");
  const resyncIds = accounts.filter((a) => a.metaapiAccountId && (!f.account || a.id === f.account)).map((a) => a.id);
  const lastSync = auto.map((a) => a.lastSyncAt).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];

  return (
    <>
      <PageHeader title="Dashboard">
        <Suspense>
          <FilterBar options={options}>
            <form action={startMyDay}>
              <Button variant="light">Start my day</Button>
            </form>
          </FilterBar>
        </Suspense>
      </PageHeader>

      {auto.length > 0 && (
        <p className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>
            <span className="font-semibold text-ink-2">Last import:</span> {lastSync ? fmtDateTime(lastSync, options.timezone) : "never"}
          </span>
          {resyncIds.length > 0 && <ResyncButton accountIds={resyncIds} />}
        </p>
      )}

      <Suspense key={JSON.stringify(sp)} fallback={<DashboardSkeleton />}>
        <DashboardBody sp={sp} f={f} timezone={options.timezone} />
      </Suspense>
    </>
  );
}

async function DashboardBody({ sp, f, timezone }: { sp: Params; f: Filters; timezone: string }) {
  const cum = first(sp.cum) === "trade" ? "trade" : "daily";
  const today = dayKey(new Date(), timezone);
  const currentMonth = today.slice(0, 7);
  const calParam = first(sp.cal);
  const month = isYearMonth(calParam) ? calParam : currentMonth;

  const dayParam = first(sp.day);
  const [d, calDays, dayDetail] = await Promise.all([loadDashboard(f, { cum }), loadCalendarMonth(f, month), dayParam ? loadDayDetail(dayParam, f) : null]);
  const { summary: s, daySummary: ds, currency: ccy } = d;

  // every link keeps the active filters
  const keep = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && k !== "cal" && k !== "cum" && k !== "day") keep.set(k, v);
  const withParam = (extra: Record<string, string | null>) => {
    const q = new URLSearchParams(keep);
    for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
    const qs = q.toString();
    return qs ? `/dashboard?${qs}` : "/dashboard";
  };
  const hrefForMonth = (target: string | null) => withParam({ cal: target && target !== currentMonth ? target : null });
  const viewMore = `/trades?${new URLSearchParams({ ...Object.fromEntries(keep), view: "all" }).toString()}`;

  const toRow = (r: TradeRow): TradeListRow => ({ id: r.id, symbol: r.symbol, side: r.side, when: fmtShortDateTime(r.at, timezone), netPnl: r.netPnl, strategy: r.strategy });
  const toggle = (active: boolean) => `rounded-md px-2.5 py-1 ${active ? "bg-line text-ink" : "hover:text-ink"}`;

  return (
    <div className="flex flex-col gap-5">
      <section aria-label="Key metrics" className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-3">
        <KpiTile
          label={`Net P&L · ${s.count} trades`}
          value={money(s.netPnl, ccy)}
          tone={s.netPnl > 0 ? "profit" : s.netPnl < 0 ? "loss" : undefined}
          sub={`Gross ${money(s.grossPnl, ccy, { signed: false })} · Fees ${money(s.fees, ccy, { signed: false })}`}
        />
        <KpiTile
          label="Trade win %"
          value={pct(s.winRate)}
          aside={
            <SegmentGauge
              segments={[
                { value: s.wins, color: "var(--profit)", label: "wins" },
                { value: s.breakevens, color: "var(--muted)", label: "breakeven" },
                { value: s.losses, color: "var(--loss)", label: "losses" },
              ]}
            />
          }
        />
        <KpiTile label="Profit factor" value={ratio(s.profitFactor)} aside={<PnlRing profit={s.grossWin} loss={s.grossLoss} />} sub="Σ wins ÷ |Σ losses|" />
        <KpiTile
          label="Day win %"
          value={pct(ds.dayWinRate)}
          aside={
            <SegmentGauge
              segments={[
                { value: ds.green, color: "var(--profit)", label: "green days" },
                { value: ds.flat, color: "var(--muted)", label: "flat days" },
                { value: ds.red, color: "var(--loss)", label: "red days" },
              ]}
            />
          }
        />
        <KpiTile label="Avg win / avg loss trade" value={ratio(s.avgWinLossRatio)}>
          <div className="mt-2">
            <WinLossBar win={s.avgWin} loss={s.avgLoss} winLabel={money(s.avgWin, ccy, { decimals: 0, signed: false })} lossLabel={money(s.avgLoss, ccy, { decimals: 0 })} />
          </div>
        </KpiTile>
      </section>

      {!d.hasTrades && (
        <Card className="py-10 text-center text-sm text-muted">
          No closed trades match these filters. Try a wider date range or reset the filters, or connect your MT4 account in{" "}
          <Link className="text-accent" href="/accounts">
            Accounts &amp; import
          </Link>
          .
        </Card>
      )}

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card>
          <CardHeader
            title="Performance score"
            right={
              <span title={PERFORMANCE_SCORE_FORMULA} className="cursor-help underline decoration-dotted">
                How is this calculated?
              </span>
            }
          />
          <ScoreRadar data={d.score.components.map((c) => ({ label: c.label, value: c.value }))} />
          <ScoreScale score={d.score.score} empty={s.count === 0} />
        </Card>

        <Card>
          <CardHeader
            title="Daily net cumulative P&L"
            right={
              <span className="flex gap-1">
                <Link href={withParam({ cum: null })} className={toggle(cum === "daily")}>
                  Daily
                </Link>
                <Link href={withParam({ cum: "trade" })} className={toggle(cum === "trade")}>
                  Trade
                </Link>
              </span>
            }
          />
          <div className="mt-3">
            <CumulativeChart data={d.cumulative} currency={ccy} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Net daily P&L" />
          <div className="mt-3">
            <DailyBars data={d.dailyNet} currency={ccy} />
          </div>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <RecentTrades recent={d.recent.map(toRow)} open={d.open.map(toRow)} currency={ccy} viewMoreHref={viewMore} />
        <div className="lg:col-span-2">
          <PnlCalendar month={month} currentMonth={currentMonth} today={today} buckets={calDays} currency={ccy} hrefFor={hrefForMonth} dayHref={(day) => withParam({ cal: month !== currentMonth ? month : null, day })} />
          {dayDetail && (
            <DayModal
              detail={dayDetail}
              tz={timezone}
              closeHref={withParam({ cal: month !== currentMonth ? month : null })}
              detailsHref={`/trades?${new URLSearchParams({ view: "day", date: dayDetail.day }).toString()}`}
            />
          )}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader title="Account balance" right={d.balance.length ? `Now ${money(d.balance[d.balance.length - 1].balance, ccy, { signed: false })}` : undefined} />
          <div className="mt-3">
            <BalanceChart data={d.balance} currency={ccy} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Drawdown" right={d.maxDrawdown < 0 ? `Max ${money(d.maxDrawdown, ccy)}` : undefined} />
          <div className="mt-3">
            <DrawdownChart data={d.drawdown} currency={ccy} />
          </div>
        </Card>
      </section>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-5" aria-busy="true" aria-label="Loading dashboard">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-3">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-[104px] rounded-card border border-line bg-card" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="h-[340px] rounded-card border border-line bg-card" />
        ))}
      </div>
    </div>
  );
}
