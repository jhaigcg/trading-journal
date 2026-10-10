"use client";

import { LineChart, MousePointer2, Minus, Ruler, Square, StickyNote, Trash2, TrendingUp } from "lucide-react";
import { cn } from "@/lib/cn";
import { DRAWING_COLORS, DRAWING_COLOR_NAMES } from "@/lib/drawings/types";
import { INDICATORS, type IndicatorKey } from "@/lib/indicators";

export type Tool = "cursor" | "trend" | "hline" | "rect" | "note" | "ruler";

const TOOLS: { id: Tool; label: string; icon: typeof MousePointer2; hint: string }[] = [
  { id: "cursor", label: "Select", icon: MousePointer2, hint: "Click a drawing to select it. Delete removes it." },
  { id: "trend", label: "Trend line", icon: TrendingUp, hint: "Click the start, then the end of the line." },
  { id: "hline", label: "Horizontal line", icon: Minus, hint: "Click a price level." },
  { id: "rect", label: "Box", icon: Square, hint: "Click one corner, then the opposite corner." },
  { id: "note", label: "Note", icon: StickyNote, hint: "Click where it happened, then type your note (for example: entered before the sweep)." },
  { id: "ruler", label: "Ruler", icon: Ruler, hint: "Click two points to measure the move. Not saved." },
];

export const toolHint = (t: Tool) => TOOLS.find((x) => x.id === t)?.hint ?? "";

const btn = "flex h-9 w-9 items-center justify-center rounded-control border text-muted hover:text-ink";

/** Drawing tools, colour, and indicators for the trade chart. */
export function ChartToolbar({
  tool,
  onTool,
  color,
  onColor,
  hasSelection,
  onDelete,
  count,
  onClear,
  indicators,
  onIndicator,
  saveState,
}: {
  tool: Tool;
  onTool: (t: Tool) => void;
  color: string;
  onColor: (c: string) => void;
  hasSelection: boolean;
  onDelete: () => void;
  count: number;
  onClear: () => void;
  indicators: Set<IndicatorKey>;
  onIndicator: (k: IndicatorKey, on: boolean) => void;
  saveState: "idle" | "saving" | "saved" | "error";
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2" role="toolbar" aria-label="Chart tools">
      <div className="flex items-center gap-1">
        {TOOLS.map((t) => (
          <button key={t.id} type="button" aria-label={t.label} title={t.label} aria-pressed={tool === t.id} onClick={() => onTool(t.id)} className={cn(btn, tool === t.id ? "border-accent bg-accent/15 text-ink" : "border-transparent")}>
            <t.icon size={16} aria-hidden />
          </button>
        ))}
      </div>

      <div role="group" aria-label="Drawing colour" className="flex items-center gap-1">
        {DRAWING_COLORS.map((c, i) => (
          <button key={c} type="button" aria-label={DRAWING_COLOR_NAMES[i]} aria-pressed={color === c} onClick={() => onColor(c)} className={cn("h-6 w-6 rounded-full border-2", color === c ? "border-ink" : "border-transparent")} style={{ background: c }} />
        ))}
      </div>

      <div className="flex items-center gap-1">
        <button type="button" aria-label="Delete selected drawing" title="Delete selected (Delete key)" disabled={!hasSelection} onClick={onDelete} className={cn(btn, "border-transparent hover:text-loss disabled:opacity-40")}>
          <Trash2 size={16} aria-hidden />
        </button>
        <button type="button" disabled={count === 0} onClick={() => window.confirm(`Remove all ${count} drawings from this trade?`) && onClear()} className="min-h-9 rounded-control px-2 text-xs text-muted hover:text-loss disabled:opacity-40">
          Clear all
        </button>
      </div>

      <details className="relative">
        <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-control border border-line-strong px-2.5 text-xs text-ink-2 hover:bg-nav-active [&::-webkit-details-marker]:hidden">
          <LineChart size={14} aria-hidden /> Indicators{indicators.size ? ` · ${indicators.size}` : ""}
        </summary>
        <div className="absolute left-0 top-10 z-20 w-44 rounded-control border border-line-strong bg-card p-2 shadow-xl">
          {INDICATORS.map((i) => (
            <label key={i.key} className="flex min-h-9 cursor-pointer items-center gap-2 rounded px-2 text-[13px] hover:bg-nav-active">
              <input type="checkbox" checked={indicators.has(i.key)} onChange={(e) => onIndicator(i.key, e.target.checked)} className="accent-[var(--accent)]" />
              <span className="h-2 w-2 rounded-full" style={{ background: i.color }} />
              {i.label}
            </label>
          ))}
        </div>
      </details>

      <span className="ml-auto text-xs text-muted" aria-live="polite">
        {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Drawings saved" : saveState === "error" ? <span className="text-loss">Could not save drawings</span> : ""}
      </span>
    </div>
  );
}
