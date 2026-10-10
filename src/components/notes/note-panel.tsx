"use client";

import { RotateCcw, Star, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { deleteNoteForever, restoreNote, setNoteTags, trashNote, updateNoteMeta } from "@/app/(app)/notebook/actions";
import { cn } from "@/lib/cn";
import type { NoteDetail } from "@/lib/queries/notes";
import { KIND_LABEL } from "@/lib/queries/notes";
import type { FilterOptions } from "@/lib/queries/options";
import { NoteEditor, type TemplateOption } from "./note-editor";

const select = "min-h-9 rounded-md border border-line-strong bg-inset px-2 text-xs text-ink-2 focus:border-accent focus:outline-none";

/** The open note: title, favourite, folder, tags, trash/restore, and the editor. Keyed by note id so switching notes remounts it. */
export function NotePanel({
  note,
  folders,
  tagGroups,
  templates,
  closeHref,
}: {
  note: NoteDetail;
  folders: { id: string; name: string }[];
  tagGroups: FilterOptions["tagGroups"];
  templates: TemplateOption[];
  closeHref: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(note.title);
  const [favorite, setFavorite] = useState(note.favorite);
  const [tagIds, setTagIds] = useState(note.tagIds);
  const [error, setError] = useState<string | null>(null);
  const savedTitle = useRef(note.title);
  const latestTags = useRef(note.tagIds);
  const tagName = new Map(tagGroups.flatMap((g) => g.tags.map((t) => [t.id, t.name] as const)));

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) return setError(r.error ?? "Something went wrong.");
      after?.();
      router.refresh();
    });

  const saveTitle = () => {
    if (title === savedTitle.current) return;
    savedTitle.current = title;
    run(() => updateNoteMeta(note.id, { title }));
  };

  const changeTags = (next: string[]) => {
    latestTags.current = next;
    setTagIds(next);
    run(() => setNoteTags(note.id, next));
  };

  const day = note.day ?? undefined;
  const statsDay = (note.kind === "DAILY" || note.kind === "SESSION_RECAP") && day ? day : undefined;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <Link href={closeHref} className="mt-1 text-xs text-muted hover:text-ink lg:hidden">
          ← List
        </Link>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          disabled={note.trashed}
          maxLength={200}
          placeholder={note.kind === "DAILY" ? `Daily journal · ${note.day}` : "Untitled note"}
          aria-label="Note title"
          className="min-w-0 flex-1 rounded-md bg-transparent px-1 text-xl font-semibold outline-none placeholder:text-muted focus:bg-inset"
        />
        {!note.trashed && (
          <button
            type="button"
            aria-pressed={favorite}
            aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
            onClick={() => {
              const next = !favorite;
              setFavorite(next);
              run(() => updateNoteMeta(note.id, { favorite: next }));
            }}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-nav-active"
          >
            <Star size={18} className={cn(favorite ? "fill-accent text-accent" : "text-muted")} />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted">
        <span className="rounded-full border border-line-strong px-2 py-0.5">{KIND_LABEL[note.kind]}</span>
        {note.day && <span className="num">{note.day}</span>}
        {note.tradeId && (
          <Link href={`/trades/${note.tradeId}`} className="text-accent hover:underline">
            Open trade{note.tradeLabel ? ` · ${note.tradeLabel}` : ""} →
          </Link>
        )}
        {note.strategy && (
          <Link href={`/playbooks/${note.strategy.id}`} className="text-accent hover:underline">
            Playbook · {note.strategy.name}
          </Link>
        )}
        {!note.trashed && (
          <select
            aria-label="Folder"
            value={note.folderId ?? ""}
            disabled={pending}
            onChange={(e) => run(() => updateNoteMeta(note.id, { folderId: e.target.value || null }))}
            className={select}
          >
            <option value="">No folder</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        )}
        <span className="ml-auto flex items-center gap-2">
          {note.trashed ? (
            <>
              <button type="button" disabled={pending} onClick={() => run(() => restoreNote(note.id), () => router.push(closeHref))} className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-line-strong px-3 text-ink hover:bg-nav-active">
                <RotateCcw size={13} /> Restore
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => confirm("Delete this note permanently? This cannot be undone.") && run(() => deleteNoteForever(note.id), () => router.push(closeHref))}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-[var(--loss-border)] px-3 text-loss hover:bg-loss-bg"
              >
                <Trash2 size={13} /> Delete forever
              </button>
            </>
          ) : (
            <button type="button" disabled={pending} onClick={() => run(() => trashNote(note.id), () => router.push(closeHref))} className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 hover:bg-nav-active hover:text-loss">
              <Trash2 size={13} /> Move to trash
            </button>
          )}
        </span>
      </div>

      {!note.trashed && (
        <div className="flex flex-wrap items-center gap-1.5">
          {tagIds.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 rounded-full border border-line-strong py-0.5 pl-2.5 pr-1 text-[11px] text-ink-2">
              {tagName.get(id) ?? "tag"}
              <button type="button" aria-label={`Remove tag ${tagName.get(id) ?? ""}`} onClick={() => changeTags(latestTags.current.filter((x) => x !== id))} className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-nav-active">
                <X size={11} />
              </button>
            </span>
          ))}
          <select
            aria-label="Add tag"
            value=""
            disabled={pending}
            onChange={(e) => e.target.value && !latestTags.current.includes(e.target.value) && changeTags([...latestTags.current, e.target.value])}
            className={select}
          >
            <option value="">+ Tag</option>
            {tagGroups.map((g) => (
              <optgroup key={g.id} label={g.name}>
                {g.tags
                  .filter((t) => !tagIds.includes(t.id))
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-control bg-loss-bg px-3 py-2 text-sm text-loss">
          {error}
        </p>
      )}

      {note.trashed && <p className="rounded-control border border-line bg-inset px-3 py-2 text-xs text-muted">This note is in the trash. Restore it to edit.</p>}

      <NoteEditor
        key={note.id}
        target={{ kind: "ID", noteId: note.id }}
        templates={note.trashed ? undefined : templates}
        statsDay={note.trashed ? undefined : statsDay}
        readOnly={note.trashed}
        placeholder={note.kind === "DAILY" ? "How did the day go? Mindset, plan, lessons…" : "Write your notes…"}
      />
    </div>
  );
}
