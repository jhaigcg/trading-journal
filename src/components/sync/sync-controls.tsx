"use client";

import { RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { cn } from "@/lib/cn";
import { useSync } from "./use-sync";

/** Runs a sync once right after sign-in (the login action sets a short-lived tj_sync cookie) and shows progress. */
export function SyncOnLogin({ accountIds }: { accountIds: string[] }) {
  const { state, start } = useSync();
  const key = accountIds.join(",");

  useEffect(() => {
    if (!accountIds.length || !document.cookie.split("; ").some((c) => c === "tj_sync=1")) return;
    document.cookie = "tj_sync=; Max-Age=0; path=/";
    void start(accountIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!state.running && !state.error) return null;
  return (
    <div role="status" className={cn("mb-4 rounded-control border px-4 py-3 text-sm", state.error ? "border-[var(--loss-border)] bg-loss-bg text-loss" : "border-line-strong bg-card text-ink-2")}>
      {state.error ? (
        <>Sync failed: {state.error}</>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <span>{state.message ?? "Syncing trades from MT4…"}</span>
            <span className="num text-xs text-muted">{Math.round(state.progress * 100)}%</span>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded bg-line">
            <div className="h-full bg-accent transition-all" style={{ width: `${Math.max(4, state.progress * 100)}%` }} />
          </div>
        </>
      )}
    </div>
  );
}

/** "Resync" link/button used on the dashboard and the accounts list. */
export function ResyncButton({ accountIds, variant = "link", label = "Resync" }: { accountIds: string[]; variant?: "link" | "button"; label?: string }) {
  const { state, start } = useSync();
  const cls =
    variant === "button"
      ? "inline-flex min-h-9 items-center gap-1.5 rounded-control border border-line-strong bg-card px-3 text-xs hover:bg-nav-active disabled:opacity-60"
      : "inline-flex items-center gap-1 text-accent hover:text-[var(--accent-hover)] disabled:opacity-60";
  return (
    <span className="inline-flex flex-col">
      <button type="button" disabled={state.running || accountIds.length === 0} onClick={() => start(accountIds)} className={cls}>
        <RefreshCw size={12} className={state.running ? "animate-spin" : undefined} />
        {state.running ? `Syncing ${Math.round(state.progress * 100)}%` : label}
      </button>
      {state.error && <span role="alert" className="mt-1 max-w-xs text-xs text-loss">{state.error}</span>}
    </span>
  );
}
