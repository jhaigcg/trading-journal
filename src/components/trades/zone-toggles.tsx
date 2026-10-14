"use client";

import type { ZoneChoice } from "@/lib/smc";

/** FVG and OB switches for the 5 and 15 minute charts. */
export function ZoneToggles({ value, onChange }: { value: ZoneChoice; onChange: (v: ZoneChoice) => void }) {
  const box = "flex min-h-8 cursor-pointer items-center gap-1.5 text-xs text-muted";
  return (
    <div className="flex items-center gap-3" role="group" aria-label="Smart money zones">
      <label className={box} title="Fair value gaps: price left a gap between candle 1 and candle 3">
        <input type="checkbox" checked={value.fvg} onChange={(e) => onChange({ ...value, fvg: e.target.checked })} className="accent-[var(--accent)]" />
        FVG
      </label>
      <label className={box} title="Order blocks: the last push the other way before a break of structure">
        <input type="checkbox" checked={value.ob} onChange={(e) => onChange({ ...value, ob: e.target.checked })} className="accent-[var(--accent)]" />
        OB
      </label>
    </div>
  );
}
