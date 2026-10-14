"use client";

import type { ZoneChoice } from "@/lib/smc";

const ITEMS: { key: keyof ZoneChoice; label: string; hint: string }[] = [
  { key: "fvg", label: "FVG", hint: "Fair value gaps: price left a gap between candle 1 and candle 3" },
  { key: "ob", label: "OB", hint: "Order blocks (internal and swing), as in LuxAlgo's Smart Money Concepts" },
  { key: "structure", label: "BOS/CHoCH", hint: "Breaks of structure and changes of character, plus the strong and weak high and low" },
  { key: "eq", label: "EQH/EQL", hint: "Equal highs and equal lows" },
];

/** Switches for the smart-money overlays on the 5 and 15 minute charts. */
export function ZoneToggles({ value, onChange }: { value: ZoneChoice; onChange: (v: ZoneChoice) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3" role="group" aria-label="Smart money overlays">
      {ITEMS.map((i) => (
        <label key={i.key} className="flex min-h-8 cursor-pointer items-center gap-1.5 text-xs text-muted" title={i.hint}>
          <input type="checkbox" checked={value[i.key]} onChange={(e) => onChange({ ...value, [i.key]: e.target.checked })} className="accent-[var(--accent)]" />
          {i.label}
        </label>
      ))}
    </div>
  );
}
