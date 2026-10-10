/**
 * Pure metrics module. No DB or framework imports so it is trivially testable.
 * Money is passed in as plain numbers (account currency, already rounded to cents by the caller).
 */

export type Side = "LONG" | "SHORT";
export type Result = "WIN" | "LOSS" | "BE";

export interface TradeInput {
  netPnl: number;
  grossPnl?: number;
  commission?: number; // negative = cost, as MT4 reports
  swap?: number;
  fees?: number;
  quantity?: number; // lots
  holdSeconds?: number | null;
  /** Trading day (YYYY-MM-DD) in the display timezone. */
  day: string;
  plannedR?: number | null;
  realizedR?: number | null;
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);
const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));

/** Win/Loss/BE: net P&L > threshold = win, < -threshold = loss, otherwise breakeven. */
export function classify(netPnl: number, threshold = 0): Result {
  if (netPnl > threshold) return "WIN";
  if (netPnl < -threshold) return "LOSS";
  return "BE";
}

export interface Summary {
  count: number;
  wins: number;
  losses: number;
  breakevens: number;
  /** wins / (wins + losses); breakevens excluded. 0..1 */
  winRate: number;
  netPnl: number;
  grossPnl: number;
  fees: number; // commission + swap + fees, as a positive cost number
  grossWin: number; // Σ net P&L of winners
  grossLoss: number; // Σ net P&L of losers (negative)
  /** Σ wins / |Σ losses|. null when there are no losses (display "∞" or "—"). */
  profitFactor: number | null;
  avgWin: number;
  avgLoss: number; // negative
  /** avgWin / |avgLoss|. null when there are no losers. */
  avgWinLossRatio: number | null;
  /** winRate × avgWin − lossRate × |avgLoss| */
  expectancy: number;
  avgNetPerTrade: number;
  avgHoldSeconds: number;
  avgPlannedR: number | null;
  avgRealizedR: number | null;
  volume: number;
}

/** Raw sums/counts: what a SQL GROUP BY can produce directly. Everything in Summary derives from these. */
export interface Aggregates {
  count: number;
  wins: number;
  losses: number;
  breakevens: number;
  netPnl: number;
  grossPnl: number;
  /** Σ (commission + swap + fees) with the broker's sign (negative = cost) */
  costs: number;
  grossWin: number;
  grossLoss: number;
  holdSum: number;
  holdCount: number;
  plannedSum: number;
  plannedCount: number;
  realizedSum: number;
  realizedCount: number;
  volume: number;
}

export function aggregate(trades: TradeInput[], breakevenThreshold = 0): Aggregates {
  const a: Aggregates = { count: trades.length, wins: 0, losses: 0, breakevens: 0, netPnl: 0, grossPnl: 0, costs: 0, grossWin: 0, grossLoss: 0, holdSum: 0, holdCount: 0, plannedSum: 0, plannedCount: 0, realizedSum: 0, realizedCount: 0, volume: 0 };
  for (const t of trades) {
    const r = classify(t.netPnl, breakevenThreshold);
    if (r === "WIN") {
      a.wins++;
      a.grossWin += t.netPnl;
    } else if (r === "LOSS") {
      a.losses++;
      a.grossLoss += t.netPnl;
    } else a.breakevens++;
    a.netPnl += t.netPnl;
    a.grossPnl += t.grossPnl ?? t.netPnl;
    a.costs += (t.commission ?? 0) + (t.swap ?? 0) + (t.fees ?? 0);
    a.volume += t.quantity ?? 0;
    if (t.holdSeconds != null) {
      a.holdSum += t.holdSeconds;
      a.holdCount++;
    }
    if (t.plannedR != null) {
      a.plannedSum += t.plannedR;
      a.plannedCount++;
    }
    if (t.realizedR != null) {
      a.realizedSum += t.realizedR;
      a.realizedCount++;
    }
  }
  return a;
}

export function summaryFromAggregates(a: Aggregates): Summary {
  const decided = a.wins + a.losses;
  const winRate = decided ? a.wins / decided : 0;
  const lossRate = decided ? a.losses / decided : 0;
  const avgWin = a.wins ? a.grossWin / a.wins : 0;
  const avgLoss = a.losses ? a.grossLoss / a.losses : 0;
  return {
    count: a.count,
    wins: a.wins,
    losses: a.losses,
    breakevens: a.breakevens,
    winRate,
    netPnl: round2(a.netPnl),
    grossPnl: round2(a.grossPnl),
    fees: round2(-a.costs),
    grossWin: round2(a.grossWin),
    grossLoss: round2(a.grossLoss),
    profitFactor: a.grossLoss === 0 ? null : a.grossWin / Math.abs(a.grossLoss),
    avgWin: round2(avgWin),
    avgLoss: round2(avgLoss),
    avgWinLossRatio: avgLoss === 0 ? null : avgWin / Math.abs(avgLoss),
    expectancy: round2(winRate * avgWin - lossRate * Math.abs(avgLoss)),
    avgNetPerTrade: round2(a.count ? a.netPnl / a.count : 0),
    avgHoldSeconds: a.holdCount ? a.holdSum / a.holdCount : 0,
    avgPlannedR: a.plannedCount ? a.plannedSum / a.plannedCount : null,
    avgRealizedR: a.realizedCount ? a.realizedSum / a.realizedCount : null,
    volume: a.volume,
  };
}

export function summarize(trades: TradeInput[], breakevenThreshold = 0): Summary {
  return summaryFromAggregates(aggregate(trades, breakevenThreshold));
}

// ───────────── Daily buckets ─────────────

export interface DayBucket {
  day: string;
  trades: number;
  netPnl: number;
  grossPnl: number;
  volume: number;
}

export function dailyBuckets(trades: TradeInput[]): DayBucket[] {
  const map = new Map<string, DayBucket>();
  for (const t of trades) {
    const b = map.get(t.day) ?? { day: t.day, trades: 0, netPnl: 0, grossPnl: 0, volume: 0 };
    b.trades += 1;
    b.netPnl += t.netPnl;
    b.grossPnl += t.grossPnl ?? t.netPnl;
    b.volume += t.quantity ?? 0;
    map.set(t.day, b);
  }
  return [...map.values()]
    .map((b) => ({ ...b, netPnl: round2(b.netPnl), grossPnl: round2(b.grossPnl) }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

export interface DaySummary {
  days: number;
  green: number;
  red: number;
  flat: number;
  /** green / (green + red) */
  dayWinRate: number;
  avgDailyNet: number;
  bestDay: number;
  worstDay: number;
}

export function summarizeDays(days: DayBucket[], breakevenThreshold = 0): DaySummary {
  const green = days.filter((d) => classify(d.netPnl, breakevenThreshold) === "WIN").length;
  const red = days.filter((d) => classify(d.netPnl, breakevenThreshold) === "LOSS").length;
  return {
    days: days.length,
    green,
    red,
    flat: days.length - green - red,
    dayWinRate: green + red ? green / (green + red) : 0,
    avgDailyNet: round2(avg(days.map((d) => d.netPnl))),
    bestDay: days.length ? Math.max(...days.map((d) => d.netPnl)) : 0,
    worstDay: days.length ? Math.min(...days.map((d) => d.netPnl)) : 0,
  };
}

// ───────────── Equity & drawdown ─────────────

/** Running total of a P&L series, starting from `start`. */
export function cumulative(values: number[], start = 0): number[] {
  let c = start;
  return values.map((v) => (c = round2(c + v)));
}

export interface DrawdownResult {
  /** drawdown at each point, <= 0, measured from the running equity peak */
  series: number[];
  max: number; // most negative value (<= 0)
  avg: number; // mean drawdown across points (<= 0)
}

/**
 * Drawdown from the running equity peak. `equity` is a balance/equity curve;
 * the peak is seeded with `start` so a first-day loss counts as drawdown.
 */
export function drawdown(equity: number[], start = equity[0] ?? 0): DrawdownResult {
  let peak = start;
  const series = equity.map((e) => {
    peak = Math.max(peak, e);
    return round2(e - peak);
  });
  return { series, max: series.length ? Math.min(...series, 0) : 0, avg: round2(avg(series)) };
}

/** Net profit divided by |max drawdown|. null when there has been no drawdown. */
export function recoveryFactor(netPnl: number, maxDrawdown: number): number | null {
  return maxDrawdown === 0 ? null : netPnl / Math.abs(maxDrawdown);
}

/** Share of net profit NOT coming from the single best day (0..1). 0 when net profit <= 0. */
export function consistency(days: DayBucket[]): number {
  const net = sum(days.map((d) => d.netPnl));
  if (net <= 0 || !days.length) return 0;
  const best = Math.max(...days.map((d) => d.netPnl));
  return clamp(1 - best / net);
}

// ───────────── Performance score ─────────────

export const PERFORMANCE_SCORE_FORMULA = [
  "Each component is scaled to 0–100, then the six are averaged with equal weight.",
  "Win %: win rate × 100",
  "Profit factor: PF ÷ 2.5 (capped at 100)",
  "Avg win/loss: ratio ÷ 2.0 (capped at 100)",
  "Recovery factor: RF ÷ 4 (capped at 100)",
  "Max drawdown: 100 at 0%, falling to 0 at a 20% drawdown of starting balance",
  "Consistency: 1 − (best day ÷ net profit)",
].join("\n");

export interface ScoreComponent {
  key: "winPct" | "profitFactor" | "avgWinLoss" | "recoveryFactor" | "maxDrawdown" | "consistency";
  label: string;
  value: number; // 0..100
}

export interface PerformanceScore {
  score: number; // 0..100
  components: ScoreComponent[];
}

export function performanceScore(input: {
  summary: Summary;
  days: DayBucket[];
  maxDrawdown: number; // <= 0
  startingBalance: number;
}): PerformanceScore {
  const { summary, days, maxDrawdown, startingBalance } = input;
  // no trades, no score: otherwise "no drawdown" and "no concentration" would award points for doing nothing
  if (summary.count === 0) {
    const labels: [ScoreComponent["key"], string][] = [["winPct", "Win %"], ["profitFactor", "Profit factor"], ["avgWinLoss", "Avg win/loss"], ["recoveryFactor", "Recovery factor"], ["maxDrawdown", "Max drawdown"], ["consistency", "Consistency"]];
    return { score: 0, components: labels.map(([key, label]) => ({ key, label, value: 0 })) };
  }
  const pf = summary.profitFactor ?? (summary.grossWin > 0 ? Infinity : 0);
  const wl = summary.avgWinLossRatio ?? (summary.avgWin > 0 ? Infinity : 0);
  const rf = recoveryFactor(summary.netPnl, maxDrawdown) ?? (summary.netPnl > 0 ? Infinity : 0);
  const ddPct = startingBalance > 0 ? Math.abs(maxDrawdown) / startingBalance : 0;

  const pct = (n: number) => Math.round(clamp(n) * 100);
  const components: ScoreComponent[] = [
    { key: "winPct", label: "Win %", value: pct(summary.winRate) },
    { key: "profitFactor", label: "Profit factor", value: pct(pf / 2.5) },
    { key: "avgWinLoss", label: "Avg win/loss", value: pct(wl / 2) },
    { key: "recoveryFactor", label: "Recovery factor", value: pct(rf / 4) },
    { key: "maxDrawdown", label: "Max drawdown", value: pct(1 - ddPct / 0.2) },
    { key: "consistency", label: "Consistency", value: pct(consistency(days)) },
  ];
  return { score: Math.round(avg(components.map((c) => c.value))), components };
}

// ───────────── Price / risk helpers ─────────────

/** Signed pips for a closed trade. Pip size is per symbol (XAUUSD default 0.01). */
export function pips(entry: number, exit: number, side: Side, pipSize = 0.01): number {
  const diff = side === "LONG" ? exit - entry : entry - exit;
  return Math.round((diff / pipSize) * 10) / 10;
}

/** Planned R = (target − entry) / (entry − stop). Works for both sides. null if undefined. */
export function plannedR(entry: number, stop: number | null | undefined, target: number | null | undefined): number | null {
  if (stop == null || target == null || entry === stop) return null;
  return (target - entry) / (entry - stop);
}

/** Initial risk in account currency: |entry − stop| × lots × contractSize × fx. */
export function riskAmount(p: {
  entry: number;
  stop: number | null | undefined;
  lots: number;
  contractSize: number;
  fxToAccount?: number;
}): number | null {
  if (p.stop == null) return null;
  return round2(Math.abs(p.entry - p.stop) * p.lots * p.contractSize * (p.fxToAccount ?? 1));
}

/** Realized R = net P&L / initial risk. null when risk is unknown or zero. */
export function realizedR(netPnl: number, risk: number | null | undefined): number | null {
  return risk ? netPnl / risk : null;
}

export function holdSeconds(open: Date, close: Date | null | undefined): number | null {
  return close ? Math.max(0, Math.round((close.getTime() - open.getTime()) / 1000)) : null;
}

/** Net ROI % = net P&L / adjusted cost (or balance at open) × 100. */
export function netRoi(netPnl: number, cost: number | null | undefined): number | null {
  return cost ? (netPnl / cost) * 100 : null;
}
