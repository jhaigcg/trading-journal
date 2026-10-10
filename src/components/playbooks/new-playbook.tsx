"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createPlaybook } from "@/app/(app)/playbooks/actions";
import { Drawer } from "@/components/ui/drawer";
import { cn } from "@/lib/cn";
import { PLAYBOOK_TEMPLATES } from "@/lib/playbooks/templates";

/** "New playbook": start blank or copy one of the starter templates. */
export function NewPlaybook() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = (key: string | null) => {
    setTemplate(key);
    // suggest the template's name until the user types their own
    if (!name.trim() || PLAYBOOK_TEMPLATES.some((t) => t.name === name)) setName(PLAYBOOK_TEMPLATES.find((t) => t.key === key)?.name ?? "");
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-10 items-center gap-1.5 rounded-control bg-accent px-4 text-[13px] font-semibold text-bg hover:bg-[var(--accent-hover)]">
        <Plus size={15} /> New playbook
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title="New playbook" className="max-w-[460px]">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setError(null);
              const r = await createPlaybook({ name, templateKey: template });
              if (!r.ok) return setError(r.error);
              router.push(`/playbooks/${r.id}`);
            });
          }}
        >
          <label className="flex flex-col gap-1.5 text-xs text-muted">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} placeholder="e.g. NY open – liquidity grab" className="min-h-11 rounded-control border border-line-strong bg-inset px-3 text-sm text-ink focus:border-accent focus:outline-none" />
          </label>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-xs text-muted">Start from</legend>
            {[{ key: null as string | null, name: "Blank playbook", description: "Add your own rule groups and rules.", rules: 0, color: "#9AA4B2" }, ...PLAYBOOK_TEMPLATES.map((t) => ({ key: t.key as string | null, name: t.name, description: t.description, rules: t.groups.reduce((s, g) => s + g.rules.length, 0), color: t.color }))].map((t) => (
              <label key={t.key ?? "blank"} className={cn("flex cursor-pointer gap-3 rounded-control border p-3 text-[13px]", template === t.key ? "border-accent bg-accent/10" : "border-line-strong hover:bg-nav-active")}>
                <input type="radio" name="template" checked={template === t.key} onChange={() => pick(t.key)} className="mt-1 accent-[var(--accent)]" />
                <span className="min-w-0">
                  <span className="flex items-center gap-2 font-semibold">
                    <i className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.color }} />
                    {t.name}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">{t.description}</span>
                  {t.rules > 0 && <span className="mt-1 block text-[11px] text-muted">{t.rules} rules included</span>}
                </span>
              </label>
            ))}
          </fieldset>

          {error && <p role="alert" className="rounded-control bg-loss-bg px-3 py-2 text-sm text-loss">{error}</p>}
          <button disabled={pending || !name.trim()} className="min-h-11 rounded-control bg-accent text-sm font-semibold text-bg hover:bg-[var(--accent-hover)] disabled:opacity-60">
            {pending ? "Creating…" : "Create playbook"}
          </button>
        </form>
      </Drawer>
    </>
  );
}
