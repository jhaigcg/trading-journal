import { dayScore, eachDay, evaluate, level, perfectStreak, summarizeRule, tradingDaysIn, type DayFacts, type RuleLike, type RuleSummary, type Verdict } from "./evaluate";

export interface BuildInput {
  rules: RuleLike[];
  /** automatic facts per day (YYYY-MM-DD) */
  facts: Map<string, DayFacts>;
  /** manual ticks: ruleId → day → ticked */
  manual: Map<string, Map<string, boolean>>;
  /** weekday numbers that count as trading days (0 = Sunday) */
  tradingWeekdays: number[];
  today: string;
  nowMinute: number;
  /** first day of the heatmap window and of the chosen period (period start >= window start) */
  windowFrom: string;
  periodFrom: string;
  /** the day shown in the "Day" panel; defaults to today */
  focusDay: string;
  /**
   * First day each rule that depends on your own habit (start my day, manual ticks) counts from: the day you first used it.
   * Days before that are not judged, otherwise all your history before you started journaling would show as missed.
   * A rule missing from the map counts from today. Leave the whole map out to judge every day.
   */
  activeFrom?: Map<string, string>;
}

export interface RuleRow {
  rule: RuleLike;
  summary: RuleSummary;
  /** verdict on the focus day */
  focus: Verdict;
  /** manual rules: the tick on the focus day (undefined = never ticked) */
  focusManual?: boolean;
}

export interface HeatDay {
  day: string;
  trading: boolean;
  followed: number;
  total: number;
  score: number | null;
  level: 0 | 1 | 2 | 3 | 4;
}

export interface ProgressData {
  today: string;
  focusDay: string;
  focusIsTrading: boolean;
  rows: RuleRow[];
  heat: HeatDay[];
  /** how many rules were followed out of those that applied, on the focus day; `pending` rules are still open */
  focusProgress: { followed: number; total: number; pending: number };
  period: { score: number | null; followed: number; total: number; tradingDays: number; perfectDays: number; streak: number };
}

/** Evaluate every rule on every trading day of the window and summarise. Days after `today` are never evaluated. */
export function buildProgress(i: BuildInput): ProgressData {
  const days = tradingDaysIn(i.windowFrom, i.today, i.tradingWeekdays);
  const habit = (r: RuleLike) => r.kind === "TIME_BY" || r.kind === "MANUAL_CHECK";
  const verdictOn = (r: RuleLike, day: string): Verdict =>
    i.activeFrom && habit(r) && day < (i.activeFrom.get(r.id) ?? i.today) ? null : evaluate(r, i.facts.get(day), { isToday: day === i.today, nowMinute: i.nowMinute, manual: i.manual.get(r.id)?.get(day) });

  const byRule = new Map(i.rules.map((r) => [r.id, days.map((day) => ({ day, verdict: verdictOn(r, day) }))]));
  const dayNet = (day: string) => {
    const f = i.facts.get(day);
    return f && f.trades > 0 ? f.dayNet : null;
  };

  const heat: HeatDay[] = eachDay(i.windowFrom, i.today).map((day) => {
    const trading = days.includes(day);
    const s = trading ? dayScore(i.rules.map((r) => byRule.get(r.id)!.find((d) => d.day === day)!.verdict)) : { followed: 0, total: 0, score: null };
    return { day, trading, followed: s.followed, total: s.total, score: s.score, level: level(s.score) };
  });

  const inPeriod = (day: string) => day >= i.periodFrom;
  const rows: RuleRow[] = i.rules.map((rule) => ({
    rule,
    summary: summarizeRule(byRule.get(rule.id)!.filter((d) => inPeriod(d.day)), dayNet),
    focus: i.focusDay <= i.today ? verdictOn(rule, i.focusDay) : null,
    ...(rule.kind === "MANUAL_CHECK" ? { focusManual: i.manual.get(rule.id)?.get(i.focusDay) } : {}),
  }));

  const periodHeat = heat.filter((h) => h.trading && inPeriod(h.day));
  const followed = periodHeat.reduce((s, h) => s + h.followed, 0);
  const total = periodHeat.reduce((s, h) => s + h.total, 0);
  const focus = rows.map((r) => r.focus);

  return {
    today: i.today,
    focusDay: i.focusDay,
    focusIsTrading: days.includes(i.focusDay),
    rows,
    heat,
    focusProgress: { followed: focus.filter((v) => v === true).length, total: focus.filter((v) => v !== null).length, pending: focus.filter((v) => v === null).length },
    period: {
      score: total ? followed / total : null,
      followed,
      total,
      tradingDays: periodHeat.length,
      perfectDays: periodHeat.filter((h) => h.score === 1).length,
      streak: perfectStreak(heat.filter((h) => h.trading).map((h) => ({ day: h.day, score: h.score }))),
    },
  };
}
