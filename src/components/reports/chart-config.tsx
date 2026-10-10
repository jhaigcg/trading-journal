"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { MAX_METRICS_PER_CHART } from "@/lib/reports/params";
import { CUMULATIVE_KEY, CUMULATIVE_LABEL, GRANULARITIES, METRIC_BY_KEY } from "@/lib/reports/rollup";

const label = (k: string) => (k === CUMULATIVE_KEY ? CUMULATIVE_LABEL : (METRIC_BY_KEY.get(k)?.label ?? k));
const control = "min-h-9 rounded-control border border-line bg-card px-2 text-[13px] text-ink";

/** Pick the metrics and the period (day, week, month) of one Performance chart. State lives in the URL (m1/g1, m2/g2). */
export function ChartConfigBar({ n, metrics, g, addable }: { n: 1 | 2; metrics: string[]; g: string; addable: string[] }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) next.set(k, v);
    router.replace(`${path}?${next.toString()}`, { scroll: false });
  };
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {metrics.map((m) => (
        <span key={m} className="inline-flex min-h-8 items-center gap-1 rounded-full border border-line bg-nav-active pl-3 pr-1 text-[13px]">
          {label(m)}
          {metrics.length > 1 && (
            <button type="button" aria-label={`Remove ${label(m)}`} onClick={() => set({ [`m${n}`]: metrics.filter((x) => x !== m).join(",") })} className="flex h-6 w-6 items-center justify-center rounded-full text-muted hover:bg-line hover:text-ink">
              <X size={13} aria-hidden />
            </button>
          )}
        </span>
      ))}
      {metrics.length < MAX_METRICS_PER_CHART && addable.length > 0 && (
        <select aria-label="Add a metric" className={control} value="" onChange={(e) => e.target.value && set({ [`m${n}`]: [...metrics, e.target.value].join(",") })}>
          <option value="">+ Add metric</option>
          {addable.map((k) => (
            <option key={k} value={k}>
              {label(k)}
            </option>
          ))}
        </select>
      )}
      <select aria-label="Group by" className={`${control} ml-auto`} value={g} onChange={(e) => set({ [`g${n}`]: e.target.value })}>
        {GRANULARITIES.map((x) => (
          <option key={x} value={x}>
            By {x}
          </option>
        ))}
      </select>
    </div>
  );
}
