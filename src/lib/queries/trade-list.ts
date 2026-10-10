import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { Filters } from "@/lib/filters/params";
import { tradeWhere } from "@/lib/filters/where";
import { round2, summaryFromAggregates, type Summary } from "@/lib/metrics";
import { DEFAULT_TZ } from "@/lib/time";
import { loadAggregates } from "./aggregate";

const n = (v: unknown) => (v == null ? 0 : Number(v));

export async function settingsFor() {
  const s = await db.setting.findUnique({ where: { id: 1 } });
  return { tz: s?.displayTimezone ?? DEFAULT_TZ, thr: Number(s?.breakevenThreshold ?? 0), home: s?.displayCurrency ?? "AUD" };
}

// ───────────── All trades table ─────────────

/** Sortable columns. Keys are the only values accepted from the URL; the SQL is fixed text. */
export const SORT_COLUMNS = {
  openedAt: 't."openedAt"',
  closedAt: 't."closedAt"',
  symbol: 't."symbol"',
  side: 't."side"',
  status: 't."status"',
  avgEntry: 't."avgEntry"',
  avgExit: 't."avgExit"',
  netPnl: 't."netPnl"',
  netRoi: 't."netRoi"',
  quantity: 't."quantity"',
  insights: '"insights"',
} as const;
export type SortKey = keyof typeof SORT_COLUMNS;
export const isSortKey = (v: string | undefined): v is SortKey => !!v && v in SORT_COLUMNS;
export const PAGE_SIZES = [25, 50, 100] as const;

export interface ListRow {
  id: string;
  openedAt: Date;
  closedAt: Date | null;
  symbol: string;
  side: "LONG" | "SHORT";
  status: "OPEN" | "CLOSED";
  result: "WIN" | "LOSS" | "BREAKEVEN" | null;
  quantity: number;
  avgEntry: number;
  avgExit: number | null;
  netPnl: number;
  netRoi: number | null;
  reviewed: boolean;
  rating: number | null;
  strategy: string | null;
  /** how many of my own rules the trade breaks: no stop, no strategy, not reviewed, no tags */
  insights: number;
}

export interface ListResult {
  rows: ListRow[];
  total: number;
  /** mean |net P&L| of the whole filtered set, the yardstick for the "scale" bar */
  avgAbs: number;
}

export async function listTrades(f: Filters, o: { sort: SortKey; dir: "asc" | "desc"; page: number; size: number }): Promise<ListResult> {
  const { tz } = await settingsFor();
  const where = tradeWhere(f, { tz });
  const order = Prisma.raw(`${SORT_COLUMNS[o.sort]} ${o.dir === "asc" ? "ASC" : "DESC"} NULLS LAST`);
  const offset = (Math.max(o.page, 1) - 1) * o.size;

  const [rows, meta] = await Promise.all([
    db.$queryRaw<Record<string, unknown>[]>`
      SELECT t."id", t."openedAt", t."closedAt", t."symbol", t."side"::text AS "side", t."status"::text AS "status", t."result"::text AS "result",
        t."quantity", t."avgEntry", t."avgExit", t."netPnl", t."netRoi", t."reviewed", t."rating", s."name" AS "strategy",
        ((t."stopLoss" IS NULL)::int + (t."strategyId" IS NULL)::int + (NOT t."reviewed")::int
          + (NOT EXISTS (SELECT 1 FROM "TradeTag" x WHERE x."tradeId" = t."id"))::int) AS "insights"
      FROM "Trade" t LEFT JOIN "Strategy" s ON s."id" = t."strategyId" ${where}
      ORDER BY ${order}, t."id" LIMIT ${o.size} OFFSET ${offset}`,
    db.$queryRaw<{ total: number; avgAbs: Prisma.Decimal | null }[]>`SELECT count(*)::int AS "total", avg(abs(t."netPnl")) AS "avgAbs" FROM "Trade" t ${where}`,
  ]);

  return {
    rows: rows.map((r) => ({
      id: String(r.id),
      openedAt: r.openedAt as Date,
      closedAt: (r.closedAt as Date | null) ?? null,
      symbol: String(r.symbol),
      side: r.side as ListRow["side"],
      status: r.status as ListRow["status"],
      result: (r.result as ListRow["result"]) ?? null,
      quantity: n(r.quantity),
      avgEntry: n(r.avgEntry),
      avgExit: r.avgExit == null ? null : n(r.avgExit),
      netPnl: n(r.netPnl),
      netRoi: r.netRoi == null ? null : n(r.netRoi),
      reviewed: Boolean(r.reviewed),
      rating: r.rating == null ? null : n(r.rating),
      strategy: (r.strategy as string | null) ?? null,
      insights: n(r.insights),
    })),
    total: meta[0]?.total ?? 0,
    avgAbs: n(meta[0]?.avgAbs),
  };
}

/** Ids of every trade matching the filters (used by "select all N matching"). Capped for safety. */
export async function matchingIds(f: Filters, cap = 5000): Promise<string[]> {
  const { tz } = await settingsFor();
  const rows = await db.$queryRaw<{ id: string }[]>`SELECT t."id" FROM "Trade" t ${tradeWhere(f, { tz })} ORDER BY t."openedAt" DESC LIMIT ${cap}`;
  return rows.map((r) => r.id);
}

// ───────────── Summary strip ─────────────

export interface ListSummary {
  summary: Summary;
  /** ≤ 60 points of cumulative net P&L, trade by trade */
  spark: number[];
}

export async function loadListSummary(f: Filters): Promise<ListSummary> {
  const { tz, thr } = await settingsFor();
  const where = tradeWhere(f, { tz });
  const agg = await loadAggregates(where, thr);
  const step = Math.max(1, Math.ceil(agg.count / 60));
  const pts = agg.count
    ? await db.$queryRaw<{ cum: Prisma.Decimal }[]>`
        WITH r AS (
          SELECT sum(t."netPnl") OVER (ORDER BY t."closedAt", t."id") AS cum, row_number() OVER (ORDER BY t."closedAt", t."id") AS rn, count(*) OVER () AS total
          FROM "Trade" t ${where} AND t."closedAt" IS NOT NULL)
        SELECT cum FROM r WHERE rn % ${step} = 0 OR rn = total ORDER BY rn`
    : [];
  return { summary: summaryFromAggregates(agg), spark: pts.map((p) => round2(n(p.cum))) };
}

// ───────────── Day / Week cards ─────────────

export interface PeriodCard {
  /** YYYY-MM-DD: the trading day, or the Monday of the week */
  key: string;
  trades: number;
  wins: number;
  losses: number;
  netPnl: number;
  grossPnl: number;
  costs: number;
  volume: number;
  grossWin: number;
  grossLoss: number;
  /** day cards: cumulative net P&L after each trade of the day */
  intraday: number[];
  notes: number;
  /** week cards */
  days: number;
  bestDay: number;
  worstDay: number;
}

const card = (r: Record<string, unknown>): PeriodCard => ({
  key: String(r.key),
  trades: n(r.trades),
  wins: n(r.wins),
  losses: n(r.losses),
  netPnl: round2(n(r.net)),
  grossPnl: round2(n(r.gross)),
  costs: round2(n(r.costs)),
  volume: n(r.volume),
  grossWin: round2(n(r.gw)),
  grossLoss: round2(n(r.gl)),
  intraday: [],
  notes: 0,
  days: n(r.days),
  bestDay: round2(n(r.best)),
  worstDay: round2(n(r.worst)),
});

const DAY_COLS = (thr: number) => Prisma.sql`
  count(*)::int AS trades,
  (count(*) FILTER (WHERE t."netPnl" > ${thr}::numeric))::int AS wins,
  (count(*) FILTER (WHERE t."netPnl" < -(${thr}::numeric)))::int AS losses,
  sum(t."netPnl") AS net, sum(t."grossPnl") AS gross, sum(t."commission" + t."swap" + t."fees") AS costs, sum(t."quantity") AS volume,
  coalesce(sum(t."netPnl") FILTER (WHERE t."netPnl" > ${thr}::numeric), 0) AS gw,
  coalesce(sum(t."netPnl") FILTER (WHERE t."netPnl" < -(${thr}::numeric)), 0) AS gl`;

export async function listDayCards(f: Filters, o: { page: number; size: number }): Promise<{ cards: PeriodCard[]; totalDays: number }> {
  const { tz, thr } = await settingsFor();
  const where = tradeWhere({ ...f, status: "closed" }, { tz });
  const offset = (Math.max(o.page, 1) - 1) * o.size;

  const [rows, total] = await Promise.all([
    db.$queryRaw<Record<string, unknown>[]>`
      SELECT t."closeDay"::text AS "key", ${DAY_COLS(thr)}
      FROM "Trade" t ${where} AND t."closeDay" IS NOT NULL GROUP BY t."closeDay" ORDER BY t."closeDay" DESC LIMIT ${o.size} OFFSET ${offset}`,
    db.$queryRaw<{ n: number }[]>`SELECT count(DISTINCT t."closeDay")::int AS n FROM "Trade" t ${where} AND t."closeDay" IS NOT NULL`,
  ]);
  const cards = rows.map(card);
  if (!cards.length) return { cards, totalDays: total[0]?.n ?? 0 };

  const days = cards.map((c) => c.key);
  const [series, dailyNotes, tradeNotes] = await Promise.all([
    db.$queryRaw<{ day: string; net: Prisma.Decimal }[]>`SELECT t."closeDay"::text AS "day", t."netPnl" AS "net" FROM "Trade" t ${where} AND t."closeDay" = ANY(${days}::date[]) ORDER BY t."closedAt", t."id"`,
    db.$queryRaw<{ day: string; n: number }[]>`SELECT "day"::text AS "day", count(*)::int AS n FROM "Note" WHERE "kind" = 'DAILY' AND "deletedAt" IS NULL AND "day" = ANY(${days}::date[]) GROUP BY "day"`,
    db.$queryRaw<{ day: string; n: number }[]>`SELECT t."closeDay"::text AS "day", count(*)::int AS n FROM "Note" nt JOIN "Trade" t ON t."id" = nt."tradeId" WHERE nt."kind" = 'TRADE' AND nt."deletedAt" IS NULL AND t."closeDay" = ANY(${days}::date[]) GROUP BY t."closeDay"`,
  ]);
  const byDay = new Map(cards.map((c) => [c.key, c]));
  const running = new Map<string, number>();
  for (const s of series) {
    const c = byDay.get(s.day);
    if (!c) continue;
    const next = round2((running.get(s.day) ?? 0) + n(s.net));
    running.set(s.day, next);
    c.intraday.push(next);
  }
  for (const x of [...dailyNotes, ...tradeNotes]) {
    const c = byDay.get(x.day);
    if (c) c.notes += x.n;
  }
  return { cards, totalDays: total[0]?.n ?? 0 };
}

export async function listWeekCards(f: Filters, o: { page: number; size: number }): Promise<{ cards: PeriodCard[]; totalWeeks: number }> {
  const { tz, thr } = await settingsFor();
  const where = tradeWhere({ ...f, status: "closed" }, { tz });
  const offset = (Math.max(o.page, 1) - 1) * o.size;
  const daily = Prisma.sql`
    WITH d AS (
      SELECT t."closeDay" AS day, ${DAY_COLS(thr)}
      FROM "Trade" t ${where} AND t."closeDay" IS NOT NULL GROUP BY t."closeDay")`;
  const [rows, total] = await Promise.all([
    db.$queryRaw<Record<string, unknown>[]>`
      ${daily}
      SELECT date_trunc('week', day)::date::text AS "key", sum(trades)::int AS trades, sum(wins)::int AS wins, sum(losses)::int AS losses,
        sum(net) AS net, sum(gross) AS gross, sum(costs) AS costs, sum(volume) AS volume, sum(gw) AS gw, sum(gl) AS gl,
        count(*)::int AS days, max(net) AS best, min(net) AS worst
      FROM d GROUP BY 1 ORDER BY 1 DESC LIMIT ${o.size} OFFSET ${offset}`,
    db.$queryRaw<{ n: number }[]>`${daily} SELECT count(DISTINCT date_trunc('week', day))::int AS n FROM d`,
  ]);
  return { cards: rows.map(card), totalWeeks: total[0]?.n ?? 0 };
}

// ───────────── Prev / next while browsing ─────────────

/** The trades before and after `id` (by entry time) within the same filters, for the ‹ › buttons on the details page. */
export async function neighbours(id: string, f: Filters): Promise<{ prev: string | null; next: string | null }> {
  const { tz } = await settingsFor();
  const where = tradeWhere(f, { tz });
  const cur = await db.trade.findUnique({ where: { id }, select: { openedAt: true } });
  if (!cur) return { prev: null, next: null };
  const [older, newer] = await Promise.all([
    db.$queryRaw<{ id: string }[]>`SELECT t."id" FROM "Trade" t ${where} AND (t."openedAt", t."id") < (${cur.openedAt}, ${id}) ORDER BY t."openedAt" DESC, t."id" DESC LIMIT 1`,
    db.$queryRaw<{ id: string }[]>`SELECT t."id" FROM "Trade" t ${where} AND (t."openedAt", t."id") > (${cur.openedAt}, ${id}) ORDER BY t."openedAt" ASC, t."id" ASC LIMIT 1`,
  ]);
  return { prev: older[0]?.id ?? null, next: newer[0]?.id ?? null };
}

