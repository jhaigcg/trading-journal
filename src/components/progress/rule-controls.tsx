"use client";

import { Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addStarterRules, deleteRule, saveRule, setManual, setRuleActive, setTradingDays } from "@/app/(app)/progress/actions";
import { Drawer } from "@/components/ui/drawer";
import { cn } from "@/lib/cn";
import { FIELD_LABEL, PERCENT_FIELDS, type PercentField, type RuleKindName } from "@/lib/progress/evaluate";

const input = "min-h-11 rounded-control border border-line-strong bg-inset px-3 text-sm text-ink focus:border-accent focus:outline-none";
const KIND_LABEL: Record<RuleKindName, string> = {
  TIME_BY: "Start my day by a time",
  PERCENT_WITH_FIELD: "Share of trades that have something filled in",
  MAX_LOSS_PER_TRADE: "Maximum loss on a single trade",
  MAX_LOSS_PER_DAY: "Maximum net loss in a day",
  MANUAL_CHECK: "A habit you tick yourself",
};

export interface EditableRule {
  id: string;
  name: string;
  kind: RuleKindName;
  params: Record<string, unknown>;
  active: boolean;
}

/** Create or edit a discipline rule. */
export function RuleDialog({ rule, trigger }: { rule?: EditableRule; trigger: "new" | "edit" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(rule?.name ?? "");
  const [kind, setKind] = useState<RuleKindName>(rule?.kind ?? "TIME_BY");
  const [time, setTime] = useState(String(rule?.params.time ?? "09:30"));
  const [field, setField] = useState<PercentField>((rule?.params.field as PercentField) ?? "stopLoss");
  const [percent, setPercent] = useState(String(rule?.params.percent ?? 100));
  const [amount, setAmount] = useState(String(rule?.params.amount ?? 100));

  const submit = () =>
    start(async () => {
      setError(null);
      const body = JSON.stringify({ name, kind, time, field, percent, amount });
      const r = await saveRule(rule?.id ?? null, body);
      if (!r.ok) return setError(r.error);
      setOpen(false);
      if (!rule) setName("");
      router.refresh();
    });

  return (
    <>
      {trigger === "new" ? (
        <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-10 items-center gap-1.5 rounded-control bg-accent px-4 text-[13px] font-semibold text-bg hover:bg-[var(--accent-hover)]">
          <Plus size={15} aria-hidden /> New rule
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(true)} aria-label={`Edit ${rule?.name}`} className="flex h-9 w-9 items-center justify-center rounded-control text-muted hover:bg-nav-active hover:text-ink">
          <Pencil size={14} aria-hidden />
        </button>
      )}
      <Drawer open={open} onClose={() => setOpen(false)} title={rule ? "Edit rule" : "New rule"} className="max-w-[460px]">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label className="flex flex-col gap-1.5 text-xs text-muted">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} placeholder="e.g. Stop loss on all trades" className={input} />
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-muted">
            Type
            <select value={kind} onChange={(e) => setKind(e.target.value as RuleKindName)} className={input}>
              {(Object.keys(KIND_LABEL) as RuleKindName[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          {kind === "TIME_BY" && (
            <label className="flex flex-col gap-1.5 text-xs text-muted">
              Press &ldquo;Start my day&rdquo; by (your display timezone)
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required className={input} />
            </label>
          )}
          {kind === "PERCENT_WITH_FIELD" && (
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5 text-xs text-muted">
                Trades must have
                <select value={field} onChange={(e) => setField(e.target.value as PercentField)} className={input}>
                  {PERCENT_FIELDS.map((f) => (
                    <option key={f} value={f}>
                      {FIELD_LABEL[f]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-xs text-muted">
                At least (% of the day&rsquo;s trades)
                <input type="number" min={1} max={100} value={percent} onChange={(e) => setPercent(e.target.value)} required className={input} />
              </label>
            </div>
          )}
          {(kind === "MAX_LOSS_PER_TRADE" || kind === "MAX_LOSS_PER_DAY") && (
            <label className="flex flex-col gap-1.5 text-xs text-muted">
              Largest loss allowed (in your account currency)
              <input type="number" min={0.01} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} required className={input} />
            </label>
          )}
          {kind === "MANUAL_CHECK" && <p className="text-xs text-muted">You tick it on the Progress page each day. A trading day that was never ticked counts as missed.</p>}
          {error && (
            <p role="alert" className="rounded-control bg-loss-bg px-3 py-2 text-sm text-loss">
              {error}
            </p>
          )}
          <button disabled={pending || !name.trim()} className="min-h-11 rounded-control bg-accent text-sm font-semibold text-bg hover:bg-[var(--accent-hover)] disabled:opacity-60">
            {pending ? "Saving…" : "Save rule"}
          </button>
        </form>
      </Drawer>
    </>
  );
}

/** Pause / resume and delete for one rule. */
export function RuleActions({ rule }: { rule: EditableRule }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<unknown>) => start(async () => (await fn(), router.refresh()));
  const btn = "flex h-9 w-9 items-center justify-center rounded-control text-muted hover:bg-nav-active hover:text-ink disabled:opacity-50";
  return (
    <div className="flex items-center justify-end gap-0.5">
      <RuleDialog rule={rule} trigger="edit" />
      <button type="button" disabled={pending} aria-label={rule.active ? `Pause ${rule.name}` : `Resume ${rule.name}`} title={rule.active ? "Pause (keeps history, stops counting)" : "Resume"} onClick={() => run(() => setRuleActive(rule.id, !rule.active))} className={btn}>
        {rule.active ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
      </button>
      <button
        type="button"
        disabled={pending}
        aria-label={`Delete ${rule.name}`}
        onClick={() => window.confirm(`Delete "${rule.name}" and its history? This cannot be undone.`) && run(() => deleteRule(rule.id))}
        className={cn(btn, "hover:text-loss")}
      >
        <Trash2 size={14} aria-hidden />
      </button>
    </div>
  );
}

/** The tick box for a manual rule on the chosen day. */
export function ManualToggle({ ruleId, day, ticked, name }: { ruleId: string; day: string; ticked: boolean | undefined; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <input
        type="checkbox"
        aria-label={`${name} on ${day}`}
        checked={ticked === true}
        disabled={pending}
        onChange={(e) =>
          start(async () => {
            const r = await setManual(ruleId, day, e.target.checked);
            setError(r.ok ? null : r.error);
            router.refresh();
          })
        }
        className="h-5 w-5 accent-[var(--accent)]"
      />
      {error && <span className="text-xs text-loss">{error}</span>}
    </span>
  );
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Which weekdays count as trading days. */
export function TradingDays({ days }: { days: number[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const toggle = (d: number) => {
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
    start(async () => {
      const r = await setTradingDays(JSON.stringify(next));
      setError(r.ok ? null : r.error);
      router.refresh();
    });
  };
  return (
    <div>
      <div role="group" aria-label="Trading days" className="flex flex-wrap gap-1.5">
        {ORDER.map((d) => (
          <button key={d} type="button" aria-pressed={days.includes(d)} disabled={pending} onClick={() => toggle(d)} className={cn("min-h-9 min-w-12 rounded-control border px-3 text-xs", days.includes(d) ? "border-accent bg-accent/15 font-semibold text-ink" : "border-line-strong text-muted hover:text-ink")}>
            {DAY_NAMES[d]}
          </button>
        ))}
      </div>
      {error && <p className="mt-1.5 text-xs text-loss">{error}</p>}
    </div>
  );
}

/** Shown when there are no rules yet. */
export function StarterRules() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await addStarterRules();
          router.refresh();
        })
      }
      className="min-h-10 rounded-control border border-line-strong px-4 text-[13px] hover:bg-nav-active disabled:opacity-60"
    >
      {pending ? "Adding…" : "Add the 5 starter rules"}
    </button>
  );
}
