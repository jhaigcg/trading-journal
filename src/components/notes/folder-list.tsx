"use client";

import { Check, FolderPlus, Pencil, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createFolder, deleteFolder, renameFolder } from "@/app/(app)/notebook/actions";
import { cn } from "@/lib/cn";

export interface FolderItem {
  id: string;
  name: string;
  count: number;
  href: string;
  active: boolean;
}

const input = "min-h-9 w-full rounded-md border border-line-strong bg-inset px-2 text-[13px] text-ink focus:border-accent focus:outline-none";

/** Custom folders: open, add, rename and delete (deleting keeps the notes, they just become unfiled). */
export function FolderList({ folders, afterDeleteHref }: { folders: FolderItem[]; afterDeleteHref: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const done = (r: { ok: boolean; error?: string }) => {
    if (!r.ok) return setError(r.error ?? "Something went wrong.");
    setAdding(false);
    setEditing(null);
    setName("");
    setError(null);
    router.refresh();
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between px-2 text-[11px] uppercase tracking-wide text-muted">
        <span>Folders</span>
        <button
          type="button"
          aria-label="New folder"
          onClick={() => {
            setAdding(true);
            setEditing(null);
            setName("");
          }}
          className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-nav-active hover:text-ink"
        >
          <FolderPlus size={14} />
        </button>
      </div>

      <ul className="flex flex-col">
        {folders.map((f) =>
          editing === f.id ? (
            <li key={f.id} className="px-1 py-1">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  start(async () => done(await renameFolder(f.id, name)));
                }}
                className="flex gap-1"
              >
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={input} aria-label="Folder name" maxLength={60} />
                <button aria-label="Save name" disabled={pending} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-profit hover:bg-nav-active">
                  <Check size={15} />
                </button>
                <button type="button" aria-label="Cancel" onClick={() => setEditing(null)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted hover:bg-nav-active">
                  <X size={15} />
                </button>
              </form>
            </li>
          ) : (
            <li key={f.id} className="group flex items-center">
              <Link href={f.href} aria-current={f.active ? "page" : undefined} className={cn("flex min-h-9 flex-1 items-center justify-between gap-2 rounded-lg px-3 text-[13px]", f.active ? "bg-nav-active font-semibold text-ink" : "text-muted hover:text-ink")}>
                <span className="truncate">{f.name}</span>
                <span className="num text-[11px]">{f.count}</span>
              </Link>
              <span className="flex opacity-0 focus-within:opacity-100 group-hover:opacity-100">
                <button
                  type="button"
                  aria-label={`Rename ${f.name}`}
                  onClick={() => {
                    setEditing(f.id);
                    setAdding(false);
                    setName(f.name);
                  }}
                  className="flex h-8 w-7 items-center justify-center rounded-md text-muted hover:text-ink"
                >
                  <Pencil size={12} />
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${f.name}`}
                  onClick={() =>
                    confirm(`Delete the folder "${f.name}"? Its ${f.count} note${f.count === 1 ? "" : "s"} will stay in your notebook, just not in a folder.`) &&
                    start(async () => {
                      const r = await deleteFolder(f.id);
                      if (r.ok && f.active) router.push(afterDeleteHref);
                      done(r);
                    })
                  }
                  className="flex h-8 w-7 items-center justify-center rounded-md text-muted hover:text-loss"
                >
                  <Trash2 size={12} />
                </button>
              </span>
            </li>
          ),
        )}
        {folders.length === 0 && !adding && <li className="px-3 py-1.5 text-xs text-muted">No folders yet.</li>}
      </ul>

      {adding && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => done(await createFolder(name)));
          }}
          className="mt-1 flex gap-1 px-1"
        >
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Folder name" className={input} aria-label="New folder name" maxLength={60} />
          <button aria-label="Create folder" disabled={pending} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-profit hover:bg-nav-active">
            <Check size={15} />
          </button>
          <button type="button" aria-label="Cancel" onClick={() => setAdding(false)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted hover:bg-nav-active">
            <X size={15} />
          </button>
        </form>
      )}
      {error && <p role="alert" className="mt-1 px-2 text-xs text-loss">{error}</p>}
    </div>
  );
}
