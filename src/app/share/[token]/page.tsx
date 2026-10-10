import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ExecutionsTable } from "@/components/trades/executions-table";
import { RunningPnl } from "@/components/trades/running-pnl";
import { TradeChart } from "@/components/trades/trade-chart";
import { TradeStats } from "@/components/trades/trade-stats";
import { Card } from "@/components/ui/card";
import { Pill, ResultPill, SidePill } from "@/components/ui/pill";
import { Pnl } from "@/components/ui/pnl";
import { duration } from "@/lib/format";
import { loadTradeDetail } from "@/lib/queries/trade-detail";
import { settingsFor } from "@/lib/queries/trade-list";
import { fmtDateTime, offsetMinutesAt } from "@/lib/time";

// shared links are private by obscurity: keep them out of search engines
export const metadata: Metadata = { title: "Shared trade · Ledger.", robots: { index: false, follow: false } };

/** Public, read-only view of one trade. Reachable only with its unguessable token; shows no notes, tags or screenshots. */
export default async function SharedTradePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await loadTradeDetail({ shareToken: token });
  if (!t) notFound();
  const { tz } = await settingsFor();
  const off = offsetMinutesAt(new Date(t.openedAt), tz);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-accent">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0D1015" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 17l5-5 4 4 7-8" />
            </svg>
          </div>
          <span className="text-base font-bold">
            Ledger<span className="text-accent">.</span>
          </span>
        </div>
        <span className="text-xs text-muted">Shared trade · read-only</span>
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
            {t.holdSeconds != null && ` · held ${duration(t.holdSeconds)}`}
          </p>
        </div>
        <Pnl value={t.netPnl} currency={t.currency} className="text-[28px] font-semibold" />
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="self-start">
          <TradeStats t={t} tz={tz} publicView />
        </Card>
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <h2 className="mb-3 text-[15px] font-semibold">Chart</h2>
            <TradeChart src={`/api/share/${token}/chart`} defaultTf="M15" height={380} tzOffsetMin={off} />
          </Card>
          <Card>
            <h2 className="mb-3 text-[15px] font-semibold">Running P&amp;L</h2>
            <RunningPnl src={`/api/share/${token}/running`} currency={t.currency} timezoneOffsetMin={off} />
          </Card>
          <Card>
            <h2 className="mb-3 text-[15px] font-semibold">Executions</h2>
            <ExecutionsTable t={t} tz={tz} />
          </Card>
        </div>
      </div>
    </main>
  );
}
