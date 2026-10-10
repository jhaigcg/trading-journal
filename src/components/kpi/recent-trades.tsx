"use client";

import Link from "next/link";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { SidePill } from "@/components/ui/pill";
import { Pnl } from "@/components/ui/pnl";
import { cn } from "@/lib/cn";

export interface TradeListRow {
  id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  /** pre-formatted in the display timezone on the server */
  when: string;
  netPnl: number;
  strategy: string | null;
}

/** "Recent trades" / "Open positions" tabs with a link to the full list. */
export function RecentTrades({ recent, open, currency, viewMoreHref }: { recent: TradeListRow[]; open: TradeListRow[]; currency: string; viewMoreHref: string }) {
  const [tab, setTab] = useState<"recent" | "open">("recent");
  const rows = tab === "recent" ? recent : open;

  return (
    <Card className="flex flex-col">
      <div role="tablist" className="flex gap-4 border-b border-line text-[13px]">
        {(
          [
            ["recent", "Recent trades"],
            ["open", `Open positions${open.length ? ` · ${open.length}` : ""}`],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn("-mb-px min-h-10 border-b-2 pb-2.5 pt-1", tab === k ? "border-accent font-semibold text-ink" : "border-transparent text-muted hover:text-ink")}
          >
            {label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">{tab === "recent" ? "No closed trades for these filters." : "No open positions."}</p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/trades/${r.id}`} title={r.strategy ?? undefined} className="grid min-h-11 grid-cols-[1fr_auto] items-center gap-2.5 border-b border-[var(--row-line)] py-2.5 text-[13px] hover:bg-nav-active/40">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="font-semibold">{r.symbol}</span>
                  <SidePill side={r.side} />
                  <span className="num whitespace-nowrap text-[11px] text-muted">{r.when}</span>
                </span>
                <Pnl value={r.netPnl} currency={currency} />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Link href={viewMoreHref} className="mt-auto pt-3 text-center text-xs text-accent hover:text-[var(--accent-hover)]">
        View more →
      </Link>
    </Card>
  );
}
