"use client";

import { ImagePlus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { deleteAttachment, uploadAttachment } from "@/app/(app)/trades/actions";
import type { TradeDTO } from "@/lib/queries/trade-detail";
import { emitTradeChanged } from "./events";

/** Screenshots for the trade. Choose a file, drag one in, or paste an image straight from the clipboard. */
export function Attachments({ t }: { t: TradeDTO }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const upload = (files: File[]) =>
    start(async () => {
      setError(null);
      for (const f of files) {
        const form = new FormData();
        form.set("file", f);
        const r = await uploadAttachment(t.id, form);
        if (!r.ok) {
          setError(r.error);
          break;
        }
      }
      router.refresh();
      emitTradeChanged();
    });

  const onlyImages = (files: (File | null)[]) => files.filter((f): f is File => !!f && f.type.startsWith("image/"));
  const fromItems = (items: DataTransferItemList) => onlyImages(Array.from(items).map((i) => (i.kind === "file" ? i.getAsFile() : null)));
  const fromFiles = (files: FileList) => onlyImages(Array.from(files));

  return (
    <div
      tabIndex={0}
      className="flex flex-col gap-3 rounded-control outline-none focus-visible:outline-accent"
      onPaste={(e) => {
        const f = fromItems(e.clipboardData.items);
        if (f.length) {
          e.preventDefault();
          upload(f);
        }
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = fromFiles(e.dataTransfer.files);
        if (f.length) upload(f);
      }}
    >
      <div className="flex items-center gap-3">
        <button type="button" disabled={pending} onClick={() => file.current?.click()} className="inline-flex min-h-10 items-center gap-2 rounded-control border border-line-strong px-3.5 text-[13px] hover:bg-nav-active disabled:opacity-60">
          <ImagePlus size={16} /> {pending ? "Uploading…" : "Add screenshot"}
        </button>
        <input ref={file} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden onChange={(e) => e.target.files && upload(fromFiles(e.target.files))} />
        <span className="text-xs text-muted">or paste / drop an image here</span>
      </div>

      {error && <p role="alert" className="rounded-control bg-loss-bg px-3 py-2 text-sm text-loss">{error}</p>}

      {t.attachments.length === 0 ? (
        <p className="py-4 text-sm text-muted">No screenshots yet.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2">
          {t.attachments.map((a) => (
            <li key={a.id} className="group relative overflow-hidden rounded-control border border-line bg-inset">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.url} alt="Trade screenshot" className="h-32 w-full cursor-zoom-in object-cover" onClick={() => setView(a.url)} />
              <button
                type="button"
                aria-label="Delete screenshot"
                onClick={() =>
                  confirm("Delete this screenshot?") &&
                  start(async () => {
                    await deleteAttachment(a.id);
                    router.refresh();
                    emitTradeChanged();
                  })
                }
                className="absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-md bg-black/60 text-ink opacity-0 hover:text-loss focus:opacity-100 group-hover:opacity-100"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {view && (
        <div role="dialog" aria-modal="true" aria-label="Screenshot" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4" onClick={() => setView(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={view} alt="Trade screenshot" className="max-h-full max-w-full rounded-control" />
        </div>
      )}
    </div>
  );
}
