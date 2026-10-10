"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { money } from "@/lib/format";

interface Point {
  label: string;
  value: number;
}

const AXIS = { fontSize: 11, fill: "var(--muted)" } as const;
const GRID = "var(--border)";

/** Compact axis money: 40K, -1.2K, 0 */
const compact = (n: number) => {
  const a = Math.abs(n);
  const s = a >= 1_000_000 ? `${+(a / 1_000_000).toFixed(1)}M` : a >= 1000 ? `${+(a / 1000).toFixed(1)}K` : `${Math.round(a)}`;
  return n < 0 ? `−${s}` : s;
};

const shortDate = (l: string) => {
  const m = l.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : l;
};

function Tip({ active, payload, label, currency, name }: { active?: boolean; payload?: { value?: number | string }[]; label?: string | number; currency: string; name?: string }) {
  if (!active || !payload?.length) return null;
  const v = Number(payload[0].value);
  return (
    <div className="rounded-lg border border-line-strong bg-card px-3 py-2 text-xs shadow-lg">
      <div className="text-muted">{shortDate(String(label))}</div>
      <div className={`num mt-0.5 text-sm font-semibold ${v > 0 ? "text-profit" : v < 0 ? "text-loss" : "text-ink"}`}>
        {name ? `${name} ` : ""}
        {money(v, currency)}
      </div>
    </div>
  );
}

/** Offset (0..1 from the top) where the value crosses zero, for a green-above / red-below gradient. */
function zeroOffset(values: number[]) {
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  if (max <= 0) return 0;
  if (min >= 0) return 1;
  return max / (max - min);
}

function Empty() {
  return <div className="flex h-[240px] items-center justify-center text-sm text-muted">No data for these filters</div>;
}

export function CumulativeChart({ data, currency }: { data: Point[]; currency: string }) {
  if (!data.length) return <Empty />;
  const off = zeroOffset(data.map((d) => d.value));
  return (
    <div className="h-[240px]" role="img" aria-label="Cumulative net P&L chart">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="cumStroke" x1="0" y1="0" x2="0" y2="1">
              <stop offset={off} stopColor="var(--profit)" />
              <stop offset={off} stopColor="var(--loss)" />
            </linearGradient>
            <linearGradient id="cumFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset={0} stopColor="var(--profit)" stopOpacity={0.35} />
              <stop offset={off} stopColor="var(--profit)" stopOpacity={0.05} />
              <stop offset={off} stopColor="var(--loss)" stopOpacity={0.05} />
              <stop offset={1} stopColor="var(--loss)" stopOpacity={0.4} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tickFormatter={shortDate} tick={AXIS} axisLine={false} tickLine={false} minTickGap={48} />
          <YAxis tickFormatter={compact} tick={AXIS} axisLine={false} tickLine={false} width={48} />
          <Tooltip content={<Tip currency={currency} />} />
          <ReferenceLine y={0} stroke="var(--border-strong)" />
          <Area type="monotone" dataKey="value" stroke="url(#cumStroke)" strokeWidth={2} fill="url(#cumFill)" baseValue={0} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DailyBars({ data, currency }: { data: Point[]; currency: string }) {
  if (!data.length) return <Empty />;
  return (
    <div className="h-[240px]" role="img" aria-label="Net daily P&L chart">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tickFormatter={shortDate} tick={AXIS} axisLine={false} tickLine={false} minTickGap={48} />
          <YAxis tickFormatter={compact} tick={AXIS} axisLine={false} tickLine={false} width={48} />
          <Tooltip content={<Tip currency={currency} />} cursor={{ fill: "var(--nav-active)", opacity: 0.5 }} />
          <ReferenceLine y={0} stroke="var(--border-strong)" />
          <Bar dataKey="value" radius={[2, 2, 0, 0]} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.label} fill={d.value >= 0 ? "var(--profit)" : "var(--loss)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BalanceChart({ data, currency }: { data: { day: string; balance: number; deposits: number }[]; currency: string }) {
  if (!data.length) return <Empty />;
  const hasDeposits = data.some((d) => d.deposits !== 0);
  return (
    <div>
      <div className="mb-1 flex gap-4 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-2 w-2 rounded-full bg-accent" /> Account balance
        </span>
        {hasDeposits && (
          <span className="inline-flex items-center gap-1.5">
            <i className="inline-block h-2 w-2 rounded-full bg-long" /> Deposits / withdrawals
          </span>
        )}
      </div>
      <div className="h-[240px]" role="img" aria-label="Account balance chart">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="day" tickFormatter={shortDate} tick={AXIS} axisLine={false} tickLine={false} minTickGap={48} />
            <YAxis tickFormatter={compact} tick={AXIS} axisLine={false} tickLine={false} width={52} domain={["auto", "auto"]} />
            <Tooltip content={<Tip currency={currency} name="Balance" />} />
            <Line type="stepAfter" dataKey="balance" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
            {hasDeposits && <Line type="stepAfter" dataKey="deposits" stroke="var(--long)" strokeWidth={1.5} dot={false} isAnimationActive={false} />}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function DrawdownChart({ data, currency }: { data: Point[]; currency: string }) {
  if (!data.length) return <Empty />;
  return (
    <div className="h-[240px]" role="img" aria-label="Drawdown chart">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="ddFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset={0} stopColor="var(--loss)" stopOpacity={0.05} />
              <stop offset={1} stopColor="var(--loss)" stopOpacity={0.45} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tickFormatter={shortDate} tick={AXIS} axisLine={false} tickLine={false} minTickGap={48} />
          <YAxis tickFormatter={compact} tick={AXIS} axisLine={false} tickLine={false} width={48} />
          <Tooltip content={<Tip currency={currency} name="Drawdown" />} />
          <Area type="monotone" dataKey="value" stroke="var(--loss)" strokeWidth={1.75} fill="url(#ddFill)" isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ScoreRadar({ data }: { data: { label: string; value: number }[] }) {
  return (
    <div className="h-[230px]" role="img" aria-label={`Performance radar: ${data.map((d) => `${d.label} ${d.value}`).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <RadarChart data={data} outerRadius="68%" margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
          <PolarGrid stroke={GRID} />
          <PolarAngleAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted)" }} />
          <Radar dataKey="value" stroke="var(--accent)" strokeWidth={2} fill="var(--accent)" fillOpacity={0.25} isAnimationActive={false} dot={{ r: 3, fill: "var(--accent)" }} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
