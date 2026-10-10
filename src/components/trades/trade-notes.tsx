"use client";

import { useState } from "react";
import { NoteEditor } from "@/components/notes/note-editor";
import { cn } from "@/lib/cn";

/** Notes for a trade: the trade's own note, or the daily journal for the day it was taken (they share the same editor). */
export function TradeNotes({ tradeId, day }: { tradeId: string; day: string }) {
  const [mode, setMode] = useState<"TRADE" | "DAILY">("TRADE");
  return (
    <div className="flex flex-col gap-3">
      <div className="inline-flex self-start rounded-control border border-line p-0.5 text-xs" role="tablist" aria-label="Note type">
        {(
          [
            ["TRADE", "Trade note"],
            ["DAILY", `Daily journal · ${day}`],
          ] as const
        ).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={mode === k} onClick={() => setMode(k)} className={cn("min-h-8 rounded-md px-3", mode === k ? "bg-nav-active font-semibold text-ink" : "text-muted hover:text-ink")}>
            {label}
          </button>
        ))}
      </div>
      {/* keyed so switching note type loads that note into a fresh editor (the old one saves itself on unmount) */}
      {mode === "TRADE" ? (
        <NoteEditor key={`t-${tradeId}`} target={{ kind: "TRADE", tradeId }} placeholder="Why did you take this trade? Did you follow your rules? What did you learn?" />
      ) : (
        <NoteEditor key={`d-${day}`} target={{ kind: "DAILY", day }} placeholder="How did the day go? Mindset, plan, lessons…" />
      )}
    </div>
  );
}
