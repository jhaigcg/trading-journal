import { isRealDay } from "@/lib/day";
import { db } from "@/lib/db";
import type { Filters } from "@/lib/filters/params";
import { tradeWhere } from "@/lib/filters/where";
import { displayCurrency } from "@/lib/fx";
import { summaryFromAggregates, type Summary } from "@/lib/metrics";
import { loadAggregates } from "./aggregate";
import { settingsFor } from "./trade-list";

export interface DayTrade {
  id: string;
  openedAt: string; // ISO
  symbol: string;
  side: "LONG" | "SHORT";
  instrument: string;
  netPnl: number;
  netRoi: number | null;
  realizedR: number | null;
  strategy: string | null;
}

export interface DayDetail {
  day: string;
  currency: string;
  summary: Summary;
  trades: DayTrade[];
  /** running net P&L after each trade, in the order the trades closed */
  running: { t: string; value: number }[];
}

const num = (v: unknown) => (v == null ? null : Number(v));
const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Everything for the day pop-up on the dashboard calendar. Uses the same filters as the calendar itself
 * (account, tags, side and so on), so its numbers always match the cell that was clicked.
 */
export async function loadDayDetail(day: string, f: Filters): Promise<DayDetail | null> {
  if (!isRealDay(day)) return null;
  const [{ tz, thr }, cur] = await Promise.all([settingsFor(), displayCurrency(f.ccy)]);
  const where = tradeWhere({ ...f, status: "closed", range: "custom", from: day, to: day }, { tz });

  const [agg, rows] = await Promise.all([
    loadAggregates(where, thr),
    db.$queryRaw<Record<string, unknown>[]>`
      SELECT t."id", t."openedAt", t."closedAt", t."symbol", t."side"::text AS "side", t."instrumentType"::text AS "instrument",
        t."netPnl", t."netRoi", t."realizedR", s."name" AS "strategy"
      FROM "Trade" t LEFT JOIN "Strategy" s ON s."id" = t."strategyId" ${where} AND t."closeDay" IS NOT NULL
      ORDER BY t."closedAt" ASC, t."id"`,
  ]);
  if (!rows.length) return null;

  const fx = cur.fx;
  const trades: DayTrade[] = rows
    .map((r) => ({
      id: String(r.id),
      openedAt: (r.openedAt as Date).toISOString(),
      symbol: String(r.symbol),
      side: r.side as "LONG" | "SHORT",
      instrument: String(r.instrument).replace("_", "/"),
      netPnl: r2(Number(r.netPnl) * fx),
      netRoi: num(r.netRoi),
      realizedR: num(r.realizedR),
      strategy: (r.strategy as string | null) ?? null,
    }))
    .sort((a, b) => b.openedAt.localeCompare(a.openedAt));

  let acc = 0;
  const running = rows.map((r) => {
    acc += Number(r.netPnl) * fx;
    return { t: (r.closedAt as Date).toISOString(), value: r2(acc) };
  });

  const s = summaryFromAggregates(agg);
  const scaled: Summary = { ...s, netPnl: r2(s.netPnl * fx), grossPnl: r2(s.grossPnl * fx), fees: r2(s.fees * fx), grossWin: r2(s.grossWin * fx), grossLoss: r2(s.grossLoss * fx), avgWin: r2(s.avgWin * fx), avgLoss: r2(s.avgLoss * fx), expectancy: r2(s.expectancy * fx), avgNetPerTrade: r2(s.avgNetPerTrade * fx) };
  return { day, currency: cur.currency, summary: scaled, trades, running };
}
