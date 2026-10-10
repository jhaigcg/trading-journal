"use client";

import { Pencil, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addCategory, addRate, addTag, editCategory, editSymbol, editTag, removeCategory, removeRate, removeTag, saveDisplay, savePassword } from "@/app/(app)/settings/actions";
import { cn } from "@/lib/cn";

type Outcome = { ok: true; [k: string]: unknown } | { ok: false; error: string };

const input = "min-h-10 rounded-control border border-line-strong bg-inset px-3 text-sm text-ink focus:border-accent focus:outline-none";
const primary = "min-h-10 rounded-control bg-accent px-4 text-[13px] font-semibold text-bg hover:bg-[var(--accent-hover)] disabled:opacity-60";
const ghost = "flex h-9 w-9 items-center justify-center rounded-control text-muted hover:bg-nav-active hover:text-ink disabled:opacity-50";

/** Run a server action, show its error or a short confirmation, and refresh the page data. */
function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const run = (fn: () => Promise<Outcome>, okNote?: (r: Outcome & { ok: true }) => string, after?: () => void) =>
    start(async () => {
      setError(null);
      setNote(null);
      const r = await fn();
      if (!r.ok) return setError(r.error);
      if (okNote) setNote(okNote(r));
      after?.();
      router.refresh();
    });
  return { pending, error, note, run };
}

function Msg({ error, note }: { error: string | null; note: string | null }) {
  if (error)
    return (
      <p role="alert" className="mt-2 rounded-control bg-loss-bg px-3 py-2 text-sm text-loss">
        {error}
      </p>
    );
  return note ? (
    <p role="status" className="mt-2 text-sm text-profit">
      {note}
    </p>
  ) : null;
}

const Field = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
  <label className="flex flex-col gap-1.5 text-xs text-muted">
    {label}
    {children}
    {hint && <span className="text-[11px]">{hint}</span>}
  </label>
);

// ───────────── display ─────────────

export function DisplayForm({ timezone, currency, threshold, zones }: { timezone: string; currency: string; threshold: number; zones: string[] }) {
  const [tz, setTz] = useState(timezone);
  const [cur, setCur] = useState(currency);
  const [thr, setThr] = useState(String(threshold));
  const { pending, error, note, run } = useRun();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveDisplay(tz, cur, thr), (r) => (r.recomputed == null ? "Saved." : `Saved. Trading days and results were recalculated for ${String(r.recomputed)} trades.`));
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Display timezone" hint="Decides which trading day a trade belongs to.">
          <input list="tz-list" value={tz} onChange={(e) => setTz(e.target.value)} required className={input} />
          <datalist id="tz-list">
            {zones.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </Field>
        <Field label="Home currency" hint="Should match your account currency. This does not convert existing trades.">
          <input value={cur} onChange={(e) => setCur(e.target.value)} maxLength={3} required className={cn(input, "uppercase")} />
        </Field>
        <Field label="Breakeven threshold" hint="A trade within plus or minus this amount counts as breakeven.">
          <input type="number" min={0} step="any" value={thr} onChange={(e) => setThr(e.target.value)} required className={input} />
        </Field>
      </div>
      <p className="mt-3 text-xs text-muted">Changing the timezone or the threshold recalculates the trading day and win/loss/breakeven of every trade. Daily journal entries keep the dates they were written under.</p>
      <div className="mt-3">
        <button disabled={pending} className={primary}>
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      <Msg error={error} note={note} />
    </form>
  );
}

// ───────────── password ─────────────

export function PasswordForm() {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [conf, setConf] = useState("");
  const { pending, error, note, run } = useRun();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => savePassword(cur, next, conf),
          () => "Password changed.",
          () => (setCur(""), setNext(""), setConf("")),
        );
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Current password">
          <input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required className={input} />
        </Field>
        <Field label="New password" hint="At least 10 characters.">
          <input type="password" autoComplete="new-password" minLength={10} value={next} onChange={(e) => setNext(e.target.value)} required className={input} />
        </Field>
        <Field label="Repeat new password">
          <input type="password" autoComplete="new-password" value={conf} onChange={(e) => setConf(e.target.value)} required className={input} />
        </Field>
      </div>
      <div className="mt-3">
        <button disabled={pending} className={primary}>
          {pending ? "Saving…" : "Change password"}
        </button>
      </div>
      <Msg error={error} note={note} />
    </form>
  );
}

// ───────────── currency rates ─────────────

export function RatesEditor({ rates, home }: { rates: { base: string; quote: string; rate: number }[]; home: string }) {
  const [base, setBase] = useState("USD");
  const [quote, setQuote] = useState(home);
  const [rate, setRate] = useState("");
  const { pending, error, run } = useRun();
  return (
    <div>
      {rates.length === 0 ? (
        <p className="text-sm text-muted">No rates yet. Add one to see reports in another currency.</p>
      ) : (
        <ul className="divide-y divide-line">
          {rates.map((r) => (
            <li key={`${r.base}${r.quote}`} className="flex items-center justify-between gap-3 py-2 text-[13px]">
              <span>
                1 {r.base} = <span className="num">{r.rate}</span> {r.quote}
              </span>
              <button type="button" disabled={pending} aria-label={`Delete ${r.base} to ${r.quote}`} onClick={() => run(() => removeRate(r.base, r.quote))} className={cn(ghost, "hover:text-loss")}>
                <Trash2 size={14} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => addRate(base, quote, rate), undefined, () => setRate(""));
        }}
      >
        <Field label="From">
          <input value={base} onChange={(e) => setBase(e.target.value)} maxLength={3} required className={cn(input, "w-24 uppercase")} />
        </Field>
        <Field label="To">
          <input value={quote} onChange={(e) => setQuote(e.target.value)} maxLength={3} required className={cn(input, "w-24 uppercase")} />
        </Field>
        <Field label="Rate">
          <input type="number" min="0" step="any" value={rate} onChange={(e) => setRate(e.target.value)} required className={cn(input, "w-32")} />
        </Field>
        <button disabled={pending} className={primary}>
          Add or update
        </button>
      </form>
      <Msg error={error} note={null} />
      <p className="mt-2 text-xs text-muted">Rates are typed in by you; nothing is fetched. A rate and its inverse are both used, so you only need one direction.</p>
    </div>
  );
}

// ───────────── symbols ─────────────

export function SymbolRow({ symbol, pipSize, contractSize }: { symbol: string; pipSize: number; contractSize: number }) {
  const [pip, setPip] = useState(String(pipSize));
  const [contract, setContract] = useState(String(contractSize));
  const { pending, error, note, run } = useRun();
  const dirty = pip !== String(pipSize) || contract !== String(contractSize);
  return (
    <li className="py-2.5">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => editSymbol(symbol, pip, contract), () => "Saved.");
        }}
      >
        <span className="w-24 text-[13px] font-medium">{symbol}</span>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          Pip size
          <input type="number" min="0" step="any" value={pip} onChange={(e) => setPip(e.target.value)} required className={cn(input, "w-28")} />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          Contract size
          <input type="number" min="0" step="any" value={contract} onChange={(e) => setContract(e.target.value)} required className={cn(input, "w-28")} />
        </label>
        <button disabled={pending || !dirty} className="min-h-10 rounded-control border border-line-strong px-3 text-[13px] hover:bg-nav-active disabled:opacity-50">
          Save
        </button>
      </form>
      <Msg error={error} note={note} />
    </li>
  );
}

// ───────────── tags ─────────────

type Group = { id: string; name: string; tags: { id: string; name: string; trades: number }[] };

function InlineName({ value, onSave, label }: { value: string; onSave: (v: string) => Promise<Outcome>; label: string }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  const { pending, error, run } = useRun();
  if (!editing)
    return (
      <span className="inline-flex items-center gap-1">
        {value}
        <button type="button" aria-label={`Rename ${label}`} onClick={() => (setV(value), setEditing(true))} className="flex h-7 w-7 items-center justify-center rounded text-muted hover:text-ink">
          <Pencil size={12} aria-hidden />
        </button>
      </span>
    );
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setEditing(false)} aria-label={`New name for ${label}`} className={cn(input, "min-h-8 w-40 py-0")} />
      <button type="button" disabled={pending} onClick={() => run(() => onSave(v), undefined, () => setEditing(false))} className="min-h-8 rounded-control bg-accent px-2.5 text-xs font-semibold text-bg">
        Save
      </button>
      <button type="button" aria-label="Cancel" onClick={() => setEditing(false)} className="flex h-8 w-8 items-center justify-center text-muted hover:text-ink">
        <X size={14} aria-hidden />
      </button>
      {error && <span className="basis-full text-xs text-loss">{error}</span>}
    </span>
  );
}

export function TagsEditor({ groups }: { groups: Group[] }) {
  const [name, setName] = useState("");
  const { pending, error, run } = useRun();
  return (
    <div>
      {groups.length === 0 && <p className="text-sm text-muted">No tag groups yet.</p>}
      <div className="space-y-4">
        {groups.map((g) => (
          <TagGroup key={g.id} group={g} />
        ))}
      </div>
      <form
        className="mt-4 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => addCategory(name), undefined, () => setName(""));
        }}
      >
        <Field label="New group (for example Setup, Mistake, Emotion)">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required className={cn(input, "w-64")} />
        </Field>
        <button disabled={pending} className={primary}>
          Add group
        </button>
      </form>
      <Msg error={error} note={null} />
    </div>
  );
}

function TagGroup({ group }: { group: Group }) {
  const [name, setName] = useState("");
  const { pending, error, run } = useRun();
  const total = group.tags.reduce((s, t) => s + t.trades, 0);
  return (
    <div className="rounded-control border border-line p-3">
      <div className="flex items-center justify-between gap-2 text-[13px] font-semibold">
        <InlineName value={group.name} label={`group ${group.name}`} onSave={(v) => editCategory(group.id, v)} />
        <button
          type="button"
          disabled={pending}
          aria-label={`Delete group ${group.name}`}
          onClick={() => window.confirm(`Delete the group "${group.name}" and its ${group.tags.length} tags? They will be removed from ${total} tagged trades. This cannot be undone.`) && run(() => removeCategory(group.id))}
          className={cn(ghost, "hover:text-loss")}
        >
          <Trash2 size={14} aria-hidden />
        </button>
      </div>
      <ul className="mt-2 flex flex-wrap gap-2">
        {group.tags.map((t) => (
          <li key={t.id} className="inline-flex items-center gap-1 rounded-full border border-line bg-nav-active py-0.5 pl-3 pr-1 text-[13px]">
            <InlineName value={t.name} label={`tag ${t.name}`} onSave={(v) => editTag(t.id, v)} />
            <span className="num text-[11px] text-muted" title="Trades with this tag">
              {t.trades}
            </span>
            <button
              type="button"
              disabled={pending}
              aria-label={`Delete tag ${t.name}`}
              onClick={() => (t.trades === 0 || window.confirm(`Remove "${t.name}" from ${t.trades} trades and delete it?`)) && run(() => removeTag(t.id))}
              className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:text-loss"
            >
              <X size={13} aria-hidden />
            </button>
          </li>
        ))}
        {group.tags.length === 0 && <li className="text-xs text-muted">No tags in this group yet.</li>}
      </ul>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => addTag(group.id, name), undefined, () => setName(""));
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Add a tag" aria-label={`Add a tag to ${group.name}`} maxLength={60} required className={cn(input, "min-h-9 w-48")} />
        <button disabled={pending} className="min-h-9 rounded-control border border-line-strong px-3 text-[13px] hover:bg-nav-active">
          Add
        </button>
      </form>
      {error && <p className="mt-1 text-xs text-loss">{error}</p>}
    </div>
  );
}
