"use client";

import { Check, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setRuleCheck } from "@/app/(app)/trades/actions";
import { cn } from "@/lib/cn";
import { emitTradeChanged } from "./events";
import type { TradeDTO } from "@/lib/queries/trade-detail";

/** The strategy's rules as a checklist for this trade: followed, broken, or not answered. */
export function RuleChecklist({ t }: { t: TradeDTO }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // optimistic answers so the click feels instant
  const [local, setLocal] = useState<Record<string, boolean | null>>({});

  if (!t.strategy) return <p className="py-6 text-sm text-muted">Link a strategy to this trade to score it against that strategy&rsquo;s rules.</p>;

  const all = t.strategy.groups.flatMap((g) => g.rules);
  const answer = (id: string, server: boolean | null) => (id in local ? local[id] : server);
  const answered = all.filter((r) => answer(r.id, r.followed) !== null);
  const followed = answered.filter((r) => answer(r.id, r.followed) === true).length;

  const set = (ruleId: string, current: boolean | null, value: boolean) => {
    const next = current === value ? null : value; // clicking the active answer clears it
    setLocal((l) => ({ ...l, [ruleId]: next }));
    setError(null);
    start(async () => {
      const r = await setRuleCheck(t.id, ruleId, next);
      if (!r.ok) {
        setError(r.error);
        setLocal((l) => {
          const { [ruleId]: _drop, ...rest } = l;
          void _drop;
          return rest;
        });
        return;
      }
      router.refresh();
      emitTradeChanged();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between rounded-control border border-line bg-inset px-3 py-2.5 text-xs">
        <span className="text-muted">{t.strategy.name}</span>
        <span className="num">
          {answered.length === 0 ? "No rules scored yet" : `${followed}/${answered.length} followed · ${Math.round((followed / answered.length) * 100)}%`}
        </span>
      </div>
      {t.strategy.groups.map((g) => (
        <div key={g.id}>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{g.name}</div>
          <ul className="flex flex-col">
            {g.rules.map((r) => {
              const v = answer(r.id, r.followed);
              return (
                <li key={r.id} className="flex items-center justify-between gap-3 border-b border-[var(--row-line)] py-2 text-[13px]">
                  <span className={cn(v === false && "text-loss")}>{r.text}</span>
                  <span className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      disabled={pending}
                      aria-label={`Followed: ${r.text}`}
                      aria-pressed={v === true}
                      onClick={() => set(r.id, v, true)}
                      className={cn("flex h-9 w-9 items-center justify-center rounded-md border", v === true ? "border-[var(--profit-border)] bg-profit-bg text-profit" : "border-line-strong text-muted hover:bg-nav-active")}
                    >
                      <Check size={16} />
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      aria-label={`Broken: ${r.text}`}
                      aria-pressed={v === false}
                      onClick={() => set(r.id, v, false)}
                      className={cn("flex h-9 w-9 items-center justify-center rounded-md border", v === false ? "border-[var(--loss-border)] bg-loss-bg text-loss" : "border-line-strong text-muted hover:bg-nav-active")}
                    >
                      <X size={16} />
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {error && <p role="alert" className="rounded-control bg-loss-bg px-3 py-2 text-sm text-loss">{error}</p>}
    </div>
  );
}
