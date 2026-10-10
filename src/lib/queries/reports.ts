import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { Filters } from "@/lib/filters/params";
import { SESSION_HOURS, type Session } from "@/lib/filters/params";
import { resolveRange } from "@/lib/filters/range";
import { localOpen, tradeWhere } from "@/lib/filters/where";
import { summaryFromAggregates, type Aggregates, type Summary } from "@/lib/metrics";
import { emptyAgg, type DayRow } from "@/lib/reports/rollup";
import { AGG_SELECT, n, toAggregates } from "./aggregate";
import { settingsFor } from "./trade-list";

type Row = Record<string, unknown>;

/** Filters as every report sees them: closed trades only (open positions have no result yet). */
export const closedOnly = (f: Filters): Filters => ({ ...f, status: "closed" });

// ───────────── the day-by-day base ─────────────

export async function loadDayRows(f: Filters): Promise<DayRow[]> {
  const { tz, thr } = await settingsFor();
  const where = tradeWhere(closedOnly(f), { tz });
  const rows = await db.$queryRaw<Row[]>`
    SELECT t."closeDay"::text AS "day", ${AGG_SELECT(thr)}
    FROM "Trade" t ${where} AND t."closeDay" IS NOT NULL
    GROUP BY t."closeDay" ORDER BY t."closeDay"`;
  return rows.map((r) => ({ day: String(r.day), agg: toAggregates(r) }));
}

/** Days in the period with a daily journal entry that has something written in it. */
export async function loadJournaledDays(f: Filters): Promise<number> {
  const { tz } = await settingsFor();
  const { from, to } = resolveRange(f.range, { from: f.from, to: f.to }, undefined, tz);
  return db.note.count({
    where: {
      kind: "DAILY",
      deletedAt: null,
      plainText: { not: "" },
      day: { ...(from ? { gte: new Date(`${from}T00:00:00Z`) } : {}), ...(to ? { lte: new Date(`${to}T00:00:00Z`) } : {}) },
    },
  });
}

// ───────────── breakdowns ─────────────

export interface Breakdown {
  key: string;
  label: string;
  summary: Summary;
  agg: Aggregates;
}

const toBreakdown = (r: Row, label: string): Breakdown => {
  const agg = toAggregates(r);
  return { key: String(r.k), label, summary: summaryFromAggregates(agg), agg };
};

/** Fill in the keys that had no trades so charts always show the whole axis. */
function fill(rows: Row[], keys: (string | number)[], label: (k: string) => string): Breakdown[] {
  const by = new Map(rows.map((r) => [String(r.k), r]));
  return keys.map((k) => toBreakdown(by.get(String(k)) ?? { k, ...emptyAgg() }, label(String(k))));
}

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first

/** By weekday of entry (display timezone), Monday first. */
export async function byWeekday(f: Filters): Promise<Breakdown[]> {
  const { tz, thr } = await settingsFor();
  const where = tradeWhere(closedOnly(f), { tz });
  const rows = await db.$queryRaw<Row[]>`SELECT EXTRACT(DOW FROM ${localOpen(tz)})::int AS "k", ${AGG_SELECT(thr)} FROM "Trade" t ${where} GROUP BY 1`;
  return fill(rows, WEEK_ORDER, (k) => WEEKDAYS[Number(k)]);
}

/** By hour of entry (display timezone), 00–23. */
export async function byHour(f: Filters): Promise<Breakdown[]> {
  const { tz, thr } = await settingsFor();
  const where = tradeWhere(closedOnly(f), { tz });
  const rows = await db.$queryRaw<Row[]>`SELECT EXTRACT(HOUR FROM ${localOpen(tz)})::int AS "k", ${AGG_SELECT(thr)} FROM "Trade" t ${where} GROUP BY 1`;
  return fill(rows, Array.from({ length: 24 }, (_, i) => i), (k) => k.padStart(2, "0"));
}

const SESSION_LABEL: Record<Session | "other", string> = { asia: "Asia (00–07 UTC)", london: "London (07–13 UTC)", newyork: "New York (13–21 UTC)", other: "Off-hours (21–24 UTC)" };

export async function bySession(f: Filters): Promise<Breakdown[]> {
  const { tz, thr } = await settingsFor();
  const where = tradeWhere(closedOnly(f), { tz });
  const [a0, a1] = SESSION_HOURS.asia;
  const [l0, l1] = SESSION_HOURS.london;
  const [n0, n1] = SESSION_HOURS.newyork;
  const rows = await db.$queryRaw<Row[]>`
    SELECT CASE WHEN EXTRACT(HOUR FROM t."openedAt") >= ${a0} AND EXTRACT(HOUR FROM t."openedAt") < ${a1} THEN 'asia'
                WHEN EXTRACT(HOUR FROM t."openedAt") >= ${l0} AND EXTRACT(HOUR FROM t."openedAt") < ${l1} THEN 'london'
                WHEN EXTRACT(HOUR FROM t."openedAt") >= ${n0} AND EXTRACT(HOUR FROM t."openedAt") < ${n1} THEN 'newyork'
                ELSE 'other' END AS "k", ${AGG_SELECT(thr)}
    FROM "Trade" t ${where} GROUP BY 1`;
  return fill(rows, ["asia", "london", "newyork", "other"], (k) => SESSION_LABEL[k as Session | "other"]);
}

export interface HeatCell {
  dow: number;
  hour: number;
  trades: number;
  net: number;
}

/** Net P&L for every weekday × hour of entry. */
export async function heatmap(f: Filters): Promise<HeatCell[]> {
  const { tz } = await settingsFor();
  const where = tradeWhere(closedOnly(f), { tz });
  const rows = await db.$queryRaw<Row[]>`
    SELECT EXTRACT(DOW FROM ${localOpen(tz)})::int AS "dow", EXTRACT(HOUR FROM ${localOpen(tz)})::int AS "hour", count(*)::int AS "trades", coalesce(sum(t."netPnl"), 0) AS "net"
    FROM "Trade" t ${where} GROUP BY 1, 2`;
  return rows.map((r) => ({ dow: n(r.dow), hour: n(r.hour), trades: n(r.trades), net: n(r.net) }));
}

export async function bySymbol(f: Filters): Promise<Breakdown[]> {
  const { tz, thr } = await settingsFor();
  const where = tradeWhere(closedOnly(f), { tz });
  const rows = await db.$queryRaw<Row[]>`SELECT t."symbol" AS "k", ${AGG_SELECT(thr)} FROM "Trade" t ${where} GROUP BY t."symbol" ORDER BY sum(t."netPnl") DESC`;
  return rows.map((r) => toBreakdown(r, String(r.k)));
}

export const NO_PLAYBOOK = "none";

/** By playbook, including the trades that are not linked to one. */
export async function byStrategy(f: Filters): Promise<Breakdown[]> {
  const { tz, thr } = await settingsFor();
  const where = tradeWhere(closedOnly(f), { tz });
  const rows = await db.$queryRaw<Row[]>`
    SELECT coalesce(t."strategyId", ${NO_PLAYBOOK}) AS "k", coalesce(s."name", 'No playbook') AS "name", ${AGG_SELECT(thr)}
    FROM "Trade" t LEFT JOIN "Strategy" s ON s."id" = t."strategyId" ${where}
    GROUP BY t."strategyId", s."name" ORDER BY sum(t."netPnl") DESC`;
  return rows.map((r) => toBreakdown(r, String(r.name)));
}

export interface TagBreakdown extends Breakdown {
  category: string;
}

/** By tag. A trade with several tags counts once under each of them, so rows overlap by design. */
export async function byTag(f: Filters): Promise<TagBreakdown[]> {
  const { tz, thr } = await settingsFor();
  const where = tradeWhere(closedOnly(f), { tz });
  const rows = await db.$queryRaw<Row[]>`
    SELECT g."id" AS "k", g."name" AS "name", c."name" AS "category", ${AGG_SELECT(thr)}
    FROM "Trade" t JOIN "TradeTag" tt ON tt."tradeId" = t."id" JOIN "Tag" g ON g."id" = tt."tagId" JOIN "TagCategory" c ON c."id" = g."categoryId" ${where}
    GROUP BY g."id", g."name", c."name" ORDER BY sum(t."netPnl") DESC`;
  return rows.map((r) => ({ ...toBreakdown(r, String(r.name)), category: String(r.category) }));
}

// ───────────── risk (R multiples) ─────────────

export const R_BUCKETS = [
  { key: "lt-2", label: "below −2R" },
  { key: "-2..-1", label: "−2R to −1R" },
  { key: "-1..0", label: "−1R to 0R" },
  { key: "0..1", label: "0R to 1R" },
  { key: "1..2", label: "1R to 2R" },
  { key: "2..3", label: "2R to 3R" },
  { key: "gt3", label: "above 3R" },
] as const;

export interface RiskReport {
  buckets: Breakdown[];
  trades: number;
  withStop: number;
  withRealizedR: number;
  avgRisk: number | null;
  avgPlannedR: number | null;
  avgRealizedR: number | null;
  /** average realized R when winning / losing */
  avgWinR: number | null;
  avgLossR: number | null;
}

export async function riskReport(f: Filters): Promise<RiskReport> {
  const { tz, thr } = await settingsFor();
  const where = tradeWhere(closedOnly(f), { tz });
  const [buckets, tot] = await Promise.all([
    db.$queryRaw<Row[]>`
      SELECT CASE WHEN t."realizedR" < -2 THEN 'lt-2' WHEN t."realizedR" < -1 THEN '-2..-1' WHEN t."realizedR" < 0 THEN '-1..0'
                  WHEN t."realizedR" < 1 THEN '0..1' WHEN t."realizedR" < 2 THEN '1..2' WHEN t."realizedR" < 3 THEN '2..3' ELSE 'gt3' END AS "k", ${AGG_SELECT(thr)}
      FROM "Trade" t ${where} AND t."realizedR" IS NOT NULL GROUP BY 1`,
    db.$queryRaw<Row[]>`
      SELECT count(*)::int AS "trades", count(t."stopLoss")::int AS "withStop", count(t."realizedR")::int AS "withR",
        avg(t."tradeRisk") AS "avgRisk", avg(t."plannedR") AS "avgPlanned", avg(t."realizedR") AS "avgRealized",
        avg(t."realizedR") FILTER (WHERE t."netPnl" > ${thr}::numeric) AS "avgWinR", avg(t."realizedR") FILTER (WHERE t."netPnl" < -(${thr}::numeric)) AS "avgLossR"
      FROM "Trade" t ${where}`,
  ]);
  const t = tot[0] ?? {};
  const num = (v: unknown) => (v == null ? null : Number(v));
  return {
    buckets: fill(buckets, R_BUCKETS.map((b) => b.key), (k) => R_BUCKETS.find((b) => b.key === k)!.label),
    trades: n(t.trades),
    withStop: n(t.withStop),
    withRealizedR: n(t.withR),
    avgRisk: num(t.avgRisk),
    avgPlannedR: num(t.avgPlanned),
    avgRealizedR: num(t.avgRealized),
    avgWinR: num(t.avgWinR),
    avgLossR: num(t.avgLossR),
  };
}

// ───────────── winners vs losers ─────────────

export interface ResultProfile {
  result: "WIN" | "LOSS" | "BREAKEVEN";
  trades: number;
  totalNet: number;
  avgNet: number | null;
  avgHoldSeconds: number | null;
  avgLots: number | null;
  avgPips: number | null;
  pctWithStop: number | null;
  pctWithPlaybook: number | null;
  pctReviewed: number | null;
  /** most common hour of entry (display timezone) */
  topHour: number | null;
}

export async function winsVsLosses(f: Filters): Promise<ResultProfile[]> {
  const { tz, thr } = await settingsFor();
  const where = tradeWhere(closedOnly(f), { tz });
  const rows = await db.$queryRaw<Row[]>`
    SELECT CASE WHEN t."netPnl" > ${thr}::numeric THEN 'WIN' WHEN t."netPnl" < -(${thr}::numeric) THEN 'LOSS' ELSE 'BREAKEVEN' END AS "k",
      count(*)::int AS "trades", coalesce(sum(t."netPnl"), 0) AS "total", avg(t."netPnl") AS "avgNet", avg(t."holdSeconds") AS "hold", avg(t."quantity") AS "lots", avg(t."pips") AS "pips",
      (count(t."stopLoss")::float / count(*)) AS "stop", (count(t."strategyId")::float / count(*)) AS "playbook", (count(*) FILTER (WHERE t."reviewed")::float / count(*)) AS "reviewed",
      mode() WITHIN GROUP (ORDER BY EXTRACT(HOUR FROM ${localOpen(tz)})::int) AS "topHour"
    FROM "Trade" t ${where} GROUP BY 1`;
  const num = (v: unknown) => (v == null ? null : Number(v));
  const by = new Map(rows.map((r) => [String(r.k), r]));
  return (["WIN", "LOSS", "BREAKEVEN"] as const).map((k) => {
    const r = by.get(k);
    return {
      result: k,
      trades: n(r?.trades),
      totalNet: n(r?.total),
      avgNet: num(r?.avgNet),
      avgHoldSeconds: num(r?.hold),
      avgLots: num(r?.lots),
      avgPips: num(r?.pips),
      pctWithStop: num(r?.stop),
      pctWithPlaybook: num(r?.playbook),
      pctReviewed: num(r?.reviewed),
      topHour: num(r?.topHour),
    };
  });
}

// ───────────── distribution ─────────────

/** Histogram of net P&L per trade in equal-width buckets spanning the range of the data. */
export async function pnlDistribution(f: Filters, buckets = 16): Promise<{ from: number; to: number; count: number }[]> {
  const { tz } = await settingsFor();
  const where = tradeWhere(closedOnly(f), { tz });
  const rows = await db.$queryRaw<{ net: Prisma.Decimal }[]>`SELECT t."netPnl" AS "net" FROM "Trade" t ${where}`;
  const v = rows.map((r) => Number(r.net));
  return histogram(v, buckets);
}

export function histogram(values: number[], buckets: number): { from: number; to: number; count: number }[] {
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return [{ from: min, to: max, count: values.length }];
  const width = (max - min) / buckets;
  const out = Array.from({ length: buckets }, (_, i) => ({ from: min + i * width, to: min + (i + 1) * width, count: 0 }));
  for (const x of values) out[Math.min(buckets - 1, Math.floor((x - min) / width))].count++;
  return out;
}
