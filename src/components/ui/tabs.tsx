"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

export interface TabDef {
  id: string;
  label: string;
  /** server-rendered content passed in as a node; only the active tab is mounted */
  content: React.ReactNode;
}

/** Simple accessible tab strip. Inactive panels are not mounted, so charts and editors load only when opened. */
export function Tabs({ tabs, initial, className }: { tabs: TabDef[]; initial?: string; className?: string }) {
  const [active, setActive] = useState(initial ?? tabs[0]?.id);
  const current = tabs.find((t) => t.id === active) ?? tabs[0];
  return (
    <div className={className}>
      <div role="tablist" className="mb-4 flex gap-0.5 overflow-x-auto border-b border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={t.id === current.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => setActive(t.id)}
            className={cn("-mb-px min-h-10 shrink-0 whitespace-nowrap border-b-2 px-2.5 text-[13px]", t.id === current.id ? "border-accent font-semibold text-ink" : "border-transparent text-muted hover:text-ink")}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${current.id}`} aria-labelledby={`tab-${current.id}`}>
        {current.content}
      </div>
    </div>
  );
}
