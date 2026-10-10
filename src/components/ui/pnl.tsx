import { cn } from "@/lib/cn";
import { money, pnlTone } from "@/lib/format";

const TONE = { profit: "text-profit", loss: "text-loss", neutral: "text-ink" } as const;

/** Signed, coloured, monospaced money amount. */
export function Pnl({ value, currency = "AUD", className, decimals }: { value: number; currency?: string; className?: string; decimals?: number }) {
  return <span className={cn("num", TONE[pnlTone(value)], className)}>{money(value, currency, { decimals })}</span>;
}
