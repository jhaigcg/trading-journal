import { cn } from "@/lib/cn";

type Result = "WIN" | "LOSS" | "BE";

const RESULT_STYLE: Record<Result, string> = {
  WIN: "bg-profit-bg text-profit",
  LOSS: "bg-loss-bg text-loss",
  BE: "bg-line text-muted",
};

export function Pill({ className, ...p }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-wide", className)} {...p} />;
}

export function ResultPill({ result }: { result: Result }) {
  return <Pill className={RESULT_STYLE[result]}>{result}</Pill>;
}

export function SidePill({ side }: { side: "LONG" | "SHORT" }) {
  return <Pill className={side === "LONG" ? "bg-long-bg text-long" : "bg-loss-bg text-loss"}>{side}</Pill>;
}

export function TagChip({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center rounded-full border border-line-strong px-2.5 py-0.5 text-[11px] text-ink-2">{children}</span>;
}
