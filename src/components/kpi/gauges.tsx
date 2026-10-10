import { cn } from "@/lib/cn";

interface Seg {
  value: number;
  color: string;
  label: string;
}

/**
 * Half-circle gauge split into segments (e.g. wins / breakevens / losses).
 * Pure SVG so it renders on the server. Segments use pathLength=100 so dash maths is in percent.
 */
export function SegmentGauge({ segments, className }: { segments: Seg[]; className?: string }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const gap = total ? 1.4 : 0;
  let start = 0;
  return (
    <div className={cn("shrink-0", className)}>
      <svg viewBox="0 0 100 58" width="104" height="60" role="img" aria-label={segments.map((s) => `${s.value} ${s.label}`).join(", ")}>
        <path d="M 10 50 A 40 40 0 0 1 90 50" pathLength={100} fill="none" stroke="var(--border)" strokeWidth="8" strokeLinecap="butt" />
        {total > 0 &&
          segments
            .filter((s) => s.value > 0)
            .map((s) => {
              const len = (s.value / total) * 100;
              const drawn = Math.max(len - gap, 0.5);
              const el = (
                <path
                  key={s.label}
                  d="M 10 50 A 40 40 0 0 1 90 50"
                  pathLength={100}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="8"
                  strokeDasharray={`${drawn} ${100 - drawn}`}
                  strokeDashoffset={-start}
                />
              );
              start += len;
              return el;
            })}
      </svg>
      <div className="-mt-1 flex justify-center gap-1.5">
        {segments.map((s) => (
          <span key={s.label} className="num rounded-full px-1.5 text-[10px] font-medium" style={{ color: s.color, background: "color-mix(in srgb, currentColor 14%, transparent)" }} title={s.label}>
            {s.value}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Full ring showing the share of gross profit vs gross loss (profit factor). */
export function PnlRing({ profit, loss }: { profit: number; loss: number }) {
  const total = profit + Math.abs(loss);
  const share = total ? (profit / total) * 100 : 0;
  const gap = total && share > 0 && share < 100 ? 1.2 : 0;
  return (
    <svg viewBox="0 0 64 64" width="64" height="64" role="img" aria-label={`${Math.round(share)}% of gross results are profit`} className="shrink-0">
      <circle cx="32" cy="32" r="26" pathLength={100} fill="none" stroke={total ? "var(--loss)" : "var(--border)"} strokeWidth="7" />
      {total > 0 && share > 0 && (
        <circle
          cx="32"
          cy="32"
          r="26"
          pathLength={100}
          fill="none"
          stroke="var(--profit)"
          strokeWidth="7"
          strokeDasharray={`${Math.max(share - gap, 0.5)} ${100 - Math.max(share - gap, 0.5)}`}
          transform="rotate(-90 32 32)"
        />
      )}
    </svg>
  );
}

/** Avg win vs avg loss as two proportional bars with amounts underneath. */
export function WinLossBar({ win, loss, winLabel, lossLabel }: { win: number; loss: number; winLabel: string; lossLabel: string }) {
  const total = win + Math.abs(loss);
  const w = total ? (win / total) * 100 : 50;
  return (
    <div className="w-full min-w-[110px]">
      <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-[3px]" role="img" aria-label={`Average win ${winLabel}, average loss ${lossLabel}`}>
        <div style={{ width: `${w}%` }} className="bg-profit" />
        <div style={{ width: `${100 - w}%` }} className="bg-loss" />
      </div>
      <div className="num mt-1 flex justify-between text-[11px]">
        <span className="text-profit">{winLabel}</span>
        <span className="text-loss">{lossLabel}</span>
      </div>
    </div>
  );
}

/** 0–100 scale with a marker for the performance score. */
export function ScoreScale({ score }: { score: number }) {
  return (
    <div className="mt-3 flex items-center gap-4 border-t border-line pt-3">
      <div className="shrink-0">
        <div className="text-xs text-muted">Your score</div>
        <div className="num text-2xl font-semibold text-accent">{score}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative h-1.5 rounded-full" style={{ background: "linear-gradient(90deg, var(--loss), var(--accent), var(--profit))" }}>
          <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-ink" style={{ left: `${Math.min(100, Math.max(0, score))}%` }} />
        </div>
        <div className="num mt-1 flex justify-between text-[10px] text-muted">
          {[0, 20, 40, 60, 80, 100].map((n) => (
            <span key={n}>{n}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
