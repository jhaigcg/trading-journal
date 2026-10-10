"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { dayStatsBlock } from "@/lib/notes/day-stats";
import { parseNoteDoc } from "@/lib/notes/doc";
import { ensureDefaultTemplates } from "@/lib/notes/templates";
import { settingsFor } from "@/lib/queries/trade-list";
import { getSession } from "@/lib/session";
import { dayKey } from "@/lib/time";

type Ok<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (error: string) => ({ ok: false as const, error });

async function requireSession() {
  if (!(await getSession())) redirect("/login");
}
const refresh = () => revalidatePath("/notebook");

const id = z.string().min(1).max(64);
const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };

// ───────────── notes ─────────────

const createSchema = z.object({
  kind: z.enum(["FREE", "DAILY", "SESSION_RECAP"]),
  folderId: id.nullish(),
  strategyId: id.nullish(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/** New note. A daily journal is one per day, so asking for today's returns the existing one. */
export async function createNote(input: z.input<typeof createSchema>): Promise<Ok<{ id: string }>> {
  await requireSession();
  const p = createSchema.safeParse(input);
  if (!p.success) return fail("Could not create the note.");
  const { kind, folderId, strategyId } = p.data;
  const day = p.data.day ?? dayKey(new Date(), (await settingsFor()).tz);

  if (kind === "DAILY") {
    const existing = await db.note.findFirst({ where: { kind: "DAILY", day: new Date(`${day}T00:00:00Z`), deletedAt: null } });
    if (existing) return { ok: true, id: existing.id };
  }
  await ensureDefaultTemplates(db);
  const tpl = kind === "FREE" ? null : await db.noteTemplate.findFirst({ where: { kind, isDefault: true } });
  const note = await db.note.create({
    data: {
      kind,
      title: kind === "DAILY" ? `Daily journal · ${day}` : kind === "SESSION_RECAP" ? `Session recap · ${day}` : "",
      content: (tpl?.content ?? EMPTY_DOC) as Prisma.InputJsonValue,
      plainText: "",
      day: kind === "FREE" ? null : new Date(`${day}T00:00:00Z`),
      folderId: folderId ?? null,
      strategyId: strategyId ?? null,
      ...(kind === "DAILY" ? { startedAt: null } : {}),
    },
  });
  refresh();
  return { ok: true, id: note.id };
}

export interface NoteBody {
  id: string;
  kind: "TRADE" | "DAILY" | "SESSION_RECAP" | "FREE";
  content: unknown;
  day: string | null;
  trashed: boolean;
}

export async function loadNoteBody(noteId: string): Promise<NoteBody | null> {
  await requireSession();
  const n = await db.note.findUnique({ where: { id: noteId } });
  return n ? { id: n.id, kind: n.kind, content: n.content, day: n.day?.toISOString().slice(0, 10) ?? null, trashed: n.deletedAt != null } : null;
}

export async function saveNoteBody(noteId: string, contentJson: string, plainText: string): Promise<Ok<{ updatedAt: string }>> {
  await requireSession();
  const parsed = parseNoteDoc(contentJson);
  if (!parsed.ok) return fail(parsed.error);
  const content = parsed.doc;
  const n = await db.note.findUnique({ where: { id: noteId }, select: { deletedAt: true } });
  if (!n) return fail("Note not found.");
  if (n.deletedAt) return fail("This note is in the trash. Restore it to edit.");
  const saved = await db.note.update({ where: { id: noteId }, data: { content: content as Prisma.InputJsonValue, plainText: plainText.slice(0, 200_000) } });
  return { ok: true, updatedAt: saved.updatedAt.toISOString() };
}

const metaSchema = z.object({
  title: z.string().max(200).optional(),
  favorite: z.boolean().optional(),
  folderId: id.nullable().optional(),
});

export async function updateNoteMeta(noteId: string, patch: z.input<typeof metaSchema>): Promise<Ok> {
  await requireSession();
  const p = metaSchema.safeParse(patch);
  if (!p.success) return fail("That value is not valid.");
  if (p.data.folderId && !(await db.noteFolder.findUnique({ where: { id: p.data.folderId }, select: { id: true } }))) return fail("Folder not found.");
  const r = await db.note.updateMany({ where: { id: noteId }, data: { ...(p.data.title !== undefined ? { title: p.data.title.trim() } : {}), ...(p.data.favorite !== undefined ? { favorite: p.data.favorite } : {}), ...(p.data.folderId !== undefined ? { folderId: p.data.folderId } : {}) } });
  if (!r.count) return fail("Note not found.");
  refresh();
  return { ok: true };
}

export async function setNoteTags(noteId: string, tagIds: string[]): Promise<Ok> {
  await requireSession();
  const ids = [...new Set(z.array(id).max(100).parse(tagIds))];
  const valid = await db.tag.findMany({ where: { id: { in: ids } }, select: { id: true } });
  await db.$transaction([db.noteTag.deleteMany({ where: { noteId } }), db.noteTag.createMany({ data: valid.map((t) => ({ noteId, tagId: t.id })), skipDuplicates: true })]);
  refresh();
  return { ok: true };
}

export async function trashNote(noteId: string): Promise<Ok> {
  await requireSession();
  const r = await db.note.updateMany({ where: { id: noteId, deletedAt: null }, data: { deletedAt: new Date() } });
  refresh();
  return r.count ? { ok: true } : fail("Note not found.");
}

export async function restoreNote(noteId: string): Promise<Ok> {
  await requireSession();
  const r = await db.note.updateMany({ where: { id: noteId, deletedAt: { not: null } }, data: { deletedAt: null } });
  refresh();
  return r.count ? { ok: true } : fail("Note not found in the trash.");
}

/** Permanent delete. Only notes already in the trash can be removed this way. */
export async function deleteNoteForever(noteId: string): Promise<Ok> {
  await requireSession();
  const r = await db.note.deleteMany({ where: { id: noteId, deletedAt: { not: null } } });
  refresh();
  return r.count ? { ok: true } : fail("Only notes in the trash can be deleted permanently.");
}

export async function emptyTrash(): Promise<Ok<{ count: number }>> {
  await requireSession();
  const r = await db.note.deleteMany({ where: { deletedAt: { not: null } } });
  refresh();
  return { ok: true, count: r.count };
}

// ───────────── folders ─────────────

const folderName = z.string().trim().min(1, "Give the folder a name.").max(60);

export async function createFolder(name: string): Promise<Ok<{ id: string }>> {
  await requireSession();
  const n = folderName.safeParse(name);
  if (!n.success) return fail(n.error.issues[0].message);
  const last = await db.noteFolder.aggregate({ _max: { position: true } });
  const f = await db.noteFolder.create({ data: { name: n.data, position: (last._max.position ?? -1) + 1 } });
  refresh();
  return { ok: true, id: f.id };
}

export async function renameFolder(folderId: string, name: string): Promise<Ok> {
  await requireSession();
  const n = folderName.safeParse(name);
  if (!n.success) return fail(n.error.issues[0].message);
  const r = await db.noteFolder.updateMany({ where: { id: folderId }, data: { name: n.data } });
  refresh();
  return r.count ? { ok: true } : fail("Folder not found.");
}

/** Deleting a folder keeps its notes: they simply become unfiled. */
export async function deleteFolder(folderId: string): Promise<Ok> {
  await requireSession();
  await db.noteFolder.deleteMany({ where: { id: folderId } });
  refresh();
  return { ok: true };
}

// ───────────── templates & stats ─────────────

export async function listTemplates(): Promise<{ id: string; name: string; kind: string }[]> {
  await requireSession();
  await ensureDefaultTemplates(db);
  const rows = await db.noteTemplate.findMany({ orderBy: [{ kind: "asc" }, { name: "asc" }], select: { id: true, name: true, kind: true } });
  return rows;
}

export async function getTemplateContent(templateId: string): Promise<unknown | null> {
  await requireSession();
  return (await db.noteTemplate.findUnique({ where: { id: templateId } }))?.content ?? null;
}

export async function getDayStatsBlock(day: string): Promise<unknown[]> {
  await requireSession();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return [];
  return (await dayStatsBlock(day)).nodes;
}

