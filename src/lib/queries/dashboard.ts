import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { loadAggregates } from "./aggregate";
import { findRate, loadRates } from "@/lib/fx";
import type { Filters } from "@/lib/filters/params";
import { resolveRange } from "@/lib/filters/range";
import { tradeWhere } from "@/lib/filters/where";
import {
  cumulative,
  drawdown,
  performanceScore,
  round2,
  summarizeDays,
  summaryFromAggregates,
  type DayBucket,
  type DaySummary,
  type PerformanceScore,
  type Summary,
} from "@/lib/metrics";
import { DEFAULT_TZ } from "@/lib/time";

const n = (v: unknown) => (v == null ? 0 : Number(v));

export interface SeriesPoint {
  label: string; // YYYY-MM-DD for daily series, "#12" for trade series
  value: number;
}
export interface BalancePoint {
  day: string;
  balance: number;
  deposits: number; // cumulative deposits less withdrawals
}
export interface TradeRow {
  id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  at: Date;
  netPnl: number;
  strategy: string | null;
}

export interface DashboardData {
  currency: string;
  homeCurrency: string;
  fx: number;
  summary: Summary;
  daySummary: DaySummary;
  score: PerformanceScore;
  maxDrawdown: number;
  cumulative: SeriesPoint[];
  cumulativeMode: "daily" | "trade";
  dailyNet: SeriesPoint[];
  drawdown: SeriesPoint[];
  balance: BalancePoint[];
  recent: TradeRow[];
  open: TradeRow[];
  startingBalance: number;
  hasTrades: boolean;
}

/** Everything the dashboard needs. All aggregation happens in Postgres; the app only receives small series. */
export async function loadDashboard(f: Filters, opts: { cum?: "daily" | "trade"; now?: Date } = {}): Promise<DashboardData> {
  const settings = await db.setting.findUnique({ where: { id: 1 } });
  const tz = settings?.displayTimezone ?? DEFAULT_TZ;
  const home = settings?.displayCurrency ?? "AUD";
  const thr = Number(settings?.breakevenThreshold ?? 0);
  const ctx = { tz, now: opts.now };

  const rates = await loadRates();
  const currency = f.ccy ?? home;
  const fx = findRate(rates, home, currency) ?? 1;
  const shownCurrency = findRate(rates, home, currency) == null ? home : currency;
  const mode = opts.cum ?? "daily";

  const where = tradeWhere(f, ctx);
  const closedWhere = tradeWhere({ ...f, status: "closed" }, ctx);

  const [agg, dayRows, tradeSeries, recentRows, openRows, accounts, summaryDays, depositDays] = await Promise.all([
    loadAggregates(where, thr),
    db.$queryRaw<{ day: string; trades: number; net: Prisma.Decimal; gross: Prisma.Decimal; volume: Prisma.Decimal }[]>`
      SELECT t."closeDay"::text AS "day", count(*)::int AS "trades", sum(t."netPnl") AS "net", sum(t."grossPnl") AS "gross", sum(t."quantity") AS "volume"
      FROM "Trade" t ${closedWhere} AND t."closeDay" IS NOT NULL
      GROUP BY t."closeDay" ORDER BY t."closeDay"`,
    mode === "trade"
      ? db.$queryRaw<{ net: Prisma.Decimal }[]>`SELECT t."netPnl" AS "net" FROM "Trade" t ${closedWhere} ORDER BY t."closedAt", t."id"`
      : Promise.resolve([] as { net: Prisma.Decimal }[]),
    db.$queryRaw<{ id: string; symbol: string; side: "LONG" | "SHORT"; at: Date; net: Prisma.Decimal; strategy: string | null }[]>`
      SELECT t."id", t."symbol", t."side"::text AS "side", t."closedAt" AS "at", t."netPnl" AS "net", s."name" AS "strategy"
      FROM "Trade" t LEFT JOIN "Strategy" s ON s."id" = t."strategyId" ${closedWhere}
      ORDER BY t."closedAt" DESC NULLS LAST LIMIT 8`,
    db.trade.findMany({
      where: { status: "OPEN", ...(f.account ? { accountId: f.account } : {}) },
      orderBy: { openedAt: "desc" },
      take: 10,
      select: { id: true, symbol: true, side: true, openedAt: true, netPnl: true, strategy: { select: { name: true } } },
    }),
    db.account.findMany({ where: { archived: false, ...(f.account ? { id: f.account } : {}) }, select: { id: true, startingBalance: true } }),
    // balance curve: account-level, so it ignores the advanced (strategy/tag/...) filters
    f.account
      ? db.$queryRaw<{ day: string; net: Prisma.Decimal }[]>`SELECT "day"::text AS "day", sum("netPnl") AS "net" FROM "DailySummary" WHERE "accountId" = ${f.account} GROUP BY "day" ORDER BY "day"`
      : db.$queryRaw<{ day: string; net: Prisma.Decimal }[]>`SELECT "day"::text AS "day", sum("netPnl") AS "net" FROM "DailySummary" GROUP BY "day" ORDER BY "day"`,
    f.account
      ? db.$queryRaw<{ day: string; amount: Prisma.Decimal }[]>`SELECT (((e."at" AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date)::text AS "day", sum(e."amount") AS "amount" FROM "BalanceEvent" e WHERE e."accountId" = ${f.account} GROUP BY 1 ORDER BY 1`
      : db.$queryRaw<{ day: string; amount: Prisma.Decimal }[]>`SELECT (((e."at" AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date)::text AS "day", sum(e."amount") AS "amount" FROM "BalanceEvent" e GROUP BY 1 ORDER BY 1`,
  ]);

  // ── summary ──
  const summary = summaryFromAggregates(agg);

  // ── daily buckets & curves (home currency, scaled at the end) ──
  const days: DayBucket[] = dayRows.map((d) => ({ day: d.day, trades: d.trades, netPnl: round2(n(d.net)), grossPnl: round2(n(d.gross)), volume: n(d.volume) }));
  const daySummary = summarizeDays(days, thr);
  const cumDaily = cumulative(days.map((d) => d.netPnl));
  const dd = drawdown(cumDaily, 0);
  const startingBalance = accounts.reduce((s, x) => s + n(x.startingBalance), 0);
  const score = performanceScore({ summary, days, maxDrawdown: dd.max, startingBalance: startingBalance || 10_000 });

  const tradeCum = cumulative(tradeSeries.map((t) => n(t.net)));
  const cumulativeSeries: SeriesPoint[] = mode === "trade" ? tradeCum.map((v, i) => ({ label: `#${i + 1}`, value: v })) : days.map((d, i) => ({ label: d.day, value: cumDaily[i] }));

  // ── balance curve over the selected range ──
  const { from, to } = resolveRange(f.range, { from: f.from, to: f.to }, opts.now, tz);
  const allDays = [...new Set([...summaryDays.map((d) => d.day), ...depositDays.map((d) => d.day)])].sort();
  const netBy = new Map(summaryDays.map((d) => [d.day, n(d.net)]));
  const depBy = new Map(depositDays.map((d) => [d.day, n(d.amount)]));
  let bal = startingBalance;
  let dep = 0;
  const balance: BalancePoint[] = [];
  for (const day of allDays) {
    dep += depBy.get(day) ?? 0;
    bal += (netBy.get(day) ?? 0) + (depBy.get(day) ?? 0);
    if ((!from || day >= from) && (!to || day <= to)) balance.push({ day, balance: round2(bal), deposits: round2(dep) });
  }

  const rowOf = (r: { id: string; symbol: string; side: "LONG" | "SHORT"; at: Date; net: Prisma.Decimal; strategy: string | null }): TradeRow => ({ id: r.id, symbol: r.symbol, side: r.side, at: r.at, netPnl: n(r.net), strategy: r.strategy });

  const scale = (v: number) => round2(v * fx);
  const scaleSeries = (s: SeriesPoint[]) => s.map((p) => ({ ...p, value: scale(p.value) }));
  const scaledSummary: Summary = {
    ...summary,
    netPnl: scale(summary.netPnl), grossPnl: scale(summary.grossPnl), fees: scale(summary.fees),
    grossWin: scale(summary.grossWin), grossLoss: scale(summary.grossLoss), avgWin: scale(summary.avgWin), avgLoss: scale(summary.avgLoss),
    expectancy: scale(summary.expectancy), avgNetPerTrade: scale(summary.avgNetPerTrade),
  };

  return {
    currency: shownCurrency,
    homeCurrency: home,
    fx,
    summary: scaledSummary,
    daySummary: { ...daySummary, avgDailyNet: scale(daySummary.avgDailyNet), bestDay: scale(daySummary.bestDay), worstDay: scale(daySummary.worstDay) },
    score,
    maxDrawdown: scale(dd.max),
    cumulative: scaleSeries(cumulativeSeries),
    cumulativeMode: mode,
    dailyNet: scaleSeries(days.map((d) => ({ label: d.day, value: d.netPnl }))),
    drawdown: scaleSeries(days.map((d, i) => ({ label: d.day, value: dd.series[i] }))),
    balance: balance.map((b) => ({ day: b.day, balance: scale(b.balance), deposits: scale(b.deposits) })),
    recent: recentRows.map((r) => ({ ...rowOf(r), netPnl: scale(n(r.net)) })),
    open: openRows.map((r) => ({ id: r.id, symbol: r.symbol, side: r.side, at: r.openedAt, netPnl: scale(n(r.netPnl)), strategy: r.strategy?.name ?? null })),
    startingBalance: scale(startingBalance),
    hasTrades: summary.count > 0,
  };
}

/** Per-day net P&L for the calendar (account + advanced filters, any month; independent of the range filter). */
export async function loadCalendarMonth(f: Filters, month: string, opts: { now?: Date } = {}): Promise<DayBucket[]> {
  const settings = await db.setting.findUnique({ where: { id: 1 } });
  const tz = settings?.displayTimezone ?? DEFAULT_TZ;
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const where = tradeWhere({ ...f, status: "closed", range: "custom", from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` }, { tz, now: opts.now });
  const rows = await db.$queryRaw<{ day: string; trades: number; net: Prisma.Decimal; gross: Prisma.Decimal; volume: Prisma.Decimal }[]>`
    SELECT t."closeDay"::text AS "day", count(*)::int AS "trades", sum(t."netPnl") AS "net", sum(t."grossPnl") AS "gross", sum(t."quantity") AS "volume"
    FROM "Trade" t ${where} AND t."closeDay" IS NOT NULL GROUP BY t."closeDay" ORDER BY t."closeDay"`;
  const fx = findRate(await loadRates(), settings?.displayCurrency ?? "AUD", f.ccy ?? settings?.displayCurrency ?? "AUD") ?? 1;
  return rows.map((r) => ({ day: r.day, trades: r.trades, netPnl: round2(n(r.net) * fx), grossPnl: round2(n(r.gross) * fx), volume: n(r.volume) }));
}
