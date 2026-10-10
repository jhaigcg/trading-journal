import { isRealDay } from "@/lib/day";
import { TZDate } from "@date-fns/tz";
import { db } from "@/lib/db";
import { buildProgress, type ProgressData } from "@/lib/progress/build";
import { addDays, emptyFacts, type DayFacts, type RuleKindName, type RuleLike } from "@/lib/progress/evaluate";
import { DEFAULT_TZ, dayKey } from "@/lib/time";
import { n } from "./aggregate";

export const PERIODS = [
  { value: "30d", label: "Last 30 days", days: 30 },
  { value: "90d", label: "Last 90 days", days: 90 },
  { value: "year", label: "Last 12 months", days: 365 },
] as const;
export type PeriodKey = (typeof PERIODS)[number]["value"];
export const isPeriod = (v: string | undefined): v is PeriodKey => PERIODS.some((p) => p.value === v);

const isDay = isRealDay;

export interface RuleRecord extends RuleLike {
  active: boolean;
}

export async function listRules(): Promise<RuleRecord[]> {
  const rows = await db.disciplineRule.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }] });
  return rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind as RuleKindName, params: (r.params ?? {}) as Record<string, unknown>, active: r.active }));
}

export interface ProgressPage extends ProgressData {
  period: ProgressData["period"] & { key: PeriodKey; label: string; from: string };
  weekdays: number[];
  inactive: RuleRecord[];
}

/** Everything the Progress page shows. Trades from all accounts count: discipline is about you, not an account. */
export async function loadProgress(opts: { period?: string; day?: string; now?: Date } = {}): Promise<ProgressPage> {
  const now = opts.now ?? new Date();
  const [settings, all] = await Promise.all([db.setting.findUnique({ where: { id: 1 } }), listRules()]);
  const tz = settings?.displayTimezone ?? DEFAULT_TZ;
  const weekdays = settings?.tradingDays?.length ? settings.tradingDays : [1, 2, 3, 4, 5];
  const today = dayKey(now, tz);
  const local = new TZDate(now, tz);
  const key: PeriodKey = isPeriod(opts.period) ? opts.period : "30d";
  const def = PERIODS.find((p) => p.value === key)!;
  const windowFrom = addDays(today, -364);
  const periodFrom = addDays(today, -(def.days - 1));
  const focusDay = isDay(opts.day) && opts.day >= windowFrom && opts.day <= today ? opts.day : today;
  const rules = all.filter((r) => r.active);

  const [tradeRows, notes, logs, firstStart, firstTicks] = await Promise.all([
    db.$queryRaw<Record<string, unknown>[]>`
      SELECT t."closeDay"::text AS "day", count(*)::int AS "trades", count(t."stopLoss")::int AS "stop", count(t."strategyId")::int AS "strategy",
        count(t."profitTarget")::int AS "target", (count(*) FILTER (WHERE t."reviewed"))::int AS "reviewed", min(t."netPnl") AS "worst", coalesce(sum(t."netPnl"), 0) AS "net"
      FROM "Trade" t WHERE t."status" = 'CLOSED' AND t."closeDay" >= ${windowFrom}::date AND t."closeDay" <= ${today}::date GROUP BY t."closeDay"`,
    db.note.findMany({ where: { kind: "DAILY", deletedAt: null, startedAt: { not: null }, day: { gte: new Date(`${windowFrom}T00:00:00Z`), lte: new Date(`${today}T00:00:00Z`) } }, select: { day: true, startedAt: true } }),
    db.disciplineLog.findMany({ where: { rule: { kind: "MANUAL_CHECK" }, day: { gte: new Date(`${windowFrom}T00:00:00Z`), lte: new Date(`${today}T00:00:00Z`) } } }),
    db.note.aggregate({ where: { kind: "DAILY", deletedAt: null, startedAt: { not: null }, day: { not: null } }, _min: { day: true } }),
    db.disciplineLog.groupBy({ by: ["ruleId"], _min: { day: true } }),
  ]);

  const activeFrom = new Map<string, string>();
  for (const r of rules) {
    const first = r.kind === "TIME_BY" ? firstStart._min.day : r.kind === "MANUAL_CHECK" ? firstTicks.find((t) => t.ruleId === r.id)?._min.day : null;
    if (first) activeFrom.set(r.id, first.toISOString().slice(0, 10));
  }

  const facts = new Map<string, DayFacts>();
  for (const r of tradeRows) {
    facts.set(String(r.day), { ...emptyFacts(), trades: n(r.trades), withStopLoss: n(r.stop), withStrategy: n(r.strategy), withProfitTarget: n(r.target), reviewed: n(r.reviewed), worstTradeNet: r.worst == null ? null : n(r.worst), dayNet: n(r.net) });
  }
  for (const note of notes) {
    const day = note.day!.toISOString().slice(0, 10);
    const t = new TZDate(note.startedAt!, tz);
    facts.set(day, { ...(facts.get(day) ?? emptyFacts()), startedMinute: t.getHours() * 60 + t.getMinutes() });
  }
  const manual = new Map<string, Map<string, boolean>>();
  for (const l of logs) {
    if (!manual.has(l.ruleId)) manual.set(l.ruleId, new Map());
    manual.get(l.ruleId)!.set(l.day.toISOString().slice(0, 10), l.followed);
  }

  const data = buildProgress({ rules, facts, manual, tradingWeekdays: weekdays, today, nowMinute: local.getHours() * 60 + local.getMinutes(), windowFrom, periodFrom, focusDay, activeFrom });
  return { ...data, period: { ...data.period, key, label: def.label, from: periodFrom }, weekdays, inactive: all.filter((r) => !r.active) };
}
