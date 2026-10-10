"use client";

import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { BarChart3, Bold, Heading2, Italic, List, ListChecks, ListOrdered, Quote } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getDayStatsBlock, getTemplateContent, loadNoteBody, saveNoteBody } from "@/app/(app)/notebook/actions";
import { loadNote, saveNote } from "@/app/(app)/trades/actions";
import { cn } from "@/lib/cn";

/** Which note this editor holds: a trade's note, a day's journal (looked up by key), or any note by id. */
export type NoteTarget = { kind: "TRADE"; tradeId: string } | { kind: "DAILY"; day: string } | { kind: "ID"; noteId: string };

type Save = "idle" | "saving" | "saved" | "error";

const EMPTY: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };

export interface TemplateOption {
  id: string;
  name: string;
}

/**
 * Rich-text note with autosave (about a second after you stop typing). Remount with a new `key` to switch notes.
 * `statsDay` adds an "Insert day stats" button; `templates` adds an "Insert template…" menu; `readOnly` is for the trash.
 */
export function NoteEditor({
  target,
  placeholder,
  templates,
  statsDay,
  readOnly,
}: {
  target: NoteTarget;
  placeholder?: string;
  templates?: TemplateOption[];
  statsDay?: string;
  readOnly?: boolean;
}) {
  const [save, setSave] = useState<Save>("idle");
  const [loaded, setLoaded] = useState<{ content: JSONContent; template: JSONContent | null } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<{ json: JSONContent; text: string } | null>(null);
  const targetRef = useRef(target); // fixed for the life of this editor: callers remount (key) to switch notes

  const persist = async (json: JSONContent, text: string) => {
    const t = targetRef.current;
    const body = JSON.stringify(json);
    if (t.kind === "ID") return saveNoteBody(t.noteId, body, text);
    return saveNote(t, body, text);
  };

  // load the existing note (or an empty one) once
  useEffect(() => {
    let alive = true;
    const t = targetRef.current;
    const load = t.kind === "ID" ? loadNoteBody(t.noteId).then((n) => ({ content: n?.content, template: null })) : loadNote(t).then((n) => ({ content: n.content, template: n.template }));
    load.then((n) => {
      if (alive) setLoaded({ content: (n.content as JSONContent | null) ?? EMPTY, template: (n.template as JSONContent | null) ?? null });
    });
    return () => {
      alive = false;
    };
  }, []);

  const flush = async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const pending = latest.current;
    if (!pending) return;
    latest.current = null;
    setSave("saving");
    const r = await persist(pending.json, pending.text).catch(() => ({ ok: false as const }));
    setSave(r.ok ? "saved" : "error");
  };

  // never lose the last edit when the note is closed or the tab changes
  useEffect(
    () => () => {
      if (latest.current) void persist(latest.current.json, latest.current.text);
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const editor = useEditor(
    {
      immediatelyRender: false,
      editable: !readOnly,
      extensions: [StarterKit, TaskList, TaskItem.configure({ nested: true }), Placeholder.configure({ placeholder: placeholder ?? "Write your notes…" })],
      content: loaded?.content ?? EMPTY,
      editorProps: { attributes: { class: "tiptap min-h-[260px] px-3 py-3 text-sm leading-relaxed outline-none", "aria-label": "Note" } },
      onUpdate: ({ editor }) => {
        latest.current = { json: editor.getJSON(), text: editor.getText() };
        setSave("saving");
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void flush(), 1000);
      },
    },
    [loaded],
  );

  if (!loaded || !editor) return <p className="py-10 text-center text-sm text-muted">Loading note…</p>;

  const isEmpty = editor.isEmpty;
  const btn = (on: boolean) => cn("flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-nav-active hover:text-ink", on && "bg-nav-active text-ink");
  const insert = (content: unknown) => {
    const c = content as { type?: string; content?: JSONContent[] };
    editor.chain().focus().insertContent((c.type === "doc" ? c.content : c) as JSONContent).run();
  };

  return (
    <div className="flex flex-col gap-2">
      {!readOnly && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-0.5" role="toolbar" aria-label="Formatting">
            <button type="button" aria-label="Bold" className={btn(editor.isActive("bold"))} onClick={() => editor.chain().focus().toggleBold().run()}>
              <Bold size={15} />
            </button>
            <button type="button" aria-label="Italic" className={btn(editor.isActive("italic"))} onClick={() => editor.chain().focus().toggleItalic().run()}>
              <Italic size={15} />
            </button>
            <button type="button" aria-label="Heading" className={btn(editor.isActive("heading"))} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
              <Heading2 size={15} />
            </button>
            <button type="button" aria-label="Bullet list" className={btn(editor.isActive("bulletList"))} onClick={() => editor.chain().focus().toggleBulletList().run()}>
              <List size={15} />
            </button>
            <button type="button" aria-label="Numbered list" className={btn(editor.isActive("orderedList"))} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
              <ListOrdered size={15} />
            </button>
            <button type="button" aria-label="Checklist" className={btn(editor.isActive("taskList"))} onClick={() => editor.chain().focus().toggleTaskList().run()}>
              <ListChecks size={15} />
            </button>
            <button type="button" aria-label="Quote" className={btn(editor.isActive("blockquote"))} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
              <Quote size={15} />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {statsDay && (
              <button
                type="button"
                onClick={async () => insert(await getDayStatsBlock(statsDay))}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-line-strong px-2.5 text-ink-2 hover:bg-nav-active"
                title={`Insert a snapshot of ${statsDay}'s trading numbers`}
              >
                <BarChart3 size={13} /> Insert day stats
              </button>
            )}
            {templates && templates.length > 0 && (
              <select
                aria-label="Insert template"
                defaultValue=""
                className="min-h-8 rounded-md border border-line-strong bg-inset px-2 text-ink-2"
                onChange={async (e) => {
                  const tpl = e.target.value && (await getTemplateContent(e.target.value));
                  e.target.value = "";
                  if (tpl) insert(tpl);
                }}
              >
                <option value="">Insert template…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
            {!templates && loaded.template && isEmpty && (
              <button type="button" onClick={() => editor.commands.setContent(loaded.template as JSONContent, { emitUpdate: true })} className="rounded-md border border-line-strong px-2.5 py-1 text-ink-2 hover:bg-nav-active">
                Use template
              </button>
            )}
            <span className={cn("num", save === "error" ? "text-loss" : "text-muted")} aria-live="polite">
              {save === "saving" ? "Saving…" : save === "saved" ? "Saved" : save === "error" ? "Not saved. Retrying on your next edit" : ""}
            </span>
          </div>
        </div>
      )}
      <div className={cn("rounded-control border border-line bg-inset", !readOnly && "focus-within:border-accent")}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
