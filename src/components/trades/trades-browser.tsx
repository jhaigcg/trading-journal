"use client";

import { Columns3, Star } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { bulkAction, matchingTradeIds } from "@/app/(app)/trades/actions";
import { Pill, ResultPill, SidePill } from "@/components/ui/pill";
import { Pnl } from "@/components/ui/pnl";
import { cn } from "@/lib/cn";
import type { FilterOptions } from "@/lib/queries/options";
import type { ListRow, SortKey } from "@/lib/queries/trade-list";
import { fmtDateTime } from "@/lib/time";
import { TradePreviewDrawer } from "./trade-preview-drawer";

interface Col {
  id: string;
  label: string;
  sort?: SortKey;
  align?: "right";
  cell: (r: ListRow, ctx: { tz: string; currency: string; avgAbs: number }) => React.ReactNode;
}

const COLUMNS: Col[] = [
  { id: "open", label: "Open date", sort: "openedAt", cell: (r, c) => <span className="num text-xs text-ink-2">{fmtDateTime(r.openedAt, c.tz)}</span> },
  { id: "symbol", label: "Symbol", sort: "symbol", cell: (r) => <span className="font-semibold">{r.symbol}</span> },
  { id: "side", label: "Side", sort: "side", cell: (r) => <SidePill side={r.side} /> },
  { id: "status", label: "Status", sort: "status", cell: (r) => (r.status === "OPEN" ? <Pill className="bg-long-bg text-long">OPEN</Pill> : r.result ? <ResultPill result={r.result === "BREAKEVEN" ? "BE" : r.result} /> : null) },
  { id: "close", label: "Close date", sort: "closedAt", cell: (r, c) => <span className="num text-xs text-ink-2">{r.closedAt ? fmtDateTime(r.closedAt, c.tz) : "—"}</span> },
  { id: "entry", label: "Entry", sort: "avgEntry", align: "right", cell: (r) => <span className="num">{r.avgEntry}</span> },
  { id: "exit", label: "Exit", sort: "avgExit", align: "right", cell: (r) => <span className="num">{r.avgExit ?? "—"}</span> },
  { id: "volume", label: "Lots", sort: "quantity", align: "right", cell: (r) => <span className="num">{r.quantity}</span> },
  { id: "net", label: "Net P&L", sort: "netPnl", align: "right", cell: (r, c) => <Pnl value={r.netPnl} currency={c.currency} /> },
  { id: "roi", label: "Net ROI", sort: "netRoi", align: "right", cell: (r) => <span className="num text-ink-2">{r.netRoi == null ? "—" : `${r.netRoi.toFixed(2)}%`}</span> },
  {
    id: "insights",
    label: "Insights",
    sort: "insights",
    align: "right",
    cell: (r) => (
      <span title="Rules this trade breaks: no stop loss, no strategy, not reviewed, no tags" className={cn("num inline-flex min-w-6 justify-center rounded-full px-1.5 text-[11px]", r.insights ? "bg-accent/15 text-accent" : "text-muted")}>
        {r.insights}
      </span>
    ),
  },
  {
    id: "scale",
    label: "Scale",
    cell: (r, c) => {
      const w = c.avgAbs ? Math.min(100, (Math.abs(r.netPnl) / (2 * c.avgAbs)) * 100) : 0; // full bar = twice my average trade
      return (
        <span className="block h-1.5 w-24 overflow-hidden rounded-full bg-line" title={`${(c.avgAbs ? Math.abs(r.netPnl) / c.avgAbs : 0).toFixed(1)}× average trade`}>
          <span className={cn("block h-full rounded-full", r.netPnl >= 0 ? "bg-profit" : "bg-loss")} style={{ width: `${Math.max(w, 2)}%` }} />
        </span>
      );
    },
  },
  { id: "strategy", label: "Strategy", cell: (r) => <span className="block max-w-[180px] truncate text-xs text-ink-2">{r.strategy ?? "—"}</span> },
  {
    id: "rating",
    label: "Rating",
    cell: (r) => (r.rating == null ? <span className="text-muted">—</span> : <span className="num inline-flex items-center gap-1 text-xs"><Star size={12} className="fill-accent text-accent" />{r.rating.toFixed(1)}</span>),
  },
];

const DEFAULT_COLS = ["open", "symbol", "status", "close", "entry", "exit", "net", "roi", "insights", "scale"];
const STORE = "ledger.trades.columns";

export function TradesBrowser({
  rows,
  total,
  avgAbs,
  currency,
  options,
  sort,
  dir,
  sortHref,
  params,
  query,
}: {
  rows: ListRow[];
  total: number;
  avgAbs: number;
  currency: string;
  options: Pick<FilterOptions, "tagGroups" | "strategies" | "timezone">;
  sort: SortKey;
  dir: "asc" | "desc";
  sortHref: Record<string, string>;
  params: Record<string, string>;
  query: string;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [cols, setCols] = useState<string[]>(DEFAULT_COLS);
  const [picker, setPicker] = useState(false);
  const [preview, setPreview] = useState<string | null>(search.get("preview"));
  const [message, setMessage] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // remembered column choice (per browser)
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? "null");
      if (Array.isArray(saved) && saved.every((s) => COLUMNS.some((c) => c.id === s)) && saved.length) setCols(saved); // eslint-disable-line react-hooks/set-state-in-effect
    } catch {
      /* default columns */
    }
  }, []);
  useEffect(() => {
    if (!picker) return;
    const close = (e: MouseEvent) => !pickerRef.current?.contains(e.target as Node) && setPicker(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [picker]);

  const visible = useMemo(() => COLUMNS.filter((c) => cols.includes(c.id)), [cols]);
  const ctx = { tz: options.timezone, currency, avgAbs };

  const setCol = (id: string) => {
    const next = cols.includes(id) ? cols.filter((c) => c !== id) : [...cols, id];
    if (!next.length) return;
    setCols(next);
    try {
      localStorage.setItem(STORE, JSON.stringify(next));
    } catch {
      /* not remembered */
    }
  };

  const openPreview = (id: string | null) => {
    setPreview(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("preview", id);
    else url.searchParams.delete("preview");
    window.history.replaceState(null, "", url); // no server round trip: the list stays put
  };

  const pageIds = rows.map((r) => r.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggleAll = () => {
    setAllMatching(false);
    setSelected(allOnPage ? new Set() : new Set(pageIds));
  };
  const toggle = (id: string) => {
    setAllMatching(false);
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const run = (label: string, fn: () => ReturnType<typeof bulkAction>) =>
    start(async () => {
      setMessage(null);
      const r = await fn();
      if (!r.ok) return setMessage(r.error);
      setMessage(`${label}: ${r.count} trade${r.count === 1 ? "" : "s"}`);
      setSelected(new Set());
      setAllMatching(false);
      router.refresh();
    });

  const ids = [...selected];

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-xs text-muted">{message ?? ""}</span>
        <div className="relative" ref={pickerRef}>
          <button type="button" onClick={() => setPicker((p) => !p)} aria-expanded={picker} className="inline-flex min-h-9 items-center gap-2 rounded-control border border-line-strong bg-card px-3 text-xs hover:bg-nav-active">
            <Columns3 size={14} /> Columns
          </button>
          {picker && (
            <div className="absolute right-0 z-20 mt-2 w-48 rounded-card border border-line-strong bg-card p-2 shadow-xl">
              {COLUMNS.map((c) => (
                <label key={c.id} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] hover:bg-nav-active">
                  <input type="checkbox" checked={cols.includes(c.id)} onChange={() => setCol(c.id)} className="accent-[var(--accent)]" />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {selected.size > 0 && (
        <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-control border border-accent/40 bg-card px-3 py-2 text-xs shadow-lg" role="region" aria-label="Bulk actions">
          <span className="font-semibold text-accent">{allMatching ? `All ${ids.length}` : selected.size} selected</span>
          {!allMatching && selected.size === pageIds.length && total > pageIds.length && (
            <button
              type="button"
              className="underline"
              onClick={() =>
                start(async () => {
                  const all = await matchingTradeIds(params);
                  setSelected(new Set(all));
                  setAllMatching(true);
                })
              }
            >
              Select all {total.toLocaleString()} matching
            </button>
          )}
          <span className="mx-1 h-4 w-px bg-line" />
          <select aria-label="Assign strategy" disabled={pending} defaultValue="" className="min-h-9 rounded-control border border-line-strong bg-inset px-2" onChange={(e) => e.target.value !== "" && (run("Strategy set", () => bulkAction({ action: "strategy", ids, strategyId: e.target.value === "none" ? null : e.target.value })), (e.target.value = ""))}>
            <option value="">Assign strategy…</option>
            <option value="none">No strategy</option>
            {options.strategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select aria-label="Add tag" disabled={pending} defaultValue="" className="min-h-9 rounded-control border border-line-strong bg-inset px-2" onChange={(e) => e.target.value && (run("Tag added", () => bulkAction({ action: "addTags", ids, tagIds: [e.target.value] })), (e.target.value = ""))}>
            <option value="">Add tag…</option>
            {options.tagGroups.map((g) => (
              <optgroup key={g.id} label={g.name}>
                {g.tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button type="button" disabled={pending} className="min-h-9 rounded-control border border-line-strong px-3 hover:bg-nav-active" onClick={() => run("Marked reviewed", () => bulkAction({ action: "reviewed", ids, reviewed: true }))}>
            Mark reviewed
          </button>
          <button type="button" disabled={pending} className="min-h-9 rounded-control border border-line-strong px-3 hover:bg-nav-active" onClick={() => run("Marked not reviewed", () => bulkAction({ action: "reviewed", ids, reviewed: false }))}>
            Mark not reviewed
          </button>
          <button
            type="button"
            disabled={pending}
            className="min-h-9 rounded-control border border-[var(--loss-border)] px-3 text-loss hover:bg-loss-bg"
            onClick={() => confirm(`Delete ${ids.length} trade${ids.length === 1 ? "" : "s"} from the journal? Trades synced from MT4 will come back on the next sync. Notes and screenshots on them are deleted.`) && run("Deleted", () => bulkAction({ action: "delete", ids }))}
          >
            Delete
          </button>
          <button type="button" className="ml-auto text-muted hover:text-ink" onClick={() => (setSelected(new Set()), setAllMatching(false))}>
            Clear
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-card border border-line bg-card">
        <table className="w-full min-w-[820px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="w-10 px-3 py-2.5">
                <input type="checkbox" aria-label="Select all on this page" checked={allOnPage} onChange={toggleAll} className="accent-[var(--accent)]" />
              </th>
              {visible.map((c) => (
                <th key={c.id} className={cn("whitespace-nowrap px-3 py-2.5 font-medium", c.align === "right" && "text-right")} aria-sort={c.sort === sort ? (dir === "asc" ? "ascending" : "descending") : undefined}>
                  {c.sort ? (
                    <Link href={sortHref[c.sort]} className={cn("inline-flex items-center gap-1 hover:text-ink", c.sort === sort && "text-ink")}>
                      {c.label}
                      {c.sort === sort && <span aria-hidden>{dir === "asc" ? "↑" : "↓"}</span>}
                    </Link>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={visible.length + 1} className="px-3 py-14 text-center text-muted">
                  No trades match these filters.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.id}
                tabIndex={0}
                aria-selected={selected.has(r.id)}
                onClick={(e) => !(e.target as HTMLElement).closest("input,a,button") && openPreview(r.id)}
                onKeyDown={(e) => e.key === "Enter" && openPreview(r.id)}
                className={cn("cursor-pointer border-b border-[var(--row-line)] hover:bg-nav-active/50 focus-visible:bg-nav-active/50", selected.has(r.id) && "bg-accent/5")}
              >
                <td className="px-3 py-2.5">
                  <input type="checkbox" aria-label={`Select ${r.symbol} trade`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} className="accent-[var(--accent)]" />
                </td>
                {visible.map((c) => (
                  <td key={c.id} className={cn("whitespace-nowrap px-3 py-2.5", c.align === "right" && "text-right")}>
                    {c.cell(r, ctx)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <TradePreviewDrawer tradeId={preview} onClose={() => openPreview(null)} options={options} query={query} />
    </div>
  );
}
