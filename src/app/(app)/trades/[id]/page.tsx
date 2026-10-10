import type { Metadata } from "next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExecutionsTable } from "@/components/trades/executions-table";
import { Attachments } from "@/components/trades/attachments";
import { RuleChecklist } from "@/components/trades/rule-checklist";
import { RunningPnl } from "@/components/trades/running-pnl";
import { ShareControl } from "@/components/trades/share-control";
import { TagPicker } from "@/components/trades/tag-picker";
import { TradeChart } from "@/components/trades/trade-chart";
import { ReviewedButton, TradeFields } from "@/components/trades/trade-fields";
import { TradeNotes } from "@/components/trades/trade-notes";
import { TradeStats } from "@/components/trades/trade-stats";
import { Card } from "@/components/ui/card";
import { Pill, ResultPill, SidePill } from "@/components/ui/pill";
import { Pnl } from "@/components/ui/pnl";
import { Tabs } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";
import { parseFilters } from "@/lib/filters/params";
import { duration } from "@/lib/format";
import { loadFilterOptions } from "@/lib/queries/options";
import { loadDrawings } from "@/lib/drawings/store";
import { loadTradeDetail } from "@/lib/queries/trade-detail";
import { neighbours } from "@/lib/queries/trade-list";
import { fmtDateTime, offsetMinutesAt } from "@/lib/time";

export const metadata: Metadata = { title: "Trade" };

type Params = Record<string, string | string[] | undefined>;

export default async function TradeDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Params> }) {
  const { id } = await params;
  const sp = await searchParams;
  const t = await loadTradeDetail({ id });
  if (!t) notFound();

  const options = await loadFilterOptions();
  const tz = options.timezone;

  // prev/next walk the list the user came from; with no filters in the URL they walk every trade
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") q.set(k, v);
  const filters = q.size ? parseFilters(sp) : parseFilters({ range: "all", status: "all" });
  const nb = await neighbours(id, filters);
  const qs = q.toString() ? `?${q.toString()}` : "";
  const off = offsetMinutesAt(new Date(t.openedAt), tz);

  const navBtn = "flex h-10 w-10 items-center justify-center rounded-control border border-line-strong bg-card";
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href={`/trades${qs ? `${qs}${qs.includes("view=") ? "" : "&view=all"}` : "?view=all"}`} className="text-sm text-muted hover:text-ink">
          ← Trades
        </Link>
        <div className="flex items-center gap-2">
          {nb.prev ? (
            <Link href={`/trades/${nb.prev}${qs}`} aria-label="Previous trade" className={cn(navBtn, "hover:bg-nav-active")}>
              <ChevronLeft size={18} />
            </Link>
          ) : (
            <span aria-hidden className={cn(navBtn, "opacity-40")}>
              <ChevronLeft size={18} />
            </span>
          )}
          {nb.next ? (
            <Link href={`/trades/${nb.next}${qs}`} aria-label="Next trade" className={cn(navBtn, "hover:bg-nav-active")}>
              <ChevronRight size={18} />
            </Link>
          ) : (
            <span aria-hidden className={cn(navBtn, "opacity-40")}>
              <ChevronRight size={18} />
            </span>
          )}
          <ReviewedButton tradeId={t.id} reviewed={t.reviewed} />
          {t.status === "CLOSED" && (
            <Link href={`/replay?trade=${t.id}`} className="inline-flex min-h-10 items-center rounded-control border border-line-strong px-3.5 text-[13px] hover:bg-nav-active">
              Replay
            </Link>
          )}
          <ShareControl tradeId={t.id} token={t.shareToken} />
        </div>
      </div>

      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[26px] font-semibold">{t.symbol}</h1>
            <SidePill side={t.side} />
            {t.status === "OPEN" ? <Pill className="bg-long-bg text-long">OPEN</Pill> : t.result && <ResultPill result={t.result === "BREAKEVEN" ? "BE" : t.result} />}
          </div>
          <p className="num mt-1 text-xs text-muted">
            {fmtDateTime(new Date(t.openedAt), tz)}
            {t.closedAt && ` → ${fmtDateTime(new Date(t.closedAt), tz)}`}
            {t.holdSeconds != null && ` · held ${duration(t.holdSeconds)}`} · {t.accountName}
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted">Net P&amp;L</div>
          <Pnl value={t.netPnl} currency={t.currency} className="text-[28px] font-semibold" />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[400px_minmax(0,1fr)]">
        <Card className="self-start">
          <Tabs
            tabs={[
              {
                id: "stats",
                label: "Stats",
                content: (
                  <div className="flex flex-col gap-5">
                    <TradeFields t={t} strategies={options.strategies} />
                    <TradeStats t={t} tz={tz} />
                  </div>
                ),
              },
              { id: "strategy", label: "Strategy", content: <RuleChecklist t={t} /> },
              { id: "tags", label: "Tags", content: <TagPicker tradeId={t.id} selected={t.tags.map((x) => x.id)} groups={options.tagGroups} /> },
              { id: "executions", label: "Executions", content: <ExecutionsTable t={t} tz={tz} /> },
              { id: "attachments", label: `Screenshots${t.attachments.length ? ` · ${t.attachments.length}` : ""}`, content: <Attachments t={t} /> },
            ]}
          />
        </Card>

        <div className="flex min-w-0 flex-col gap-4 self-start">
          <Card>
            <TradeChart src={`/api/trades/${t.id}/chart`} defaultTf="M15" height={470} tzOffsetMin={off} tradeId={t.id} initialDrawings={await loadDrawings(t.id)} />
          </Card>
          <Card>
            <Tabs
              tabs={[
                { id: "notes", label: "Journal", content: <TradeNotes tradeId={t.id} day={t.openDay} /> },
                { id: "running", label: "Running P&L", content: <RunningPnl src={`/api/trades/${t.id}/running`} currency={t.currency} timezoneOffsetMin={off} /> },
              ]}
            />
          </Card>
        </div>
      </div>
    </>
  );
}
