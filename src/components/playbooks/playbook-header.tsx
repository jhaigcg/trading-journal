"use client";

import { Archive, ArchiveRestore, ImagePlus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { removeCover, updatePlaybook, uploadCover } from "@/app/(app)/playbooks/actions";
import { cn } from "@/lib/cn";

const SWATCHES = ["#E0B04E", "#7FB7F0", "#3DD39A", "#F26B6F", "#C792EA", "#FFB86C"];

/** Cover, name, description, colour and archive state of a playbook. Text saves when you leave the field. */
export function PlaybookHeader({ id, name, description, color, archived, coverUrl }: { id: string; name: string; description: string | null; color: string; archived: boolean; coverUrl: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(name);
  const [about, setAbout] = useState(description ?? "");
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const saved = useRef({ name, description: description ?? "" });

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Something went wrong.");
      router.refresh();
    });

  return (
    <div className="mb-5 overflow-hidden rounded-card border border-line bg-card">
      <div className="relative h-36 sm:h-44" style={coverUrl ? undefined : { background: `linear-gradient(135deg, ${color}33, ${color}0d)` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {coverUrl && <img src={coverUrl} alt="" className="h-full w-full object-cover" />}
        <div className="absolute right-3 top-3 flex gap-2">
          <button type="button" disabled={pending} onClick={() => file.current?.click()} className="inline-flex min-h-9 items-center gap-1.5 rounded-control bg-black/60 px-3 text-xs text-ink backdrop-blur hover:bg-black/80">
            <ImagePlus size={14} /> {coverUrl ? "Change cover" : "Add cover"}
          </button>
          {coverUrl && (
            <button type="button" disabled={pending} aria-label="Remove cover" onClick={() => run(() => removeCover(id))} className="flex h-9 w-9 items-center justify-center rounded-control bg-black/60 text-ink backdrop-blur hover:text-loss">
              <Trash2 size={14} />
            </button>
          )}
        </div>
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            const form = new FormData();
            form.set("file", f);
            run(() => uploadCover(id, form));
          }}
        />
      </div>

      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              if (title.trim() && title !== saved.current.name) {
                saved.current.name = title;
                run(() => updatePlaybook(id, { name: title }));
              } else setTitle(saved.current.name);
            }}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            maxLength={120}
            aria-label="Playbook name"
            className="min-w-0 flex-1 rounded-md bg-transparent px-1 text-[22px] font-semibold outline-none focus:bg-inset"
          />
          <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Colour">
            {SWATCHES.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={color.toLowerCase() === c.toLowerCase()} aria-label={`Colour ${c}`} onClick={() => run(() => updatePlaybook(id, { color: c }))} className={cn("h-6 w-6 rounded-full border-2", color.toLowerCase() === c.toLowerCase() ? "border-ink" : "border-transparent")} style={{ background: c }} />
            ))}
          </div>
          <button type="button" disabled={pending} onClick={() => run(() => updatePlaybook(id, { archived: !archived }))} className="inline-flex min-h-9 items-center gap-1.5 rounded-control border border-line-strong px-3 text-xs hover:bg-nav-active">
            {archived ? <ArchiveRestore size={14} /> : <Archive size={14} />} {archived ? "Unarchive" : "Archive"}
          </button>
        </div>
        <textarea
          value={about}
          onChange={(e) => setAbout(e.target.value)}
          onBlur={() => {
            if (about !== saved.current.description) {
              saved.current.description = about;
              run(() => updatePlaybook(id, { description: about }));
            }
          }}
          rows={2}
          maxLength={1000}
          placeholder="Describe the setup: when it applies, what confirms it, how you manage it."
          aria-label="Description"
          className="w-full resize-y rounded-md bg-transparent px-1 py-1 text-sm text-ink-2 outline-none placeholder:text-muted focus:bg-inset"
        />
        {archived && <p className="text-xs text-muted">Archived: hidden from the active list, and its past trades keep their link to it.</p>}
        {error && <p role="alert" className="rounded-control bg-loss-bg px-3 py-2 text-sm text-loss">{error}</p>}
      </div>
    </div>
  );
}
