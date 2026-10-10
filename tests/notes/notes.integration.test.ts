/**
 * Notebook backend against the real database (session and Next cache stubbed). Everything it creates is
 * prefixed "TEST-" and removed afterwards. Skipped automatically if no database is reachable.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getSession: async () => ({ uid: "test" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import {
  createFolder,
  createNote,
  deleteFolder,
  deleteNoteForever,
  emptyTrash,
  getDayStatsBlock,
  getTemplateContent,
  listTemplates,
  loadNoteBody,
  renameFolder,
  restoreNote,
  saveNoteBody,
  setNoteTags,
  trashNote,
  updateNoteMeta,
} from "@/app/(app)/notebook/actions";
import { db } from "@/lib/db";
import { displayTitle, folderCounts, listNotes, loadNoteDetail, noteCounts, noteTagCounts, snippetOf } from "@/lib/queries/notes";

const P = "TEST-";
const DAY = "2031-05-05";
let reachable = false;
let tagId = "";
let accountId = "";
const doc = (t: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });

async function mk(title: string, body: string, extra: Record<string, unknown> = {}) {
  return db.note.create({ data: { kind: "FREE", title: `${P}${title}`, content: doc(body), plainText: body, ...extra } });
}

beforeAll(async () => {
  try {
    await db.$queryRaw`select 1`;
    reachable = true;
    const cat = await db.tagCategory.upsert({ where: { name: "TEST cat" }, update: {}, create: { name: "TEST cat" } });
    tagId = (await db.tag.upsert({ where: { categoryId_name: { categoryId: cat.id, name: "TEST tag" } }, update: {}, create: { categoryId: cat.id, name: "TEST tag" } })).id;
    await db.symbolConfig.upsert({ where: { symbol: "XAUUSD" }, update: {}, create: { symbol: "XAUUSD", pipSize: 0.01, contractSize: 100, aliases: [] } });
  } catch {
    reachable = false;
  }
});

afterAll(async () => {
  if (reachable) {
    await db.note.deleteMany({ where: { OR: [{ title: { startsWith: P } }, { title: { contains: DAY } }, { day: new Date(`${DAY}T00:00:00Z`) }] } });
    await db.noteFolder.deleteMany({ where: { name: { startsWith: P } } });
    await db.dailySummary.deleteMany({ where: { accountId } });
    if (accountId) await db.account.deleteMany({ where: { id: accountId } });
    await db.tagCategory.deleteMany({ where: { name: "TEST cat" } });
  }
  await db.$disconnect();
});

describe("search and sections", () => {
  it("finds notes by title or body, case-insensitively, in any language, with the title match first", async (ctx) => {
    if (!reachable) return ctx.skip();
    await mk("alpha", "Liquidity sweep then CHoCH on the five minute");
    await mk("beta", "nothing relevant");
    await mk("CHoCH checklist", "rules");
    await mk("中文笔记", "今天的交易计划：等待流动性扫荡后进场");

    const q = await listNotes({ section: "all", q: "choch" });
    const titles = q.map((n) => n.title).filter((t) => t.startsWith(P));
    expect(titles).toEqual([`${P}CHoCH checklist`, `${P}alpha`]);

    const zh = await listNotes({ section: "all", q: "流动性" });
    expect(zh.map((n) => n.title)).toContain(`${P}中文笔记`);
    expect((await listNotes({ section: "all", q: "no-such-text-zzzz" })).length).toBe(0);
  });

  it("snippets show context around the match", () => {
    const text = "x".repeat(120) + " NEEDLE " + "y".repeat(120);
    const s = snippetOf(text, "needle");
    expect(s.startsWith("…")).toBe(true);
    expect(s.toLowerCase()).toContain("needle");
    expect(snippetOf("short note", "zzz")).toBe("short note");
    expect(snippetOf("  lots   of\n\nwhitespace ")).toBe("lots of whitespace");
  });

  it("sections, favourites, folders and tags filter correctly; counts agree", async (ctx) => {
    if (!reachable) return ctx.skip();
    const before = await noteCounts();
    const folder = await createFolder(`${P}Setups`);
    if (!folder.ok) throw new Error(folder.error);
    const a = await mk("fav", "x", { favorite: true, folderId: folder.id });
    const s = await mk("recap", "x", { kind: "SESSION_RECAP", day: new Date(`${DAY}T00:00:00Z`) });
    await setNoteTags(a.id, [tagId]);

    const after = await noteCounts();
    expect(after.all - before.all).toBe(2);
    expect(after.favorites - before.favorites).toBe(1);
    expect(after.session - before.session).toBe(1);
    expect(after.mine - before.mine).toBe(1);

    expect((await listNotes({ section: "favorites" })).map((n) => n.id)).toContain(a.id);
    expect((await listNotes({ section: "session" })).map((n) => n.id)).toContain(s.id);
    expect((await listNotes({ section: "all", folderId: folder.id })).map((n) => n.id)).toEqual([a.id]);
    expect((await listNotes({ section: "all", tagId })).map((n) => n.id)).toEqual([a.id]);
    expect((await folderCounts()).find((f) => f.id === folder.id)?.count).toBe(1);
    expect((await noteTagCounts()).find((t) => t.id === tagId)?.count).toBe(1);

    const d = (await loadNoteDetail(a.id))!;
    expect(d).toMatchObject({ favorite: true, folderId: folder.id, tagIds: [tagId], trashed: false });
  });

  it("display titles fall back sensibly", () => {
    expect(displayTitle({ title: "", kind: "DAILY", day: "2026-10-09" })).toBe("Daily journal · 2026-10-09");
    expect(displayTitle({ title: "", kind: "TRADE", day: null, tradeLabel: "XAUUSD long · 2026-10-09" })).toBe("Trade note · XAUUSD long · 2026-10-09");
    expect(displayTitle({ title: "", kind: "FREE", day: null })).toBe("Untitled note");
    expect(displayTitle({ title: "Mine", kind: "FREE", day: null })).toBe("Mine");
  });
});

describe("creating and editing", () => {
  it("a daily journal is one per day, starts from the daily template", async (ctx) => {
    if (!reachable) return ctx.skip();
    const a = await createNote({ kind: "DAILY", day: DAY });
    const b = await createNote({ kind: "DAILY", day: DAY });
    if (!a.ok || !b.ok) throw new Error("create failed");
    expect(b.id).toBe(a.id);
    const body = (await loadNoteBody(a.id))!;
    expect(body).toMatchObject({ kind: "DAILY", day: DAY, trashed: false });
    expect(JSON.stringify(body.content)).toContain("Pre-market checklist");
    expect(await db.note.count({ where: { kind: "DAILY", day: new Date(`${DAY}T00:00:00Z`), deletedAt: null } })).toBe(1);
  });

  it("free and session notes, saving, titles and validation", async (ctx) => {
    if (!reachable) return ctx.skip();
    const n = await createNote({ kind: "FREE" });
    if (!n.ok) throw new Error("create failed");
    expect(await saveNoteBody(n.id, JSON.stringify(doc("hello world")), "hello world")).toMatchObject({ ok: true });
    expect(await updateNoteMeta(n.id, { title: `  ${P}My title  ` })).toEqual({ ok: true });
    const d = (await loadNoteDetail(n.id))!;
    expect(d.title).toBe(`${P}My title`);
    expect((await db.note.findUniqueOrThrow({ where: { id: n.id } })).plainText).toBe("hello world");
    expect(await updateNoteMeta(n.id, { title: "x".repeat(300) })).toMatchObject({ ok: false });
    expect(await updateNoteMeta(n.id, { folderId: "missing" })).toMatchObject({ ok: false });
    expect(await updateNoteMeta("missing", { favorite: true })).toMatchObject({ ok: false });
    expect(await saveNoteBody(n.id, "oops", "x")).toMatchObject({ ok: false });
    const s = await createNote({ kind: "SESSION_RECAP", day: DAY });
    expect(s.ok && (await loadNoteBody(s.id))?.kind).toBe("SESSION_RECAP");
  });
});

describe("trash", () => {
  it("trash hides, restore returns, only trashed notes can be deleted forever, trashed notes cannot be edited", async (ctx) => {
    if (!reachable) return ctx.skip();
    const n = await mk("trashme", "bye");
    const live = (id: string) => listNotes({ section: "all" }).then((l) => l.some((x) => x.id === id));
    expect(await deleteNoteForever(n.id)).toMatchObject({ ok: false }); // still live
    expect(await trashNote(n.id)).toEqual({ ok: true });
    expect(await live(n.id)).toBe(false);
    expect((await listNotes({ section: "trash" })).map((x) => x.id)).toContain(n.id);
    expect((await noteCounts()).trash).toBeGreaterThanOrEqual(1);
    expect(await saveNoteBody(n.id, JSON.stringify(doc("edit")), "edit")).toMatchObject({ ok: false });
    expect(await restoreNote(n.id)).toEqual({ ok: true });
    expect(await live(n.id)).toBe(true);
    expect(await restoreNote(n.id)).toMatchObject({ ok: false }); // not in the trash any more

    await trashNote(n.id);
    expect(await deleteNoteForever(n.id)).toEqual({ ok: true });
    expect(await db.note.findUnique({ where: { id: n.id } })).toBeNull();
  });

  it("emptying the trash removes only trashed notes", async (ctx) => {
    if (!reachable) return ctx.skip();
    const keep = await mk("keep", "k");
    const gone = await mk("gone", "g", { deletedAt: new Date() });
    const r = await emptyTrash();
    expect(r.ok).toBe(true);
    expect(await db.note.findUnique({ where: { id: gone.id } })).toBeNull();
    expect(await db.note.findUnique({ where: { id: keep.id } })).not.toBeNull();
  });
});

describe("folders", () => {
  it("create, rename, validate; deleting a folder keeps its notes", async (ctx) => {
    if (!reachable) return ctx.skip();
    const f = await createFolder(`${P}Weekly`);
    if (!f.ok) throw new Error(f.error);
    expect(await createFolder("   ")).toMatchObject({ ok: false });
    expect(await renameFolder(f.id, `${P}Weekly reviews`)).toEqual({ ok: true });
    expect(await renameFolder("missing", "x")).toMatchObject({ ok: false });
    const n = await mk("in-folder", "x", { folderId: f.id });
    expect(await deleteFolder(f.id)).toEqual({ ok: true });
    const after = await db.note.findUniqueOrThrow({ where: { id: n.id } });
    expect(after.folderId).toBeNull(); // unfiled, not deleted
    expect(after.deletedAt).toBeNull();
  });
});

describe("templates and day stats", () => {
  it("default templates exist for every kind, once, with content", async (ctx) => {
    if (!reachable) return ctx.skip();
    const a = await listTemplates();
    const b = await listTemplates(); // idempotent: no duplicates
    expect(b.length).toBe(a.length);
    for (const kind of ["TRADE", "DAILY", "SESSION_RECAP"]) expect(a.some((t) => t.kind === kind)).toBe(true);
    const daily = a.find((t) => t.name === "Daily journal")!;
    expect(JSON.stringify(await getTemplateContent(daily.id))).toContain("End-of-day review");
    expect(await getTemplateContent("missing")).toBeNull();
  });

  it("day stats are a faithful snapshot of that day", async (ctx) => {
    if (!reachable) return ctx.skip();
    expect(JSON.stringify(await getDayStatsBlock("2031-05-04"))).toContain("No closed trades on 2031-05-04");
    expect(await getDayStatsBlock("not-a-day")).toEqual([]);

    const acc = await db.account.create({ data: { name: `${P}stats`, platform: "MANUAL", currency: "AUD", startingBalance: 0, syncType: "MANUAL" } });
    accountId = acc.id;
    const day = new Date(`${DAY}T00:00:00Z`);
    const mkT = (i: number, net: number) =>
      db.trade.create({
        data: { accountId, brokerTicket: `st-${i}`, symbol: "XAUUSD", side: "LONG", status: "CLOSED", openedAt: new Date(Date.UTC(2031, 4, 5, 7, i)), closedAt: new Date(Date.UTC(2031, 4, 5, 7, i, 30)), openDay: day, closeDay: day, quantity: 0.1, avgEntry: 2000, avgExit: 2001, grossPnl: net, commission: 0, netPnl: net, result: net > 0 ? "WIN" : "LOSS" },
      });
    await mkT(1, 100);
    await mkT(2, 50);
    await mkT(3, -30);
    const text = JSON.stringify(await getDayStatsBlock(DAY));
    expect(text).toContain("Day stats · 2031-05-05");
    expect(text).toContain("Net P&L: +A$120.00");
    expect(text).toContain("Trades: 3 (2 W · 0 BE · 1 L), win rate 67%");
    expect(text).toContain("Profit factor: 5.00"); // 150 / 30
    expect(text).toContain("Best trade +A$100.00");
    expect(text).toContain("worst trade −A$30.00");
  });
});
