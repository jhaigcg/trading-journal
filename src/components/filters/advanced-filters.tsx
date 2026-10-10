"use client";

import { SlidersHorizontal } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Drawer } from "@/components/ui/drawer";
import { cn } from "@/lib/cn";
import {
  ADVANCED_KEYS,
  FLAG_LABELS,
  FLAGS,
  INSTRUMENTS,
  SESSION_HOURS,
  SESSIONS,
  activeAdvancedCount,
  advancedToParams,
  parseFilters,
  type Filters,
} from "@/lib/filters/params";
import type { FilterOptions } from "@/lib/queries/options";

const TABS = ["General", "Tags", "Day & Time", "Strategy", "Insights"] as const;
type Tab = (typeof TABS)[number];

const WEEKDAYS = [
  { v: 1, l: "Mon" }, { v: 2, l: "Tue" }, { v: 3, l: "Wed" }, { v: 4, l: "Thu" }, { v: 5, l: "Fri" }, { v: 6, l: "Sat" }, { v: 0, l: "Sun" },
];
const SESSION_LABEL = { asia: "Asia", london: "London", newyork: "New York" } as const;

const select = "min-h-10 w-full rounded-control border border-line-strong bg-inset px-3 text-sm text-ink focus:border-accent focus:outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-xs text-muted">
      {label}
      {children}
    </label>
  );
}

function Chip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      onClick={onClick}
      className={cn(
        "min-h-9 rounded-full border px-3 text-xs transition-colors",
        on ? "border-accent bg-accent/15 text-accent" : "border-line-strong text-ink-2 hover:bg-nav-active",
      )}
    >
      {children}
    </button>
  );
}

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export function AdvancedFilters({ options }: { options: FilterOptions }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const applied = parseFilters(Object.fromEntries(params.entries()));
  const count = activeAdvancedCount(applied);

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("General");
  const [draft, setDraft] = useState<Filters>(applied);
  const patch = (p: Partial<Filters>) => setDraft((d) => ({ ...d, ...p }));

  const openPanel = () => {
    setDraft(applied); // always start from what is currently applied
    setTab("General");
    setOpen(true);
  };

  const commit = (f: Filters) => {
    const next = new URLSearchParams(params.toString());
    for (const k of ADVANCED_KEYS) next.delete(k);
    for (const [k, v] of Object.entries(advancedToParams(f))) next.set(k, v);
    router.replace(`${path}?${next.toString()}`, { scroll: false });
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={openPanel}
        className={cn(
          "inline-flex min-h-10 items-center gap-2 rounded-control border px-3.5 text-[13px] hover:bg-nav-active",
          count ? "border-accent text-accent" : "border-line-strong bg-card text-ink",
        )}
      >
        <SlidersHorizontal size={14} /> Filters{count ? ` · ${count}` : ""}
      </button>

      <Drawer open={open} onClose={() => setOpen(false)} title="Filters" className="max-w-[440px]">
        <div role="tablist" aria-label="Filter groups" className="-mx-1 mb-4 flex gap-1 overflow-x-auto pb-1">
          {TABS.map((t) => (
            <button
              key={t}
              role="tab"
              type="button"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn("min-h-9 shrink-0 rounded-lg px-3 text-[13px]", tab === t ? "bg-nav-active font-semibold text-ink" : "text-muted hover:text-ink")}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-4 pb-20" role="tabpanel">
          {tab === "General" && (
            <>
              <Field label="Instrument">
                <select className={select} value={draft.instrument ?? ""} onChange={(e) => patch({ instrument: (e.target.value || undefined) as Filters["instrument"] })}>
                  <option value="">All</option>
                  {INSTRUMENTS.map((i) => (
                    <option key={i} value={i}>
                      {i === "FOREX_CFD" ? "Forex / CFD" : i === "FUTURES" ? "Futures" : "Stocks"}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Symbol">
                <select className={select} value={draft.symbol ?? ""} onChange={(e) => patch({ symbol: e.target.value || undefined })}>
                  <option value="">All</option>
                  {options.symbols.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Field label="Side">
                <select className={select} value={draft.side ?? ""} onChange={(e) => patch({ side: (e.target.value || undefined) as Filters["side"] })}>
                  <option value="">Long & short</option>
                  <option value="LONG">Long</option>
                  <option value="SHORT">Short</option>
                </select>
              </Field>
              <Field label="Result">
                <select className={select} value={draft.result ?? ""} onChange={(e) => patch({ result: (e.target.value || undefined) as Filters["result"] })}>
                  <option value="">All</option>
                  <option value="WIN">Wins</option>
                  <option value="LOSS">Losses</option>
                  <option value="BREAKEVEN">Breakeven</option>
                </select>
              </Field>
              <Field label="Status">
                <select className={select} value={draft.status} onChange={(e) => patch({ status: e.target.value as Filters["status"] })}>
                  <option value="closed">Closed trades</option>
                  <option value="open">Open positions</option>
                  <option value="all">Open and closed</option>
                </select>
              </Field>
              <Field label="Duration">
                <select className={select} value={draft.duration ?? ""} onChange={(e) => patch({ duration: (e.target.value || undefined) as Filters["duration"] })}>
                  <option value="">Intraday & multi-day</option>
                  <option value="intraday">Intraday only</option>
                  <option value="multiday">Multi-day only</option>
                </select>
              </Field>
              <Field label="Review">
                <select className={select} value={draft.reviewed ?? ""} onChange={(e) => patch({ reviewed: (e.target.value || undefined) as Filters["reviewed"] })}>
                  <option value="">Reviewed & unreviewed</option>
                  <option value="yes">Reviewed</option>
                  <option value="no">Not reviewed</option>
                </select>
              </Field>
            </>
          )}

          {tab === "Tags" &&
            (options.tagGroups.length === 0 ? (
              <p className="text-sm text-muted">No tags yet.</p>
            ) : (
              <>
                <p className="text-xs text-muted">Shows trades with any of the selected tags.</p>
                {options.tagGroups.map((g) => (
                  <div key={g.id}>
                    <div className="mb-2 text-xs font-semibold text-ink-2">{g.name}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {g.tags.map((t) => (
                        <Chip key={t.id} on={draft.tags.includes(t.id)} onClick={() => patch({ tags: toggle(draft.tags, t.id) })}>
                          {t.name}
                        </Chip>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            ))}

          {tab === "Day & Time" && (
            <>
              <div>
                <div className="mb-2 text-xs font-semibold text-ink-2">Weekday (of entry)</div>
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAYS.map((d) => (
                    <Chip key={d.v} on={draft.dow.includes(d.v)} onClick={() => patch({ dow: toggle(draft.dow, d.v) })}>
                      {d.l}
                    </Chip>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 text-xs font-semibold text-ink-2">Hour of day (of entry, your timezone)</div>
                <div className="grid grid-cols-6 gap-1.5">
                  {Array.from({ length: 24 }, (_, h) => (
                    <Chip key={h} on={draft.hour.includes(h)} onClick={() => patch({ hour: toggle(draft.hour, h) })}>
                      <span className="num">{String(h).padStart(2, "0")}</span>
                    </Chip>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 text-xs font-semibold text-ink-2">Session (UTC)</div>
                <div className="flex flex-wrap gap-1.5">
                  {SESSIONS.map((s) => (
                    <Chip key={s} on={draft.session.includes(s)} onClick={() => patch({ session: toggle(draft.session, s) })} title={`${SESSION_HOURS[s][0]}:00–${SESSION_HOURS[s][1]}:00 UTC`}>
                      {SESSION_LABEL[s]} <span className="num ml-1 text-muted">{String(SESSION_HOURS[s][0]).padStart(2, "0")}–{String(SESSION_HOURS[s][1]).padStart(2, "0")}</span>
                    </Chip>
                  ))}
                </div>
              </div>
            </>
          )}

          {tab === "Strategy" && (
            <div className="flex flex-wrap gap-1.5">
              <Chip on={draft.strategy.includes("none")} onClick={() => patch({ strategy: toggle(draft.strategy, "none") })}>
                No strategy
              </Chip>
              {options.strategies.map((s) => (
                <Chip key={s.id} on={draft.strategy.includes(s.id)} onClick={() => patch({ strategy: toggle(draft.strategy, s.id) })}>
                  {s.name}
                </Chip>
              ))}
            </div>
          )}

          {tab === "Insights" && (
            <>
              <p className="text-xs text-muted">Find trades that break your own rules. Selected flags are combined (a trade must match all of them).</p>
              <div className="flex flex-wrap gap-1.5">
                {FLAGS.map((f) => (
                  <Chip key={f} on={draft.flags.includes(f)} onClick={() => patch({ flags: toggle(draft.flags, f) })}>
                    {FLAG_LABELS[f]}
                  </Chip>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="sticky -bottom-4 -mx-4 -mb-4 flex items-center justify-between gap-2 border-t border-line bg-card px-4 py-3">
          <button type="button" onClick={() => commit({ ...draft, ...parseFilters({}), account: draft.account, range: draft.range, from: draft.from, to: draft.to, ccy: draft.ccy })} className="min-h-10 rounded-control px-3 text-[13px] text-muted hover:text-loss">
            Reset all
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={() => setOpen(false)} className="min-h-10 rounded-control border border-line-strong px-4 text-[13px] hover:bg-nav-active">
              Cancel
            </button>
            <button type="button" onClick={() => commit(draft)} className="min-h-10 rounded-control bg-accent px-5 text-[13px] font-semibold text-bg hover:bg-[var(--accent-hover)]">
              Apply
            </button>
          </div>
        </div>
      </Drawer>
    </>
  );
}
