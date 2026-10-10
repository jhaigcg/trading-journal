import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { Filters } from "@/lib/filters/params";
import { tradeConditions, tradeWhere } from "@/lib/filters/where";
import { cumulative, dailyBuckets, round2, summarizeDays, summaryFromAggregates, type Aggregates, type DaySummary, type Summary } from "@/lib/metrics";
import { fileUrl } from "./trade-detail";
import { loadAggregates } from "./aggregate";
import { settingsFor } from "./trade-list";

const n = (v: unknown) => (v == null ? 0 : Number(v));

const zero: Aggregates = { count: 0, wins: 0, losses: 0, breakevens: 0, netPnl: 0, grossPnl: 0, costs: 0, grossWin: 0, grossLoss: 0, holdSum: 0, holdCount: 0, plannedSum: 0, plannedCount: 0, realizedSum: 0, realizedCount: 0, volume: 0 };

export interface PlaybookRow {
  id: string;
  name: string;
  color: string;
  archived: boolean;
  coverUrl: string | null;
  description: string | null;
  missed: number;
  summary: Summary;
}

/** Every playbook with its numbers over the filtered trades (the global filters apply, except the playbook picker itself). */
export async function listPlaybooks(f: Filters): Promise<PlaybookRow[]> {
  const { tz, thr } = await settingsFor();
  const conds = tradeConditions({ ...f, status: "closed", strategy: [] }, { tz });
  const extra = conds.length ? Prisma.sql`AND ${Prisma.join(conds, " AND ")}` : Prisma.empty;
  const only = f.strategy.filter((s) => s !== "none");
  const restrict = only.length ? Prisma.sql`WHERE s."id" IN (${Prisma.join(only)})` : Prisma.empty;

  const rows = await db.$queryRaw<Record<string, unknown>[]>`
    SELECT s."id", s."name", s."color", s."archived", s."coverUrl", s."description",
      (SELECT count(*)::int FROM "MissedTrade" m WHERE m."strategyId" = s."id") AS "missed",
      count(t."id")::int AS "count",
      (count(t."id") FILTER (WHERE t."netPnl" > ${thr}::numeric))::int AS "wins",
      (count(t."id") FILTER (WHERE t."netPnl" < -(${thr}::numeric)))::int AS "losses",
      (count(t."id") FILTER (WHERE t."id" IS NOT NULL AND abs(t."netPnl") <= ${thr}::numeric))::int AS "breakevens",
      coalesce(sum(t."netPnl"), 0) AS "net", coalesce(sum(t."grossPnl"), 0) AS "gross",
      coalesce(sum(t."commission" + t."swap" + t."fees"), 0) AS "costs",
      coalesce(sum(t."netPnl") FILTER (WHERE t."netPnl" > ${thr}::numeric), 0) AS "gw",
      coalesce(sum(t."netPnl") FILTER (WHERE t."netPnl" < -(${thr}::numeric)), 0) AS "gl",
      coalesce(sum(t."holdSeconds"), 0) AS "holdSum", count(t."holdSeconds")::int AS "holdCount",
      coalesce(sum(t."quantity"), 0) AS "volume"
    FROM "Strategy" s LEFT JOIN "Trade" t ON t."strategyId" = s."id" ${extra}
    ${restrict}
    GROUP BY s."id" ORDER BY s."name"`;

  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    color: String(r.color),
    archived: Boolean(r.archived),
    coverUrl: r.coverUrl ? fileUrl(String(r.coverUrl)) : null,
    description: (r.description as string | null) ?? null,
    missed: n(r.missed),
    summary: summaryFromAggregates({ ...zero, count: n(r.count), wins: n(r.wins), losses: n(r.losses), breakevens: n(r.breakevens), netPnl: n(r.net), grossPnl: n(r.gross), costs: n(r.costs), grossWin: n(r.gw), grossLoss: n(r.gl), holdSum: n(r.holdSum), holdCount: n(r.holdCount), volume: n(r.volume) }),
  }));
}

export interface Highlights {
  best: PlaybookRow | null;
  worst: PlaybookRow | null;
  mostActive: PlaybookRow | null;
  bestWinRate: PlaybookRow | null;
}

/** Minimum decided trades before a win rate means anything. */
export const MIN_TRADES_FOR_WIN_RATE = 5;

/** The four headline cards. Only active playbooks that actually traded in the period are considered. */
export function highlights(rows: PlaybookRow[]): Highlights {
  const traded = rows.filter((r) => !r.archived && r.summary.count > 0);
  const by = (cmp: (a: PlaybookRow, b: PlaybookRow) => number) => [...traded].sort(cmp)[0] ?? null;
  const best = by((a, b) => b.summary.netPnl - a.summary.netPnl);
  const worstCandidate = by((a, b) => a.summary.netPnl - b.summary.netPnl);
  return {
    best,
    // a single playbook is not both the best and the worst
    worst: worstCandidate && worstCandidate.id !== best?.id ? worstCandidate : null,
    mostActive: by((a, b) => b.summary.count - a.summary.count),
    bestWinRate: [...traded].filter((r) => r.summary.wins + r.summary.losses >= MIN_TRADES_FOR_WIN_RATE).sort((a, b) => b.summary.winRate - a.summary.winRate)[0] ?? null,
  };
}

// ───────────── one playbook ─────────────

export interface RuleStat {
  id: string;
  text: string;
  followed: number;
  answered: number;
}
export interface PlaybookDetail {
  id: string;
  name: string;
  description: string | null;
  color: string;
  archived: boolean;
  coverUrl: string | null;
  summary: Summary;
  days: DaySummary;
  curve: { label: string; value: number }[];
  groups: { id: string; name: string; rules: RuleStat[] }[];
  /** share of answered rule checks that were "followed", across all rules */
  compliance: number | null;
  missed: { id: string; symbol: string | null; seenAt: string; side: "LONG" | "SHORT" | null; hypotheticalR: number | null; reason: string | null }[];
  recentTrades: { id: string; symbol: string; side: "LONG" | "SHORT"; closedAt: Date; netPnl: number }[];
  notes: { id: string; title: string; updatedAt: Date }[];
}

export async function loadPlaybook(id: string, f: Filters): Promise<PlaybookDetail | null> {
  const s = await db.strategy.findUnique({
    where: { id },
    include: { groups: { orderBy: { position: "asc" }, include: { rules: { orderBy: { position: "asc" } } } }, missed: { orderBy: { seenAt: "desc" } } },
  });
  if (!s) return null;
  const { tz, thr } = await settingsFor();
  const scoped: Filters = { ...f, status: "closed", strategy: [id] };
  const where = tradeWhere(scoped, { tz });
  const conds = tradeConditions({ ...f, status: "closed", strategy: [] }, { tz });
  const extra = conds.length ? Prisma.sql`AND ${Prisma.join(conds, " AND ")}` : Prisma.empty;

  const [agg, dayRows, checks, recent, notes] = await Promise.all([
    loadAggregates(where, thr),
    db.$queryRaw<{ day: string; trades: number; net: Prisma.Decimal; gross: Prisma.Decimal; volume: Prisma.Decimal }[]>`
      SELECT t."closeDay"::text AS "day", count(*)::int AS "trades", sum(t."netPnl") AS "net", sum(t."grossPnl") AS "gross", sum(t."quantity") AS "volume"
      FROM "Trade" t ${where} AND t."closeDay" IS NOT NULL GROUP BY t."closeDay" ORDER BY t."closeDay"`,
    // rule compliance over the trades in the current filters: how often each rule was followed when it was answered
    db.$queryRaw<{ ruleId: string; answered: number; followed: number }[]>`
      SELECT c."ruleId", count(*)::int AS "answered", (count(*) FILTER (WHERE c."followed"))::int AS "followed"
      FROM "TradeRuleCheck" c JOIN "Trade" t ON t."id" = c."tradeId"
      WHERE t."strategyId" = ${id} AND t."status" = 'CLOSED' ${extra}
      GROUP BY c."ruleId"`,
    db.$queryRaw<{ id: string; symbol: string; side: "LONG" | "SHORT"; closedAt: Date; net: Prisma.Decimal }[]>`
      SELECT t."id", t."symbol", t."side"::text AS "side", t."closedAt", t."netPnl" AS "net" FROM "Trade" t ${where} ORDER BY t."closedAt" DESC NULLS LAST LIMIT 30`,
    db.note.findMany({ where: { strategyId: id, deletedAt: null }, orderBy: { updatedAt: "desc" }, take: 30, select: { id: true, title: true, updatedAt: true } }),
  ]);

  const stat = new Map(checks.map((c) => [c.ruleId, c]));
  const groups = s.groups.map((g) => ({
    id: g.id,
    name: g.name,
    rules: g.rules.map((r) => ({ id: r.id, text: r.text, followed: stat.get(r.id)?.followed ?? 0, answered: stat.get(r.id)?.answered ?? 0 })),
  }));
  const all = groups.flatMap((g) => g.rules);
  const answered = all.reduce((a, r) => a + r.answered, 0);

  const days = dailyBuckets(dayRows.map((d) => ({ netPnl: n(d.net), grossPnl: n(d.gross), quantity: n(d.volume), day: d.day })));
  const cum = cumulative(days.map((d) => d.netPnl));

  return {
    id: s.id,
    name: s.name,
    description: s.description,
    color: s.color,
    archived: s.archived,
    coverUrl: s.coverUrl ? fileUrl(s.coverUrl) : null,
    summary: summaryFromAggregates(agg),
    days: summarizeDays(days, thr),
    curve: days.map((d, i) => ({ label: d.day, value: cum[i] })),
    groups,
    compliance: answered ? round2((all.reduce((a, r) => a + r.followed, 0) / answered) * 100) : null,
    missed: s.missed.map((m) => ({ id: m.id, symbol: m.symbol, seenAt: m.seenAt.toISOString(), side: m.side, hypotheticalR: m.hypotheticalR == null ? null : Number(m.hypotheticalR), reason: m.reason })),
    recentTrades: recent.map((r) => ({ id: r.id, symbol: r.symbol, side: r.side, closedAt: r.closedAt, netPnl: n(r.net) })),
    notes,
  };
}
