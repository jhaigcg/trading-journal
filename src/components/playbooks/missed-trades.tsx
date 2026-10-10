"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteMissedTrade, logMissedTrade } from "@/app/(app)/playbooks/actions";
import { SidePill } from "@/components/ui/pill";
import type { PlaybookDetail } from "@/lib/queries/playbooks";
import { fmtDateTime, localToUtc } from "@/lib/time";

const input = "min-h-10 w-full rounded-control border border-line-strong bg-inset px-3 text-sm text-ink focus:border-accent focus:outline-none";
const label = "flex flex-col gap-1.5 text-xs text-muted";

/** Setups I saw but did not take: what, when, what it would have returned, and why I stayed out. */
export function MissedTrades({ strategyId, items, tz, defaultWhen }: { strategyId: string; items: PlaybookDetail["missed"]; tz: string; defaultWhen: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ symbol: "XAUUSD", when: defaultWhen, side: "", r: "", reason: "" });

  const submit = () =>
    start(async () => {
      setError(null);
      const at = localToUtc(form.when, tz);
      if (Number.isNaN(at.getTime())) return setError("Enter the date and time you saw the setup.");
      const r = await logMissedTrade(strategyId, {
        symbol: form.symbol,
        seenAt: at.toISOString(),
        side: form.side === "LONG" || form.side === "SHORT" ? form.side : null,
        hypotheticalR: form.r.trim() === "" ? null : Number(form.r),
        reason: form.reason,
      });
      if (!r.ok) return setError(r.error);
      setForm((f) => ({ ...f, r: "", reason: "" }));
      router.refresh();
    });

  const totalR = items.reduce((s, m) => s + (m.hypotheticalR ?? 0), 0);

  return (
    <div className="flex flex-col gap-5">
      <form
        className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3 rounded-card border border-line bg-inset p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className={label}>
          Symbol
          <input value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} maxLength={20} className={input} />
        </label>
        <label className={label}>
          When I saw it
          <input type="datetime-local" required value={form.when} onChange={(e) => setForm({ ...form, when: e.target.value })} className={input} />
        </label>
        <label className={label}>
          Side
          <select value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value })} className={input}>
            <option value="">Not sure</option>
            <option value="LONG">Long</option>
            <option value="SHORT">Short</option>
          </select>
        </label>
        <label className={label}>
          Would have made (R)
          <input value={form.r} onChange={(e) => setForm({ ...form, r: e.target.value })} inputMode="decimal" placeholder="e.g. 2.5" className={`${input} num`} />
        </label>
        <label className={`${label} col-span-full`}>
          Why I did not take it
          <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} maxLength={500} placeholder="Hesitated, away from the screen, news, daily loss limit…" className={input} />
        </label>
        <div className="col-span-full flex items-center gap-3">
          <button disabled={pending} className="min-h-10 rounded-control bg-accent px-4 text-[13px] font-semibold text-bg hover:bg-[var(--accent-hover)] disabled:opacity-60">
            {pending ? "Saving…" : "Log missed trade"}
          </button>
          {error && <span role="alert" className="text-sm text-loss">{error}</span>}
        </div>
      </form>

      {items.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">No missed trades logged. Note the setups you saw but skipped: they show what hesitation costs you.</p>
      ) : (
        <>
          <p className="text-xs text-muted">
            {items.length} missed · <span className="num">{totalR > 0 ? "+" : ""}{totalR.toFixed(2)}R</span> if all had worked as logged
          </p>
          <ul className="flex flex-col">
            {items.map((m) => (
              <li key={m.id} className="flex items-start justify-between gap-3 border-b border-[var(--row-line)] py-2.5 text-[13px]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{m.symbol ?? "—"}</span>
                    {m.side && <SidePill side={m.side} />}
                    <span className="num text-xs text-muted">{fmtDateTime(new Date(m.seenAt), tz)}</span>
                    {m.hypotheticalR != null && <span className={`num text-xs ${m.hypotheticalR >= 0 ? "text-profit" : "text-loss"}`}>{m.hypotheticalR > 0 ? "+" : ""}{m.hypotheticalR}R</span>}
                  </div>
                  {m.reason && <p className="mt-1 text-xs text-ink-2">{m.reason}</p>}
                </div>
                <button
                  type="button"
                  aria-label="Delete missed trade"
                  disabled={pending}
                  onClick={() =>
                    confirm("Delete this missed trade?") &&
                    start(async () => {
                      await deleteMissedTrade(m.id);
                      router.refresh();
                    })
                  }
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted hover:bg-nav-active hover:text-loss"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
