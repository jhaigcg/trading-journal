/**
 * Server actions run against the real database with the login session and Next's cache calls stubbed.
 * Uses a throw-away account; skipped automatically if no database is reachable.
 */
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getSession: async () => ({ uid: "test" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import { db } from "@/lib/db";
import { bulkAction, deleteAttachment, loadNote, saveNote, setRuleCheck, setReviewed, setShare, setTradeTags, updateTradeFields, uploadAttachment } from "@/app/(app)/trades/actions";
import { loadTradeDetail } from "@/lib/queries/trade-detail";

const NAME = "TEST actions account (vitest)";
let reachable = false;
let accountId = "";
let strategyA = "";
let strategyB = "";
let ruleA = "";
let ruleB = "";
let tagIds: string[] = [];
const ids: string[] = [];

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

async function mkTrade(i: number, extra: Record<string, unknown> = {}) {
  const opened = new Date(Date.UTC(2026, 0, 12, 7, i));
  const t = await db.trade.create({
    data: {
      accountId,
      brokerTicket: `act-${i}`,
      symbol: "XAUUSD",
      side: "LONG",
      status: "CLOSED",
      openedAt: opened,
      closedAt: new Date(opened.getTime() + 300_000),
      openDay: new Date("2026-01-12T00:00:00Z"),
      closeDay: new Date("2026-01-12T00:00:00Z"),
      quantity: 0.2,
      avgEntry: 2000,
      avgExit: 2004,
      grossPnl: 80,
      netPnl: 78.6,
      commission: -1.4,
      result: "WIN",
      ...extra,
    },
  });
  ids.push(t.id);
  return t;
}

beforeAll(async () => {
  try {
    await db.$queryRaw`select 1`;
    reachable = true;
    await db.symbolConfig.upsert({ where: { symbol: "XAUUSD" }, update: {}, create: { symbol: "XAUUSD", pipSize: 0.01, contractSize: 100, aliases: [] } });
    await db.account.deleteMany({ where: { name: NAME } });
    accountId = (await db.account.create({ data: { name: NAME, platform: "MANUAL", currency: "AUD", startingBalance: 0, syncType: "MANUAL" } })).id;
    const mk = async (name: string) =>
      db.strategy.create({ data: { name, groups: { create: [{ name: "Entry", rules: { create: [{ text: `${name} rule` }] } }] } }, include: { groups: { include: { rules: true } } } });
    const a = await mk("TEST strat A");
    const b = await mk("TEST strat B");
    strategyA = a.id;
    strategyB = b.id;
    ruleA = a.groups[0].rules[0].id;
    ruleB = b.groups[0].rules[0].id;
    const cat = await db.tagCategory.upsert({ where: { name: "TEST cat" }, update: {}, create: { name: "TEST cat" } });
    tagIds = [];
    for (const n of ["t1", "t2"]) tagIds.push((await db.tag.upsert({ where: { categoryId_name: { categoryId: cat.id, name: n } }, update: {}, create: { categoryId: cat.id, name: n } })).id);
  } catch {
    reachable = false;
  }
});

afterAll(async () => {
  if (reachable) {
    await db.dailySummary.deleteMany({ where: { accountId } });
    await db.note.deleteMany({ where: { OR: [{ tradeId: { in: ids } }, { title: "Daily journal · 2031-03-03" }] } });
    await db.account.deleteMany({ where: { name: NAME } });
    await db.strategy.deleteMany({ where: { name: { startsWith: "TEST strat" } } });
    await db.tagCategory.deleteMany({ where: { name: "TEST cat" } });
    await rm(path.resolve(process.cwd(), ".data", "uploads", "trades"), { recursive: true, force: true, maxRetries: 2 }).catch(() => undefined);
  }
  await db.$disconnect();
});

describe("editing a trade", () => {
  it("recalculates risk and R when the stop or target changes", async (ctx) => {
    if (!reachable) return ctx.skip();
    const t = await mkTrade(1);
    const r1 = await updateTradeFields(t.id, { stopLoss: 1995, profitTarget: 2010 });
    expect(r1).toMatchObject({ ok: true, tradeRisk: 100, plannedR: 2, realizedR: 0.79 });
    const r2 = await updateTradeFields(t.id, { stopLoss: 1990 });
    expect(r2).toMatchObject({ ok: true, tradeRisk: 200, plannedR: 1, realizedR: 0.39 });
    const d = (await loadTradeDetail({ id: t.id }))!;
    expect(d).toMatchObject({ stopLoss: 1990, profitTarget: 2010, initialTarget: 2010, tradeRisk: 200, plannedR: 1, realizedR: 0.39 });
    const r3 = await updateTradeFields(t.id, { stopLoss: null });
    expect(r3).toMatchObject({ ok: true, tradeRisk: null, plannedR: null, realizedR: null });
  });

  it("rejects a stop or target on the wrong side of the entry, and out-of-range ratings", async (ctx) => {
    if (!reachable) return ctx.skip();
    const t = await mkTrade(2);
    expect(await updateTradeFields(t.id, { stopLoss: 2005 })).toMatchObject({ ok: false });
    expect(await updateTradeFields(t.id, { profitTarget: 1990 })).toMatchObject({ ok: false });
    expect(await updateTradeFields(t.id, { rating: 6 })).toMatchObject({ ok: false });
    expect(await updateTradeFields(t.id, { rating: 3.3 })).toMatchObject({ ok: false });
    expect(await updateTradeFields("missing", { rating: 3 })).toMatchObject({ ok: false });
    expect((await loadTradeDetail({ id: t.id }))!.stopLoss).toBeNull(); // nothing was saved
  });

  it("rating, reviewed flag, tags and share link", async (ctx) => {
    if (!reachable) return ctx.skip();
    const t = await mkTrade(3);
    expect(await updateTradeFields(t.id, { rating: 4.5 })).toMatchObject({ ok: true });
    expect(await setReviewed(t.id, true)).toEqual({ ok: true });
    expect(await setTradeTags(t.id, [tagIds[0], tagIds[1], "bogus-id"])).toEqual({ ok: true });
    let d = (await loadTradeDetail({ id: t.id }))!;
    expect(d).toMatchObject({ rating: 4.5, reviewed: true });
    expect(d.tags.map((x) => x.name).sort()).toEqual(["t1", "t2"]);
    await setTradeTags(t.id, [tagIds[1]]);
    expect((await loadTradeDetail({ id: t.id }))!.tags.map((x) => x.name)).toEqual(["t2"]);

    const on = await setShare(t.id, true);
    expect(on.ok && on.token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    const again = await setShare(t.id, true);
    expect(again.ok && again.token).toBe(on.ok && on.token); // stable while enabled
    d = (await loadTradeDetail({ shareToken: (on as { token: string }).token }))!;
    expect(d.id).toBe(t.id);
    await setShare(t.id, false);
    expect(await loadTradeDetail({ shareToken: (on as { token: string }).token })).toBeNull(); // old link is dead
  });
});

describe("strategy rules", () => {
  it("answers belong to the trade's strategy and are cleared when the strategy changes", async (ctx) => {
    if (!reachable) return ctx.skip();
    const t = await mkTrade(4);
    expect(await setRuleCheck(t.id, ruleA, true)).toMatchObject({ ok: false }); // no strategy yet
    await updateTradeFields(t.id, { strategyId: strategyA });
    expect(await setRuleCheck(t.id, ruleA, true)).toEqual({ ok: true });
    expect(await setRuleCheck(t.id, ruleB, true)).toMatchObject({ ok: false }); // rule of another strategy
    let d = (await loadTradeDetail({ id: t.id }))!;
    expect(d.strategy!.groups[0].rules[0]).toMatchObject({ id: ruleA, followed: true });
    await setRuleCheck(t.id, ruleA, false);
    d = (await loadTradeDetail({ id: t.id }))!;
    expect(d.strategy!.groups[0].rules[0].followed).toBe(false);
    await setRuleCheck(t.id, ruleA, null);
    expect((await loadTradeDetail({ id: t.id }))!.strategy!.groups[0].rules[0].followed).toBeNull();

    await setRuleCheck(t.id, ruleA, true);
    await updateTradeFields(t.id, { strategyId: strategyB });
    expect(await db.tradeRuleCheck.count({ where: { tradeId: t.id } })).toBe(0);
    await updateTradeFields(t.id, { strategyId: null });
    expect((await loadTradeDetail({ id: t.id }))!.strategy).toBeNull();
  });
});

describe("bulk actions", () => {
  it("assign strategy, add tags, mark reviewed, delete", async (ctx) => {
    if (!reachable) return ctx.skip();
    const a = await mkTrade(10);
    const b = await mkTrade(11);
    const sel = [a.id, b.id];
    expect(await bulkAction({ action: "strategy", ids: sel, strategyId: strategyA })).toEqual({ ok: true, count: 2 });
    expect((await db.trade.findMany({ where: { id: { in: sel } } })).every((t) => t.strategyId === strategyA)).toBe(true);
    expect(await bulkAction({ action: "strategy", ids: sel, strategyId: "nope" })).toMatchObject({ ok: false });

    await bulkAction({ action: "addTags", ids: sel, tagIds: [tagIds[0]] });
    await bulkAction({ action: "addTags", ids: sel, tagIds: [tagIds[0], tagIds[1]] }); // overlap is fine
    expect(await db.tradeTag.count({ where: { tradeId: { in: sel } } })).toBe(4);

    await bulkAction({ action: "reviewed", ids: sel, reviewed: true });
    expect((await db.trade.findMany({ where: { id: { in: sel } } })).every((t) => t.reviewed)).toBe(true);

    expect(await bulkAction({ action: "delete", ids: [a.id] })).toEqual({ ok: true, count: 1 });
    expect(await db.trade.findUnique({ where: { id: a.id } })).toBeNull();
    expect(await db.trade.findUnique({ where: { id: b.id } })).not.toBeNull();
    expect(await bulkAction({ action: "delete", ids: [] })).toMatchObject({ ok: false });
  });
});

describe("notes", () => {
  it("trade note and daily journal round-trip, autosave updates in place", async (ctx) => {
    if (!reachable) return ctx.skip();
    const t = await mkTrade(20);
    const empty = await loadNote({ kind: "TRADE", tradeId: t.id });
    expect(empty).toMatchObject({ id: null, content: null });

    const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
    const s1 = await saveNote({ kind: "TRADE", tradeId: t.id }, JSON.stringify(doc("first")), "first");
    expect(s1.ok).toBe(true);
    await saveNote({ kind: "TRADE", tradeId: t.id }, JSON.stringify(doc("second")), "second");
    expect(await db.note.count({ where: { tradeId: t.id, kind: "TRADE" } })).toBe(1); // updated, not duplicated
    const back = await loadNote({ kind: "TRADE", tradeId: t.id });
    expect(back.content).toEqual(doc("second"));

    await saveNote({ kind: "DAILY", day: "2031-03-03" }, JSON.stringify(doc("day")), "day");
    expect((await loadNote({ kind: "DAILY", day: "2031-03-03" })).content).toEqual(doc("day"));
    expect(await saveNote({ kind: "TRADE", tradeId: t.id }, "not json", "x")).toMatchObject({ ok: false });
  });
});

describe("screenshots", () => {
  it("accepts real images, rejects fakes and oversize files, and deletes", async (ctx) => {
    if (!reachable) return ctx.skip();
    const t = await mkTrade(30);
    const form = (bytes: Buffer, type: string, name = "a.png") => {
      const f = new FormData();
      f.set("file", new File([new Uint8Array(bytes)], name, { type }));
      return f;
    };
    const ok = await uploadAttachment(t.id, form(PNG, "image/png"));
    expect(ok.ok).toBe(true);
    const d = (await loadTradeDetail({ id: t.id }))!;
    expect(d.attachments).toHaveLength(1);
    expect(d.attachments[0].url).toMatch(/^\/api\/files\/trades\/.+\.png$/);
    const key = d.attachments[0].url.replace("/api/files/", "");
    expect(existsSync(path.resolve(process.cwd(), ".data", "uploads", key))).toBe(true);

    expect(await uploadAttachment(t.id, form(Buffer.from("<svg onload=alert(1)></svg>"), "image/svg+xml", "x.svg"))).toMatchObject({ ok: false });
    expect(await uploadAttachment(t.id, form(Buffer.from("MZ not really a png"), "image/png"))).toMatchObject({ ok: false }); // bytes must match the declared type
    expect(await uploadAttachment(t.id, form(Buffer.concat([PNG, Buffer.alloc(9 * 1024 * 1024)]), "image/png"))).toMatchObject({ ok: false });
    expect(await uploadAttachment("missing", form(PNG, "image/png"))).toMatchObject({ ok: false });

    if (ok.ok) expect(await deleteAttachment(ok.id)).toEqual({ ok: true });
    expect(existsSync(path.resolve(process.cwd(), ".data", "uploads", key))).toBe(false);
    expect((await loadTradeDetail({ id: t.id }))!.attachments).toHaveLength(0);
  });
});
