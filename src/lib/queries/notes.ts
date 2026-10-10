import type { NoteKind, Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export const SECTIONS = ["all", "favorites", "trade", "daily", "session", "mine", "trash"] as const;
export type Section = (typeof SECTIONS)[number];
export const isSection = (v: string | undefined): v is Section => !!v && (SECTIONS as readonly string[]).includes(v);

export const SECTION_LABEL: Record<Section, string> = {
  all: "All notes",
  favorites: "Favorites",
  trade: "Trade notes",
  daily: "Daily journal",
  session: "Sessions recap",
  mine: "My notes",
  trash: "Trash",
};

export interface NoteFilter {
  section: Section;
  folderId?: string;
  tagId?: string;
  strategyId?: string;
  q?: string;
}

const KIND: Partial<Record<Section, NoteKind>> = { trade: "TRADE", daily: "DAILY", session: "SESSION_RECAP", mine: "FREE" };

export function noteWhere(f: NoteFilter): Prisma.NoteWhereInput {
  const and: Prisma.NoteWhereInput[] = [{ deletedAt: f.section === "trash" ? { not: null } : null }];
  const kind = KIND[f.section];
  if (kind) and.push({ kind });
  if (f.section === "favorites") and.push({ favorite: true });
  if (f.folderId) and.push({ folderId: f.folderId });
  if (f.tagId) and.push({ tags: { some: { tagId: f.tagId } } });
  if (f.strategyId) and.push({ strategyId: f.strategyId });
  const q = f.q?.trim();
  // case-insensitive substring search over title and body: works for any language (no word-splitting needed)
  if (q) and.push({ OR: [{ title: { contains: q, mode: "insensitive" } }, { plainText: { contains: q, mode: "insensitive" } }] });
  return { AND: and };
}

export interface NoteRow {
  id: string;
  kind: NoteKind;
  title: string;
  snippet: string;
  day: string | null;
  updatedAt: Date;
  favorite: boolean;
  folderId: string | null;
  tradeId: string | null;
  tradeLabel: string | null;
  trashed: boolean;
}

/** Context around the first match (or the start of the note when there is no search). */
export function snippetOf(text: string, q?: string, width = 140): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const needle = q?.trim().toLowerCase();
  if (needle) {
    const i = flat.toLowerCase().indexOf(needle);
    if (i > 40) return `…${flat.slice(i - 40, i - 40 + width)}`;
  }
  return flat.slice(0, width);
}

export async function listNotes(f: NoteFilter, limit = 200): Promise<NoteRow[]> {
  const rows = await db.note.findMany({
    where: noteWhere(f),
    orderBy: [{ updatedAt: "desc" }],
    take: limit,
    select: { id: true, kind: true, title: true, plainText: true, day: true, updatedAt: true, favorite: true, folderId: true, tradeId: true, deletedAt: true, trade: { select: { symbol: true, side: true, openedAt: true } } },
  });
  const q = f.q?.trim().toLowerCase();
  const list = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    snippet: snippetOf(r.plainText, f.q),
    day: r.day?.toISOString().slice(0, 10) ?? null,
    updatedAt: r.updatedAt,
    favorite: r.favorite,
    folderId: r.folderId,
    tradeId: r.tradeId,
    tradeLabel: r.trade ? `${r.trade.symbol} ${r.trade.side === "LONG" ? "long" : "short"} · ${r.trade.openedAt.toISOString().slice(0, 10)}` : null,
    trashed: r.deletedAt != null,
  }));
  // when searching, notes whose title matches come first
  return q ? [...list.filter((n) => n.title.toLowerCase().includes(q)), ...list.filter((n) => !n.title.toLowerCase().includes(q))] : list;
}

export type NoteCounts = Record<Section, number>;

export async function noteCounts(): Promise<NoteCounts> {
  const [live, trash, favorites] = await Promise.all([
    db.note.groupBy({ by: ["kind"], where: { deletedAt: null }, _count: true }),
    db.note.count({ where: { deletedAt: { not: null } } }),
    db.note.count({ where: { deletedAt: null, favorite: true } }),
  ]);
  const by = (k: NoteKind) => live.find((l) => l.kind === k)?._count ?? 0;
  return { all: live.reduce((s, l) => s + l._count, 0), favorites, trade: by("TRADE"), daily: by("DAILY"), session: by("SESSION_RECAP"), mine: by("FREE"), trash };
}

export async function folderCounts() {
  const [folders, counts] = await Promise.all([
    db.noteFolder.findMany({ orderBy: [{ position: "asc" }, { name: "asc" }] }),
    db.note.groupBy({ by: ["folderId"], where: { deletedAt: null, folderId: { not: null } }, _count: true }),
  ]);
  const c = new Map(counts.map((x) => [x.folderId, x._count]));
  return folders.map((f) => ({ id: f.id, name: f.name, count: c.get(f.id) ?? 0 }));
}

/** Tags that are used on at least one live note, with counts. */
export async function noteTagCounts() {
  const rows = await db.noteTag.groupBy({ by: ["tagId"], where: { note: { deletedAt: null } }, _count: true });
  if (!rows.length) return [];
  const tags = await db.tag.findMany({ where: { id: { in: rows.map((r) => r.tagId) } }, select: { id: true, name: true, category: { select: { name: true } } } });
  const c = new Map(rows.map((r) => [r.tagId, r._count]));
  return tags.map((t) => ({ id: t.id, name: t.name, category: t.category.name, count: c.get(t.id) ?? 0 })).sort((a, b) => a.name.localeCompare(b.name));
}

export interface NoteDetail {
  id: string;
  kind: NoteKind;
  title: string;
  favorite: boolean;
  folderId: string | null;
  day: string | null;
  trashed: boolean;
  updatedAt: string;
  tradeId: string | null;
  tradeLabel: string | null;
  strategy: { id: string; name: string } | null;
  tagIds: string[];
}

export async function loadNoteDetail(id: string): Promise<NoteDetail | null> {
  const n = await db.note.findUnique({
    where: { id },
    include: { tags: true, strategy: { select: { id: true, name: true } }, trade: { select: { symbol: true, side: true, openedAt: true } } },
  });
  if (!n) return null;
  return {
    id: n.id,
    kind: n.kind,
    title: n.title,
    favorite: n.favorite,
    folderId: n.folderId,
    day: n.day?.toISOString().slice(0, 10) ?? null,
    trashed: n.deletedAt != null,
    updatedAt: n.updatedAt.toISOString(),
    tradeId: n.tradeId,
    tradeLabel: n.trade ? `${n.trade.symbol} ${n.trade.side === "LONG" ? "long" : "short"} · ${n.trade.openedAt.toISOString().slice(0, 10)}` : null,
    strategy: n.strategy,
    tagIds: n.tags.map((t) => t.tagId),
  };
}

export const KIND_LABEL: Record<NoteKind, string> = { TRADE: "Trade note", DAILY: "Daily journal", SESSION_RECAP: "Session recap", FREE: "Note" };

/** Title to show in lists when the note has none. */
export function displayTitle(n: { title: string; kind: NoteKind; day: string | null; tradeLabel?: string | null }): string {
  if (n.title.trim()) return n.title;
  if (n.kind === "DAILY" && n.day) return `Daily journal · ${n.day}`;
  if (n.kind === "TRADE" && n.tradeLabel) return `Trade note · ${n.tradeLabel}`;
  if (n.kind === "SESSION_RECAP") return n.day ? `Session recap · ${n.day}` : "Session recap";
  return "Untitled note";
}
