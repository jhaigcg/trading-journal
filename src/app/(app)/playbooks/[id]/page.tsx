import type { Metadata } from "next";
import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CumulativeChart } from "@/components/charts/charts";
import { KpiTile } from "@/components/kpi/kpi-tile";
import { FilterBar } from "@/components/layout/filter-bar";
import { MissedTrades } from "@/components/playbooks/missed-trades";
import { NewPlaybookNoteButton } from "@/components/playbooks/new-note-button";
import { PlaybookHeader } from "@/components/playbooks/playbook-header";
import { RulesEditor } from "@/components/playbooks/rules-editor";
import { Card } from "@/components/ui/card";
import { SidePill } from "@/components/ui/pill";
import { Pnl } from "@/components/ui/pnl";
import { Tabs } from "@/components/ui/tabs";
import { displayCurrency } from "@/lib/fx";
import { parseFilters } from "@/lib/filters/params";
import { duration, money, pct, ratio } from "@/lib/format";
import { loadFilterOptions } from "@/lib/queries/options";
import { loadPlaybook } from "@/lib/queries/playbooks";
import { fmtDateTime, fmtShortDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Playbook" };

type Params = Record<string, string | string[] | undefined>;

const localNow = (tz: string) => format(new TZDate(new Date(), tz), "yyyy-MM-dd'T'HH:mm");

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--row-line)] py-2 text-[13px]">
      <dt className="text-muted">{label}</dt>
      <dd className="num text-right">{children}</dd>
    </div>
  );
}

export default async function PlaybookPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Params> }) {
  const { id } = await params;
  const sp = await searchParams;
  const f = parseFilters(sp);
  const [p, options, cur] = await Promise.all([loadPlaybook(id, f), loadFilterOptions(), displayCurrency(f.ccy)]);
  if (!p) notFound();
  const { currency, fx } = cur;
  const tz = options.timezone;
  const s = p.summary;
  const m = (v: number, signed = true) => money(v * fx, currency, { signed });
  const dash = <span className="text-muted">—</span>;

  const keep = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") keep.set(k, v);
  const allTrades = `/trades?${new URLSearchParams({ ...Object.fromEntries(keep), view: "all", strategy: id }).toString()}`;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href={`/playbooks${keep.toString() ? `?${keep.toString()}` : ""}`} className="text-sm text-muted hover:text-ink">
          ← Playbooks
        </Link>
        <Suspense>
          <FilterBar options={options} />
        </Suspense>
      </div>

      <PlaybookHeader id={p.id} name={p.name} description={p.description} color={p.color} archived={p.archived} coverUrl={p.coverUrl} />

      <section aria-label="Key numbers" className="mb-5 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
        <KpiTile label="Net P&L" value={m(s.netPnl)} tone={s.netPnl > 0 ? "profit" : s.netPnl < 0 ? "loss" : undefined} />
        <KpiTile label="Win rate" value={s.wins + s.losses ? pct(s.winRate) : "—"} sub={`${s.wins} W · ${s.losses} L`} />
        <KpiTile label="Trades" value={String(s.count)} />
        <KpiTile label="Profit factor" value={ratio(s.profitFactor)} />
        <KpiTile label="Daily win rate" value={p.days.days ? pct(p.days.dayWinRate) : "—"} sub={`${p.days.green} green · ${p.days.red} red days`} />
        <KpiTile label="Avg duration" value={s.avgHoldSeconds ? duration(s.avgHoldSeconds) : "—"} />
      </section>

      <Card>
        <Tabs
          tabs={[
            {
              id: "stats",
              label: "Stats",
              content: (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                  <div>
                    <h3 className="mb-2 text-[15px] font-semibold">Cumulative net P&amp;L</h3>
                    <CumulativeChart data={p.curve.map((c) => ({ label: c.label, value: c.value * fx }))} currency={currency} />
                  </div>
                  <dl>
                    <Metric label="Gross P&L">{m(s.grossPnl)}</Metric>
                    <Metric label="Fees">{m(s.fees, false)}</Metric>
                    <Metric label="Avg winner">{s.wins ? m(s.avgWin) : dash}</Metric>
                    <Metric label="Avg loser">{s.losses ? m(s.avgLoss) : dash}</Metric>
                    <Metric label="Avg win / avg loss">{ratio(s.avgWinLossRatio)}</Metric>
                    <Metric label="Expectancy">{s.count ? m(s.expectancy) : dash}</Metric>
                    <Metric label="Avg net per trade">{s.count ? m(s.avgNetPerTrade) : dash}</Metric>
                    <Metric label="Best day">{p.days.days ? m(p.days.bestDay) : dash}</Metric>
                    <Metric label="Worst day">{p.days.days ? m(p.days.worstDay) : dash}</Metric>
                    <Metric label="Avg daily net">{p.days.days ? m(p.days.avgDailyNet) : dash}</Metric>
                    <Metric label="Avg planned R">{s.avgPlannedR == null ? dash : `${s.avgPlannedR.toFixed(2)}R`}</Metric>
                    <Metric label="Avg realized R">{s.avgRealizedR == null ? dash : `${s.avgRealizedR.toFixed(2)}R`}</Metric>
                    <Metric label="Volume">{s.volume.toFixed(2)} lots</Metric>
                    <Metric label="Rule compliance">{p.compliance == null ? dash : `${Math.round(p.compliance)}%`}</Metric>
                  </dl>
                </div>
              ),
            },
            { id: "rules", label: `Rules · ${p.groups.reduce((a, g) => a + g.rules.length, 0)}`, content: <RulesEditor strategyId={p.id} groups={p.groups} compliance={p.compliance} /> },
            {
              id: "trades",
              label: `Trades · ${s.count}`,
              content:
                p.recentTrades.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted">No trades with this playbook for these filters. Link trades to it from the Trades page.</p>
                ) : (
                  <div>
                    <ul>
                      {p.recentTrades.map((t) => (
                        <li key={t.id}>
                          <Link href={`/trades/${t.id}`} className="flex min-h-11 items-center justify-between gap-3 border-b border-[var(--row-line)] py-2 text-[13px] hover:bg-nav-active/40">
                            <span className="flex items-center gap-2">
                              <span className="font-semibold">{t.symbol}</span>
                              <SidePill side={t.side} />
                              <span className="num text-xs text-muted">{fmtShortDateTime(t.closedAt, tz)}</span>
                            </span>
                            <Pnl value={t.netPnl * fx} currency={currency} />
                          </Link>
                        </li>
                      ))}
                    </ul>
                    <Link href={allTrades} className="mt-3 inline-block text-xs text-accent hover:underline">
                      See all {s.count} in Trades →
                    </Link>
                  </div>
                ),
            },
            {
              id: "missed",
              label: `Missed · ${p.missed.length}`,
              content: <MissedTrades strategyId={p.id} items={p.missed} tz={tz} defaultWhen={localNow(tz)} />,
            },
            {
              id: "notes",
              label: `Notes · ${p.notes.length}`,
              content: (
                <div className="flex flex-col gap-3">
                  <div>
                    <NewPlaybookNoteButton strategyId={p.id} />
                  </div>
                  {p.notes.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted">No notes about this playbook yet. Write down what you have learned about the setup.</p>
                  ) : (
                    <ul>
                      {p.notes.map((n) => (
                        <li key={n.id}>
                          <Link href={`/notebook?note=${n.id}`} className="flex min-h-11 items-center justify-between gap-3 border-b border-[var(--row-line)] py-2 text-[13px] hover:bg-nav-active/40">
                            <span className="truncate font-semibold">{n.title || "Untitled note"}</span>
                            <span className="num shrink-0 text-xs text-muted">{fmtDateTime(n.updatedAt, tz)}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ),
            },
          ]}
        />
      </Card>
    </>
  );
}
