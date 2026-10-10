import type { Metadata } from "next";
import { CalendarDays, FileText, Star, StickyNote, Timer, Trash2, TrendingUp } from "lucide-react";
import Link from "next/link";
import { FolderList } from "@/components/notes/folder-list";
import { EmptyTrashButton, NewNoteButton } from "@/components/notes/note-actions";
import { NotePanel } from "@/components/notes/note-panel";
import { PageHeader } from "@/components/layout/page-header";
import { cn } from "@/lib/cn";
import { db } from "@/lib/db";
import { ensureDefaultTemplates } from "@/lib/notes/templates";
import { SECTIONS, SECTION_LABEL, displayTitle, folderCounts, isSection, listNotes, loadNoteDetail, noteCounts, noteTagCounts, type Section } from "@/lib/queries/notes";
import { loadFilterOptions } from "@/lib/queries/options";

export const metadata: Metadata = { title: "Notebook" };

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const ICON: Record<string, React.ReactNode> = {
  all: <FileText size={15} />,
  favorites: <Star size={15} />,
  trade: <TrendingUp size={15} />,
  daily: <CalendarDays size={15} />,
  session: <Timer size={15} />,
  mine: <StickyNote size={15} />,
  trash: <Trash2 size={15} />,
};

export default async function NotebookPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const section: Section = isSection(first(sp.section)) ? (first(sp.section) as Section) : "all";
  const folderId = first(sp.folder);
  const tagId = first(sp.tag);
  const q = first(sp.q)?.slice(0, 100);
  const noteId = first(sp.note);

  await ensureDefaultTemplates(db);
  const [counts, folders, tags, notes, options, templates, detail] = await Promise.all([
    noteCounts(),
    folderCounts(),
    noteTagCounts(),
    listNotes({ section, folderId, tagId, q }),
    loadFilterOptions(),
    db.noteTemplate.findMany({ orderBy: [{ kind: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    noteId ? loadNoteDetail(noteId) : Promise.resolve(null),
  ]);

  // links keep the current view (section / folder / tag / search) and only change the open note
  const href = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const base: Record<string, string | undefined> = { section: section === "all" ? undefined : section, folder: folderId, tag: tagId, q, note: noteId };
    for (const [k, v] of Object.entries({ ...base, ...patch })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/notebook?${s}` : "/notebook";
  };
  const navHref = (s: Section) => (s === "all" ? "/notebook" : `/notebook?section=${s}`);
  const listHref = href({ note: null });
  const showEditor = !!detail;

  const dateFmt = new Intl.DateTimeFormat("en-AU", { day: "2-digit", month: "short", year: "numeric", timeZone: options.timezone });

  return (
    <>
      <PageHeader title="Notebook" />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_320px_minmax(0,1fr)]">
        {/* ── navigation ── */}
        <nav aria-label="Notebook" className={cn("flex-col gap-4 lg:flex", showEditor ? "hidden" : "flex")}>
          <ul className="flex flex-col">
            {SECTIONS.map((s) => (
              <li key={s}>
                <Link href={navHref(s)} aria-current={section === s && !folderId && !tagId ? "page" : undefined} className={cn("flex min-h-9 items-center justify-between gap-2 rounded-lg px-3 text-[13px]", section === s && !folderId && !tagId ? "bg-nav-active font-semibold text-ink" : "text-muted hover:text-ink")}>
                  <span className="flex items-center gap-2">
                    {ICON[s]} {SECTION_LABEL[s]}
                  </span>
                  <span className="num text-[11px]">{counts[s]}</span>
                </Link>
              </li>
            ))}
          </ul>

          <FolderList
            folders={folders.map((f) => ({ ...f, href: `/notebook?folder=${f.id}`, active: folderId === f.id }))}
            afterDeleteHref="/notebook"
          />

          {tags.length > 0 && (
            <div>
              <div className="mb-1 px-2 text-[11px] uppercase tracking-wide text-muted">Tags</div>
              <ul className="flex flex-wrap gap-1.5 px-1">
                {tags.map((t) => (
                  <li key={t.id}>
                    <Link href={`/notebook?tag=${t.id}`} aria-current={tagId === t.id ? "page" : undefined} className={cn("inline-flex min-h-8 items-center gap-1 rounded-full border px-2.5 text-[11px]", tagId === t.id ? "border-accent bg-accent/15 text-accent" : "border-line-strong text-ink-2 hover:bg-nav-active")}>
                      {t.name} <span className="num text-muted">{t.count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </nav>

        {/* ── note list ── */}
        <section aria-label="Notes" className={cn("min-w-0 flex-col gap-3 lg:flex", showEditor ? "hidden" : "flex")}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="truncate text-[15px] font-semibold">
              {folderId ? (folders.find((f) => f.id === folderId)?.name ?? "Folder") : tagId ? `Tag · ${tags.find((t) => t.id === tagId)?.name ?? ""}` : SECTION_LABEL[section]}
            </h2>
            {section === "trash" ? <EmptyTrashButton count={counts.trash} afterHref="/notebook?section=trash" /> : section !== "trade" && <NewNoteButton section={section} folderId={folderId} tagId={tagId} />}
          </div>

          <form action="/notebook" className="flex gap-2" role="search">
            {section !== "all" && <input type="hidden" name="section" value={section} />}
            {folderId && <input type="hidden" name="folder" value={folderId} />}
            {tagId && <input type="hidden" name="tag" value={tagId} />}
            <input name="q" defaultValue={q} placeholder="Search notes…" aria-label="Search notes" className="min-h-10 w-full rounded-control border border-line-strong bg-inset px-3 text-sm placeholder:text-muted focus:border-accent focus:outline-none" />
            {q && (
              <Link href={href({ q: null, note: null })} className="inline-flex min-h-10 items-center rounded-control border border-line-strong px-3 text-xs text-muted hover:text-ink">
                Clear
              </Link>
            )}
          </form>

          {notes.length === 0 ? (
            <p className="rounded-card border border-line bg-card px-4 py-10 text-center text-sm text-muted">
              {q ? `No notes match "${q}".` : section === "trash" ? "The trash is empty." : section === "trade" ? "Trade notes appear here once you write them on a trade." : "No notes here yet."}
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {notes.map((n) => (
                <li key={n.id}>
                  <Link href={href({ note: n.id })} aria-current={noteId === n.id ? "true" : undefined} className={cn("block rounded-control border px-3 py-2.5", noteId === n.id ? "border-accent/60 bg-nav-active" : "border-line bg-card hover:bg-nav-active/60")}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-semibold">{displayTitle({ ...n })}</span>
                      {n.favorite && <Star size={12} className="shrink-0 fill-accent text-accent" aria-label="Favorite" />}
                    </div>
                    {n.snippet && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{n.snippet}</p>}
                    <div className="mt-1 text-[11px] text-muted">{n.day ?? dateFmt.format(n.updatedAt)}</div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── editor ── */}
        <section aria-label="Editor" className={cn("min-w-0 rounded-card border border-line bg-card p-4 lg:block", showEditor ? "block" : "hidden")}>
          {detail ? (
            <NotePanel key={detail.id} note={detail} folders={folders} tagGroups={options.tagGroups} templates={templates} closeHref={listHref} />
          ) : (
            <p className="py-24 text-center text-sm text-muted">{noteId ? "That note no longer exists." : "Select a note, or create a new one."}</p>
          )}
        </section>
      </div>
    </>
  );
}
