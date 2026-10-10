"use client";

import { Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ChartSection } from "@/lib/reports/doc";
import { formatValue, type Unit } from "@/lib/reports/rollup";

const COLORS = ["var(--accent)", "#5aa9e6", "#c084fc", "#34d399"];
const AXIS = { fontSize: 11, fill: "var(--muted)" } as const;

const shortLabel = (l: string) => {
  const m = l.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}`;
  const mo = l.match(/^(\d{4})-(\d{2})$/);
  return mo ? `${mo[2]}/${mo[1].slice(2)}` : l;
};

const compact = (unit: Unit, v: number) => {
  if (unit === "money") {
    const a = Math.abs(v);
    const s = a >= 1_000_000 ? `${+(a / 1_000_000).toFixed(1)}M` : a >= 1000 ? `${+(a / 1000).toFixed(1)}K` : `${Math.round(a)}`;
    return v < 0 ? `−${s}` : s;
  }
  if (unit === "pct") return `${Math.round(v)}%`;
  if (unit === "duration") return `${Math.round(v / 60)}m`;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
};

/** One chart, up to two vertical axes (left = first unit, right = second). Bars for totals, lines for rates. */
export function ReportChart({ section, currency }: { section: ChartSection; currency: string }) {
  const units = [...new Set(section.series.map((s) => s.unit))].slice(0, 2);
  const data = section.labels.map((label, i) => ({ label, ...Object.fromEntries(section.series.map((s) => [s.key, s.values[i] ?? null])) }));
  if (!data.length || section.series.every((s) => s.values.every((v) => v == null))) {
    return <div className="flex h-[240px] items-center justify-center text-sm text-muted">No data for these filters</div>;
  }
  const axisOf = (u: Unit) => (units.indexOf(u) === 0 ? "left" : "right");
  return (
    <div className="h-[280px]" role="img" aria-label={`${section.title}: chart of ${section.series.map((s) => s.label).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={AXIS} tickFormatter={shortLabel} axisLine={false} tickLine={false} minTickGap={24} />
          {units.map((u, i) => (
            <YAxis key={u} yAxisId={i === 0 ? "left" : "right"} orientation={i === 0 ? "left" : "right"} tick={AXIS} tickFormatter={(v: number) => compact(u, v)} axisLine={false} tickLine={false} width={44} />
          ))}
          <ReferenceLine yAxisId="left" y={0} stroke="var(--border-strong, var(--border))" />
          <Tooltip
            contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
            labelFormatter={(l) => String(l)}
            formatter={(v, name, item) => {
              const s = section.series.find((x) => x.key === item?.dataKey);
              return [s ? formatValue(s.unit, v == null ? null : Number(v), currency) : String(v), String(name)];
            }}
          />
          {section.series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {section.series.map((s, i) =>
            s.type === "bar" ? (
              <Bar key={s.key} dataKey={s.key} name={s.label} yAxisId={axisOf(s.unit)} fill={COLORS[i % COLORS.length]} radius={[2, 2, 0, 0]} maxBarSize={28} isAnimationActive={false} />
            ) : (
              <Line key={s.key} dataKey={s.key} name={s.label} yAxisId={axisOf(s.unit)} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={section.labels.length < 40} connectNulls isAnimationActive={false} />
            ),
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
