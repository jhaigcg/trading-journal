"use client";

import { ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addGroup, addRule, deleteGroup, deleteRule, moveGroup, moveRule, renameGroup, updateRule } from "@/app/(app)/playbooks/actions";
import { cn } from "@/lib/cn";
import type { PlaybookDetail } from "@/lib/queries/playbooks";

const input = "min-h-9 w-full rounded-md border border-line-strong bg-inset px-2.5 text-[13px] text-ink focus:border-accent focus:outline-none";
const iconBtn = "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-nav-active hover:text-ink disabled:opacity-30";

type Result = { ok: boolean; error?: string };

/**
 * Rule groups and rules, with how often each rule was followed on past trades. Everything saves immediately;
 * deleting a group or rule also deletes the answers already given to it.
 */
export function RulesEditor({ strategyId, groups, compliance }: { strategyId: string; groups: PlaybookDetail["groups"]; compliance: number | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ kind: "group" | "rule"; id: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [newGroup, setNewGroup] = useState("");
  const [newRule, setNewRule] = useState<Record<string, string>>({});

  const run = (fn: () => Promise<Result>, after?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) return setError(r.error ?? "Something went wrong.");
      after?.();
      router.refresh();
    });

  const edit = (kind: "group" | "rule", id: string, text: string) => {
    setEditing({ kind, id });
    setDraft(text);
  };
  const isEditing = (kind: string, id: string) => editing?.kind === kind && editing.id === id;

  const editor = (save: (text: string) => Promise<Result>) => (
    <form
      className="flex min-w-0 flex-1 gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => save(draft), () => setEditing(null));
      }}
    >
      <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} className={input} maxLength={300} aria-label="Edit text" />
      <button aria-label="Save" disabled={pending} className={cn(iconBtn, "text-profit")}>
        <Check size={15} />
      </button>
      <button type="button" aria-label="Cancel" onClick={() => setEditing(null)} className={iconBtn}>
        <X size={15} />
      </button>
    </form>
  );

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted">
        {compliance == null ? "Score your trades against these rules (Trade → Strategy tab) to see how often you follow each one." : `Overall you follow these rules ${Math.round(compliance)}% of the time on trades you have scored.`}
      </p>

      {groups.map((g, gi) => (
        <section key={g.id} className="rounded-card border border-line bg-inset">
          <header className="flex items-center gap-1 border-b border-line px-3 py-2">
            {isEditing("group", g.id) ? (
              editor((t) => renameGroup(g.id, t))
            ) : (
              <>
                <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold uppercase tracking-wide text-ink-2">{g.name}</h3>
                <button type="button" aria-label={`Rename ${g.name}`} onClick={() => edit("group", g.id, g.name)} className={iconBtn}>
                  <Pencil size={13} />
                </button>
                <button type="button" aria-label="Move group up" disabled={pending || gi === 0} onClick={() => run(() => moveGroup(g.id, -1))} className={iconBtn}>
                  <ArrowUp size={14} />
                </button>
                <button type="button" aria-label="Move group down" disabled={pending || gi === groups.length - 1} onClick={() => run(() => moveGroup(g.id, 1))} className={iconBtn}>
                  <ArrowDown size={14} />
                </button>
                <button
                  type="button"
                  aria-label={`Delete group ${g.name}`}
                  onClick={() => confirm(`Delete the group "${g.name}" with its ${g.rules.length} rule${g.rules.length === 1 ? "" : "s"}? Answers already given to these rules on past trades are deleted too.`) && run(() => deleteGroup(g.id))}
                  className={cn(iconBtn, "hover:text-loss")}
                >
                  <Trash2 size={13} />
                </button>
              </>
            )}
          </header>

          <ul>
            {g.rules.map((r, ri) => {
              const pct = r.answered ? Math.round((r.followed / r.answered) * 100) : null;
              return (
                <li key={r.id} className="flex items-center gap-2 border-b border-[var(--row-line)] px-3 py-2 last:border-b-0">
                  {isEditing("rule", r.id) ? (
                    editor((t) => updateRule(r.id, t))
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 text-[13px]">{r.text}</span>
                      <span className="flex w-36 shrink-0 items-center gap-2" title={r.answered ? `Followed on ${r.followed} of ${r.answered} scored trades` : "Not scored on any trade yet"}>
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                          <span className={cn("block h-full rounded-full", pct == null ? "" : pct >= 80 ? "bg-profit" : pct >= 50 ? "bg-accent" : "bg-loss")} style={{ width: `${pct ?? 0}%` }} />
                        </span>
                        <span className="num w-14 text-right text-[11px] text-muted">{pct == null ? "—" : `${pct}% · ${r.answered}`}</span>
                      </span>
                      <span className="flex shrink-0">
                        <button type="button" aria-label={`Edit rule: ${r.text}`} onClick={() => edit("rule", r.id, r.text)} className={iconBtn}>
                          <Pencil size={13} />
                        </button>
                        <button type="button" aria-label="Move rule up" disabled={pending || ri === 0} onClick={() => run(() => moveRule(r.id, -1))} className={iconBtn}>
                          <ArrowUp size={14} />
                        </button>
                        <button type="button" aria-label="Move rule down" disabled={pending || ri === g.rules.length - 1} onClick={() => run(() => moveRule(r.id, 1))} className={iconBtn}>
                          <ArrowDown size={14} />
                        </button>
                        <button type="button" aria-label={`Delete rule: ${r.text}`} onClick={() => confirm(`Delete this rule?${r.answered ? ` Its ${r.answered} scored answer${r.answered === 1 ? "" : "s"} will be deleted too.` : ""}`) && run(() => deleteRule(r.id))} className={cn(iconBtn, "hover:text-loss")}>
                          <Trash2 size={13} />
                        </button>
                      </span>
                    </>
                  )}
                </li>
              );
            })}
            {g.rules.length === 0 && <li className="px-3 py-3 text-xs text-muted">No rules in this group yet.</li>}
          </ul>

          <form
            className="flex gap-2 border-t border-line px-3 py-2"
            onSubmit={(e) => {
              e.preventDefault();
              const text = newRule[g.id] ?? "";
              if (text.trim()) run(() => addRule(g.id, text), () => setNewRule((n) => ({ ...n, [g.id]: "" })));
            }}
          >
            <input value={newRule[g.id] ?? ""} onChange={(e) => setNewRule((n) => ({ ...n, [g.id]: e.target.value }))} placeholder="Add a rule…" maxLength={300} aria-label={`Add a rule to ${g.name}`} className={input} />
            <button disabled={pending} className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md border border-line-strong px-3 text-xs hover:bg-nav-active disabled:opacity-60">
              <Plus size={13} /> Add
            </button>
          </form>
        </section>
      ))}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (newGroup.trim()) run(() => addGroup(strategyId, newGroup), () => setNewGroup(""));
        }}
      >
        <input value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="New rule group (e.g. Context, Entry, Management)…" maxLength={120} aria-label="New rule group" className={input} />
        <button disabled={pending} className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md bg-accent px-3 text-xs font-semibold text-bg hover:bg-[var(--accent-hover)] disabled:opacity-60">
          <Plus size={13} /> Add group
        </button>
      </form>

      {error && <p role="alert" className="rounded-control bg-loss-bg px-3 py-2 text-sm text-loss">{error}</p>}
    </div>
  );
}
