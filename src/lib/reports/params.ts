import { CUMULATIVE_KEY, METRIC_BY_KEY, isGranularity, type Granularity, type Unit } from "./rollup";

export interface ChartConfig {
  metrics: string[];
  g: Granularity;
}

export const MAX_METRICS_PER_CHART = 4;
export const DEFAULT_CHARTS: [ChartConfig, ChartConfig] = [
  { metrics: [CUMULATIVE_KEY], g: "day" },
  { metrics: ["net", "winRate"], g: "week" },
];

const unitOf = (key: string): Unit | null => (key === CUMULATIVE_KEY ? "money" : (METRIC_BY_KEY.get(key)?.unit ?? null));

/**
 * Sanitise a metric list from the URL: known metrics only, no repeats, at most four, and at most two different units
 * (a chart has two vertical axes; a third unit would have nowhere to go).
 */
export function cleanMetrics(list: string[]): string[] {
  const out: string[] = [];
  const units = new Set<Unit>();
  for (const key of list) {
    const u = unitOf(key);
    if (!u || out.includes(key)) continue;
    if (!units.has(u) && units.size >= 2) continue;
    units.add(u);
    out.push(key);
    if (out.length >= MAX_METRICS_PER_CHART) break;
  }
  return out;
}

type Raw = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Chart 1 and 2 from `m1`/`g1` and `m2`/`g2`; anything missing or invalid falls back to the defaults. */
export function parseCharts(raw: Raw): [ChartConfig, ChartConfig] {
  const read = (i: 0 | 1): ChartConfig => {
    const n = i + 1;
    const metrics = cleanMetrics((one(raw[`m${n}`]) ?? "").split(",").map((s) => s.trim()).filter(Boolean));
    const g = one(raw[`g${n}`]);
    return { metrics: metrics.length ? metrics : DEFAULT_CHARTS[i].metrics, g: isGranularity(g) ? g : DEFAULT_CHARTS[i].g };
  };
  return [read(0), read(1)];
}

/** The metrics that may still be added to a chart (respecting the two-unit limit and the cap). */
export function addableMetrics(current: string[]): string[] {
  const all = [CUMULATIVE_KEY, ...METRIC_BY_KEY.keys()];
  return all.filter((k) => !current.includes(k) && cleanMetrics([...current, k]).length === current.length + 1);
}
