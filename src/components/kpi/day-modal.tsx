"use client";

import { Play, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { openDayJournal } from "@/app/(app)/dashboard/actions";
import { cn } from "@/lib/cn";
import { money, pct, pnlTone, ratio } from "@/lib/format";
import type { DayDetail } from "@/lib/queries/day-detail";

const TONE = { profit: "text-profit", loss: "text-loss", neutral: "text-ink" } as const;
const clock = (iso: string, tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(iso));
const longDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Pop-up for one calendar day: how the day went, and every trade in it with a way into the details and the replay. */
export function DayModal({ detail, tz, closeHref, detailsHref }: { detail: DayDetail; tz: string; closeHref: string; detailsHref: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && router.push(closeHref, { scroll: false });
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router, closeHref]);

  const s = detail.summary;
  const cur = detail.currency;
  const data = [{ t: "", value: 0 }, ...detail.running];
  const max = Math.max(...data.map((d) => d.value), 0);
  const min = Math.min(...data.map((d) => d.value), 0);
  const off = max <= 0 ? 0 : min >= 0 ? 1 : max / (max - min);
  const stat = (label: string, value: React.ReactNode) => (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="num mt-0.5 text-[15px] font-semibold">{value}</div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
      <Link href={closeHref} scroll={false} aria-label="Close" className="absolute inset-0 bg-black/60" />
      <div role="dialog" aria-modal="true" aria-label={`Trades on ${longDay(detail.day)}`} className="relative flex max-h-full w-full max-w-[860px] flex-col rounded-card border border-line-strong bg-card shadow-2xl">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h2 className="text-base font-semibold">{longDay(detail.day)}</h2>
            <span className="text-sm text-muted">
              Net P&amp;L <span className={cn("num font-semibold", TONE[pnlTone(s.netPnl)])}>{money(s.netPnl, cur)}</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" disabled={pending} onClick={() => start(() => openDayJournal(detail.day))} className="min-h-9 rounded-control border border-line-strong px-3 text-[13px] hover:bg-nav-active disabled:opacity-60">
              {pending ? "Opening…" : "Journal"}
            </button>
            <Link href={closeHref} scroll={false} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-control text-muted hover:bg-nav-active hover:text-ink">
              <X size={18} aria-hidden />
            </Link>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,260px)_1fr]">
            <div className="h-[120px]" role="img" aria-label="Running net P&L through the day">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="day-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset={0} stopColor="var(--profit)" stopOpacity={0.35} />
                      <stop offset={off} stopColor="var(--profit)" stopOpacity={0.05} />
                      <stop offset={off} stopColor="var(--loss)" stopOpacity={0.05} />
                      <stop offset={1} stopColor="var(--loss)" stopOpacity={0.35} />
                    </linearGradient>
                    <linearGradient id="day-stroke" x1="0" y1="0" x2="0" y2="1">
                      <stop offset={off} stopColor="var(--profit)" />
                      <stop offset={off} stopColor="var(--loss)" />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="t" hide />
                  <YAxis hide domain={[min, max]} />
                  <ReferenceLine y={0} stroke="var(--border)" />
                  <Area type="monotone" dataKey="value" stroke="url(#day-stroke)" strokeWidth={1.5} fill="url(#day-fill)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              {stat("Total trades", s.count)}
              {stat("Gross P&L", <span className={TONE[pnlTone(s.grossPnl)]}>{money(s.grossPnl, cur)}</span>)}
              {stat("Winners / losers", `${s.wins} / ${s.losses}`)}
              {stat("Fees & swap", money(s.fees, cur, { decimals: 2 }).replace(/^[+-]/, ""))}
              {stat("Win rate", s.wins + s.losses ? pct(s.winRate, 1) : "—")}
              {stat("Volume", s.volume.toFixed(2))}
              {stat("Profit factor", ratio(s.profitFactor))}
              {stat("Avg per trade", <span className={TONE[pnlTone(s.avgNetPerTrade)]}>{money(s.avgNetPerTrade, cur)}</span>)}
            </div>
          </div>

          {/* phones: a card per trade instead of a table that needs sideways scrolling */}
          <ul className="mt-5 flex flex-col gap-2 sm:hidden">
            {detail.trades.map((t) => (
              <li key={t.id}>
                <div role="button" tabIndex={0} onClick={() => router.push(`/trades/${t.id}`)} onKeyDown={(e) => e.key === "Enter" && router.push(`/trades/${t.id}`)} className="flex items-center gap-3 rounded-control border border-line p-3 active:bg-nav-active">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="num text-sm font-semibold">{clock(t.openedAt, tz)}</span>
                      <span className="rounded-full bg-nav-active px-2 py-0.5 text-xs">{t.symbol}</span>
                      <span className="text-xs text-ink-2">{t.side === "LONG" ? "Long" : "Short"}</span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted">
                      {t.realizedR == null ? "" : `${t.realizedR.toFixed(2)}R`}
                      {t.realizedR != null && t.strategy ? " · " : ""}
                      {t.strategy ?? ""}
                    </div>
                  </div>
                  <div className={cn("num shrink-0 text-right text-[15px] font-semibold", TONE[pnlTone(t.netPnl)])}>{money(t.netPnl, cur)}</div>
                  <Link href={`/replay?trade=${t.id}`} onClick={(e) => e.stopPropagation()} aria-label={`Replay the ${clock(t.openedAt, tz)} ${t.symbol} trade`} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-accent hover:bg-line">
                    <Play size={15} aria-hidden fill="currentColor" />
                  </Link>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-5 hidden overflow-x-auto rounded-control border border-line sm:block">
            <table className="w-full min-w-[600px] border-collapse text-[13px]">
              <thead>
                <tr className="bg-inset text-left text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-3 py-2.5 font-medium">Open time</th>
                  <th className="px-3 py-2.5 font-medium">Ticker</th>
                  <th className="px-3 py-2.5 font-medium">Side</th>
                  <th className="px-3 py-2.5 text-right font-medium">Net P&amp;L</th>
                  <th className="px-3 py-2.5 text-right font-medium">Net ROI</th>
                  <th className="px-3 py-2.5 text-right font-medium">R</th>
                  <th className="px-3 py-2.5 font-medium">Playbook</th>
                  <th className="px-3 py-2.5 text-center font-medium">Replay</th>
                </tr>
              </thead>
              <tbody>
                {detail.trades.map((t) => (
                  <tr key={t.id} onClick={() => router.push(`/trades/${t.id}`)} className="cursor-pointer border-t border-line hover:bg-nav-active">
                    <td className="px-3 py-2.5">
                      <Link href={`/trades/${t.id}`} className="num hover:text-accent">
                        {clock(t.openedAt, tz)}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="rounded-full bg-nav-active px-2.5 py-0.5 text-xs">{t.symbol}</span>
                    </td>
                    <td className="px-3 py-2.5">{t.side === "LONG" ? "Long" : "Short"}</td>
                    <td className={cn("num px-3 py-2.5 text-right", TONE[pnlTone(t.netPnl)])}>{money(t.netPnl, cur)}</td>
                    <td className="num px-3 py-2.5 text-right text-ink-2">{t.netRoi == null ? "—" : `${t.netRoi.toFixed(2)}%`}</td>
                    <td className="num px-3 py-2.5 text-right text-ink-2">{t.realizedR == null ? "—" : `${t.realizedR.toFixed(2)}R`}</td>
                    <td className="max-w-[170px] truncate px-3 py-2.5 text-ink-2" title={t.strategy ?? undefined}>{t.strategy ?? "—"}</td>
                    <td className="px-3 py-1.5 text-center">
                      <Link href={`/replay?trade=${t.id}`} onClick={(e) => e.stopPropagation()} aria-label={`Replay the ${clock(t.openedAt, tz)} ${t.symbol} trade`} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-accent hover:bg-line">
                        <Play size={14} aria-hidden fill="currentColor" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted">Times are in {tz}. Click a trade to open its details, or the play button to replay it.</p>
        </div>

        <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">
          <Link href={closeHref} scroll={false} className="inline-flex min-h-10 items-center rounded-control border border-line-strong px-5 text-[13px] hover:bg-nav-active">
            Cancel
          </Link>
          <Link href={detailsHref} className="inline-flex min-h-10 items-center rounded-control bg-accent px-5 text-[13px] font-semibold text-bg hover:bg-[var(--accent-hover)]">
            View details
          </Link>
        </footer>
      </div>
    </div>
  );
}
