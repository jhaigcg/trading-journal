import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { Aggregates } from "@/lib/metrics";

export const n = (v: unknown) => (v == null ? 0 : Number(v));

/**
 * The aggregate columns every report is built from (alias `t` on "Trade"). Used with or without GROUP BY, so
 * the dashboard, Trades views and Reports all derive their numbers from the same SQL.
 */
export const AGG_SELECT = (thr: number) => Prisma.sql`
  count(*)::int AS "count",
  (count(*) FILTER (WHERE t."netPnl" > ${thr}::numeric))::int AS "wins",
  (count(*) FILTER (WHERE t."netPnl" < -(${thr}::numeric)))::int AS "losses",
  (count(*) FILTER (WHERE abs(t."netPnl") <= ${thr}::numeric))::int AS "breakevens",
  coalesce(sum(t."netPnl"), 0) AS "netPnl",
  coalesce(sum(t."grossPnl"), 0) AS "grossPnl",
  coalesce(sum(t."commission" + t."swap" + t."fees"), 0) AS "costs",
  coalesce(sum(t."netPnl") FILTER (WHERE t."netPnl" > ${thr}::numeric), 0) AS "grossWin",
  coalesce(sum(t."netPnl") FILTER (WHERE t."netPnl" < -(${thr}::numeric)), 0) AS "grossLoss",
  coalesce(sum(t."holdSeconds"), 0) AS "holdSum", count(t."holdSeconds")::int AS "holdCount",
  coalesce(sum(t."plannedR"), 0) AS "plannedSum", count(t."plannedR")::int AS "plannedCount",
  coalesce(sum(t."realizedR"), 0) AS "realizedSum", count(t."realizedR")::int AS "realizedCount",
  coalesce(sum(t."quantity"), 0) AS "volume"`;

export function toAggregates(a: Record<string, unknown>): Aggregates {
  return {
    count: n(a.count), wins: n(a.wins), losses: n(a.losses), breakevens: n(a.breakevens),
    netPnl: n(a.netPnl), grossPnl: n(a.grossPnl), costs: n(a.costs), grossWin: n(a.grossWin), grossLoss: n(a.grossLoss),
    holdSum: n(a.holdSum), holdCount: n(a.holdCount), plannedSum: n(a.plannedSum), plannedCount: n(a.plannedCount),
    realizedSum: n(a.realizedSum), realizedCount: n(a.realizedCount), volume: n(a.volume),
  };
}

/** One aggregate row over the trades selected by `where` (alias `t`). */
export async function loadAggregates(where: Prisma.Sql, thr: number): Promise<Aggregates> {
  const rows = await db.$queryRaw<Record<string, unknown>[]>`SELECT ${AGG_SELECT(thr)} FROM "Trade" t ${where}`;
  return toAggregates(rows[0] ?? {});
}
