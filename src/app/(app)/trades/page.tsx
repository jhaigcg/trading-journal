import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { KpiTile } from "@/components/kpi/kpi-tile";
import { FilterBar } from "@/components/layout/filter-bar";
import { PageHeader } from "@/components/layout/page-header";
import { MiniCalendar } from "@/components/trades/mini-calendar";
import { Pager } from "@/components/trades/pager";
import { DayCard, WeekCard } from "@/components/trades/period-cards";
import { Spark } from "@/components/trades/spark";
import { TradesBrowser } from "@/components/trades/trades-browser";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { isYearMonth } from "@/lib/calendar";
import { displayCurrency } from "@/lib/fx";
import { parseFilters, type Filters } from "@/lib/filters/params";
import { money, pct, ratio } from "@/lib/format";
import { loadCalendarMonth } from "@/lib/queries/dashboard";
import { loadFilterOptions } from "@/lib/queries/options";
import { PAGE_SIZES, isSortKey, listDayCards, listTrades, listWeekCards, loadListSummary, type SortKey } from "@/lib/queries/trade-list";
import { dayKey } from "@/lib/time";

export const metadata: Metadata = { title: "Trades" };

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const VIEWS = [
  ["day", "Day"],
  ["week", "Week"],
  ["all", "All trades"],
] as const;

export default async function TradesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const options = await loadFilterOptions();
  const view = (VIEWS.map((v) => v[0]) as string[]).includes(first(sp.view) ?? "") ? (first(sp.view) as "day" | "week" | "all") : "day";

  // every link on this page keeps the active filters
  const keep = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") keep.set(k, v);
  const href = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(keep);
    q.delete("preview");
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    return `/trades?${q.toString()}`;
  };

  return (
    <>
      <PageHeader title="Trades">
        <Suspense>
          <FilterBar options={options}>
            <Link href="/trades/new" className="inline-flex min-h-10 items-center rounded-control bg-ink px-4 text-[13px] font-semibold text-bg hover:bg-white">
              + Add trade
            </Link>
          </FilterBar>
        </Suspense>
      </PageHeader>

      <nav aria-label="Trades view" className="mb-5 inline-flex rounded-control border border-line p-0.5 text-[13px]">
        {VIEWS.map(([k, label]) => (
          <Link key={k} href={href({ view: k, page: null, date: null })} aria-current={view === k ? "page" : undefined} className={cn("flex min-h-9 items-center rounded-md px-4", view === k ? "bg-nav-active font-semibold text-ink" : "text-muted hover:text-ink")}>
            {label}
          </Link>
        ))}
      </nav>

      <Suspense key={JSON.stringify(sp)} fallback={<div className="h-64 animate-pulse rounded-card border border-line bg-card" aria-busy="true" aria-label="Loading trades" />}>
        <TradesBody view={view} sp={sp} href={href} options={options} />
      </Suspense>
    </>
  );
}

async function TradesBody({ view, sp, href, options }: { view: "day" | "week" | "all"; sp: Params; href: (p: Record<string, string | null>) => string; options: Awaited<ReturnType<typeof loadFilterOptions>> }) {
  const raw = parseFilters(sp);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(first(sp.date) ?? "") ? first(sp.date)! : undefined;
  const f: Filters = date ? { ...raw, range: "custom", from: date, to: date } : raw;
  const { currency, fx } = await displayCurrency(raw.ccy);
  const page = Math.max(1, Number(first(sp.page)) || 1);

  if (view === "all") return <AllView f={f} sp={sp} href={href} options={options} currency={currency} fx={fx} page={page} />;

  const today = dayKey(new Date(), options.timezone);
  const month = isYearMonth(first(sp.month)) ? first(sp.month)! : (date ?? today).slice(0, 7);

  if (view === "week") {
    const size = 8;
    const { cards, totalWeeks } = await listWeekCards(f, { page, size });
    return (
      <>
        <div className="flex flex-col gap-3">
          {cards.length === 0 && <EmptyCard />}
          {cards.map((c) => {
            const end = new Date(`${c.key}T00:00:00Z`);
            end.setUTCDate(end.getUTCDate() + 6);
            const scaled = { ...c, netPnl: c.netPnl * fx, grossPnl: c.grossPnl * fx, costs: c.costs * fx, bestDay: c.bestDay * fx, worstDay: c.worstDay * fx };
            return <WeekCard key={c.key} c={scaled} currency={currency} viewHref={href({ view: "day", range: "custom", from: c.key, to: end.toISOString().slice(0, 10), page: null })} />;
          })}
        </div>
        <Pager page={page} total={totalWeeks} size={size} unit="weeks" hrefFor={(p) => href({ page: String(p) })} />
      </>
    );
  }

  const size = 10;
  const [{ cards, totalDays }, cal] = await Promise.all([listDayCards(f, { page, size }), loadCalendarMonth({ ...raw, range: "month" }, month)]);
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_280px]">
      <div>
        {date && (
          <p className="mb-3 text-sm text-muted">
            Showing {date}.{" "}
            <Link href={href({ date: null, range: null, from: null, to: null })} className="text-accent underline">
              Show all days
            </Link>
          </p>
        )}
        <div className="flex flex-col gap-3">
          {cards.length === 0 && <EmptyCard />}
          {cards.map((c) => {
            const scaled = { ...c, netPnl: c.netPnl * fx, grossPnl: c.grossPnl * fx, costs: c.costs * fx, intraday: c.intraday.map((v) => v * fx) };
            return <DayCard key={c.key} c={scaled} currency={currency} viewHref={href({ view: "all", range: "custom", from: c.key, to: c.key, page: null })} />;
          })}
        </div>
        <Pager page={page} total={totalDays} size={size} unit="days" hrefFor={(p) => href({ page: String(p) })} />
      </div>
      <aside className="lg:sticky lg:top-4 lg:self-start">
        <MiniCalendar month={month} today={today} buckets={cal.map((b) => ({ ...b, netPnl: b.netPnl }))} selected={date} dayHref={(d) => href({ view: "day", date: d, page: null })} monthHref={(m) => href({ month: m })} />
      </aside>
    </div>
  );
}

const EmptyCard = () => <Card className="py-14 text-center text-sm text-muted">No trades match these filters.</Card>;

async function AllView({ f, sp, href, options, currency, fx, page }: { f: Filters; sp: Params; href: (p: Record<string, string | null>) => string; options: Awaited<ReturnType<typeof loadFilterOptions>>; currency: string; fx: number; page: number }) {
  const sort: SortKey = isSortKey(first(sp.sort)) ? (first(sp.sort) as SortKey) : "closedAt";
  const dir = first(sp.dir) === "asc" ? "asc" : "desc";
  const size = (PAGE_SIZES as readonly number[]).includes(Number(first(sp.size))) ? Number(first(sp.size)) : 50;

  const [list, sum] = await Promise.all([listTrades(f, { sort, dir, page, size }), loadListSummary(f)]);
  const s = sum.summary;
  const rows = list.rows.map((r) => ({ ...r, netPnl: r.netPnl * fx }));

  // clicking the active column flips direction; a new column starts descending (ascending for text)
  const sortHref = Object.fromEntries(
    (["openedAt", "closedAt", "symbol", "side", "status", "avgEntry", "avgExit", "netPnl", "netRoi", "quantity", "insights"] as SortKey[]).map((k) => [
      k,
      href({ sort: k, dir: k === sort ? (dir === "asc" ? "desc" : "asc") : k === "symbol" || k === "side" || k === "status" ? "asc" : "desc", page: null }),
    ]),
  );
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && !["page", "size", "sort", "dir", "preview", "view"].includes(k)) params[k] = v;
  const query = new URLSearchParams(params).toString();

  return (
    <>
      <section aria-label="Summary" className="mb-5 grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
        <KpiTile label={`Net cumulative P&L · ${s.count} trades`} value={money(s.netPnl * fx, currency)} tone={s.netPnl > 0 ? "profit" : s.netPnl < 0 ? "loss" : undefined}>
          <Spark values={sum.spark.map((v) => v * fx)} width={220} height={36} className="mt-2 h-9 w-full" />
        </KpiTile>
        <KpiTile label="Profit factor" value={ratio(s.profitFactor)} />
        <KpiTile label="Trade win %" value={pct(s.winRate)} sub={`${s.wins} W · ${s.breakevens} BE · ${s.losses} L`} />
        <KpiTile label="Avg win / avg loss" value={ratio(s.avgWinLossRatio)} sub={`${money(s.avgWin * fx, currency, { decimals: 0, signed: false })} / ${money(s.avgLoss * fx, currency, { decimals: 0 })}`} />
      </section>

      <TradesBrowser rows={rows} total={list.total} avgAbs={list.avgAbs * fx} currency={currency} options={options} sort={sort} dir={dir} sortHref={sortHref} params={params} query={query} />
      <Pager page={page} total={list.total} size={size} sizes={PAGE_SIZES} hrefFor={(p, sz) => href({ page: String(p), size: String(sz) })} />
    </>
  );
}
