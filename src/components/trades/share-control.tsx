"use client";

import { Check, Copy, Link2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setShare } from "@/app/(app)/trades/actions";

/** Optional public, read-only link to a trade. Turning it off kills the link immediately. */
export function ShareControl({ tradeId, token }: { tradeId: string; token: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState(false);
  const url = token && typeof window !== "undefined" ? `${window.location.origin}/share/${token}` : "";

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="inline-flex min-h-10 items-center gap-2 rounded-control border border-line-strong bg-card px-3.5 text-[13px] hover:bg-nav-active">
        <Link2 size={14} /> Share{token ? " · on" : ""}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-[min(340px,86vw)] rounded-card border border-line-strong bg-card p-4 shadow-xl">
          <p className="text-xs text-muted">Anyone with the link can see this trade&rsquo;s numbers, executions and chart. They cannot see your notes, tags or screenshots, and cannot change anything.</p>
          {token ? (
            <div className="mt-3 flex flex-col gap-2">
              <div className="flex gap-2">
                <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Share link" className="num min-h-10 w-full rounded-control border border-line-strong bg-inset px-3 text-xs" />
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(url);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-control border border-line-strong px-3 text-xs hover:bg-nav-active"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    await setShare(tradeId, false);
                    router.refresh();
                  })
                }
                className="self-start text-xs text-loss hover:underline disabled:opacity-60"
              >
                Turn off sharing
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await setShare(tradeId, true);
                  router.refresh();
                })
              }
              className="mt-3 min-h-10 rounded-control bg-accent px-4 text-[13px] font-semibold text-bg hover:bg-[var(--accent-hover)] disabled:opacity-60"
            >
              Create a public link
            </button>
          )}
        </div>
      )}
    </div>
  );
}
