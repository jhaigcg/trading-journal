"use client";

import { useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { money } from "@/lib/format";
import type { RunningData } from "@/lib/queries/trade-chart";
import { useJson } from "./use-json";

const AXIS = { fontSize: 11, fill: "var(--muted)" } as const;

const clock = (t: number) => new Date(t * 1000).toISOString().slice(11, 16);

/** Gross P&L (realised + floating) over the life of the trade, from the price path. */
export function RunningPnl({ src, currency, timezoneOffsetMin = 0 }: { src: string; currency: string; timezoneOffsetMin?: number }) {
  const [attempt, setAttempt] = useState(0);
  const { data, status: state } = useJson<RunningData>(src, attempt);

  if (state === "loading" && !data) return <p className="py-16 text-center text-sm text-muted">Calculating from the price path…</p>;
  if (state === "error" || !data)
    return (
      <p className="py-16 text-center text-sm text-muted">
        Could not load this chart. <button className="text-accent underline" onClick={() => setAttempt((a) => a + 1)}>Try again</button>
      </p>
    );
  if (data.unsupported) return <p className="py-16 text-center text-sm text-muted">There is no price data source for this symbol.</p>;
  if (!data.priceCheck.matches)
    return (
      <p role="alert" className="rounded-control bg-loss-bg px-4 py-3 text-sm text-loss">
        The price feed ({data.priceCheck.feedPrice?.toFixed(2)}) does not match this trade&rsquo;s prices ({data.priceCheck.diffPct?.toFixed(1)}% apart), so a running P&amp;L cannot be worked out reliably.
      </p>
    );
  if (data.points.length < 3)
    return (
      <p className="py-16 text-center text-sm text-muted">
        {data.pendingToday ? "Prices for today are published after the trading day ends (00:00 UTC), so this will be available tomorrow." : data.incomplete ? "Price data could not be downloaded right now. " : "Not enough price data inside this trade. "}
        {!data.pendingToday && <button className="text-accent underline" onClick={() => setAttempt((a) => a + 1)}>Try again</button>}
      </p>
    );

  const series = data.points.map((p) => ({ t: p.t + timezoneOffsetMin * 60, pnl: p.pnl }));
  const max = Math.max(...series.map((p) => p.pnl), 0);
  const min = Math.min(...series.map((p) => p.pnl), 0);
  const off = max <= 0 ? 0 : min >= 0 ? 1 : max / (max - min);

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
        <span>
          Best <span className="num text-profit">{data.best != null ? money(data.best, currency) : "—"}</span>
        </span>
        <span>
          Worst <span className="num text-loss">{data.worst != null ? money(data.worst, currency) : "—"}</span>
        </span>
        {data.maePrice != null && data.mfePrice != null && (
          <span className="num">
            MAE {data.maePrice} · MFE {data.mfePrice}
          </span>
        )}
      </div>
      <div className="h-[260px]" role="img" aria-label="Running P&L chart">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="runStroke" x1="0" y1="0" x2="0" y2="1">
                <stop offset={off} stopColor="var(--profit)" />
                <stop offset={off} stopColor="var(--loss)" />
              </linearGradient>
              <linearGradient id="runFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset={0} stopColor="var(--profit)" stopOpacity={0.3} />
                <stop offset={off} stopColor="var(--profit)" stopOpacity={0.04} />
                <stop offset={off} stopColor="var(--loss)" stopOpacity={0.04} />
                <stop offset={1} stopColor="var(--loss)" stopOpacity={0.35} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={clock} tick={AXIS} axisLine={false} tickLine={false} minTickGap={40} />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} width={52} />
            <Tooltip
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <div className="rounded-lg border border-line-strong bg-card px-3 py-2 text-xs shadow-lg">
                    <div className="text-muted">{clock(Number(payload[0].payload.t))}</div>
                    <div className={`num text-sm font-semibold ${Number(payload[0].value) >= 0 ? "text-profit" : "text-loss"}`}>{money(Number(payload[0].value), currency)}</div>
                  </div>
                ) : null
              }
            />
            <ReferenceLine y={0} stroke="var(--border-strong)" />
            <Area type="stepAfter" dataKey="pnl" stroke="url(#runStroke)" strokeWidth={2} fill="url(#runFill)" baseValue={0} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
