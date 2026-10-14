import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { settingsFor } from "@/lib/queries/trade-list";
import { listScenarios, trainingStats } from "@/lib/training/scenarios";
import { TF_NAMES } from "@/lib/training/constants";

export const metadata: Metadata = { title: "Training" };

const stars = (n: number) => "★".repeat(n) + "☆".repeat(3 - n);
const when = (iso: string, tz: string) => new Intl.DateTimeFormat("en-AU", { timeZone: tz, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
const sign = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)}`;

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <Card>
      <div className="text-xs text-muted">{label}</div>
      <div className="num mt-1 text-2xl font-semibold">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </Card>
  );
}

type Row = Awaited<ReturnType<typeof listScenarios>>[number];

function Section({ title, blurb, kind, scenarios: list, tz }: { title: string; blurb: string; kind: "SETUP" | "EVENT"; scenarios: Row[]; tz: string }) {
  return (
    <section id="training-panel" role="tabpanel" aria-label={title} className="mb-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="max-w-[640px] text-xs text-muted">{blurb}</p>
        </div>
        <Link href={`/training/new?kind=${kind}`} className="inline-flex min-h-9 items-center rounded-control border border-line-strong px-3 text-[13px] hover:bg-nav-active">
          + Add {kind === "EVENT" ? "news event" : "price action"} scenario
        </Link>
      </div>
      {list.length === 0 ? (
        <p className="rounded-card border border-dashed border-line px-4 py-6 text-center text-sm text-muted">None yet.</p>
      ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {list.map((s) => (
                <li key={s.id}>
                  <Card className="flex h-full flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="min-w-0 text-[15px] font-semibold">{s.title}</h2>
                      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px]", s.kind === "EVENT" ? "bg-accent/15 text-accent" : "bg-nav-active text-ink-2")}>{s.kind === "EVENT" ? "News event" : "Setup"}</span>
                    </div>
                    <p className="num text-xs text-muted">
                      {s.symbol} · {TF_NAMES[s.timeframe] ?? s.timeframe} · {when(s.decisionAt, tz)}
                    </p>
                    <p className="text-xs text-muted">
                      <span className="text-accent">{stars(s.difficulty)}</span>
                      {s.playbook && ` · ${s.playbook}`}
                      {!s.hasExpert && " · no expert answer"}
                    </p>
                    <div className="num mt-auto flex items-center justify-between pt-2 text-xs text-muted">
                      <span>{s.attempts === 0 ? "Not tried yet" : `${s.attempts} ${s.attempts === 1 ? "attempt" : "attempts"} · best ${s.bestMatch ?? "—"} · last ${s.lastR == null ? (s.lastMatch ?? "—") : `${sign(s.lastR)}R`}`}</span>
                    </div>
                    <div className="flex gap-2">
                      <Link href={`/training/${s.id}`} className="inline-flex min-h-10 flex-1 items-center justify-center rounded-control bg-accent text-[13px] font-semibold text-bg hover:bg-[var(--accent-hover)]">
                        {s.attempts === 0 ? "Train" : "Train again"}
                      </Link>
                      <Link href={`/training/${s.id}/edit`} className="inline-flex min-h-10 items-center rounded-control border border-line-strong px-3 text-[13px] hover:bg-nav-active">
                        Edit
                      </Link>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
      )}
    </section>
  );
}

export default async function TrainingPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab: "SETUP" | "EVENT" = (await searchParams).tab === "events" ? "EVENT" : "SETUP";
  const { tz } = await settingsFor();
  const [scenarios, stats] = await Promise.all([listScenarios(), trainingStats(tz)]);
  const shown = scenarios.filter((s) => s.kind === tab);
  const nextUp = shown.find((s) => s.attempts === 0) ?? [...shown].sort((a, b) => (a.bestMatch ?? 101) - (b.bestMatch ?? 101))[0];

  return (
    <>
      <PageHeader title="Training">
        <div className="flex flex-wrap gap-2">
          {nextUp && (
            <Link href={`/training/${nextUp.id}`} className="inline-flex min-h-10 items-center rounded-control border border-line-strong px-4 text-[13px] hover:bg-nav-active">
              {nextUp.attempts === 0 ? "Start the next one" : "Practise your weakest"}
            </Link>
          )}
          <Link href="/training/new" className="inline-flex min-h-10 items-center rounded-control bg-accent px-4 text-[13px] font-semibold text-bg hover:bg-[var(--accent-hover)]">
            + New scenario
          </Link>
        </div>
      </PageHeader>

      {scenarios.length === 0 ? (
        <Card className="py-12 text-center">
          <h2 className="text-lg font-semibold">Train your eye on real charts</h2>
          <p className="mx-auto mt-2 max-w-[560px] text-sm text-muted">
            A scenario is a real moment in the market. The chart stops at the decision point, you mark your entry, stop loss and take profit, and the real candles that follow decide how you did. Your own annotated chart and notes are shown afterwards, with a score for how closely you matched them.
          </p>
          <div className="mt-5">
            <Link href="/training/new" className="inline-flex min-h-11 items-center rounded-control bg-accent px-5 text-sm font-semibold text-bg hover:bg-[var(--accent-hover)]">
              Create your first scenario
            </Link>
          </div>
        </Card>
      ) : (
        <>
          <section aria-label="Your training" className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
            <Stat label="Attempts" value={stats.attempts} sub={`${stats.scenariosTried} of ${scenarios.length} scenarios tried`} />
            <Stat label="Average match" value={stats.avgMatch == null ? "—" : Math.round(stats.avgMatch)} sub="out of 100 against the expert" />
            <Stat label="Average result" value={stats.avgR == null ? "—" : `${sign(stats.avgR)}R`} sub={stats.winRate == null ? undefined : `${Math.round(stats.winRate * 100)}% of trades were winners`} />
            <Stat label="Training streak" value={`${stats.streakDays} ${stats.streakDays === 1 ? "day" : "days"}`} sub="days in a row with an attempt" />
          </section>

          {stats.byPlaybook.length > 0 && (
            <Card className="mb-4">
              <CardHeader title="By playbook" right="Weakest first" />
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {stats.byPlaybook.map((p) => (
                  <li key={p.name} className="flex items-center justify-between gap-3 rounded-control border border-line px-3 py-2 text-[13px]">
                    <span className="truncate">{p.name}</span>
                    <span className="num shrink-0 text-muted">
                      {p.avgMatch == null ? "—" : Math.round(p.avgMatch)} · {p.attempts} {p.attempts === 1 ? "try" : "tries"}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <div role="tablist" aria-label="Kind of training" className="mb-4 flex gap-1 border-b border-line">
            {(
              [
                ["SETUP", "Price action", "price-action"],
                ["EVENT", "News events", "events"],
              ] as const
            ).map(([kind, label, slug]) => (
              <Link
                key={kind}
                href={`/training?tab=${slug}`}
                role="tab"
                aria-selected={tab === kind}
                aria-controls="training-panel"
                scroll={false}
                className={cn("-mb-px min-h-11 border-b-2 px-4 py-2.5 text-sm", tab === kind ? "border-accent font-semibold text-ink" : "border-transparent text-muted hover:text-ink")}
              >
                {label} <span className="num ml-1 text-xs text-muted">{scenarios.filter((s) => s.kind === kind).length}</span>
              </Link>
            ))}
          </div>
          {tab === "SETUP" ? (
            <Section title="Price action" blurb="Normal market conditions, no NFP or CPI. Mark your entry, stop loss and take profit on the chart (5m, 15m and 1m, with the FVG, OB and structure switches)." kind="SETUP" scenarios={shown} tz={tz} />
          ) : (
            <Section title="News events" blurb="Price action around NFP, CPI and other high-impact releases. Replay the 5-second chart live and trade the break, usually with a limit order on the pullback." kind="EVENT" scenarios={shown} tz={tz} />
          )}
        </>
      )}
    </>
  );
}
