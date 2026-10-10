import type { Metadata } from "next";
import { Check, Minus, X } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Heatmap } from "@/components/progress/heatmap";
import { ManualToggle, RuleActions, RuleDialog, StarterRules, TradingDays } from "@/components/progress/rule-controls";
import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { currencySymbol, money, pct } from "@/lib/format";
import { db } from "@/lib/db";
import { describeRule, type Verdict } from "@/lib/progress/evaluate";
import { PERIODS, loadProgress } from "@/lib/queries/progress";

export const metadata: Metadata = { title: "Progress" };

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const nice = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function Mark({ v }: { v: Verdict }) {
  if (v === true) return <span className="inline-flex items-center gap-1 text-profit"><Check size={14} aria-hidden /> Followed</span>;
  if (v === false) return <span className="inline-flex items-center gap-1 text-loss"><X size={14} aria-hidden /> Missed</span>;
  return <span className="inline-flex items-center gap-1 text-muted"><Minus size={14} aria-hidden /> Not applicable yet</span>;
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <Card>
      <div className="text-xs text-muted">{label}</div>
      <div className="num mt-1 text-2xl font-semibold">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </Card>
  );
}

export default async function ProgressPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const p = await loadProgress({ period: first(sp.period), day: first(sp.day) });
  const settings = await db.setting.findUnique({ where: { id: 1 } });
  const home = settings?.displayCurrency ?? "AUD";
  const sym = currencySymbol(home);

  const href = (extra: Record<string, string | null>) => {
    const q = new URLSearchParams();
    if (p.period.key !== "30d") q.set("period", p.period.key);
    if (p.focusDay !== p.today) q.set("day", p.focusDay);
    for (const [k, v] of Object.entries(extra)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    const s = q.toString();
    return `/progress${s ? `?${s}` : ""}`;
  };
  const isToday = p.focusDay === p.today;
  const none = p.rows.length === 0;

  return (
    <>
      <PageHeader title="Progress">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-control border border-line p-0.5 text-[13px]">
            {PERIODS.map((o) => (
              <Link key={o.value} href={href({ period: o.value === "30d" ? null : o.value })} aria-current={p.period.key === o.value ? "page" : undefined} className={cn("flex min-h-9 items-center rounded-md px-3", p.period.key === o.value ? "bg-nav-active font-semibold text-ink" : "text-muted hover:text-ink")}>
                {o.label}
              </Link>
            ))}
          </div>
          <RuleDialog trigger="new" />
        </div>
      </PageHeader>

      {none ? (
        <Card className="py-10 text-center">
          <h2 className="text-lg font-semibold">Track the habits behind your results</h2>
          <p className="mx-auto mt-2 max-w-[520px] text-sm text-muted">Rules are checked automatically against your trades and your daily journal: start your day on time, put a stop loss on every trade, link trades to a playbook, and keep losses within a limit.</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <StarterRules />
          </div>
        </Card>
      ) : (
        <>
          <section aria-label="Summary" className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
            <Stat label={isToday ? "Today's progress" : `Progress on ${nice(p.focusDay)}`} value={`${p.focusProgress.followed}/${p.focusProgress.total}`} sub={p.focusProgress.pending ? `${p.focusProgress.pending} still open` : p.focusIsTrading ? "rules followed" : "not a trading day"} />
            <Stat label="Perfect-day streak" value={`${p.period.streak} ${p.period.streak === 1 ? "day" : "days"}`} sub="every applicable rule followed" />
            <Stat label={`Score · ${p.period.label.toLowerCase()}`} value={p.period.score == null ? "—" : pct(p.period.score, 0)} sub={`${p.period.followed} of ${p.period.total} checks over ${p.period.tradingDays} trading days`} />
            <Stat label="Perfect days" value={p.period.perfectDays} sub={`of ${p.period.tradingDays} trading days`} />
          </section>

          <Card className="mb-4">
            <CardHeader title="Last 12 months" right="Click a day to see how it went" />
            <div className="mt-3">
              <Heatmap days={p.heat} focusDay={p.focusDay} href={(d) => href({ day: d === p.today ? null : d })} />
            </div>
          </Card>

          <Card className="mb-4">
            <CardHeader title={isToday ? "Today" : nice(p.focusDay)} right={!isToday && <Link href={href({ day: null })} className="text-accent underline">Back to today</Link>} />
            {!p.focusIsTrading && <p className="mt-2 text-xs text-muted">This is not one of your trading days, so no rule is judged. Change your trading days below.</p>}
            <ul className="mt-2 divide-y divide-line">
              {p.rows.map((r) => (
                <li key={r.rule.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-[13px]">
                  <span>
                    <span className="font-medium">{r.rule.name}</span>
                    <span className="block text-xs text-muted">{describeRule(r.rule, sym)}</span>
                  </span>
                  <span className="flex items-center gap-4">
                    {r.rule.kind === "MANUAL_CHECK" && p.focusIsTrading && <ManualToggle ruleId={r.rule.id} day={p.focusDay} ticked={r.focusManual} name={r.rule.name} />}
                    {p.focusIsTrading ? <Mark v={r.focus} /> : <span className="text-muted">—</span>}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}

      <Card className="mb-4 p-0">
        <div className="px-4 pt-4">
          <CardHeader title="Rules" right={p.period.label} />
        </div>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-medium">Rule</th>
                <th className="px-3 py-2.5 text-right font-medium">Current streak</th>
                <th className="px-3 py-2.5 text-right font-medium">Best streak</th>
                <th className="px-3 py-2.5 text-right font-medium">Follow rate</th>
                <th className="px-3 py-2.5 text-right font-medium">Avg day when followed</th>
                <th className="px-3 py-2.5 text-right font-medium">Avg day when broken</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {p.rows.length === 0 && p.inactive.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted">
                    No rules yet.
                  </td>
                </tr>
              )}
              {p.rows.map(({ rule, summary: s }) => (
                <tr key={rule.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{rule.name}</div>
                    <div className="text-xs text-muted">{describeRule(rule, sym)}</div>
                  </td>
                  <td className="num px-3 py-2.5 text-right">{s.currentStreak}</td>
                  <td className="num px-3 py-2.5 text-right">{s.bestStreak}</td>
                  <td className="num px-3 py-2.5 text-right">{s.rate == null ? "—" : `${pct(s.rate, 0)} (${s.followed}/${s.applicable})`}</td>
                  <td className={cn("num px-3 py-2.5 text-right", s.avgNetFollowed != null && (s.avgNetFollowed >= 0 ? "text-profit" : "text-loss"))}>{s.avgNetFollowed == null ? "—" : money(s.avgNetFollowed, home)}</td>
                  <td className={cn("num px-3 py-2.5 text-right", s.avgNetBroken != null && (s.avgNetBroken >= 0 ? "text-profit" : "text-loss"))}>{s.avgNetBroken == null ? "—" : money(s.avgNetBroken, home)}</td>
                  <td className="px-4 py-1.5">
                    <RuleActions rule={{ ...rule, active: true }} />
                  </td>
                </tr>
              ))}
              {p.inactive.map((rule) => (
                <tr key={rule.id} className="border-b border-line text-muted last:border-0">
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{rule.name}</div>
                    <div className="text-xs">Paused · {describeRule(rule, sym)}</div>
                  </td>
                  <td colSpan={5} />
                  <td className="px-4 py-1.5">
                    <RuleActions rule={rule} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 pb-3 pt-2 text-xs text-muted">Days a rule does not apply to (for example a stop-loss rule on a day without trades) are left out. Money amounts use your account currency. Averages are the net P&amp;L of those days.</p>
      </Card>

      <Card>
        <CardHeader title="Trading days" />
        <p className="mb-3 mt-1 text-xs text-muted">Only these weekdays are judged. Days off never break a streak.</p>
        <TradingDays days={p.weekdays} />
      </Card>
    </>
  );
}
