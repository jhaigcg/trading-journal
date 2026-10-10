"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ExecutionsTable } from "@/components/trades/executions-table";
import { RuleChecklist } from "@/components/trades/rule-checklist";
import { TagPicker } from "@/components/trades/tag-picker";
import { TradeChart } from "@/components/trades/trade-chart";
import { TradeFields } from "@/components/trades/trade-fields";
import { TradeNotes } from "@/components/trades/trade-notes";
import { TradeStats } from "@/components/trades/trade-stats";
import { Pill, ResultPill, SidePill } from "@/components/ui/pill";
import { Pnl } from "@/components/ui/pnl";
import { Drawer } from "@/components/ui/drawer";
import { Tabs } from "@/components/ui/tabs";
import { duration } from "@/lib/format";
import type { TradeDTO } from "@/lib/queries/trade-detail";
import type { FilterOptions } from "@/lib/queries/options";
import { fmtDateTime, offsetMinutesAt } from "@/lib/time";
import { TRADE_CHANGED } from "./events";
import { useJson } from "./use-json";

/** Right-hand preview of a trade, opened from a row. Everything in it is editable and reloads itself after a change. */
export function TradePreviewDrawer({ tradeId, onClose, options, query }: { tradeId: string | null; onClose: () => void; options: Pick<FilterOptions, "tagGroups" | "strategies" | "timezone">; query: string }) {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener(TRADE_CHANGED, bump);
    return () => window.removeEventListener(TRADE_CHANGED, bump);
  }, []);

  return (
    <Drawer open={!!tradeId} onClose={onClose} title="Trade preview" className="max-w-[460px]">
      {tradeId && <Body key={tradeId} id={tradeId} version={version} options={options} query={query} />}
    </Drawer>
  );
}

function Body({ id, version, options, query }: { id: string; version: number; options: Pick<FilterOptions, "tagGroups" | "strategies" | "timezone">; query: string }) {
  const { data: t, status } = useJson<TradeDTO>(`/api/trades/${id}`, version);
  if (!t) return <p className="py-10 text-center text-sm text-muted">{status === "error" ? "Could not load this trade." : "Loading…"}</p>;
  return <Loaded t={t} options={options} query={query} />;
}

function Loaded({ t, options, query }: { t: TradeDTO; options: Pick<FilterOptions, "tagGroups" | "strategies" | "timezone">; query: string }) {
  const tz = options.timezone;
  const off = offsetMinutesAt(new Date(t.openedAt), tz);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-lg font-semibold">{t.symbol}</span>
          <SidePill side={t.side} />
          {t.status === "OPEN" ? <Pill className="bg-long-bg text-long">OPEN</Pill> : t.result && <ResultPill result={t.result === "BREAKEVEN" ? "BE" : t.result} />}
          {t.reviewed && <Pill className="bg-profit-bg text-profit">REVIEWED</Pill>}
        </div>
        <div className="num mt-1 text-xs text-muted">
          {fmtDateTime(new Date(t.openedAt), tz)}
          {t.closedAt && ` → ${fmtDateTime(new Date(t.closedAt), tz)}`}
          {t.holdSeconds != null && ` · ${duration(t.holdSeconds)}`}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 rounded-control border border-line bg-inset px-3 py-2.5">
          <div>
            <div className="text-[11px] text-muted">Net P&amp;L</div>
            <Pnl value={t.netPnl} currency={t.currency} className="text-base font-semibold" />
          </div>
          <div>
            <div className="text-[11px] text-muted">Net ROI</div>
            <div className="num text-base">{t.netRoi == null ? "—" : `${t.netRoi.toFixed(2)}%`}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted">Gross</div>
            <Pnl value={t.grossPnl} currency={t.currency} className="text-base" />
          </div>
        </div>
        <Link href={`/trades/${t.id}${query ? `?${query}` : ""}`} className="mt-3 inline-flex min-h-10 items-center rounded-control bg-accent px-4 text-[13px] font-semibold text-bg hover:bg-[var(--accent-hover)]">
          Go to trade details →
        </Link>
      </div>

      <Tabs
        tabs={[
          {
            id: "stats",
            label: "Stats",
            content: (
              <div className="flex flex-col gap-5">
                <TradeFields t={t} strategies={options.strategies} />
                <TradeStats t={t} tz={tz} />
              </div>
            ),
          },
          { id: "strategy", label: "Strategy", content: <RuleChecklist t={t} /> },
          { id: "tags", label: "Tags", content: <TagPicker tradeId={t.id} selected={t.tags.map((x) => x.id)} groups={options.tagGroups} /> },
          { id: "executions", label: "Executions", content: <ExecutionsTable t={t} tz={tz} /> },
          { id: "chart", label: "Chart", content: <TradeChart src={`/api/trades/${t.id}/chart`} defaultTf="M15" height={280} tzOffsetMin={off} /> },
          { id: "notes", label: "Notes", content: <TradeNotes tradeId={t.id} day={t.openDay} /> },
        ]}
      />
    </div>
  );
}
