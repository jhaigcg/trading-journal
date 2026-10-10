"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { newPlaybookNote } from "@/app/(app)/playbooks/actions";

/** Starts a note linked to this playbook and opens it in the Notebook. */
export function NewPlaybookNoteButton({ strategyId }: { strategyId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await newPlaybookNote(strategyId);
            if (!r.ok) return setError(r.error);
            router.push(`/notebook?note=${r.id}`);
          })
        }
        className="inline-flex min-h-9 items-center gap-1.5 rounded-control bg-accent px-3 text-[13px] font-semibold text-bg hover:bg-[var(--accent-hover)] disabled:opacity-60"
      >
        <Plus size={14} /> New note
      </button>
      {error && <span role="alert" className="text-xs text-loss">{error}</span>}
    </span>
  );
}
