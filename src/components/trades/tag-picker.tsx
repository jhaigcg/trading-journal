"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { setTradeTags } from "@/app/(app)/trades/actions";
import { cn } from "@/lib/cn";
import type { FilterOptions } from "@/lib/queries/options";
import { emitTradeChanged } from "./events";


/** Tags grouped by category (mistakes, mental state, SMC setups…). Toggling a chip saves immediately. */
export function TagPicker({ tradeId, selected, groups }: { tradeId: string; selected: string[]; groups: FilterOptions["tagGroups"] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ids, setIds] = useState<string[]>(selected);
  const [error, setError] = useState<string | null>(null);

  // the latest selection lives in a ref too, so clicks that land before a re-render still build on each other
  const latest = useRef(ids);
  const toggle = (id: string) => {
    const prev = latest.current;
    const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
    latest.current = next;
    setIds(next);
    setError(null);
    start(async () => {
      const r = await setTradeTags(tradeId, next);
      if (!r.ok) {
        latest.current = prev;
        setIds(prev);
        setError(r.error);
        return;
      }
      router.refresh();
      emitTradeChanged();
    });
  };

  if (!groups.length) return <p className="py-6 text-sm text-muted">No tags yet.</p>;
  return (
    <div className="flex flex-col gap-4" aria-busy={pending}>
      {groups.map((g) => (
        <div key={g.id}>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{g.name}</div>
          <div className="flex flex-wrap gap-1.5">
            {g.tags.map((tag) => {
              const on = ids.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(tag.id)}
                  className={cn("min-h-9 rounded-full border px-3 text-xs transition-colors", on ? "border-accent bg-accent/15 text-accent" : "border-line-strong text-ink-2 hover:bg-nav-active")}
                >
                  {tag.name}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {error && <p role="alert" className="rounded-control bg-loss-bg px-3 py-2 text-sm text-loss">{error}</p>}
    </div>
  );
}
