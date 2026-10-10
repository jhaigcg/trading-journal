import { isRealDay } from "@/lib/day";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { ReplayPlayer } from "@/components/replay/replay-player";
import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { db } from "@/lib/db";
import { money } from "@/lib/format";
import { loadReplayPicks } from "@/lib/queries/replay";
import { DEFAULT_TZ, fmtDateTime, offsetMinutesAt } from "@/lib/time";

export const metadata: Metadata = { title: "Replay" };

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const isDay = isRealDay;
const tone = (n: number) => (n > 0 ? "text-profit" : n < 0 ? "text-loss" : "text-ink");

export default async function ReplayPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const tradeId = first(sp.trade);
  const dayParam = first(sp.day);
  const mode: "trade" | "day" = dayParam !== undefined && !tradeId ? "day" : "trade";
  const symbol = first(sp.symbol);

  const [settings, picks] = await Promise.all([db.setting.findUnique({ where: { id: 1 } }), loadReplayPicks()]);
  const tz = settings?.displayTimezone ?? DEFAULT_TZ;

  let src: string | null = null;
  let offset = offsetMinutesAt(new Date(), tz);
  if (mode === "trade" && tradeId) {
    const t = await db.trade.findUnique({ where: { id: tradeId }, select: { openedAt: true } });
    if (t) {
      src = `/api/replay?trade=${encodeURIComponent(tradeId)}`;
      offset = offsetMinutesAt(t.openedAt, tz);
    }
  } else if (mode === "day" && isDay(dayParam)) {
    src = `/api/replay?day=${dayParam}${symbol ? `&symbol=${encodeURIComponent(symbol)}` : ""}`;
    offset = offsetMinutesAt(new Date(`${dayParam}T12:00:00Z`), tz);
  }

  const tab = (m: "trade" | "day") => cn("flex min-h-9 items-center rounded-md px-4", mode === m ? "bg-nav-active font-semibold text-ink" : "text-muted hover:text-ink");

  return (
    <>
      <PageHeader title="Replay">
        <div className="inline-flex rounded-control border border-line p-0.5 text-[13px]">
          <Link href="/replay" aria-current={mode === "trade" ? "page" : undefined} className={tab("trade")}>
            Trade replay
          </Link>
          <Link href="/replay?day=" aria-current={mode === "day" ? "page" : undefined} className={tab("day")}>
            Day replay
          </Link>
        </div>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card>
          {src ? (
            <ReplayPlayer key={src} src={src} tzOffsetMin={offset} />
          ) : (
            <div className="flex min-h-[320px] flex-col items-center justify-center gap-2 px-6 text-center">
              <h2 className="text-lg font-semibold">{mode === "trade" ? "Pick a trade to replay" : "Pick a day to replay"}</h2>
              <p className="max-w-[460px] text-sm text-muted">
                {mode === "trade"
                  ? "Step through the trade one candle at a time, with the entry, exit, stop and target appearing as they happen. The result stays hidden until the replay reaches the exit."
                  : "Replay a whole trading day: every trade in the day's most traded symbol, with a running P&L as the day unfolds."}
              </p>
              {mode === "day" && dayParam && !isDay(dayParam) && <p className="text-sm text-loss">That is not a valid date.</p>}
            </div>
          )}
        </Card>

        <Card className="h-fit">
          {mode === "day" ? (
            <>
              <CardHeader title="Choose a day" />
              <form action="/replay" className="mt-3 flex gap-2">
                <input type="hidden" name="symbol" value="" disabled />
                <input type="date" name="day" defaultValue={isDay(dayParam) ? dayParam : ""} required aria-label="Day to replay" className="min-h-10 min-w-0 flex-1 rounded-control border border-line-strong bg-inset px-3 text-sm text-ink" />
                <button className="min-h-10 rounded-control bg-accent px-3 text-[13px] font-semibold text-bg hover:bg-[var(--accent-hover)]">Replay</button>
              </form>
              <p className="mb-1 mt-4 text-xs text-muted">Recent trading days</p>
              <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
                {picks.recentDays.map((d) => (
                  <li key={d.day}>
                    <Link href={`/replay?day=${d.day}`} aria-current={d.day === dayParam ? "true" : undefined} className={cn("flex items-center justify-between gap-2 px-1 py-2.5 text-[13px] hover:bg-nav-active", d.day === dayParam && "bg-nav-active")}>
                      <span>
                        {d.day}
                        <span className="ml-2 text-xs text-muted">{d.trades} {d.trades === 1 ? "trade" : "trades"}</span>
                      </span>
                      <span className={cn("num", tone(d.net))}>{money(d.net, picks.recentTrades[0]?.currency ?? "AUD")}</span>
                    </Link>
                  </li>
                ))}
                {picks.recentDays.length === 0 && <li className="py-6 text-center text-sm text-muted">No trades yet.</li>}
              </ul>
            </>
          ) : (
            <>
              <CardHeader title="Recent trades" />
              <ul className="mt-2 max-h-[560px] divide-y divide-line overflow-y-auto">
                {picks.recentTrades.map((t) => (
                  <li key={t.id}>
                    <Link href={`/replay?trade=${t.id}`} aria-current={t.id === tradeId ? "true" : undefined} className={cn("flex items-center justify-between gap-2 px-1 py-2.5 text-[13px] hover:bg-nav-active", t.id === tradeId && "bg-nav-active")}>
                      <span className="min-w-0">
                        <span className="font-medium">{t.symbol}</span>
                        <span className="ml-1.5 text-xs text-muted">{t.side === "LONG" ? "Long" : "Short"}</span>
                        <span className="block text-xs text-muted">{fmtDateTime(t.openedAt ? new Date(t.openedAt) : new Date(), tz)}</span>
                      </span>
                      <span className="num text-xs text-muted" title="Result is hidden until you replay it">
                        ?
                      </span>
                    </Link>
                  </li>
                ))}
                {picks.recentTrades.length === 0 && <li className="py-6 text-center text-sm text-muted">No trades yet.</li>}
              </ul>
              <p className="mt-2 text-xs text-muted">Results are hidden here on purpose, so a replay is a fair test of how you would read it live.</p>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
