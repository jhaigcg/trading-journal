"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createNote, emptyTrash } from "@/app/(app)/notebook/actions";

/** "New note" for the current section: a free note, today's daily journal, or a session recap. */
/** Props are plain data (not a function) because this is rendered by a server component. */
export function NewNoteButton({ section, folderId, tagId }: { section: string; folderId?: string; tagId?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const kind = section === "daily" ? "DAILY" : section === "session" ? "SESSION_RECAP" : "FREE";
  const label = kind === "DAILY" ? "Today's journal" : kind === "SESSION_RECAP" ? "New recap" : "New note";

  return (
    <div className="flex flex-col items-end">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await createNote({ kind, folderId: folderId ?? null });
            if (!r.ok) return setError(r.error);
            const q = new URLSearchParams();
            if (section !== "all") q.set("section", section);
            if (folderId) q.set("folder", folderId);
            if (tagId) q.set("tag", tagId);
            q.set("note", r.id);
            router.push(`/notebook?${q.toString()}`);
            router.refresh();
          })
        }
        className="inline-flex min-h-9 items-center gap-1.5 rounded-control bg-accent px-3 text-[13px] font-semibold text-bg hover:bg-[var(--accent-hover)] disabled:opacity-60"
      >
        <Plus size={14} /> {label}
      </button>
      {error && <span role="alert" className="mt-1 text-xs text-loss">{error}</span>}
    </div>
  );
}

export function EmptyTrashButton({ count, afterHref }: { count: number; afterHref: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (count === 0) return null;
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        confirm(`Permanently delete the ${count} note${count === 1 ? "" : "s"} in the trash? This cannot be undone.`) &&
        start(async () => {
          await emptyTrash();
          router.push(afterHref);
          router.refresh();
        })
      }
      className="min-h-9 rounded-control border border-[var(--loss-border)] px-3 text-[13px] text-loss hover:bg-loss-bg disabled:opacity-60"
    >
      Empty trash
    </button>
  );
}
