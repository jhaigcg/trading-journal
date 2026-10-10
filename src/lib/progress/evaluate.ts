/**
 * Discipline rules, evaluated day by day. Pure functions: the queries gather the facts, this decides.
 *
 * A rule gives one verdict per trading day:
 *   true  = followed,  false = broken,  null = does not apply (or is still pending, for today).
 * "Does not apply" days (for example a stop-loss rule on a day with no trades) never count for or against you.
 */

export const RULE_KINDS = ["TIME_BY", "PERCENT_WITH_FIELD", "MAX_LOSS_PER_TRADE", "MAX_LOSS_PER_DAY", "MANUAL_CHECK"] as const;
export type RuleKindName = (typeof RULE_KINDS)[number];

export const PERCENT_FIELDS = ["stopLoss", "strategyId", "profitTarget", "reviewed"] as const;
export type PercentField = (typeof PERCENT_FIELDS)[number];
export const FIELD_LABEL: Record<PercentField, string> = { stopLoss: "a stop loss", strategyId: "a playbook", profitTarget: "a profit target", reviewed: "a review" };

export interface RuleLike {
  id: string;
  name: string;
  kind: RuleKindName;
  params: Record<string, unknown>;
}

/** Everything the automatic rules need to know about one day. */
export interface DayFacts {
  trades: number;
  withStopLoss: number;
  withStrategy: number;
  withProfitTarget: number;
  reviewed: number;
  /** the most negative net P&L of any single trade that day (null when there were no trades) */
  worstTradeNet: number | null;
  dayNet: number;
  /** minutes after local midnight when "Start my day" was pressed, null if it was not */
  startedMinute: number | null;
}

export const emptyFacts = (): DayFacts => ({ trades: 0, withStopLoss: 0, withStrategy: 0, withProfitTarget: 0, reviewed: 0, worstTradeNet: null, dayNet: 0, startedMinute: null });

export type Verdict = boolean | null;

export interface DayContext {
  isToday: boolean;
  /** minutes after local midnight right now (only used for today) */
  nowMinute: number;
  /** the manual tick for this rule and day: undefined when never ticked */
  manual?: boolean;
}

export const parseTime = (s: unknown): number | null => {
  const m = typeof s === "string" ? s.match(/^([01]?\d|2[0-3]):([0-5]\d)$/) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

export function evaluate(rule: RuleLike, facts: DayFacts | undefined, ctx: DayContext): Verdict {
  const f = facts ?? emptyFacts();
  switch (rule.kind) {
    case "TIME_BY": {
      const limit = parseTime(rule.params.time);
      if (limit == null) return null;
      if (f.startedMinute != null) return f.startedMinute <= limit;
      return ctx.isToday && ctx.nowMinute <= limit ? null : false; // not started yet: still pending until the deadline passes
    }
    case "PERCENT_WITH_FIELD": {
      if (f.trades === 0) return null;
      const field = rule.params.field as PercentField;
      const count = field === "stopLoss" ? f.withStopLoss : field === "strategyId" ? f.withStrategy : field === "profitTarget" ? f.withProfitTarget : field === "reviewed" ? f.reviewed : null;
      if (count == null) return null;
      const target = Math.min(100, Math.max(0, num(rule.params.percent, 100)));
      return (count / f.trades) * 100 >= target - 1e-9;
    }
    case "MAX_LOSS_PER_TRADE": {
      if (f.trades === 0 || f.worstTradeNet == null) return null;
      return f.worstTradeNet >= -Math.abs(num(rule.params.amount, 0)) - 1e-9;
    }
    case "MAX_LOSS_PER_DAY": {
      if (f.trades === 0) return null;
      return f.dayNet >= -Math.abs(num(rule.params.amount, 0)) - 1e-9;
    }
    case "MANUAL_CHECK":
      if (ctx.manual !== undefined) return ctx.manual;
      return ctx.isToday ? null : false;
  }
}

/** One-line description of a rule for lists ("Start my day by 09:30"). */
export function describeRule(rule: RuleLike, currency = "A$"): string {
  switch (rule.kind) {
    case "TIME_BY":
      return `Press "Start my day" by ${String(rule.params.time ?? "")}`;
    case "PERCENT_WITH_FIELD": {
      const pct = num(rule.params.percent, 100);
      const label = FIELD_LABEL[rule.params.field as PercentField] ?? "the field";
      return pct >= 100 ? `Every trade has ${label}` : `At least ${pct}% of trades have ${label}`;
    }
    case "MAX_LOSS_PER_TRADE":
      return `No single trade loses more than ${currency}${num(rule.params.amount, 0)}`;
    case "MAX_LOSS_PER_DAY":
      return `The day's net loss stays within ${currency}${num(rule.params.amount, 0)}`;
    case "MANUAL_CHECK":
      return "Tick it yourself each day";
  }
}

// ───────────── summaries ─────────────

export interface DayVerdict {
  day: string; // YYYY-MM-DD, trading days only, ascending
  verdict: Verdict;
}

export interface RuleSummary {
  followed: number;
  broken: number;
  applicable: number;
  /** followed / applicable, 0..1; null when nothing applied */
  rate: number | null;
  /** consecutive followed days ending at the latest day that applied */
  currentStreak: number;
  bestStreak: number;
  /** average net P&L on days the rule was followed / broken (only days with a result) */
  avgNetFollowed: number | null;
  avgNetBroken: number | null;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function summarizeRule(days: DayVerdict[], dayNet: (day: string) => number | null): RuleSummary {
  const decided = days.filter((d) => d.verdict !== null);
  const followed = decided.filter((d) => d.verdict === true).length;
  let current = 0;
  for (let i = decided.length - 1; i >= 0 && decided[i].verdict === true; i--) current++;
  let best = 0;
  let run = 0;
  for (const d of decided) {
    run = d.verdict ? run + 1 : 0;
    best = Math.max(best, run);
  }
  const nets = (v: boolean) => decided.filter((d) => d.verdict === v).map((d) => dayNet(d.day)).filter((n): n is number => n != null);
  return {
    followed,
    broken: decided.length - followed,
    applicable: decided.length,
    rate: decided.length ? followed / decided.length : null,
    currentStreak: current,
    bestStreak: best,
    avgNetFollowed: mean(nets(true)),
    avgNetBroken: mean(nets(false)),
  };
}

/** How a day went across all rules: share of applicable rules followed. Null when nothing applied. */
export function dayScore(verdicts: Verdict[]): { followed: number; total: number; score: number | null } {
  const decided = verdicts.filter((v) => v !== null);
  const followed = decided.filter(Boolean).length;
  return { followed, total: decided.length, score: decided.length ? followed / decided.length : null };
}

/** Heatmap level 0 (nothing applied) … 4 (everything followed), like a contribution graph. */
export function level(score: number | null): 0 | 1 | 2 | 3 | 4 {
  if (score == null) return 0;
  if (score >= 1) return 4;
  if (score >= 0.75) return 3;
  if (score >= 0.5) return 2;
  return 1;
}

/** Consecutive trading days, ending at the latest decided one, on which every applicable rule was followed. */
export function perfectStreak(scores: { day: string; score: number | null }[]): number {
  const decided = scores.filter((s) => s.score !== null);
  let n = 0;
  for (let i = decided.length - 1; i >= 0 && decided[i].score === 1; i--) n++;
  return n;
}

// ───────────── calendar helpers ─────────────

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Every calendar day from `from` to `to` inclusive. */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Days in the range that are trading days (weekday numbers 0 = Sunday … 6 = Saturday). */
export function tradingDaysIn(from: string, to: string, weekdays: number[]): string[] {
  return eachDay(from, to).filter((d) => weekdays.includes(new Date(`${d}T00:00:00Z`).getUTCDay()));
}

export { addDays };
