import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FilterBar } from "@/components/layout/filter-bar";
import { PageHeader } from "@/components/layout/page-header";
import { NewPlaybook } from "@/components/playbooks/new-playbook";
import { Card } from "@/components/ui/card";
import { Pnl } from "@/components/ui/pnl";
import { cn } from "@/lib/cn";
import { displayCurrency } from "@/lib/fx";
import { parseFilters } from "@/lib/filters/params";
import { money, pct, ratio } from "@/lib/format";
import { MIN_TRADES_FOR_WIN_RATE, highlights, listPlaybooks, type PlaybookRow } from "@/lib/queries/playbooks";
import { loadFilterOptions } from "@/lib/queries/options";

export const metadata: Metadata = { title: "Playbooks" };

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function PlaybooksPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const f = parseFilters(sp);
  const tab = first(sp.tab) === "archived" ? "archived" : "active";
  const [options, rows, cur] = await Promise.all([loadFilterOptions(), listPlaybooks(f), displayCurrency(f.ccy)]);
  const { currency, fx } = cur;

  const hl = highlights(rows);
  const shown = rows.filter((r) => r.archived === (tab === "archived"));
  const keep = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && k !== "tab") keep.set(k, v);
  const tabHref = (t: string) => `/playbooks?${new URLSearchParams({ ...Object.fromEntries(keep), ...(t === "archived" ? { tab: "archived" } : {}) }).toString()}`;
  const detailHref = (id: string) => `/playbooks/${id}${keep.toString() ? `?${keep.toString()}` : ""}`;

  return (
    <>
      <PageHeader title="Playbooks">
        <Suspense>
          <FilterBar options={options}>
            <NewPlaybook />
          </FilterBar>
        </Suspense>
      </PageHeader>

      <section aria-label="Highlights" className="mb-5 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
        <Highlight label="Best performing" row={hl.best} href={detailHref} value={hl.best && <Pnl value={hl.best.summary.netPnl * fx} currency={currency} className="text-xl font-semibold" />} sub={hl.best && `${hl.best.summary.count} trades`} empty="No trades in this period" />
        <Highlight label="Least performing" row={hl.worst} href={detailHref} value={hl.worst && <Pnl value={hl.worst.summary.netPnl * fx} currency={currency} className="text-xl font-semibold" />} sub={hl.worst && `${hl.worst.summary.count} trades`} empty="Needs at least two playbooks with trades" />
        <Highlight label="Most active" row={hl.mostActive} href={detailHref} value={hl.mostActive && <span className="num text-xl font-semibold">{hl.mostActive.summary.count} trades</span>} sub={hl.mostActive && `Net ${money(hl.mostActive.summary.netPnl * fx, currency)}`} empty="No trades in this period" />
        <Highlight label="Best win rate" row={hl.bestWinRate} href={detailHref} value={hl.bestWinRate && <span className="num text-xl font-semibold">{pct(hl.bestWinRate.summary.winRate, 0)}</span>} sub={hl.bestWinRate && `${hl.bestWinRate.summary.wins} W · ${hl.bestWinRate.summary.losses} L`} empty={`Needs ${MIN_TRADES_FOR_WIN_RATE}+ trades`} />
      </section>

      <div className="mb-3 inline-flex rounded-control border border-line p-0.5 text-[13px]">
        {(["active", "archived"] as const).map((t) => (
          <Link key={t} href={tabHref(t)} aria-current={tab === t ? "page" : undefined} className={cn("flex min-h-9 items-center rounded-md px-4 capitalize", tab === t ? "bg-nav-active font-semibold text-ink" : "text-muted hover:text-ink")}>
            {t} · {rows.filter((r) => r.archived === (t === "archived")).length}
          </Link>
        ))}
      </div>

      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-medium">Playbook</th>
                <th className="px-3 py-3 text-right font-medium">Missed</th>
                <th className="px-3 py-3 text-right font-medium">Avg loser</th>
                <th className="px-3 py-3 text-right font-medium">Avg winner</th>
                <th className="px-3 py-3 text-right font-medium">Net P&amp;L</th>
                <th className="px-3 py-3 text-right font-medium">Profit factor</th>
                <th className="px-3 py-3 text-right font-medium">Trades</th>
                <th className="px-3 py-3 text-right font-medium">Expectancy</th>
                <th className="px-4 py-3 text-right font-medium">Win rate</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-muted">
                    {tab === "archived" ? "No archived playbooks." : "No playbooks yet. Create one from a starter template."}
                  </td>
                </tr>
              )}
              {shown.map((r) => (
                <Row key={r.id} r={r} fx={fx} currency={currency} href={detailHref(r.id)} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="mt-2 text-xs text-muted">Numbers follow the filters above. Win rate counts wins and losses only (breakevens excluded).</p>
    </>
  );
}

function Highlight({ label, row, href, value, sub, empty }: { label: string; row: PlaybookRow | null; href: (id: string) => string; value: React.ReactNode; sub: React.ReactNode; empty: string }) {
  return (
    <Card>
      <div className="text-xs text-muted">{label}</div>
      {row ? (
        <>
          <Link href={href(row.id)} className="mt-1.5 flex items-center gap-2 text-[14px] font-semibold hover:text-accent">
            <i className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: row.color }} />
            <span className="truncate">{row.name}</span>
          </Link>
          <div className="mt-2">{value}</div>
          <div className="mt-1 text-xs text-muted">{sub}</div>
        </>
      ) : (
        <p className="mt-3 text-sm text-muted">{empty}</p>
      )}
    </Card>
  );
}

function Row({ r, fx, currency, href }: { r: PlaybookRow; fx: number; currency: string; href: string }) {
  const s = r.summary;
  const none = s.count === 0;
  const dash = <span className="text-muted">—</span>;
  return (
    <tr className="border-b border-[var(--row-line)] hover:bg-nav-active/40">
      <td className="px-4 py-3">
        <Link href={href} className="flex items-center gap-2.5 font-semibold hover:text-accent">
          <i className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
          <span className="max-w-[340px] truncate">{r.name}</span>
        </Link>
      </td>
      <td className="num px-3 py-3 text-right">{r.missed}</td>
      <td className="num px-3 py-3 text-right text-loss">{s.losses ? money(s.avgLoss * fx, currency) : dash}</td>
      <td className="num px-3 py-3 text-right text-profit">{s.wins ? money(s.avgWin * fx, currency) : dash}</td>
      <td className="px-3 py-3 text-right">{none ? dash : <Pnl value={s.netPnl * fx} currency={currency} />}</td>
      <td className="num px-3 py-3 text-right">{none ? dash : ratio(s.profitFactor)}</td>
      <td className="num px-3 py-3 text-right">{s.count}</td>
      <td className="px-3 py-3 text-right">{none ? dash : <Pnl value={s.expectancy * fx} currency={currency} />}</td>
      <td className="num px-4 py-3 text-right">{s.wins + s.losses ? pct(s.winRate, 0) : dash}</td>
    </tr>
  );
}
