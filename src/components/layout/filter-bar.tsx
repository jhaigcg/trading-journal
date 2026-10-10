"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { AdvancedFilters } from "@/components/filters/advanced-filters";
import { RANGE_PRESETS } from "@/lib/filters/range";
import type { FilterOptions } from "@/lib/queries/options";

const control =
  "min-h-10 rounded-control border border-line-strong bg-card px-3.5 text-[13px] text-ink focus:border-accent focus:outline-none";

/**
 * Global filter bar: account, date range, currency, and the advanced filters panel.
 * State lives in the URL query string (?account=&range=&from=&to=&ccy=&…) so every analytics page is
 * shareable and refresh-safe.
 */
export function FilterBar({ options, children }: { options: FilterOptions; children?: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("cal"); // changing filters returns the calendar to the current month
    start(() => router.replace(`${path}?${next.toString()}`, { scroll: false }));
  };

  const range = params.get("range") ?? "month";
  const home = options.currencies[0] ?? "AUD";

  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={pending}>
      <select aria-label="Account" className={control} value={params.get("account") ?? ""} onChange={(e) => set({ account: e.target.value || null })}>
        <option value="">All accounts</option>
        {options.accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <select aria-label="Date range" className={control} value={range} onChange={(e) => set({ range: e.target.value === "month" ? null : e.target.value, from: null, to: null })}>
        {RANGE_PRESETS.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      {range === "custom" && (
        <>
          <input type="date" aria-label="From" className={control} value={params.get("from") ?? ""} onChange={(e) => set({ from: e.target.value || null })} />
          <input type="date" aria-label="To" className={control} value={params.get("to") ?? ""} onChange={(e) => set({ to: e.target.value || null })} />
        </>
      )}
      <AdvancedFilters options={options} />
      {options.currencies.length > 1 && (
        <select aria-label="Display currency" className={control} value={params.get("ccy") ?? home} onChange={(e) => set({ ccy: e.target.value === home ? null : e.target.value })}>
          {options.currencies.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      )}
      {children}
    </div>
  );
}
