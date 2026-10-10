import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/card";

export function KpiTile({
  label,
  value,
  tone,
  sub,
  children,
  aside,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  tone?: "profit" | "loss" | "accent";
  sub?: React.ReactNode;
  children?: React.ReactNode;
  /** a gauge / ring shown to the right of the figure */
  aside?: React.ReactNode;
}) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-muted">{label}</div>
          <div
            className={cn(
              "num mt-2 text-[26px] font-semibold leading-tight",
              tone === "profit" && "text-profit",
              tone === "loss" && "text-loss",
              tone === "accent" && "text-accent",
            )}
          >
            {value}
          </div>
        </div>
        {aside}
      </div>
      {children}
      {sub && <div className="mt-1.5 text-xs text-muted">{sub}</div>}
    </Card>
  );
}

/** Segmented W / BE / L bar. */
export function WinBar({ wins, be, losses }: { wins: number; be: number; losses: number }) {
  return (
    <div
      className="mt-2.5 flex h-1.5 gap-0.5 overflow-hidden rounded-[3px]"
      role="img"
      aria-label={`${wins} wins, ${be} breakeven, ${losses} losses`}
    >
      <div style={{ flex: wins }} className="bg-profit" />
      <div style={{ flex: be }} className="bg-muted" />
      <div style={{ flex: losses }} className="bg-loss" />
    </div>
  );
}

/** Label / bar / value rows used by the performance score card. */
export function ScoreBars({ items }: { items: { label: string; value: number }[] }) {
  return (
    <div className="mt-3.5 flex flex-col gap-2.5">
      {items.map((s) => (
        <div key={s.label} className="grid grid-cols-[120px_1fr_34px] items-center gap-2.5 text-xs">
          <span className="text-muted">{s.label}</span>
          <div className="h-1.5 overflow-hidden rounded-[3px] bg-line">
            <div className="h-full rounded-[3px] bg-accent" style={{ width: `${s.value}%` }} />
          </div>
          <span className="num text-right">{s.value}</span>
        </div>
      ))}
    </div>
  );
}
